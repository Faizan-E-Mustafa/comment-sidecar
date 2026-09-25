'use strict';
const vscode = require('vscode');
const path = require('node:path');
const { Store } = require('./store');
const { DraftProvider } = require('./drafts');
const { hoverHeader, commentMarkdown, diagnosticsFor, markerDecorations } = require('./presentation');
const { createHighlights } = require('./highlights');
const { readSettings } = require('./settings');
const { render } = require('../core/render');
const { matchingDocuments, sidecarRenameEdit } = require('./documents');
const { registerCommands } = require('./commands');

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
  function updated(uri) {
    const key = uri.toString();
    clearTimeout(timers.get(key));
    timers.set(key, setTimeout(() => {
      timers.delete(key);
      void refresh(uri);
    }, 100));
    previewEvents.fire(previewUri(uri));
  }
  const store = new Store(updated, log);

  async function invalidateSource(uri) {
    const documents = await matchingDocuments([uri.fsPath]);
    for (const document of documents) {
      store.invalidate(document.uri);
      updated(document.uri);
    }
  }
  const drafts = new DraftProvider(invalidateSource);
  const previewUri = uri => vscode.Uri.from({
    scheme: 'line-comments-preview',
    path: `/${path.basename(uri.fsPath)}.txt`,
    query: encodeURIComponent(uri.toString()),
  });

  function clearPresentation(uri) {
    diagnostics.delete(uri);
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document.uri.toString() !== uri.toString()) {
        continue;
      }
      highlights.apply(editor, [], 'off');
      editor.setDecorations(decoration, []);
    }
    if (vscode.window.activeTextEditor?.document.uri.toString() === uri.toString()) {
      status.hide();
    }
  }

  function updateStatus(entry, uri) {
    if (vscode.window.activeTextEditor?.document.uri.toString() !== uri.toString()) {
      return;
    }
    if (!entry.results.length) {
      status.hide();
      return;
    }

    const pending = entry.results.filter(item => ['review', 'ambiguous', 'detached'].includes(item.status)).length;
    if (!pending) {
      status.hide();
      return;
    }

    status.text = `$(comment) ${pending} to review`;
    status.tooltip = 'Line Comments: inspect external comments';
    status.show();
  }

  async function refresh(uri) {
    const document = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
    if (!document || !store.supports(document)) {
      return;
    }

    try {
      const entry = await store.get(document);
      if (!entry) {
        clearPresentation(uri);
        return;
      }

      diagnostics.set(uri, diagnosticsFor(document, entry.results));
      const settings = readSettings(vscode.workspace.getConfiguration('lineComments', uri));
      const options = markerDecorations(document, entry.byLine, settings);
      for (const editor of vscode.window.visibleTextEditors) {
        if (editor.document.uri.toString() !== uri.toString()) {
          continue;
        }
        highlights.apply(editor, entry.results, settings.highlightStyle);
        editor.setDecorations(decoration, options);
      }

      updateStatus(entry, uri);
    } catch (error) {
      clearPresentation(uri);
      log(error);
    }
  }

  registerCommands(context, { store, drafts, output, log, updated, previewUri });

  context.subscriptions.push(
    output, diagnostics, previewEvents, decoration, highlights, status, drafts,
    new vscode.Disposable(() => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
    }),
    vscode.workspace.registerFileSystemProvider('line-comment-draft', drafts, { isCaseSensitive: true }),
    vscode.workspace.registerTextDocumentContentProvider('line-comments-preview', {
      onDidChange: previewEvents.event,
      async provideTextDocumentContent(uri) {
        const sourceUri = vscode.Uri.parse(decodeURIComponent(uri.query));
        const document = await vscode.workspace.openTextDocument(sourceUri);
        const entry = await store.get(document);
        if (!entry) {
          return 'No source context available.';
        }
        return render(entry.source, entry.results, {
          file: entry.snapshot.file,
          end: Math.min(document.lineCount, 1000),
          sidecarHash: entry.snapshot.sidecarHash,
        });
      },
    }),
    vscode.languages.registerHoverProvider({ scheme: 'file' }, {
      async provideHover(document, position, token) {
        if (!store.supports(document)) {
          return undefined;
        }
        try {
          const entry = await store.get(document);
          if (token.isCancellationRequested || !entry) {
            return undefined;
          }
          const items = entry.byLine.get(position.line + 1);
          if (!items?.length) {
            return undefined;
          }

          const { showHoverMetadata: showMetadata } = readSettings(
            vscode.workspace.getConfiguration('lineComments', document.uri),
          );
          const line = position.line + 1;
          const contents = [hoverHeader(line, items.length), ...items.map(item => commentMarkdown(item, { showMetadata }))];
          return new vscode.Hover(contents, document.lineAt(position.line).range);
        } catch (error) {
          log(error);
          return undefined;
        }
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
    vscode.workspace.onDidCloseTextDocument(document => {
      store.close(document);
      drafts.close(document.uri);
      diagnostics.delete(document.uri);
    }),
    vscode.window.onDidChangeActiveTextEditor(editor => {
      status.hide();
      if (editor) {
        updated(editor.document.uri);
      }
    }),
    vscode.window.onDidChangeVisibleTextEditors(editors => {
      for (const editor of editors) {
        updated(editor.document.uri);
      }
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('lineComments')) {
        return;
      }
      for (const editor of vscode.window.visibleTextEditors) {
        updated(editor.document.uri);
      }
    }),
    vscode.workspace.onWillRenameFiles(event => {
      if (vscode.workspace.isTrusted) {
        event.waitUntil(sidecarRenameEdit(event.files));
      }
    }),
  );

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.comment');
  const changedSidecar = uri => invalidateSource(vscode.Uri.file(uri.fsPath.slice(0, -8))).catch(log);
  context.subscriptions.push(
    watcher,
    watcher.onDidChange(changedSidecar),
    watcher.onDidCreate(changedSidecar),
    watcher.onDidDelete(changedSidecar),
  );
  for (const editor of vscode.window.visibleTextEditors) {
    updated(editor.document.uri);
  }
  return { store, drafts, refresh };
}
function deactivate() {}
module.exports = { activate, deactivate };
