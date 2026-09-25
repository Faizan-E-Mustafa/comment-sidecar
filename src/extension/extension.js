'use strict';
const vscode = require('vscode');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Store } = require('./store');
const { DraftProvider } = require('./drafts');
const { commentMarkdown, diagnosticsFor, markerText } = require('./presentation');
const { createHighlights } = require('./highlights');
const { render } = require('../core/render');
const service = require('../node/service');
const { matchingDocuments, hasDirtyDocument } = require('./documents');

function activate(context) {
  const output = vscode.window.createOutputChannel('Line Comments');
  const diagnostics = vscode.languages.createDiagnosticCollection('line-comments');
  const previewEvents = new vscode.EventEmitter();
  const decoration = vscode.window.createTextEditorDecorationType({
    isWholeLine: true,
    after: { margin: '0 0 0 1em', color: new vscode.ThemeColor('editorCodeLens.foreground') },
  });
  const highlights = createHighlights();
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 30);
  status.command = 'lineComments.list';
  const timers = new Map();
  const log = error => output.appendLine(`[${new Date().toISOString()}] ${error.message || error}`);
  let store;
  function updated(uri) {
    const key = uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => { timers.delete(key); void refresh(uri); }, 100));
    previewEvents.fire(previewUri(uri));
  }
  store = new Store(updated, log);
  async function invalidateSource(uri) {
    const documents = await matchingDocuments([uri.fsPath]);
    for (const document of documents) {
      store.invalidate(document.uri);
      updated(document.uri);
    }
  }
  const drafts = new DraftProvider(invalidateSource);
  const previewUri = uri => vscode.Uri.from({ scheme: 'line-comments-preview', path: `/${path.basename(uri.fsPath)}.txt`, query: encodeURIComponent(uri.toString()) });
  function clearPresentation(uri) {
    diagnostics.delete(uri);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() !== uri.toString()) continue;
      highlights.apply(editor, [], 'off');
      editor.setDecorations(decoration, []);
    }
    if (vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()) status.hide();
  }
  async function refresh(uri) {
    const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
    if (!document || !store.supports(document)) return;
    try {
      const entry = await store.get(document);
      if (!entry) { clearPresentation(uri); return; }
      diagnostics.set(uri, diagnosticsFor(document, entry.results));
      const options = [];
      const config = vscode.workspace.getConfiguration('lineComments', uri);
      const markerStyle = config.get('markerStyle', 'label');
      const show = config.get('showMarkers', true) && markerStyle !== 'off';
      const highlightStyle = config.get('highlightStyle', 'line');
      const groups = new Map();
      if (show) for (const item of entry.results) {
        if (item.line === null || item.line > document.lineCount) continue;
        const list = groups.get(item.line) || [];
        list.push(item); groups.set(item.line, list);
      }
      for (const [line, notes] of groups) {
        const needsReview = notes.some(item => item.status === 'review');
        options.push({
          range: document.lineAt(line - 1).range,
          renderOptions: {
            after: {
              contentText: markerText(needsReview, markerStyle),
            },
          },
        });
      }
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() !== uri.toString()) continue;
        highlights.apply(editor, entry.results, highlightStyle);
        editor.setDecorations(decoration, options);
      }
      if (vscode.window.activeTextEditor?.document.uri.toString() !== uri.toString()) return;
      if (!entry.results.length) { status.hide(); return; }
      const pending = entry.results.filter(item => ['review', 'ambiguous', 'detached'].includes(item.status)).length;
      if (!pending) { status.hide(); return; }
      status.text = `$(comment) ${pending} to review`;
      status.tooltip = 'Line Comments: inspect external comments'; status.show();
    } catch (error) { clearPresentation(uri); log(error); }
  }
  async function current(requireClean = false) {
    const editor = vscode.window.activeTextEditor;
    if (!editor || !store.supports(editor.document)) throw new Error('Select a saved source file inside a workspace folder.');
    if (requireClean && !vscode.workspace.isTrusted) throw new Error('Trust this workspace before changing comments.');
    if (requireClean && editor.document.isDirty) throw new Error('Save the source before adding or changing a comment.');
    const root = vscode.workspace.getWorkspaceFolder(editor.document.uri).uri.fsPath;
    const sidecarPath = `${editor.document.uri.fsPath}.comment`;
    if (requireClean && await hasDirtyDocument([editor.document.uri.fsPath, sidecarPath])) throw new Error('Save the source and sidecar before changing comments through commands.');
    return { editor, root, entry: await store.get(editor.document) };
  }
  async function pick(entry, line, all = false) {
    const local = entry.results.filter(item => item.line === line);
    const list = all || !local.length ? entry.results : local;
    if (!list.length) throw new Error('This file has no external comments.');
    if (list.length === 1) return list[0];
    const choice = await vscode.window.showQuickPick(list.map(item => ({ label: item.note.text.split('\n')[0].slice(0, 100), description: `${item.line ?? 'unresolved'} · ${item.status} · ${item.note.id}`, item })), { placeHolder: 'Choose a line comment' });
    return choice?.item;
  }
  function command(name, action) {
    context.subscriptions.push(vscode.commands.registerCommand(`lineComments.${name}`, async () => {
      try { return await action(); }
      catch (error) { log(error); void vscode.window.showErrorMessage(`Line Comments: ${error.message}`); }
    }));
  }
  async function mutate(operation, chooseAll = false) {
    const { editor, root, entry } = await current(true);
    const line = editor.selection.active.line + 1;
    const item = await pick(entry, line, chooseAll);
    if (!item) return;
    if (operation === 'remove' && await vscode.window.showWarningMessage('Delete this external comment? Source code will not change.', { modal: true }, 'Delete comment') !== 'Delete comment') return;
    const snapshot = await service.load(root, editor.document.uri.fsPath);
    await service.write(root, snapshot.sourcePath, {
      operation, id: item.note.id, line, expectedText: editor.document.lineAt(line - 1).text,
      expectedSource: snapshot.sourceHash, expectedSidecar: snapshot.sidecarHash,
    });
    store.invalidate(editor.document.uri); updated(editor.document.uri);
  }
  command('add', async () => {
    const { editor, root } = await current(true);
    const snapshot = await service.load(root, editor.document.uri.fsPath);
    const uri = drafts.create(snapshot, editor.selection.active.line + 1);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { viewColumn: vscode.ViewColumn.Beside, preview: false });
    void vscode.window.showInformationMessage('Write the comment here, then save. Only the sibling .comment file will be written.');
  });
  command('edit', async () => {
    const { editor, root, entry } = await current(true);
    const item = await pick(entry, editor.selection.active.line + 1);
    if (!item) return;
    const snapshot = await service.load(root, editor.document.uri.fsPath);
    const note = snapshot.notes.find(note => note.id === item.note.id);
    if (!note) throw new Error('Comment changed; select it again.');
    const uri = drafts.create(snapshot, item.line || note.line, note);
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri), { viewColumn: vscode.ViewColumn.Beside, preview: false });
  });
  command('remove', () => mutate('remove'));
  command('review', () => mutate('review'));
  command('reanchor', () => mutate('reanchor', true));
  command('compact', async () => {
    const { editor, root } = await current(true);
    const snapshot = await service.load(root, editor.document.uri.fsPath);
    if (snapshot.raw === null) throw new Error('This source has no .comment sidecar to convert.');
    if (snapshot.formatVersion === 2) {
      void vscode.window.showInformationMessage('This .comment file already uses code-free fingerprints.'); return;
    }
    const choice = await vscode.window.showWarningMessage(
      'Replace copied source context with fingerprints in this .comment file? Comments and attachment states are preserved. Older extension versions cannot read v2. Commit or back up the sidecar first.',
      { modal: true }, 'Convert to code-free format');
    if (choice !== 'Convert to code-free format') return;
    if (!vscode.workspace.isTrusted) throw new Error('Trust this workspace before changing comments.');
    if (await hasDirtyDocument([snapshot.sourcePath, snapshot.sidecarPath])) throw new Error('Save the source and sidecar before converting.');
    await service.write(root, snapshot.sourcePath, {
      operation: 'compact', expectedSource: snapshot.sourceHash, expectedSidecar: snapshot.sidecarHash,
    });
    store.invalidate(editor.document.uri); updated(editor.document.uri);
    void vscode.window.showInformationMessage('Converted .comment to v2. Source code was not changed.');
  });
  command('openSidecar', async () => {
    const { editor } = await current();
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(vscode.Uri.file(`${editor.document.uri.fsPath}.comment`)), { viewColumn: vscode.ViewColumn.Beside });
  });
  command('preview', async () => {
    const { editor } = await current();
    await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(previewUri(editor.document.uri)), { viewColumn: vscode.ViewColumn.Beside, preview: false });
  });
  command('copy', async () => {
    const { editor, entry } = await current();
    const start = editor.selection.isEmpty ? 1 : editor.selection.start.line + 1;
    const end = editor.selection.isEmpty ? Math.min(editor.document.lineCount, 200) : editor.selection.end.line + (editor.selection.end.character === 0 ? 0 : 1);
    const text = render(entry.source, entry.results, { start, end: Math.max(start, end), file: entry.snapshot.file, sidecarHash: entry.snapshot.sidecarHash });
    await vscode.env.clipboard.writeText(text);
    void vscode.window.showInformationMessage('Copied source and per-line comments with original line numbers.');
  });
  command('list', async () => {
    const { editor, entry } = await current();
    const item = await pick(entry, 0, true);
    if (!item) return;
    if (item.line === null) { void vscode.window.showWarningMessage(`${item.note.id}: ${item.reason} Place the cursor on the intended line and run Reattach Comment.`); return; }
    const position = new vscode.Position(item.line - 1, 0);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position));
    await vscode.commands.executeCommand('editor.action.showHover');
  });
  command('check', async () => {
    const { root } = await current();
    const report = await service.check(root);
    output.appendLine(JSON.stringify(report, null, 2)); output.show(true);
    void vscode.window.showInformationMessage(`${report.comments} comments checked; ${report.problems} need attention.`);
  });
  command('copyRules', async () => {
    const text = await fs.readFile(context.asAbsolutePath('integration/AGENTS.snippet.md'), 'utf8');
    const invocation = `node ${JSON.stringify(context.asAbsolutePath('src/cli.js'))}`;
    await vscode.env.clipboard.writeText(text.replaceAll('lc ', `${invocation} `));
    void vscode.window.showInformationMessage('Copied agent instructions. Merge into AGENTS.md or a Cursor rule; existing files have not been changed.');
  });
  command('copyMcp', async () => {
    const { root } = await current();
    const mode = await vscode.window.showQuickPick(['Read-only', 'Read and write comment sidecars'], { placeHolder: 'MCP access: source code is never writable through these tools' });
    if (!mode) return;
    const args = [context.asAbsolutePath('src/mcp.js'), '--root', root];
    if (mode !== 'Read-only') args.push('--allow-write');
    await vscode.env.clipboard.writeText(JSON.stringify({ mcpServers: { 'line-comments': { type: 'stdio', command: 'node', args } } }, null, 2));
    void vscode.window.showInformationMessage('Copied Cursor MCP configuration. Merge its server entry into .cursor/mcp.json.');
  });
  context.subscriptions.push(
    output, diagnostics, previewEvents, decoration, highlights, status, drafts,
    new vscode.Disposable(() => { for (const timer of timers.values()) clearTimeout(timer); }),
    vscode.workspace.registerFileSystemProvider('line-comment-draft', drafts, { isCaseSensitive: true }),
    vscode.workspace.registerTextDocumentContentProvider('line-comments-preview', {
      onDidChange: previewEvents.event,
      async provideTextDocumentContent(uri) {
        const sourceUri = vscode.Uri.parse(decodeURIComponent(uri.query));
        const document = await vscode.workspace.openTextDocument(sourceUri);
        const entry = await store.get(document);
        if (!entry) return 'No source context available.';
        return render(entry.source, entry.results, { file: entry.snapshot.file, end: Math.min(document.lineCount, 1000), sidecarHash: entry.snapshot.sidecarHash });
      },
    }),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, {
      async provideHover(document, position, token) {
        if (!store.supports(document)) return undefined;
        try {
          const entry = await store.get(document);
          if (token.isCancellationRequested || !entry) return undefined;
          const items = entry.results.filter(item => item.line === position.line + 1);
          if (!items.length) return undefined;
          const showMetadata = vscode.workspace.getConfiguration('lineComments', document.uri).get('showHoverMetadata', false);
          return new vscode.Hover(items.map(item => commentMarkdown(item, { showMetadata })), document.lineAt(position.line).range);
        } catch (error) { log(error); return undefined; }
      },
    }),
    vscode.workspace.onDidChangeTextDocument(event => store.changed(event)),
    vscode.workspace.onDidSaveTextDocument(document => {
      if (document.uri.scheme === 'file' && document.uri.fsPath.endsWith('.comment')) {
        void invalidateSource(vscode.Uri.file(document.uri.fsPath.slice(0, -8))).catch(log);
        return;
      }
      void store.saved(document);
    }),
    vscode.workspace.onDidCloseTextDocument(document => { store.close(document); drafts.close(document.uri); diagnostics.delete(document.uri); }),
    vscode.window.onDidChangeActiveTextEditor(editor => { status.hide(); if (editor) updated(editor.document.uri); }),
    vscode.window.onDidChangeVisibleTextEditors(editors => { for (const editor of editors) updated(editor.document.uri); }),
    vscode.workspace.onDidChangeConfiguration(event => { if (event.affectsConfiguration('lineComments')) for (const editor of vscode.window.visibleTextEditors) updated(editor.document.uri); }),
    vscode.workspace.onWillRenameFiles(event => {
      if (!vscode.workspace.isTrusted) return;
      event.waitUntil((async () => {
        const edit = new vscode.WorkspaceEdit();
        for (const file of event.files) {
          if (file.oldUri.scheme !== 'file' || file.newUri.scheme !== 'file' || file.oldUri.fsPath.endsWith('.comment')) continue;
          if (!vscode.workspace.getWorkspaceFolder(file.newUri)) continue;
          const oldSidecar = vscode.Uri.file(`${file.oldUri.fsPath}.comment`), newSidecar = vscode.Uri.file(`${file.newUri.fsPath}.comment`);
          try {
            await vscode.workspace.fs.stat(oldSidecar);
            if (event.files.some(item => item.oldUri.toString() === oldSidecar.toString())) continue;
            edit.renameFile(oldSidecar, newSidecar, { overwrite: false });
          } catch {}
        }
        return edit;
      })());
    }),
  );
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.comment');
  const changedSidecar = uri => invalidateSource(vscode.Uri.file(uri.fsPath.slice(0, -8))).catch(log);
  context.subscriptions.push(watcher, watcher.onDidChange(changedSidecar), watcher.onDidCreate(changedSidecar), watcher.onDidDelete(changedSidecar));
  for (const editor of vscode.window.visibleTextEditors) updated(editor.document.uri);
  return { store, drafts, refresh };
}
function deactivate() {}
module.exports = { activate, deactivate };
