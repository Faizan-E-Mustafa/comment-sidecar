'use strict';
const { linesOf } = require('./text');
const { assertNote, MAX_NOTES } = require('./note');
const FORMAT_VERSION = 2;
const HEADER = '# comment-sidecar v2';
const MAX_SIDECAR_BYTES = 2 * 1024 * 1024;

function validName(name) {
  if (typeof name !== 'string' || !name || /[\r\n\0]/.test(name)) {
    throw new Error('Invalid source filename.');
  }
  return name;
}
function validate(note, ids) {
  assertNote(note);
  if (ids.has(note.id)) {
    throw new Error('Invalid or duplicate note ID.');
  }
  ids.add(note.id);
}
function serialize(name, notes) {
  validName(name);
  if (notes.length > MAX_NOTES) {
    throw new Error('Too many comments.');
  }
  const out = [HEADER, `--- ${name}`, `+++ ${name}.annotated`];
  const ids = new Set();
  for (const note of [...notes].sort((a, b) => a.line - b.line || a.id.localeCompare(b.id))) {
    validate(note, ids);
    const a = note.anchor;
    out.push(`@@ ${note.line} @@ id=${note.id} base=${note.base} state=${note.state}`);
    out.push(`@anchor sha256 before=${a.before} after=${a.after} strong=${Number(a.strong)} target=${a.target} context=${a.context}`);
    out.push(...note.text.split('\n').map(line => `+// ${line}`));
  }
  const raw = `${out.join('\n')}\n`;
  if (Buffer.byteLength(raw) > MAX_SIDECAR_BYTES) {
    throw new Error('Serialized sidecar exceeds 2 MiB.');
  }
  return raw;
}
function parse(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_SIDECAR_BYTES) {
    throw new Error('Sidecar exceeds 2 MiB.');
  }
  const lines = linesOf(raw);
  if (lines[0] !== HEADER) {
    throw new Error(`Unsupported .comment file version; expected "${HEADER}".`);
  }
  if (lines.pop() !== '') {
    throw new Error('Sidecar must end with a newline.');
  }
  if (!lines[1]?.startsWith('--- ')) {
    throw new Error('Mismatched sidecar header.');
  }
  const name = validName(lines[1].slice(4));
  if (lines[2] !== `+++ ${name}.annotated`) {
    throw new Error('Mismatched sidecar header.');
  }
  const ids = new Set();
  const notes = [];
  let i = 3;
  while (i < lines.length) {
    if (notes.length >= MAX_NOTES) {
      throw new Error('Too many comments.');
    }
    const head = /^@@ (\d+) @@ id=((?:sc|lc)_[a-zA-Z0-9_-]{1,64}) base=([a-f0-9]{64}) state=(attached|review|detached)$/.exec(lines[i++]);
    if (!head) {
      throw new Error(`Invalid hunk header at sidecar line ${i}.`);
    }
    const a = /^@anchor sha256 before=([0-2]) after=([0-2]) strong=([01]) target=([a-f0-9]{64}) context=([a-f0-9]{64})$/.exec(lines[i++]);
    if (!a) {
      throw new Error(`Invalid anchor fingerprint at sidecar line ${i}.`);
    }
    const comments = [];
    while (i < lines.length && !lines[i].startsWith('@@ ')) {
      if (!lines[i].startsWith('+// ')) {
        throw new Error(`Invalid comment-only patch line ${i + 1}; source context and code additions/deletions are not allowed.`);
      }
      comments.push(lines[i++].slice(4));
    }
    const note = {
      id: head[2], base: head[3], state: head[4], line: Number(head[1]),
      text: comments.join('\n'),
      anchor: {
        before: Number(a[1]), after: Number(a[2]), strong: a[3] === '1', target: a[4], context: a[5],
      },
    };
    validate(note, ids);
    notes.push(note);
  }
  return { name, notes };
}
module.exports = { parse, serialize, FORMAT_VERSION };
