'use strict';
const { linesOf, sourceHash, hash } = require('./text');
const { createNote } = require('./format');
const { fingerprintOf, contextHash } = require('./fingerprints');

function resolveNotes(source, notes) {
  if (!notes.length) return [];
  const lines = linesOf(source), base = sourceHash(source);
  const byText = new Map();
  const lineHashes = new Map();
  for (let i = 0; i < lines.length; i++) {
    let digest = lineHashes.get(lines[i]);
    if (!digest) { digest = hash(lines[i]); lineHashes.set(lines[i], digest); }
    const positions = byText.get(digest);
    if (positions) positions.push(i + 1); else byText.set(digest, [i + 1]);
  }
  return notes.map(note => {
    const anchor = fingerprintOf(note);
    const result = (line, status, reason) => ({ note, line, status, reason });
    if (note.state === 'detached') return result(null, 'detached', 'Target was detached by an editor change; reattach explicitly.');
    if (note.base === base && lineHashes.get(lines[note.line - 1]) === anchor.target) return result(note.line, note.state, 'Source matches the recorded revision.');
    const candidates = byText.get(anchor.target) || [];
    const exact = candidates.filter(line => {
      const start = line - 1 - anchor.before;
      if (start < 0 || line + anchor.after > lines.length) return false;
      return contextHash(lines.slice(start, line + anchor.after)) === anchor.context;
    });
    if (exact.length === 1) {
      const status = note.state === 'review' ? 'review' : exact[0] === note.line ? 'attached' : 'moved';
      return result(exact[0], status, 'Target and recorded neighboring lines match uniquely; meaning is not verified.');
    }
    if (exact.length > 1 || candidates.length > 1) return result(null, 'ambiguous', 'Multiple matching lines; choose the target explicitly.');
    if (candidates.length === 1 && anchor.strong) return result(candidates[0], 'review', 'Only the target text matches; neighboring context changed. Verify this provisional attachment.');
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
