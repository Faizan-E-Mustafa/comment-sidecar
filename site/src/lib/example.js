// Build-time data. Everything the page shows about examples/app.tsx comes from the extension's own code:
// the demo's states are what the extension tracks and saves for each change, and the terminal is real CLI output.
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(path.join(__REPOSITORY__, 'package.json'));
const manifest = require('./package.json');
const { createNote } = require('./src/core/note.js');
const { serialize } = require('./src/core/format.js');
const { lineOffsets } = require('./src/core/text.js');
const { resolveNotes, rebaseNotes } = require('./src/core/anchors.js');
const { applyChanges, trackEdits } = require('./src/core/edits.js');
const service = require('./src/node/service.js');

const examples = path.join(__REPOSITORY__, 'examples');
const snapshot = await service.load(examples, 'app.tsx');
const READ = { start: 4, end: 5 };

// Show a short prefix of each SHA-256 digest, as the README figures do.
const short = digest => `${digest.slice(0, 4)}…`;

function sidecarParts(line) {
  const hunk = /^(@@ )(\d+)( @@ id=\S+ base=)([0-9a-f]{64})( state=)(\w+)$/.exec(line);
  if (hunk) {
    return [
      ['hunk', hunk[1]], ['hunk', hunk[2]], ['hunk', ' @@'], ['id', hunk[3].slice(3)], ['id', short(hunk[4])],
      ['id', hunk[5]], [hunk[6] === 'review' ? 'review' : 'id', hunk[6]],
    ];
  }
  const anchor = /^(@anchor .* target=)([0-9a-f]{64})( context=)([0-9a-f]{64})$/.exec(line);
  if (anchor) {
    return [['anchor', anchor[1]], ['anchor', short(anchor[2])], ['anchor', anchor[3]], ['anchor', short(anchor[4])]];
  }
  if (line.startsWith('+// ')) {
    return [['text', line]];
  }
  return [[line.startsWith('#') ? 'header' : 'file', line]];
}

// A .comment file as display lines, each tagged with the ID of the comment it belongs to.
function sidecarLines(text) {
  let id = null;
  return text.trimEnd().split('\n').map(line => {
    const hunk = /^@@ \d+ @@ id=(\S+)/.exec(line);
    if (hunk) {
      id = hunk[1];
    }
    return { id, parts: sidecarParts(line) };
  });
}

function terminalParts(line) {
  const header = /^(\S+ source=)([0-9a-f]{64})$/.exec(line);
  const hash = /^(sidecar=)([0-9a-f]{64})$/.exec(line);
  const code = /^(\d+ \| )(.*)$/.exec(line);
  const comment = /^( {2})(@\d+)( \[\S+;)(\w+)(\] )(.*)$/.exec(line);
  if (header || hash) {
    const [, label, digest] = header || hash;
    return [['dim', label + short(digest)]];
  }
  if (code) {
    return [['num', code[1]], ['src', code[2]]];
  }
  if (comment) {
    return [
      ['dim', comment[1]], ['at', comment[2]], ['id', comment[3]], [comment[4] === 'attached' ? 'ok' : 'review', comment[4]],
      ['id', comment[5]], ['str', comment[6]],
    ];
  }
  return [['dim', line]];
}

// The live example: three lines are added above the first comment, then its line is edited, then it is reviewed.
const ADDED = ['  const theme = useTheme();', '  const flags = useFlags();', '  if (flags.offline) return <Offline />;'];
const ADD_AFTER = 2;
const INSERT = ' || !theme';
const lines = snapshot.source.trimEnd().split('\n');
const edited = snapshot.notes[0];
const lead = lines[edited.line - 1].slice(0, lines[edited.line - 1].indexOf(')'));

const rows = [
  ...lines.slice(0, ADD_AFTER).map((text, i) => ({ key: `line${i + 1}`, text })),
  ...ADDED.map((text, i) => ({ key: `added${i + 1}`, text, added: true })),
  ...lines.slice(ADD_AFTER).map((text, i) => ({ key: `line${ADD_AFTER + i + 1}`, text })),
];
for (const note of snapshot.notes) {
  rows.find(row => row.key === `line${note.line}`).note = note;
}
const editKey = `line${edited.line}`;
const original = rows.filter(row => !row.added).map(row => row.key);
const expanded = rows.map(row => row.key);

// Applies one editor change and saves, the way the extension does on Ctrl+S.
function save(state, change) {
  const source = applyChanges(state.source, [change]);
  const notes = rebaseNotes(source, trackEdits(state.source, source, state.results, [change]));
  return { source, notes, results: resolveNotes(source, notes) };
}
// Mark Comment Reviewed: the comment is placed again where it is now, as attached.
function review(state, id) {
  const notes = state.results.map(result => {
    if (result.note.id !== id) {
      return result.note;
    }
    return createNote(state.source, result.line, result.note.text, { id });
  });
  return { ...state, notes, results: resolveNotes(state.source, notes) };
}
const lineOf = (state, id) => state.results.find(result => result.note.id === id).line;
const offsetOf = (source, line, column = 0) => lineOffsets(source)[line - 1] + column;

const commented = { source: snapshot.source, notes: snapshot.notes, results: snapshot.results };
const moved = save(commented, {
  rangeOffset: offsetOf(commented.source, ADD_AFTER + 1), rangeLength: 0, text: ADDED.map(text => `${text}\n`).join(''),
});
const changed = save(moved, {
  rangeOffset: offsetOf(moved.source, lineOf(moved, edited.id), lead.length), rangeLength: 0, text: INSERT,
});
const reviewed = review(changed, edited.id);

const steps = [
  { name: 'comment', state: commented, order: original, edit: false },
  { name: 'move', state: moved, order: expanded, edit: false },
  { name: 'edit', state: changed, order: expanded, edit: true },
  { name: 'review', state: reviewed, order: expanded, edit: true },
].map(({ name, state, order, edit }) => {
  const text = order.map(key => {
    const row = rows.find(candidate => candidate.key === key);
    if (key === editKey && edit) {
      return lead + INSERT + row.text.slice(lead.length);
    }
    return row.text;
  }).join('\n');
  if (`${text}\n` !== state.source) {
    throw new Error(`The demo rows for "${name}" no longer match the example source.`);
  }
  const status = state.results.find(result => result.note.id === edited.id).status;
  return {
    name, order, edit, review: status === 'review', line: lineOf(state, edited.id),
    sidecar: sidecarLines(serialize('app.tsx', state.notes)),
  };
});

export const demo = { rows, steps, editKey, lead, insert: INSERT, edited };
export const anatomy = sidecarLines(snapshot.raw).slice(0, 6);
export const read = { ...READ, file: 'app.tsx' };
export const terminal = (await service.read(examples, 'app.tsx', READ)).output.trimEnd().split('\n').map(terminalParts);
export const extension = {
  version: manifest.version,
  id: `${manifest.publisher}.${manifest.name}`,
  openVsx: `https://open-vsx.org/extension/${manifest.publisher}/${manifest.name}`,
  repository: manifest.repository.url,
};
