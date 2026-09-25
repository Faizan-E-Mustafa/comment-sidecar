'use strict';
const fs = require('node:fs');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { createNote, serialize, parse } = require('../src/core/format');
const { resolveNotes } = require('../src/core/anchors');
const { render } = require('../src/core/render');
const { trackEdits } = require('../src/core/edits');
const { sourceHash } = require('../src/core/text');
const reports = [];
function measure(fn, iterations = 100) {
  for (let i = 0; i < 10; i++) fn();
  const samples = [];
  for (let i = 0; i < iterations; i++) { const start = performance.now(); fn(); samples.push(performance.now() - start); }
  samples.sort((a, b) => a - b);
  return { medianMs: +samples[Math.floor(samples.length * 0.5)].toFixed(3), p95Ms: +samples[Math.floor(samples.length * 0.95)].toFixed(3) };
}
for (const [lineCount, noteCount] of [[1000, 20], [10000, 200]]) {
  const source = Array.from({ length: lineCount }, (_, i) => `const value${i} = calculate(${i});`).join('\n');
  const base = sourceHash(source);
  const notes = Array.from({ length: noteCount }, (_, i) => createNote(source, 4 + i * Math.floor((lineCount - 8) / noteCount), 'Preserve the initialization order before using this value.', { base }));
  for (const formatVersion of [1, 2]) {
  const raw = serialize('example.ts', notes, { version: formatVersion });
  const persisted = parse(raw).notes;
  const results = resolveNotes(source, persisted);
  const changed = '\n' + source;
  reports.push({ formatVersion, lineCount, noteCount, sourceBytes: Buffer.byteLength(source), sidecarBytes: Buffer.byteLength(raw),
    parse: measure(() => parse(raw)),
    resolveExternalEdit: measure(() => resolveNotes(changed, persisted)),
    trackEditorInsertion: measure(() => trackEdits(source, changed, results, [{ rangeOffset: 0, rangeLength: 0, text: '\n' }])),
    hoverLookup: measure(() => results.filter(item => item.line === 4), 1000),
    render200Lines: measure(() => render(source, results, { start: 1, end: 200 })),
  });
  }
}
const metadata = { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model, measuredAt: new Date().toISOString(), method: 'Warm single-process microbenchmarks; 100 samples (1000 for hover); not end-to-end editor latency.', reports };
fs.writeFileSync('BENCHMARK.json', JSON.stringify(metadata, null, 2) + '\n');
console.log(JSON.stringify(metadata, null, 2));
