'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const { serialize, parse } = require('../src/core/format');
const { createNote } = require('../src/core/note');
const { resolveNotes, rebaseNotes } = require('../src/core/anchors');
const { applyChanges, trackEdits } = require('../src/core/edits');
const { render } = require('../src/core/render');
const service = require('../src/node/service');
const { sourceHash, hash } = require('../src/core/text');
const SOURCE = 'function App() {\n  const ready = session.ready;\n  if (!ready) return null;\n  return render();\n}\n';
const note = () => createNote(SOURCE, 3, 'Wait until restoration finishes.', { id: 'sc_wait' });
const v2 = notes => parse(serialize('app.ts', notes)).notes;
const FIXTURES = path.join(__dirname, 'fixtures');
const guards = snapshot => ({ expectedSource: snapshot.sourceHash, expectedSidecar: snapshot.sidecarHash });
const FOREIGN = '# comment-sidecar v1\n--- app.ts\n+++ app.ts.annotated\n@@ -2,3 +2,4 @@ id=sc_old base=' + 'a'.repeat(64) + ' state=attached\n   const ready = session.ready;\n+// Unknown-version note.\n   if (!ready) return null;\n';

test('v2 stores coordinates, fingerprints and comments without copying target or neighbor code', () => {
  const raw = serialize('app.ts', [note()]);

  assert.match(raw, /^# comment-sidecar v2\n/);
  assert.match(raw, /^@@ 3 @@ id=sc_wait/m);
  assert.match(raw, /^@anchor sha256 /m);
  assert.match(raw, /^\+\/\/ Wait until restoration finishes\./m);
  for (const line of SOURCE.trimEnd().split('\n')) {
    assert.ok(!raw.split('\n').includes(` ${line}`));
  }
  assert.doesNotMatch(raw, /session\.ready|function App|return render|return null/);

  const parsed = parse(raw).notes[0];
  assert.deepEqual(parsed, note());
  assert.deepEqual(Object.keys(parsed).sort(), ['anchor', 'base', 'id', 'line', 'state', 'text']);
  assert.deepEqual(Object.keys(parsed.anchor).sort(), ['after', 'before', 'context', 'strong', 'target']);
});

test('new comments get sc_ IDs and lc_ IDs from earlier versions stay valid', () => {
  assert.match(createNote(SOURCE, 3, 'New.').id, /^sc_[a-f0-9]{12}$/);

  const legacy = createNote(SOURCE, 3, 'Written before 1.1.0.', { id: 'lc_legacy' });
  const raw = serialize('app.ts', [legacy]);
  assert.match(raw, /^@@ 3 @@ id=lc_legacy /m);
  assert.deepEqual(parse(raw).notes[0], legacy);
  assert.throws(() => serialize('app.ts', [createNote(SOURCE, 3, 'Unknown prefix.', { id: 'xx_note' })]), /Invalid note ID/);
});

test('v2 round trips multiline bodies, empty body lines, diff-looking text and Unicode', () => {
  const item = createNote(SOURCE, 3, 'Reason.\n\n@@ not a header\n@anchor not metadata\n+// body\nαβ 日本語 🧪\n', { id: 'sc_body' });

  assert.deepEqual(v2([item])[0], item);

  const raw = serialize('app.ts', [item]).replaceAll('\n', '\r\n');
  assert.deepEqual(parse(raw).notes[0], item);
  assert.equal(resolveNotes(SOURCE.replaceAll('\n', '\r\n'), parse(raw).notes)[0].status, 'attached');
});

test('v2 handles empty files, trailing empty lines and duplicate comments at one line', () => {
  for (const [source, line] of [['', 1], [SOURCE, 6]]) {
    const notes = v2([createNote(source, line, 'Boundary comment.')]);
    assert.equal(resolveNotes(source, notes)[0].line, line);
  }

  const notes = v2([note(), createNote(SOURCE, 3, 'Second note.', { id: 'sc_second' })]);
  assert.equal(notes.length, 2);
  assert.equal(resolveNotes(SOURCE, notes).filter(n => n.line === 3).length, 2);
});

const cases = [
  ['unchanged revision', SOURCE, 3, 'attached'],
  ['insertion above', '// unrelated\n' + SOURCE, 4, 'moved'],
  ['block moved with intact context', 'const unrelated = true;\n' + SOURCE, 4, 'moved'],
  ['neighbors changed', SOURCE.replace('session.ready', 'readiness'), 3, 'review'],
  ['duplicated full context', SOURCE + SOURCE, null, 'ambiguous'],
  ['duplicated target only', 'a\n  if (!ready) return null;\nb\n  if (!ready) return null;\nc', null, 'ambiguous'],
  ['rewritten target', SOURCE.replace('!ready', 'loading'), null, 'detached'],
  ['deleted target', SOURCE.replace('  if (!ready) return null;\n', ''), null, 'detached'],
];
for (const [name, source, line, status] of cases) {
  test(`v2 resolves ${name} conservatively`, () => {
    const result = resolveNotes(source, v2([note()]))[0];
    assert.equal(result.line, line);
    assert.equal(result.status, status);
  });
}

test('weak generic target never becomes a target-only match after context changes', () => {
  const item = createNote('first\n}\nlast', 2, 'Closing constraint.');
  assert.equal(resolveNotes('other\n}\nchanged', v2([item]))[0].status, 'detached');
});

test('v2 live editing, deletion, saved review and tombstone survive reload', () => {
  const initial = resolveNotes(SOURCE, v2([note()]));

  const changes = [{ rangeOffset: SOURCE.indexOf('!ready'), rangeLength: 6, text: 'loading' }];
  const changed = applyChanges(SOURCE, changes);
  const results = trackEdits(SOURCE, changed, initial, changes);
  assert.equal(resolveNotes(changed, v2(rebaseNotes(changed, results)))[0].status, 'review');

  const start = SOURCE.indexOf('  if');
  const removal = [{ rangeOffset: start, rangeLength: SOURCE.indexOf('\n', start) - start + 1, text: '' }];
  const deleted = applyChanges(SOURCE, removal);
  const detached = trackEdits(SOURCE, deleted, initial, removal);
  const persisted = v2(rebaseNotes(deleted, detached));
  assert.equal(persisted[0].state, 'detached');
  assert.equal(resolveNotes(SOURCE, persisted)[0].line, null);
});

test('v2 agent rendering never emits anchor fingerprints or metadata blocks', () => {
  const notes = v2([note()]);
  const output = render(SOURCE, resolveNotes(SOURCE, notes), { start: 2, end: 4 });

  assert.match(output, /^3 \|   if \(!ready\) return null;/m);
  assert.match(output, /@3 \[sc_wait;attached\]/);
  assert.ok(!output.includes(notes[0].anchor.target));
  assert.ok(!output.includes(notes[0].anchor.context));
  assert.doesNotMatch(output, /@anchor|@@|base=/);

  const only = render(SOURCE, resolveNotes(SOURCE, notes), { mode: 'comments' });
  assert.doesNotMatch(only, /session\.ready|return null/);
});

test('v2 rejects source context, additions, deletions, incomplete bodies and malformed fingerprints', () => {
  const raw = serialize('app.ts', [note()]);
  for (const replacement of ['+const injected = 1;', '-const old = 1;', ' const copied = 1;']) {
    assert.throws(() => parse(raw.replace('+// Wait until restoration finishes.', replacement)), /not allowed/);
  }
  assert.throws(() => parse(raw.replace('+// Wait until restoration finishes.\n', '')), /Comment/);
  assert.throws(() => parse(raw.replace('target=', 'target=z')), /fingerprint/);
  assert.throws(() => parse(raw.replace('before=2', 'before=9')), /fingerprint/);
  assert.throws(() => parse(raw.replace('@@ 3 @@', '@@ 0 @@')), /line/);
  assert.throws(() => parse(raw.replace('@@ 3 @@', '@@ 9007199254740992 @@')), /line/);
  assert.throws(() => parse(raw.replace('state=attached', 'state=unverified')), /header/);
  assert.throws(() => parse(raw.slice(0, -1)), /newline/);
  assert.throws(() => parse(raw.replace('.annotated', '.wrong')), /header/);
  assert.throws(() => parse(raw.replace('v2', 'v999')), /version/);
  assert.throws(() => serialize('app.ts', [note(), note()]), /duplicate/);
  assert.throws(() => serialize('app.ts\n', [note()]), /filename/);
  const duplicate = raw + raw.split('\n').slice(3).join('\n');
  assert.throws(() => parse(duplicate), /duplicate/);
});

test('v2 enforces sidecar size, comment length and note count limits', () => {
  assert.throws(() => parse('# comment-sidecar v2\n' + 'x'.repeat(2097152)), /2 MiB/);
  const invalid = { ...note(), text: 'x'.repeat(16001) };
  assert.throws(() => serialize('app.ts', [invalid]), /Comment/);
  assert.throws(() => serialize('app.ts', Array(1001).fill(note())), /Too many/);
  const many = Array.from({ length: 1001 }, (_, i) => ({ ...note(), id: `sc_n${i}` }));
  const raw = serialize('app.ts', many.slice(0, 1000)) +
    serialize('app.ts', many.slice(1000)).split('\n').slice(3).join('\n');
  assert.throws(() => parse(raw), /Too many/);
});

test('v2 insertion property check preserves attachment at 100 different offsets', () => {
  const items = v2([note()]);
  for (let count = 1; count <= 100; count++) {
    const source = Array.from({ length: count }, (_, i) => `const other${i} = true;`).join('\n') + '\n' + SOURCE;
    const result = resolveNotes(source, items)[0];
    assert.equal(result.line, count + 3);
    assert.equal(result.status, 'moved');
  }
});

test('golden sidecar parses, re-serializes byte-identically and is reproduced by createNote', async () => {
  const [source, raw, expected] = await Promise.all(
    ['golden.ts', 'golden.ts.comment', 'golden.ts.comment.json'].map(name =>
      fs.readFile(path.join(FIXTURES, name), 'utf8')
    )
  );

  const parsed = parse(raw);
  assert.deepEqual(parsed, JSON.parse(expected));
  assert.equal(serialize('golden.ts', parsed.notes), raw);
  assert.equal(parse(raw.replaceAll('\n', '\r\n')).notes.length, parsed.notes.length);

  const rebuilt = parsed.notes.map(item =>
    createNote(source, item.line, item.text, { id: item.id, state: item.state })
  );
  assert.equal(serialize('golden.ts', rebuilt), raw);

  const results = resolveNotes(source, parsed.notes);
  assert.deepEqual(
    results.map(item => [item.note.id, item.line, item.status]),
    parsed.notes.map(item => [item.id, item.state === 'detached' ? null : item.line, item.state])
  );
});

test('bundled example sidecar loads, resolves and re-serializes without changes', async () => {
  const source = await fs.readFile(path.join(__dirname, '../examples/app.tsx'), 'utf8');
  const raw = await fs.readFile(path.join(__dirname, '../examples/app.tsx.comment'), 'utf8');

  const { name, notes } = parse(raw);
  assert.equal(serialize(name, notes), raw);
  assert.ok(notes.length > 0);
  assert.ok(resolveNotes(source, notes).every(item => item.status === 'attached'));
});

test('createNote returns only the canonical fingerprint shape without copied source', () => {
  const item = note();
  assert.deepEqual(Object.keys(item), ['id', 'base', 'state', 'line', 'text', 'anchor']);
  assert.deepEqual(Object.keys(item.anchor), ['before', 'after', 'strong', 'target', 'context']);
  assert.deepEqual([item.anchor.before, item.anchor.after, item.anchor.strong], [2, 2, true]);
  assert.doesNotMatch(JSON.stringify(item), /session\.ready|return null|return render/);
  assert.equal(createNote(SOURCE, 1, 'x').anchor.before, 0);
  assert.equal(createNote('a\r\nb', 1, 'one\r\ntwo').text, 'one\ntwo');
});

test('notes with copied source instead of an anchor are rejected', () => {
  const unanchored = {
    id: 'sc_old',
    base: 'a'.repeat(64),
    state: 'attached',
    line: 3,
    before: ['a', 'b'],
    target: 'c',
    after: [],
    text: 'Old.',
  };
  assert.throws(() => serialize('app.ts', [unanchored]), /anchor/);
  assert.throws(() => resolveNotes(SOURCE, [unanchored]), /anchor/);
  assert.throws(() => serialize('app.ts', [{ ...note(), anchor: { ...note().anchor, target: 'short' } }]), /anchor/);
  assert.throws(() => serialize('app.ts', [{ ...note(), anchor: { ...note().anchor, before: 3 } }]), /context counts/);
  assert.throws(() => serialize('app.ts', [{ ...note(), state: 'moved' }]), /state/);
  assert.throws(() => serialize('app.ts', [{ ...note(), state: 'ambiguous' }]), /state/);
});

test('any header other than v2 is rejected as an unsupported version', () => {
  assert.throws(() => parse(FOREIGN), /Unsupported .comment file version/);
  assert.throws(() => parse(FOREIGN.replaceAll('\n', '\r\n')), /Unsupported .comment file version/);
  assert.throws(() => parse('# comment-sidecar v3\n'), /Unsupported .comment file version/);
  assert.throws(() => parse(''), /Unsupported .comment file version/);
});

async function workspace(t, sidecar) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'comment-sidecar-format-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'app.ts'), SOURCE);
  if (sidecar !== undefined) {
    await fs.writeFile(path.join(root, 'app.ts.comment'), sidecar);
  }
  return root;
}

