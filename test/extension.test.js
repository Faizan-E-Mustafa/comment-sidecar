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
  fire(value) { for (const callback of this.listeners) callback(value); }
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
    registerHoverProvider(selector, provider) { hoverProviders.push(provider); return new Disposable(); },
  },
  workspace: {
    isTrusted: true, textDocuments: [], root: '',
    getWorkspaceFolder(uri) { return uri.scheme === 'file' && uri.fsPath.startsWith(`${this.root}${path.sep}`) ? { uri: Uri.file(this.root) } : undefined; },
    getConfiguration() { return { get: (key, fallback) => fallback }; },
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
    createOutputChannel() { return { appendLine() {}, show() {}, dispose() {} }; },
    createTextEditorDecorationType() { return new Disposable(); },
    createStatusBarItem() { return { hide() {}, show() {}, dispose() {} }; },
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
function makeEditor(document) { return { document, selection: new Selection(new Position(1, 0), new Position(1, 0)), setDecorations() {}, revealRange() {} }; }
const originalLoad = Module._load;
Module._load = function(request, ...args) { return request === 'vscode' ? vscode : originalLoad.call(this, request, ...args); };
const { activate } = require('../src/extension/extension');
Module._load = originalLoad;

async function setup(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'line-comments-editor-'));
  const text = 'const ready = false;\nif (!ready) wait();\nstart();\n';
  await fs.writeFile(path.join(root, 'app.ts'), text);
  vscode.workspace.root = root; vscode.workspace.textDocuments = []; vscode.workspace.isTrusted = true;
  const document = await vscode.workspace.openTextDocument(Uri.file(path.join(root, 'app.ts')));
  const editor = makeEditor(document);
  vscode.window.activeTextEditor = editor; vscode.window.visibleTextEditors = [editor];
  const context = { subscriptions: [], asAbsolutePath: file => path.join(__dirname, '..', file) };
  const api = activate(context);
  t.after(async () => { context.subscriptions.forEach(item => item.dispose()); await fs.rm(root, { recursive: true, force: true }); });
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
