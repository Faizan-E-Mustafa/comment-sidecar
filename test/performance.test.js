'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sourceHash, hash, linesOf } = require('../src/core/text');
const { resolveNotes } = require('../src/core/anchors');
const { serialize, parse } = require('../src/core/format');
const { createNote } = require('../src/core/note');
const { clean, findGeneratedFiles } = require('../scripts/clean');

test('optimized source hashing preserves normalization and validation', () => {
  for (const text of ['', '\n', '\r\n', 'a\r\nb\r\n', 'a\rb\n', '🙂\r\n', 'x'.repeat(20000)]) {
    assert.equal(sourceHash(text), hash(linesOf(text).join('\n')));
  }
  for (const invalid of [null, undefined, 42, {}, '\0']) {
    assert.throws(() => sourceHash(invalid), /UTF-8/);
  }
});

test('same-revision fast path preserves exact positions for duplicate lines', () => {
  const source = 'start();\nrepeat();\nend();\nstart();\nrepeat();\nend();';
  const notes = parse(
    serialize('a.ts', [createNote(source, 2, 'First.'), createNote(source, 5, 'Second.')])
  ).notes;

  assert.deepEqual(
    resolveNotes(source, notes).map(item => [item.line, item.status]),
    [[2, 'attached'], [5, 'attached']]
  );
  assert.deepEqual(
    resolveNotes('\n' + source, notes).map(item => [item.line, item.status]),
    [[3, 'moved'], [6, 'moved']]
  );
});

test('matching revision alone never overrides an incorrect target position', () => {
  const source = 'first();\nsecond();\nthird();\nfourth();\nfifth();';
  const note = createNote(source, 3, 'Target.');
  note.line = 1;
  const result = resolveNotes(source, [note])[0];
  assert.equal(result.line, 3);
  assert.equal(result.status, 'moved');
});

test('lazy resolver handles mixed current, old and detached annotations', () => {
  const old = 'first();\nsecond();\nthird();\nfourth();\nfifth();';
  const source = '\n' + old;
  const current = createNote(source, 2, 'Current.');
  const previous = createNote(old, 3, 'Previous.');
  const detached = { ...createNote(old, 4, 'Detached.'), state: 'detached' };
  const results = resolveNotes(source, [current, previous, detached]);
  assert.deepEqual(results.map(item => [item.line, item.status]), [[2, 'attached'], [4, 'moved'], [null, 'detached']]);
});

test('cleanup previews and removes only allowlisted build artifacts and reports', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-clean-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'dist'));
  fs.mkdirSync(path.join(root, 'reports'));

  const removable = [
    'comment-sidecar-0.1.2.vsix',
    'dist/comment-sidecar-0.1.3.vsix',
    'reports/BENCHMARK.json',
    'PERFORMANCE-COMPARISON.json',
  ];
  const preserved = [
    'app.ts',
    'app.ts.comment',
    'app.ts.comment.lock',
    'app.ts.comment.123.tmp',
    'package.json',
    'reports/my-notes.txt',
    'dist/important.zip',
    'fix.patch',
  ];
  for (const file of [...removable, ...preserved]) {
    fs.writeFileSync(path.join(root, file), 'keep unless generated');
  }

  assert.deepEqual(clean(root), removable.sort());
  assert.ok(removable.every(file => fs.existsSync(path.join(root, file))));

  clean(root, true);
  assert.ok(removable.every(file => !fs.existsSync(path.join(root, file))));
  assert.ok(preserved.every(file => fs.existsSync(path.join(root, file))));
});

test('cleanup refuses to follow symlinked reports directories or build files', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-clean-links-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  const outside = path.join(root, 'unrelated');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'BENCHMARK.json'), 'unrelated');

  const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(outside, path.join(root, 'reports'), symlinkType);
  fs.symlinkSync(path.join(outside, 'BENCHMARK.json'), path.join(root, 'comment-sidecar-0.1.3.vsix'));

  assert.deepEqual(findGeneratedFiles(root), []);

  clean(root, true);
  assert.equal(fs.readFileSync(path.join(outside, 'BENCHMARK.json'), 'utf8'), 'unrelated');
});