test('service writes fingerprint anchors for add, reanchor, review and sync without touching source', async t => {
  const root = await workspace(t);
  let snapshot = await service.load(root, 'app.ts');
  const added = await service.write(root, 'app.ts', {
    operation: 'add',
    line: 3,
    text: 'New note.',
    expectedText: '  if (!ready) return null;',
    ...guards(snapshot),
  });
  assert.equal(added.formatVersion, 2);

  const changed = SOURCE.replace('session.ready', 'readiness');
  await fs.writeFile(path.join(root, 'app.ts'), changed);
  snapshot = await service.load(root, 'app.ts');
  assert.equal(snapshot.results[0].status, 'review');

  const expectAnchor = expected =>
    assert.deepEqual(
      snapshot.notes[0],
      createNote(changed, expected.line, 'New note.', { id: added.id, base: snapshot.sourceHash, state: expected.state })
    );

  for (const [operation, extra, expected] of [
    ['sync', {}, { line: 3, state: 'review' }],
    ['review', { id: added.id }, { line: 3, state: 'attached' }],
    ['reanchor', { id: added.id, line: 4, expectedText: '  return render();' }, { line: 4, state: 'attached' }],
  ]) {
    await service.write(root, 'app.ts', { operation, ...extra, ...guards(snapshot) });
    snapshot = await service.load(root, 'app.ts');
    expectAnchor(expected);
    assert.doesNotMatch(snapshot.raw, /readiness|return null|return render/);
  }

  assert.equal(await fs.readFile(path.join(root, 'app.ts'), 'utf8'), changed);
});

