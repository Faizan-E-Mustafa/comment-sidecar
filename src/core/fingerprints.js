'use strict';
const { hash } = require('./text');

// Hash the exact lines, not normalized syntax; array encoding preserves boundaries.
function contextHash(lines) { return hash(JSON.stringify(lines)); }
function fingerprintOf(note) {
  if (note.anchor) return note.anchor;
  return {
    target: hash(note.target),
    context: contextHash([...note.before, note.target, ...note.after]),
    before: note.before.length,
    after: note.after.length,
    strong: note.target.trim().length > 3,
  };
}
function compactNote(note) {
  return {
    id: note.id, base: note.base, state: note.state, line: note.line,
    anchor: { ...fingerprintOf(note) }, text: note.text,
  };
}
module.exports = { contextHash, fingerprintOf, compactNote };
