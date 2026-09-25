'use strict';
const { createHash } = require('node:crypto');

function linesOf(text) {
  if (typeof text !== 'string' || text.includes('\0')) throw new Error('Expected a UTF-8 text file without NUL bytes.');
  return text.replace(/\r\n/g, '\n').split('\n');
}
function hash(text) { return createHash('sha256').update(text).digest('hex'); }
function sourceHash(text) { return hash(linesOf(text).join('\n')); }
function lineOffsets(text) {
  const offsets = [0];
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') offsets.push(i + 1);
  return offsets;
}
function lineAtOffset(offsets, offset) {
  let lo = 0, hi = offsets.length;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >>> 1;
    if (offsets[mid] <= offset) lo = mid; else hi = mid;
  }
  return lo + 1;
}
function assertLine(line, count) {
  if (!Number.isInteger(line) || line < 1 || line > count) throw new Error(`Line must be an integer from 1 to ${count}.`);
}
module.exports = { linesOf, hash, sourceHash, lineOffsets, lineAtOffset, assertLine };
