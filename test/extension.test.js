'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const Module = require('node:module');
const { pathToFileURL, fileURLToPath } = require('node:url');
const service = require('../src/node/service');
const { sourceHash } = require('../src/core/text');

class Disposable { constructor(action = () => {}) { this.action = action; } dispose() { this.action(); } }
class EventEmitter {
  constructor() { this.listeners = new Set(); this.event = callback => { this.listeners.add(callback); return new Disposable(() => this.listeners.delete(callback)); }; }
  fire(value) { return Promise.all([...this.listeners].map(callback => callback(value))); }
  dispose() { this.listeners.clear(); }
}
class Uri {
  constructor(url) { this.url = new URL(url); this.scheme = this.url.protocol.slice(0, -1); this.fsPath = this.scheme === 'file' ? fileURLToPath(this.url) : decodeURIComponent(this.url.pathname); this.query = this.url.search.slice(1); }
  toString() { return this.url.href; }
  static file(file) { return new Uri(pathToFileURL(file)); }
  static parse(value) { return new Uri(value); }
  static from({ scheme, path, query = '' }) { return new Uri(`${scheme}://${encodeURI(path)}${query ? `?${query}` : ''}`); }
}
class Position { constructor(line, character) { this.line = line; this.character = character; } }
class Range {
  constructor(a, b, c, d) { this.start = typeof a === 'number' ? new Position(a, b) : a; this.end = typeof a === 'number' ? new Position(c, d) : b; }
}
class Selection extends Range { constructor(a, b) { super(a, b); this.active = b; this.isEmpty = a.line === b.line && a.character === b.character; } }
class MarkdownString { constructor() { this.parts = []; } appendMarkdown(value) { this.parts.push({ type: 'markdown', value }); return this; } appendText(value) { this.parts.push({ type: 'text', value }); return this; } }
const commands = new Map(), hoverProviders = [], fileProviders = new Map(), contentProviders = new Map(), events = {};
const event = name => { const emitter = new EventEmitter(); events[name] = emitter; return emitter.event; };
const vscode = {
  Disposable, EventEmitter, Uri, Position, Range, Selection, MarkdownString,
  ThemeColor: class { constructor(id) { this.id = id; } },
  Hover: class { constructor(contents, range) { this.contents = contents; this.range = range; } },
  Diagnostic: class { constructor(range, message, severity) { Object.assign(this, { range, message, severity }); } },
  DiagnosticSeverity: { Warning: 1 }, FileType: { File: 1 }, FileChangeType: { Changed: 1 }, StatusBarAlignment: { Right: 2 }, ViewColumn: { Beside: -2 },
  FileSystemError: { FileNotFound: () => new Error('File not found'), NoPermissions: message => new Error(message || 'No permissions') },
  WorkspaceEdit: class { constructor() { this.renames = []; } renameFile(a, b, options) { this.renames.push({ a, b, options }); } },
  commands: { registerCommand(name, fn) { commands.set(name, fn); return new Disposable(() => commands.delete(name)); }, executeCommand: async () => {} },
  languages: {
    createDiagnosticCollection() { return { values: new Map(), set(uri, values) { this.values.set(uri.toString(), values); }, delete(uri) { this.values.delete(uri.toString()); }, dispose() {} }; },
    registerHoverProvider(selector, provider) { hoverProviders.push(provider); return new Disposable(() => hoverProviders.splice(hoverProviders.indexOf(provider), 1)); },
  },
  workspace: {
    isTrusted: true, textDocuments: [], root: '',
    getWorkspaceFolder(uri) { return uri.scheme === 'file' && uri.fsPath.startsWith(`${this.root}${path.sep}`) ? { uri: Uri.file(this.root) } : undefined; },
    getConfiguration() { return { get: (key, fallback) => Object.hasOwn(vscode.configuration, key) ? vscode.configuration[key] : fallback }; },
    registerFileSystemProvider(scheme, provider) { fileProviders.set(scheme, provider); return new Disposable(); },
    registerTextDocumentContentProvider(scheme, provider) { contentProviders.set(scheme, provider); return new Disposable(); },
    onDidChangeTextDocument: event('change'), onDidSaveTextDocument: event('save'), onDidCloseTextDocument: event('close'), onDidChangeConfiguration: event('config'), onWillRenameFiles: event('rename'),
    createFileSystemWatcher() { return { onDidChange: event('sidecarChange'), onDidCreate: event('sidecarCreate'), onDidDelete: event('sidecarDelete'), dispose() {} }; },
    fs: { stat: async uri => fs.stat(uri.fsPath) },
    async openTextDocument(uri) {
      const known = this.textDocuments.find(doc => doc.uri.toString() === uri.toString());
      if (known) return known;
      let text;
      if (uri.scheme === 'file') text = await fs.readFile(uri.fsPath, 'utf8');
      else if (fileProviders.has(uri.scheme)) text = (await fileProviders.get(uri.scheme).readFile(uri)).toString();
      else text = await contentProviders.get(uri.scheme).provideTextDocumentContent(uri);
      const document = makeDocument(uri, text); this.textDocuments.push(document); return document;
    },
  },
  window: {
    activeTextEditor: undefined, visibleTextEditors: [],
    createOutputChannel() { return { appendLine(value) { vscode.logs.push(value); }, show() {}, dispose() {} }; },
    createTextEditorDecorationType() { return new Disposable(); },
    createStatusBarItem() { const item = { visible: false, hide() { this.visible = false; }, show() { this.visible = true; }, dispose() {} }; vscode.status = item; return item; },
    onDidChangeActiveTextEditor: event('active'), onDidChangeVisibleTextEditors: event('visible'),
    showInformationMessage: async () => {}, showErrorMessage: async message => { vscode.lastError = message; },
    showWarningMessage: async () => 'Delete comment', showQuickPick: async options => options[0],
    async showTextDocument(document) { const editor = makeEditor(document); this.activeTextEditor = editor; this.visibleTextEditors.push(editor); return editor; },
  },
  env: { clipboard: { writeText: async text => { vscode.clipboard = text; } } },
};
function makeDocument(uri, text) {
  return { uri, text, version: 1, isDirty: false, getText() { return this.text; }, get lineCount() { return this.text.split('\n').length; }, lineAt(line) { const text = this.text.split('\n')[line].replace(/\r$/, ''); return { text, range: new Range(line, 0, line, text.length) }; } };
}
function makeEditor(document) { return { document, decorations: [], selection: new Selection(new Position(1, 0), new Position(1, 0)), setDecorations(type, options) { this.decorations = options; }, revealRange() {} }; }
const originalLoad = Module._load;
Module._load = function(request, ...args) { return request === 'vscode' ? vscode : originalLoad.call(this, request, ...args); };
const { activate } = require('../src/extension/extension');
Module._load = originalLoad;

