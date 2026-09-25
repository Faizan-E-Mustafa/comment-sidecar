'use strict';
const vscode = require('vscode');
const { randomUUID } = require('node:crypto');
const path = require('node:path');
const { write } = require('../node/service');
const { assertComment } = require('../core/note');
const { hasDirtyDocument } = require('./documents');

class DraftProvider {
  constructor(onSaved) {
    this.entries = new Map();
    this.events = new vscode.EventEmitter();
    this.onDidChangeFile = this.events.event;
    this.onSaved = onSaved;
  }
  create(snapshot, line, note) {
    const name = `${path.basename(snapshot.sourcePath)}-line-${line || note.line}.txt`;
    const uri = vscode.Uri.from({ scheme: 'line-comment-draft', path: `/${randomUUID()}/${name}` });
    this.entries.set(uri.toString(), { snapshot, line, id: note?.id, text: note?.text || '', time: Date.now() });
    return uri;
  }
  get(uri) {
    const entry = this.entries.get(uri.toString());
    if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
    return entry;
  }
  stat(uri) {
    const entry = this.get(uri);
    return { type: vscode.FileType.File, ctime: entry.time, mtime: entry.time, size: Buffer.byteLength(entry.text) };
  }
  readFile(uri) { return Buffer.from(this.get(uri).text); }
  async writeFile(uri, content) {
    if (!vscode.workspace.isTrusted) throw vscode.FileSystemError.NoPermissions('Trust the workspace before changing comments.');
    const entry = this.get(uri);
    if (content.byteLength > 64000) throw new Error('Comment is too large.');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(content);
    assertComment(text);
    if (await hasDirtyDocument([entry.snapshot.sourcePath, entry.snapshot.sidecarPath])) {
      throw new Error('Save the source and sidecar before saving this comment.');
    }
    const result = await write(entry.snapshot.root, entry.snapshot.sourcePath, {
      operation: entry.id ? 'update' : 'add', id: entry.id, line: entry.line, text,
      expectedText: entry.snapshot.source.replace(/\r\n/g, '\n').split('\n')[entry.line - 1],
      expectedSource: entry.snapshot.sourceHash, expectedSidecar: entry.snapshot.sidecarHash,
    });
    entry.id = result.id; entry.text = text; entry.time = Date.now();
    entry.snapshot.sourceHash = result.source; entry.snapshot.sidecarHash = result.sidecar;
    this.events.fire([{ type: vscode.FileChangeType.Changed, uri }]);
    await this.onSaved(vscode.Uri.file(entry.snapshot.sourcePath));
  }
  watch() { return new vscode.Disposable(() => {}); }
  readDirectory() { return []; }
  createDirectory() { throw vscode.FileSystemError.NoPermissions(); }
  delete() { throw vscode.FileSystemError.NoPermissions(); }
  rename() { throw vscode.FileSystemError.NoPermissions(); }
  close(uri) { this.entries.delete(uri.toString()); }
  dispose() { this.entries.clear(); this.events.dispose(); }
}
module.exports = { DraftProvider };
