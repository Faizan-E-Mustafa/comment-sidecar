'use strict';
const legacy = require('./format-v1');
const compact = require('./format-v2');
function sidecarVersion(raw) {
  if (raw === null) return 2;
  if (raw.startsWith('# line-comments v1\n') || raw.startsWith('# line-comments v1\r\n')) return 1;
  if (raw.startsWith('# line-comments v2\n') || raw.startsWith('# line-comments v2\r\n')) return 2;
  throw new Error('Unsupported line-comments sidecar version.');
}
function parse(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 2 * 1024 * 1024) throw new Error('Sidecar exceeds 2 MiB.');
  return sidecarVersion(raw) === 2 ? compact.parse(raw) : legacy.parse(raw);
}
function serialize(name, notes, options = {}) {
  const version = options.version ?? (notes.some(note => note.anchor) ? 2 : 1);
  if (version === 2) return compact.serialize(name, notes);
  if (version !== 1) throw new Error('Unsupported line-comments sidecar version.');
  if (notes.some(note => note.anchor)) throw new Error('Cannot expand fingerprint-only anchors back into source text.');
  return legacy.serialize(name, notes);
}
module.exports = { ...legacy, parse, serialize, sidecarVersion };
