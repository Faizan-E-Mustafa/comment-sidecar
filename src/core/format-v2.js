'use strict';
const { linesOf } = require('./text');
const { assertComment, MAX_NOTES } = require('./format-v1');
const { compactNote } = require('./fingerprints');
const HASH = /^[a-f0-9]{64}$/;

function validName(name) {
  if (typeof name !== 'string' || !name || /[\r\n\0]/.test(name)) throw new Error('Invalid source filename.');
  return name;
}
function validate(note, ids) {
  assertComment(note.text);
  if (!/^lc_[a-zA-Z0-9_-]{1,64}$/.test(note.id) || ids.has(note.id)) throw new Error('Invalid or duplicate note ID.');
  if (!HASH.test(note.base)) throw new Error('Invalid base hash.');
  if (!['attached', 'review', 'detached'].includes(note.state)) throw new Error('Invalid note state.');
  const a = note.anchor;
  if (!a || !HASH.test(a.target) || !HASH.test(a.context) || typeof a.strong !== 'boolean') throw new Error('Invalid anchor fingerprint.');
  if (![a.before, a.after].every(n => Number.isInteger(n) && n >= 0 && n <= 2)) throw new Error('Invalid anchor context counts.');
  if (!Number.isSafeInteger(note.line) || note.line <= a.before) throw new Error('Invalid anchor line.');
  ids.add(note.id);
}
function serialize(name, notes) {
  validName(name);
  if (notes.length > MAX_NOTES) throw new Error('Too many comments.');
  const out = ['# line-comments v2', `--- ${name}`, `+++ ${name}.annotated`];
  const ids = new Set();
  for (const original of [...notes].sort((a, b) => a.line - b.line || a.id.localeCompare(b.id))) {
    const note = compactNote(original);
    validate(note, ids);
    const a = note.anchor;
    out.push(`@@ ${note.line} @@ id=${note.id} base=${note.base} state=${note.state}`);
    out.push(`@anchor sha256 before=${a.before} after=${a.after} strong=${Number(a.strong)} target=${a.target} context=${a.context}`);
    out.push(...note.text.split('\n').map(line => `+// ${line}`));
  }
  const raw = `${out.join('\n')}\n`;
  if (Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Serialized sidecar exceeds 2 MiB.');
  return raw;
}
function parse(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Sidecar exceeds 2 MiB.');
  const lines = linesOf(raw);
  if (lines.pop() !== '') throw new Error('Sidecar must end with a newline.');
  if (lines[0] !== '# line-comments v2' || !lines[1]?.startsWith('--- ')) throw new Error('Not a line-comments v2 sidecar.');
  const name = validName(lines[1].slice(4));
  if (lines[2] !== `+++ ${name}.annotated`) throw new Error('Mismatched sidecar header.');
  const ids = new Set(), notes = [];
  let i = 3;
  while (i < lines.length) {
    if (notes.length >= MAX_NOTES) throw new Error('Too many comments.');
    const head = /^@@ (\d+) @@ id=(lc_[a-zA-Z0-9_-]{1,64}) base=([a-f0-9]{64}) state=(attached|review|detached)$/.exec(lines[i++]);
    if (!head) throw new Error(`Invalid hunk header at sidecar line ${i}.`);
    const a = /^@anchor sha256 before=([0-2]) after=([0-2]) strong=([01]) target=([a-f0-9]{64}) context=([a-f0-9]{64})$/.exec(lines[i++]);
    if (!a) throw new Error(`Invalid anchor fingerprint at sidecar line ${i}.`);
    const comments = [];
    while (i < lines.length && !lines[i].startsWith('@@ ')) {
      if (!lines[i].startsWith('+// ')) throw new Error(`Invalid comment-only patch line ${i + 1}; source context and code additions/deletions are not allowed in v2.`);
      comments.push(lines[i++].slice(4));
    }
    const note = {
      id: head[2], base: head[3], state: head[4], line: Number(head[1]),
      anchor: { before: Number(a[1]), after: Number(a[2]), strong: a[3] === '1', target: a[4], context: a[5] },
      text: comments.join('\n'),
    };
    validate(note, ids);
    notes.push(note);
  }
  return { name, notes };
}
module.exports = { parse, serialize };
