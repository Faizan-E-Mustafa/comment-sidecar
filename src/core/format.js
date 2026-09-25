'use strict';
const { randomUUID } = require('node:crypto');
const { linesOf, sourceHash, assertLine } = require('./text');
const MAX_NOTES = 1000;
const MAX_COMMENT_CHARS = 16000;

function assertComment(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_COMMENT_CHARS || text.includes('\0')) {
    throw new Error(`Comment must contain 1–${MAX_COMMENT_CHARS} characters and no NUL bytes.`);
  }
}
function createNote(source, line, text, options = {}) {
  const lines = linesOf(source);
  assertLine(line, lines.length);
  assertComment(text);
  const start = Math.max(0, line - 3);
  return {
    id: options.id || `lc_${randomUUID().replaceAll('-', '').slice(0, 12)}`,
    base: options.base || sourceHash(source),
    state: options.state || 'attached',
    line,
    before: lines.slice(start, line - 1),
    target: lines[line - 1],
    after: lines.slice(line, line + 2),
    text: text.replace(/\r\n/g, '\n'),
  };
}
function validName(name) {
  if (typeof name !== 'string' || !name || /[\r\n\0]/.test(name)) throw new Error('Invalid source filename.');
  return name;
}

function serialize(name, notes) {
  validName(name);
  if (notes.length > MAX_NOTES) throw new Error('Too many comments.');
  const out = ['# line-comments v1', `--- ${name}`, `+++ ${name}.annotated`];
  const ids = new Set();
  for (const note of [...notes].sort((a, b) => a.line - b.line || a.id.localeCompare(b.id))) {
    assertComment(note.text);
    if (!/^lc_[a-zA-Z0-9_-]{1,64}$/.test(note.id) || ids.has(note.id)) throw new Error('Invalid or duplicate note ID.');
    if (!/^[a-f0-9]{64}$/.test(note.base)) throw new Error('Invalid base hash.');
    if (!['attached', 'review', 'detached'].includes(note.state)) throw new Error('Invalid note state.');
    if (!Number.isInteger(note.line) || note.line <= note.before.length) throw new Error('Invalid anchor line.');
    if (note.before.length > 2 || note.after.length > 2) throw new Error('Too much hunk context.');
    if ([...note.before, note.target, ...note.after].some(line => typeof line !== 'string' || /[\r\n\0]/.test(line))) throw new Error('Invalid source context.');
    ids.add(note.id);
    const comments = note.text.split('\n');
    const count = note.before.length + 1 + note.after.length;
    const start = note.line - note.before.length;
    out.push(`@@ -${start},${count} +${start},${count + comments.length} @@ id=${note.id} base=${note.base} state=${note.state}`);
    out.push(...note.before.map(line => ` ${line}`));
    out.push(...comments.map(line => `+// ${line}`));
    out.push(` ${note.target}`, ...note.after.map(line => ` ${line}`));
  }
  const raw = `${out.join('\n')}\n`;
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Serialized sidecar exceeds 2 MiB.');
  return raw;
}

function parse(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Sidecar exceeds 2 MiB.');
  const lines = linesOf(raw);
  if (lines.pop() !== '') throw new Error('Sidecar must end with a newline.');
  if (lines[0] !== '# line-comments v1' || !lines[1]?.startsWith('--- ') || !lines[2]?.startsWith('+++ ')) {
    throw new Error('Not a line-comments v1 sidecar.');
  }
  const name = validName(lines[1].slice(4));
  if (lines[2] !== `+++ ${name}.annotated`) throw new Error('Mismatched sidecar header.');
  const notes = [];
  const ids = new Set();
  let i = 3;
  while (i < lines.length) {
    if (notes.length >= MAX_NOTES) throw new Error('Too many comments.');
    const match = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@ id=(lc_[a-zA-Z0-9_-]{1,64}) base=([a-f0-9]{64}) state=(attached|review|detached)$/.exec(lines[i++]);
    if (!match) throw new Error(`Invalid hunk header at sidecar line ${i}.`);
    const [, oldStart, oldCount, newStart, newCount, id, base, state] = match;
    const start = Number(oldStart), count = Number(oldCount), added = Number(newCount) - count;
    if (!Number.isSafeInteger(start) || start < 1 || Number(newStart) !== start || count < 1 || count > 5 || added < 1) throw new Error('Invalid hunk coordinates.');
    if (ids.has(id)) throw new Error(`Duplicate comment ID: ${id}.`);
    ids.add(id);
    const before = [], after = [], comments = [];
    let target;
    while (i < lines.length && !lines[i].startsWith('@@ ')) {
      const value = lines[i++];
      if (value.startsWith('+// ') && target === undefined) { comments.push(value.slice(4)); continue; }
      if (!value.startsWith(' ')) throw new Error(`Invalid comment-only patch line ${i}; code additions/deletions are not allowed.`);
      if (!comments.length) { before.push(value.slice(1)); continue; }
      if (target === undefined) target = value.slice(1); else after.push(value.slice(1));
    }
    if (target === undefined || before.length > 2 || after.length > 2 || before.length + 1 + after.length !== count || comments.length !== added) throw new Error('Hunk content does not match its coordinates.');
    const text = comments.join('\n');
    assertComment(text);
    notes.push({ id, base, state, line: start + before.length, before, target, after, text });
  }
  return { name, notes };
}
module.exports = { createNote, serialize, parse, assertComment, MAX_NOTES };