async function setup(t, options = {}) {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'line-comments-editor-'));
  let root = temporary;
  if (options.alias) {
    const real = path.join(temporary, 'workspace');
    await fs.mkdir(real);
    root = path.join(temporary, 'editor-alias');
    await fs.symlink(real, root, process.platform === 'win32' ? 'junction' : 'dir');
  }
  const text = 'const ready = false;\nif (!ready) wait();\nstart();\n';
  await fs.writeFile(path.join(root, 'app.ts'), text);
  vscode.configuration = {}; vscode.logs = [];
  vscode.workspace.root = root; vscode.workspace.textDocuments = []; vscode.workspace.isTrusted = true;
  const document = await vscode.workspace.openTextDocument(Uri.file(path.join(root, 'app.ts')));
  const editor = makeEditor(document);
  vscode.window.activeTextEditor = editor; vscode.window.visibleTextEditors = [editor];
  const context = { subscriptions: [], asAbsolutePath: file => path.join(__dirname, '..', file) };
  const api = activate(context);
  t.after(async () => { context.subscriptions.forEach(item => item.dispose()); await fs.rm(temporary, { recursive: true, force: true }); });
  return { root, document, editor, api, context };
}

test('extension registers commands, hover, multiline draft filesystem and preview provider', async t => {
  await setup(t);
  assert.equal(commands.size, 12);
  assert.ok(hoverProviders.length > 0);
  assert.ok(fileProviders.has('line-comment-draft'));
  assert.ok(contentProviders.has('line-comments-preview'));
});
test('multiline draft saves real sidecar, without changing the source', async t => {
  const { root, document, api } = await setup(t);
  const snapshot = await service.load(root, 'app.ts');
  const uri = api.drafts.create(snapshot, 2);
  const original = await fs.readFile(path.join(root, 'app.ts'), 'utf8');
  await api.drafts.writeFile(uri, Buffer.from('First reason.\nSecond reason.'));
  assert.equal((await service.load(root, 'app.ts')).notes[0].text, 'First reason.\nSecond reason.');
  assert.equal(await fs.readFile(path.join(root, 'app.ts'), 'utf8'), original);
  const entry = await api.store.get(document);
  assert.equal(entry.results.length, 1);
});
test('hover returns comment as escaped text, never trusted HTML or commands', async t => {
  const { root, document, api } = await setup(t);
  const uri = api.drafts.create(await service.load(root, 'app.ts'), 2);
  const text = '[run](command:evil) <script>bad()</script>';
  await api.drafts.writeFile(uri, Buffer.from(text));
  await api.store.get(document);
  const provider = hoverProviders[hoverProviders.length - 1];
  const hover = await provider.provideHover(document, new Position(1, 4), { isCancellationRequested: false });
  assert.equal(hover.contents[0].isTrusted, false);
  assert.equal(hover.contents[0].supportHtml, false);
  assert.ok(hover.contents[0].parts.some(part => part.type === 'text' && part.value === text));
  assert.equal(await provider.provideHover(document, new Position(0, 0), { isCancellationRequested: false }), undefined);
});
test('store tracks insertion, persists coordinates on save, and does not edit source itself', async t => {
  const { root, document, api } = await setup(t);
  const uri = api.drafts.create(await service.load(root, 'app.ts'), 2);
  await api.drafts.writeFile(uri, Buffer.from('Wait.'));
  await api.store.get(document);
  document.text = '\n' + document.text; document.version++; document.isDirty = true;
  api.store.changed({ document, contentChanges: [{ rangeOffset: 0, rangeLength: 0, text: '\n' }] });
  assert.equal((await api.store.get(document)).results[0].line, 3);
  await fs.writeFile(path.join(root, 'app.ts'), document.text); document.isDirty = false;
  await api.store.saved(document);
  const snapshot = await service.load(root, 'app.ts');
  assert.equal(snapshot.notes[0].line, 3);
  assert.equal(snapshot.notes[0].base, sourceHash(document.text));
});
test('store undo restores pre-deletion attachment within in-memory history', async t => {
  const { root, document, api } = await setup(t);
  const uri = api.drafts.create(await service.load(root, 'app.ts'), 2);
  await api.drafts.writeFile(uri, Buffer.from('Wait.'));
  await api.store.get(document);
  const old = document.text, start = old.indexOf('if (!ready)'), length = 'if (!ready) wait();\n'.length;
  document.text = old.slice(0, start) + old.slice(start + length); document.version++;
  api.store.changed({ document, contentChanges: [{ rangeOffset: start, rangeLength: length, text: '' }] });
  assert.equal((await api.store.get(document)).results[0].status, 'detached');
  document.text = old; document.version++;
  api.store.changed({ document, contentChanges: [{ rangeOffset: start, rangeLength: 0, text: 'if (!ready) wait();\n' }] });
  assert.equal((await api.store.get(document)).results[0].line, 2);
  assert.equal((await api.store.get(document)).results[0].status, 'attached');
});
test('untrusted workspaces and unsaved sources prevent draft writes', async t => {
  const { root, document, api } = await setup(t);
  const uri = api.drafts.create(await service.load(root, 'app.ts'), 2);
  vscode.workspace.isTrusted = false;
  await assert.rejects(() => api.drafts.writeFile(uri, Buffer.from('Reason.')), /Trust/);
  vscode.workspace.isTrusted = true; document.isDirty = true;
  await assert.rejects(() => api.drafts.writeFile(uri, Buffer.from('Reason.')), /Save the source/);
});
test('source revision changed while drafting cannot attach comment to another line', async t => {
  const { root, api } = await setup(t);
  const uri = api.drafts.create(await service.load(root, 'app.ts'), 2);
  await fs.writeFile(path.join(root, 'app.ts'), '\nchanged\n');
  await assert.rejects(() => api.drafts.writeFile(uri, Buffer.from('Reason.')), /Source revision/);
});
test('editor rename participants include sibling patch without overwrite', async t => {
  const { root, api } = await setup(t);
  const uri = api.drafts.create(await service.load(root, 'app.ts'), 2);
  await api.drafts.writeFile(uri, Buffer.from('Reason.'));
  let pending;
  events.rename.fire({ files: [{ oldUri: Uri.file(path.join(root, 'app.ts')), newUri: Uri.file(path.join(root, 'renamed.ts')) }], waitUntil(value) { pending = value; } });
  const edit = await pending;
  assert.equal(edit.renames.length, 1);
  assert.equal(edit.renames[0].a.fsPath, path.join(root, 'app.ts.comment'));
  assert.equal(edit.renames[0].options.overwrite, false);
});