test('service rejects unknown operations', async t => {
  const root = await workspace(t, serialize('app.ts', [note()]));
  const snapshot = await service.load(root, 'app.ts');

  await assert.rejects(
    () => service.write(root, 'app.ts', { operation: 'rename', ...guards(snapshot) }),
    /Operation must be add, update, remove, reanchor, review, or sync/
  );
});

test('reading a valid v2 sidecar never rewrites it', async t => {
  const raw = serialize('app.ts', [note()]);
  const root = await workspace(t, raw);
  const before = await fs.stat(path.join(root, 'app.ts.comment'));

  await service.read(root, 'app.ts');
  await service.check(root);

  assert.equal(await fs.readFile(path.join(root, 'app.ts.comment'), 'utf8'), raw);
  assert.equal((await fs.stat(path.join(root, 'app.ts.comment'))).mtimeMs, before.mtimeMs);
});

for (const [label, sidecar] of [
  ['unsupported-version', FOREIGN],
  ['malformed', '# comment-sidecar v2\n--- app.ts\n+++ app.ts.annotated\n@@ broken\n'],
]) {
  test(`${label} sidecars are reported and left byte-identical by every write path`, async t => {
    const root = await workspace(t, sidecar);
    const file = path.join(root, 'app.ts.comment');

    await assert.rejects(
      () => service.load(root, 'app.ts'),
      label === 'malformed' ? /hunk header/ : /Unsupported .comment file version/
    );
    const report = await service.check(root);
    assert.equal(report.problems, 1);
    assert.equal(report.reports[0].status, 'error');

    const stale = { expectedSource: sourceHash(SOURCE), expectedSidecar: hash(sidecar) };
    for (const options of [
      { operation: 'add', line: 3, text: 'x', expectedText: '  if (!ready) return null;' },
      { operation: 'update', id: 'sc_old', text: 'x' },
      { operation: 'remove', id: 'sc_old' },
      { operation: 'reanchor', id: 'sc_old', line: 3, expectedText: '  if (!ready) return null;' },
      { operation: 'review', id: 'sc_old' },
      { operation: 'sync' },
    ]) {
      await assert.rejects(() => service.write(root, 'app.ts', { ...options, ...stale }));
    }

    const cli = path.join(__dirname, '../src/cli.js');
    await assert.rejects(
      () => exec(process.execPath, [cli, 'read', 'app.ts', '--root', root]),
      error => error.code === 2 && /Comment Sidecar:/.test(error.stderr)
    );
    await assert.rejects(
      () => exec(process.execPath, [
        cli, 'sync', 'app.ts', '--root', root,
        '--source-hash', stale.expectedSource,
        '--sidecar-hash', stale.expectedSidecar,
      ]),
      error => error.code === 2
    );

    assert.equal(await fs.readFile(file, 'utf8'), sidecar);
    assert.equal(await fs.readFile(path.join(root, 'app.ts'), 'utf8'), SOURCE);
  });
}
