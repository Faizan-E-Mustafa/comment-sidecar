'use strict';
const { linesOf, lineOffsets, lineAtOffset } = require('./text');

function applyChanges(source, changes) {
  let result = source;
  for (const edit of [...changes].sort((a, b) => b.rangeOffset - a.rangeOffset)) {
    result = result.slice(0, edit.rangeOffset) + edit.text + result.slice(edit.rangeOffset + edit.rangeLength);
  }
  return result;
}

function trackEdits(oldSource, newSource, results, changes) {
  const sorted = [...changes].sort((a, b) => a.rangeOffset - b.rangeOffset);
  let end = -1;
  for (const edit of sorted) {
    if (!Number.isInteger(edit.rangeOffset) || !Number.isInteger(edit.rangeLength) || edit.rangeOffset < end || edit.rangeOffset < 0 || edit.rangeLength < 0 || edit.rangeOffset + edit.rangeLength > oldSource.length || typeof edit.text !== 'string') throw new Error('Invalid or overlapping editor changes.');
    end = edit.rangeOffset + edit.rangeLength;
  }
  if (applyChanges(oldSource, changes) !== newSource) throw new Error('Editor changes do not match the new document.');
  const oldOffsets = lineOffsets(oldSource), newOffsets = lineOffsets(newSource), oldLines = linesOf(oldSource);
  return results.map(result => {
    if (result.line === null) return result;
    const start = oldOffsets[result.line - 1], finish = start + oldLines[result.line - 1].length;
    let delta = 0, touched = false, detached = false;
    for (const edit of sorted) {
      const a = edit.rangeOffset, b = a + edit.rangeLength;
      if (edit.rangeLength === 0 && a === start) {
        delta += edit.text.length;
        if (edit.text && !edit.text.endsWith('\n')) touched = true;
        continue;
      }
      if (b <= start) { delta += edit.text.length - edit.rangeLength; continue; }
      if (a > finish || (a === finish && edit.rangeLength > 0)) {
        if (a === finish && edit.rangeLength > 0) detached = true;
        continue;
      }
      touched = true;
      if (a < start || b > finish || edit.text.includes('\n') || (a <= start && b >= finish && !edit.text)) detached = true;
    }
    if (detached) return { ...result, note: { ...result.note, state: 'detached' }, line: null, status: 'detached', reason: 'An editor change deleted, split, joined, or replaced the target range. Reattach explicitly.' };
    const line = lineAtOffset(newOffsets, Math.max(0, start + delta));
    const status = touched || result.status === 'review' ? 'review' : line === result.line ? result.status : 'moved';
    return { ...result, line, status, reason: touched ? 'The annotated line was edited. Review the comment.' : 'Position tracked through editor changes; meaning is not verified.' };
  });
}
module.exports = { trackEdits, applyChanges };