function hoverText(hover) {
  return hover.contents.flatMap(content => content.parts.map(part => part.value)).join('');
}
async function addDraft(api, root, text = 'Wait for initialization.') {
  const uri = api.drafts.create(await service.load(root, 'app.ts'), 2);
  await api.drafts.writeFile(uri, Buffer.from(text));
  return uri;
}
test('quiet defaults render one comment body without markers, status bar or revision metadata', async t => {
  const { root, document, editor, api } = await setup(t);
  await addDraft(api, root);
  await api.refresh(document.uri);
  assert.deepEqual(editor.decorations, []);
  assert.equal(vscode.status.visible, false);
  const hover = await hoverProviders.at(-1).provideHover(document, new Position(1, 3), { isCancellationRequested: false });
  assert.equal(hover.contents.length, 1);
  assert.equal(hoverText(hover), 'Wait for initialization.');
});
test('optional markers are dots with no decoration hover to duplicate provider content', async t => {
  const { root, document, editor, api } = await setup(t);
  await addDraft(api, root);
  vscode.configuration.showMarkers = true;
  await api.refresh(document.uri);
  assert.equal(editor.decorations.length, 1);
  assert.equal(editor.decorations[0].renderOptions.after.contentText, '·');
  assert.equal(Object.hasOwn(editor.decorations[0], 'hoverMessage'), false);
  vscode.configuration.showMarkers = false;
  await api.refresh(document.uri);
  assert.deepEqual(editor.decorations, []);
});
test('hover metadata is explicitly opt-in', async t => {
  const { root, document, api } = await setup(t);
  await addDraft(api, root);
  vscode.configuration.showHoverMetadata = true;
  const hover = await hoverProviders.at(-1).provideHover(document, new Position(1, 0), { isCancellationRequested: false });
  const note = (await service.load(root, 'app.ts')).notes[0];
  assert.ok(hoverText(hover).includes(note.id));
  assert.match(hoverText(hover), /attached/);
  assert.match(hoverText(hover), /Source matches the recorded revision/);
});
test('review warning remains visible when debug metadata and markers are off', async t => {
  const { root, document, api } = await setup(t);
  await addDraft(api, root);
  await api.store.get(document);
  const offset = document.text.indexOf('wait()');
  document.text = document.text.replace('wait()', 'awaitReady()'); document.version++;
  api.store.changed({ document, contentChanges: [{ rangeOffset: offset, rangeLength: 6, text: 'awaitReady()' }] });
  const hover = await hoverProviders.at(-1).provideHover(document, new Position(1, 0), { isCancellationRequested: false });
  assert.match(hoverText(hover), /Needs review/);
  assert.doesNotMatch(hoverText(hover), /Source matches/);
  await api.refresh(document.uri);
  assert.equal(vscode.status.visible, true);
});
test('aliased workspace loads source and refreshes cached annotations after a canonical draft save', async t => {
  const { root, document, api } = await setup(t, { alias: true });
  assert.equal((await api.store.get(document)).results.length, 0);
  await addDraft(api, root);
  const entry = await api.store.get(document);
  assert.equal(entry.results.length, 1);
  assert.equal(entry.snapshot.sourcePath, await fs.realpath(document.uri.fsPath));
  assert.notEqual(entry.snapshot.sourcePath, document.uri.fsPath);
});
test('dirty source through an alias blocks draft save without writing the sidecar', async t => {
  const { root, document, api } = await setup(t, { alias: true });
  const uri = api.drafts.create(await service.load(root, 'app.ts'), 2);
  document.isDirty = true;
  await assert.rejects(() => api.drafts.writeFile(uri, Buffer.from('Reason.')), /Save the source/);
  await assert.rejects(() => fs.stat(path.join(root, 'app.ts.comment')), { code: 'ENOENT' });
});
test('dirty aliased sidecar blocks both draft edits and automatic tracked writes', async t => {
  const { root, document, api } = await setup(t, { alias: true });
  const uri = await addDraft(api, root);
  const sidecar = await vscode.workspace.openTextDocument(Uri.file(path.join(root, 'app.ts.comment')));
  const before = sidecar.getText(); sidecar.isDirty = true;
  await assert.rejects(() => api.drafts.writeFile(uri, Buffer.from('Updated reason.')), /Save the source/);
  await api.store.get(document);
  document.text = '\n' + document.text; document.version++;
  api.store.changed({ document, contentChanges: [{ rangeOffset: 0, rangeLength: 0, text: '\n' }] });
  await fs.writeFile(document.uri.fsPath, document.text);
  await api.store.saved(document);
  assert.ok(vscode.logs.some(line => line.includes('Sidecar has unsaved edits')));
  assert.equal(await fs.readFile(sidecar.uri.fsPath, 'utf8'), before);
  sidecar.isDirty = false;
  await api.store.saved(document);
  assert.equal((await service.load(root, 'app.ts')).notes[0].line, 3);
});
test('canonical sidecar watcher event invalidates an aliased editor cache', async t => {
  const { root, document, api } = await setup(t, { alias: true });
  const entry = await api.store.get(document);
  assert.equal(entry.results.length, 0);
  const snapshot = await service.load(root, 'app.ts');
  await service.write(root, 'app.ts', { operation: 'add', line: 2, text: 'External writer.', expectedText: 'if (!ready) wait();', expectedSource: snapshot.sourceHash, expectedSidecar: snapshot.sidecarHash });
  await events.sidecarChange.fire(Uri.file(snapshot.sidecarPath));
  assert.equal((await api.store.get(document)).results[0].note.text, 'External writer.');
});
