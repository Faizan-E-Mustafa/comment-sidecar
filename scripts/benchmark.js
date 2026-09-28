'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { performance } = require('node:perf_hooks');

function measure(fn, iterations = 100) {
  for (let i = 0; i < 10; i++) {
    fn();
  }

  const samples = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    samples.push(performance.now() - start);
  }

  samples.sort((a, b) => a - b);
  return {
    medianMs: +samples[Math.floor(samples.length * 0.5)].toFixed(5),
    p95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(5),
  };
}

function loadImplementation(root) {
  const load = relative => require(path.join(root, relative));
  const originalLoad = Module._load;
  let Store;
  try {
    Module._load = function (request, ...args) {
      return request === 'vscode' ? {} : originalLoad.call(this, request, ...args);
    };

    ({ Store } = load('src/extension/store.js'));
  } finally {
    Module._load = originalLoad;
  }

  return {
    root,
    version: load('package.json').version,
    Store,
    ...load('src/core/note.js'),
    ...load('src/core/format.js'),
    ...load('src/core/anchors.js'),
    ...load('src/core/render.js'),
    ...load('src/core/edits.js'),
    ...load('src/core/text.js'),
  };
}

function noCommentEdit(implementation, tail) {
  let count = 0;
  let previousHeader = 'let count = 0;\n';
  const uri = { toString: () => 'benchmark://source' };
  const document = { uri, text: previousHeader + tail, version: 1, getText() { return this.text; } };
  const store = new implementation.Store(() => {}, error => { throw error; });
  store.cache.set(uri.toString(), {
    source: document.text,
    version: 1,
    snapshot: { notes: [] },
    results: [],
    byLine: new Map(),
    history: new Map([[implementation.sourceHash(document.text), []]]),
  });
  return () => {
    const header = `let count = ${++count};\n`;
    const change = { rangeOffset: 0, rangeLength: previousHeader.length, text: header };
    document.text = header + tail;
    document.version++;
    store.changed({ document, contentChanges: [change] });
    previousHeader = header;
  };
}

function run(implementation) {
  const reports = [];
  for (const [lineCount, noteCount] of [[1000, 20], [10000, 200]]) {
    const source = Array.from({ length: lineCount }, (_, i) => `const value${i} = calculate(${i});`).join('\n');
    const base = implementation.sourceHash(source);
    const notes = Array.from({ length: noteCount }, (_, i) => implementation.createNote(
      source,
      4 + i * Math.floor((lineCount - 8) / noteCount),
      'Preserve the initialization order before using this value.',
      { base, id: `sc_bench${i}` },
    ));
    const raw = implementation.serialize('example.ts', notes);
    const persisted = implementation.parse(raw).notes;
    const results = implementation.resolveNotes(source, persisted);
    const changed = '\n' + source;
    reports.push({
      lineCount,
      noteCount,
      sourceBytes: Buffer.byteLength(source),
      sidecarBytes: Buffer.byteLength(raw),
      createNotes: measure(() => notes.map(note => implementation.createNote(
        source, note.line, note.text, { base, id: note.id },
      )), 20),
      serialize: measure(() => implementation.serialize('example.ts', persisted)),
      parse: measure(() => implementation.parse(raw)),
      resolveSameRevision: measure(() => implementation.resolveNotes(source, persisted)),
      resolveExternalEdit: measure(() => implementation.resolveNotes(changed, persisted)),
      trackEditorInsertion: measure(() => implementation.trackEdits(
        source, changed, results, [{ rangeOffset: 0, rangeLength: 0, text: '\n' }],
      )),
      render200Lines: measure(() => implementation.render(source, results, { start: 1, end: 200 })),
    });
    reports.push({
      lineCount,
      noteCount: 0,
      sourceBytes: Buffer.byteLength(source),
      storeEditWithoutComments: measure(noCommentEdit(implementation, source)),
    });
  }

  return { version: implementation.version, reports };
}

const args = process.argv.slice(2);

if (args.length && (args.length !== 2 || args[0] !== '--baseline')) {
  console.error('Usage: npm run benchmark [-- --baseline /path/to/older/source]');
  process.exitCode = 2;
} else {
  const root = path.resolve(__dirname, '..');
  const result = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpu: os.cpus()[0]?.model,
    measuredAt: new Date().toISOString(),
    method: 'Warm single-process synthetic microbenchmarks. 10 warmups, 100 samples. '
      + 'Store.changed uses a minimal document fixture with no editor UI or filesystem. This is NOT '
      + 'end-to-end editor latency or a token benchmark.',
  };
  if (args.length) {
    result.baseline = run(loadImplementation(path.resolve(args[1])));
  }

  result.current = run(loadImplementation(root));

  const directory = path.join(root, 'reports');
  fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, args.length ? 'PERFORMANCE-COMPARISON.json' : 'BENCHMARK.json');
  fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
