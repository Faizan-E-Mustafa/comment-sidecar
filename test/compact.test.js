'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const exec = promisify(require('node:child_process').execFile);
const { createNote, serialize, parse, sidecarVersion } = require('../src/core/format');
const { compactNote } = require('../src/core/fingerprints');
const { resolveNotes, rebaseNotes } = require('../src/core/anchors');
const { applyChanges, trackEdits } = require('../src/core/edits');
const { render } = require('../src/core/render');
const service = require('../src/node/service');
const SOURCE = 'function App() {\n  const ready = session.ready;\n  if (!ready) return null;\n  return render();\n}\n';
const note = () => createNote(SOURCE, 3, 'Wait until restoration finishes.', { id: 'lc_wait' });
const v2 = notes => parse(serialize('app.ts', notes, { version: 2 })).notes;
const guards = snapshot => ({ expectedSource: snapshot.sourceHash, expectedSidecar: snapshot.sidecarHash });
async function fixture(t, notes = [note()]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'line-comments-compact-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'app.ts'), SOURCE);
  if (notes !== null) await fs.writeFile(path.join(root, 'app.ts.comment'), serialize('app.ts', notes, { version: 1 }));
  return root;
}

test('v2 stores coordinates, fingerprints and comments without copying target or neighbor code', () => {
  const raw = serialize('app.ts', [note()], { version: 2 });
  assert.match(raw, /^# line-comments v2\n/);
  assert.match(raw, /^@@ 3 @@ id=lc_wait/m);
  assert.match(raw, /^@anchor sha256 /m);
  assert.match(raw, /^\+\/\/ Wait until restoration finishes\./m);
  for (const line of SOURCE.trimEnd().split('\n')) assert.ok(!raw.split('\n').includes(` ${line}`));
  assert.doesNotMatch(raw, /session\.ready|function App|return render|return null/);
  const parsed = parse(raw).notes[0];
  assert.deepEqual(parsed, compactNote(note()));
  assert.equal(Object.hasOwn(parsed, 'target'), false);
  assert.equal(Object.hasOwn(parsed, 'before'), false);
  assert.equal(Object.hasOwn(parsed, 'after'), false);
  assert.equal(sidecarVersion(raw), 2);
  assert.equal(sidecarVersion(serialize('app.ts', [note()], { version: 1 })), 1);
  assert.equal(sidecarVersion(null), 2);
});

test('v2 round trips multiline bodies, empty body lines, diff-looking text and Unicode', () => {
  const item = createNote(SOURCE, 3, 'Reason.\n\n@@ not a header\n@anchor not metadata\n+// body\nαβ 日本語 🧪\n', { id: 'lc_body' });
  assert.deepEqual(v2([item])[0], compactNote(item));
  const raw = serialize('app.ts', [item], { version: 2 }).replaceAll('\n', '\r\n');
  assert.deepEqual(parse(raw).notes[0], compactNote(item));
  assert.equal(resolveNotes(SOURCE.replaceAll('\n', '\r\n'), parse(raw).notes)[0].status, 'attached');
});

test('v2 handles empty files, trailing empty lines and duplicate comments at one line', () => {
  for (const [source, line] of [['', 1], [SOURCE, 6]]) {
    const notes = v2([createNote(source, line, 'Boundary comment.')]);
    assert.equal(resolveNotes(source, notes)[0].line, line);
  }
  const notes = v2([note(), createNote(SOURCE, 3, 'Second note.', { id: 'lc_second' })]);
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
  assert.match(output, /@3 \[lc_wait;attached\]/);
  assert.ok(!output.includes(notes[0].anchor.target));
  assert.ok(!output.includes(notes[0].anchor.context));
  assert.doesNotMatch(output, /@anchor|@@|base=/);
  const only = render(SOURCE, resolveNotes(SOURCE, notes), { mode: 'comments' });
  assert.doesNotMatch(only, /session\.ready|return null/);
});

test('v2 rejects source context, additions, deletions, incomplete bodies and malformed fingerprints', () => {
  const raw = serialize('app.ts', [note()], { version: 2 });
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
  assert.throws(() => serialize('app.ts', [note(), note()], { version: 2 }), /duplicate/);
  assert.throws(() => serialize('app.ts\n', [note()], { version: 2 }), /filename/);
  const duplicate = raw + raw.split('\n').slice(3).join('\n');
  assert.throws(() => parse(duplicate), /duplicate/);
});

test('v2 enforces limits and cannot silently expand fingerprints into made-up source', () => {
  assert.throws(() => parse('# line-comments v2\n' + 'x'.repeat(2097152)), /2 MiB/);
  const invalid = { ...compactNote(note()), text: 'x'.repeat(16001) };
  assert.throws(() => serialize('app.ts', [invalid], { version: 2 }), /Comment/);
  assert.throws(() => serialize('app.ts', Array(1001).fill(note()), { version: 2 }), /Too many/);
  assert.throws(() => serialize('app.ts', v2([note()]), { version: 1 }), /Cannot expand/);
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

test('new service writes default to code-free v2 and preserve source bytes', async t => {
  const root = await fixture(t, null);
  const snapshot = await service.load(root, 'app.ts');
  await service.write(root, 'app.ts', { operation: 'add', line: 3, text: 'New note.', expectedText: '  if (!ready) return null;', ...guards(snapshot) });
  const result = await service.load(root, 'app.ts');
  assert.equal(result.formatVersion, 2);
  assert.equal(result.results[0].status, 'attached');
  assert.doesNotMatch(result.raw, /return null|session\.ready/);
  assert.equal(await fs.readFile(result.sourcePath, 'utf8'), SOURCE);
});

test('legacy sidecars remain v1 on reads and edits until explicit conversion', async t => {
  const root = await fixture(t);
  const snapshot = await service.load(root, 'app.ts');
  assert.equal(snapshot.formatVersion, 1);
  assert.equal(await fs.readFile(snapshot.sidecarPath, 'utf8'), snapshot.raw);
  await service.write(root, 'app.ts', { operation: 'update', id: 'lc_wait', text: 'Updated note.', ...guards(snapshot) });
  assert.equal((await service.load(root, 'app.ts')).formatVersion, 1);
});

test('conversion preserves IDs, comments and resolved states without reattaching missing code', async t => {
  const notes = [note(), createNote(SOURCE, 2, 'Review state stays.', { id: 'lc_review', state: 'review' }), createNote(SOURCE, 4, 'Detached stays.', { id: 'lc_detached', state: 'detached' })];
  const root = await fixture(t, notes);
  const source = SOURCE.replace('!ready', 'loading');
  await fs.writeFile(path.join(root, 'app.ts'), source);
  const snapshot = await service.load(root, 'app.ts');
  const result = await service.write(root, 'app.ts', { operation: 'compact', ...guards(snapshot) });
  const after = await service.load(root, 'app.ts');
  assert.equal(result.formatVersion, 2);
  const summary = s => s.results.map(r => ({ id: r.note.id, text: r.note.text, line: r.line, state: r.note.state, status: r.status }));
  assert.deepEqual(summary(after), summary(snapshot));
  assert.equal(await fs.readFile(after.sourcePath, 'utf8'), source);
  assert.doesNotMatch(after.raw, /session\.ready|return null|return render/);
  const previous = after.raw;
  await service.write(root, 'app.ts', { operation: 'compact', ...guards(after) });
  assert.equal((await service.load(root, 'app.ts')).raw, previous);
});

test('conversion requires fresh source and sidecar guards', async t => {
  const root = await fixture(t);
  const snapshot = await service.load(root, 'app.ts');
  await assert.rejects(() => service.write(root, 'app.ts', { operation: 'compact' }), /Source revision/);
  await service.write(root, 'app.ts', { operation: 'update', id: 'lc_wait', text: 'Another author.', ...guards(snapshot) });
  await assert.rejects(() => service.write(root, 'app.ts', { operation: 'compact', ...guards(snapshot) }), /Sidecar revision/);
  assert.equal((await service.load(root, 'app.ts')).formatVersion, 1);
});

test('conversion of a nonexistent sidecar fails rather than creating an empty file', async t => {
  const root = await fixture(t, null);
  const snapshot = await service.load(root, 'app.ts');
  await assert.rejects(() => service.write(root, 'app.ts', { operation: 'compact', ...guards(snapshot) }), /no .comment/);
  await assert.rejects(() => fs.stat(path.join(root, 'app.ts.comment')), { code: 'ENOENT' });
});

test('CLI compact converts a legacy sidecar with explicit revision guards in a real subprocess', async t => {
  const root = await fixture(t), cli = path.join(__dirname, '../src/cli.js');
  const snapshot = await service.load(root, 'app.ts');
  const result = await exec(process.execPath, [cli, 'compact', 'app.ts', '--root', root, '--source-hash', snapshot.sourceHash, '--sidecar-hash', snapshot.sidecarHash]);
  assert.equal(JSON.parse(result.stdout).formatVersion, 2);
  assert.equal((await service.load(root, 'app.ts')).formatVersion, 2);
});
