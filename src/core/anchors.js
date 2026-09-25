'use strict';
const { linesOf, sourceHash } = require('./text');
const { createNote } = require('./format');

function resolveNotes(source, notes) {
  const lines = linesOf(source), base = sourceHash(source);
  const byText = new Map();
  for (let i = 0; i < lines.length; i++) {
    const positions = byText.get(lines[i]);
    if (positions) positions.push(i + 1); else byText.set(lines[i], [i + 1]);
  }
  return notes.map(note => {
    const result = (line, status, reason) => ({ note, line, status, reason });
    if (note.state === 'detached') return result(null, 'detached', 'Target was detached by an editor change; reattach explicitly.');
    if (note.base === base && lines[note.line - 1] === note.target) return result(note.line, note.state, 'Source matches the recorded revision.');
    const candidates = byText.get(note.target) || [];
    const exact = candidates.filter(line => {
      const start = line - 1 - note.before.length;
      if (start < 0 || line + note.after.length > lines.length) return false;
      return note.before.every((text, i) => lines[start + i] === text)
        && note.after.every((text, i) => lines[line + i] === text);
    });
    if (exact.length === 1) {
      const status = note.state === 'review' ? 'review' : exact[0] === note.line ? 'attached' : 'moved';
      return result(exact[0], status, 'Target and recorded neighboring lines match uniquely; meaning is not verified.');
    }
    if (exact.length > 1 || candidates.length > 1) return result(null, 'ambiguous', 'Multiple matching lines; choose the target explicitly.');
    if (candidates.length === 1 && note.target.trim().length > 3) return result(candidates[0], 'review', 'Only the target text matches; neighboring context changed. Verify this provisional attachment.');
    return result(null, 'detached', 'The original target cannot be located confidently.');
  });
}

function rebaseNotes(source, results) {
  const base = sourceHash(source);
  return results.map(result => {
    if (result.line === null) return result.note;
    return createNote(source, result.line, result.note.text, {
      id: result.note.id, base, state: result.status === 'review' ? 'review' : 'attached',
    });
  });
}
module.exports = { resolveNotes, rebaseNotes };
