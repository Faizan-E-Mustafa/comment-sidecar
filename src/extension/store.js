'use strict';
const vscode = require('vscode');
const { load, saveTracked } = require('../node/service');
const { sourceHash } = require('../core/text');
const { resolveNotes } = require('../core/anchors');
const { trackEdits } = require('../core/edits');
const { MAX_FILE_BYTES } = require('../node/workspace');
const { hasDirtyDocument } = require('./documents');

function indexResults(results) {
  const byLine = new Map();
  for (const result of results) {
    if (result.line === null) {
      continue;
    }
    const items = byLine.get(result.line);
    if (items) {
      items.push(result);
    } else {
      byLine.set(result.line, [result]);
    }
  }
  return byLine;
}

function setResults(entry, results) {
  entry.results = results;
  entry.byLine = indexResults(results);
}

class Store {
  constructor(onUpdate, onError) {
    this.cache = new Map();
    this.pending = new Map();
    this.onUpdate = onUpdate;
    this.onError = onError;
    this.saving = new Set();
  }
  supports(document) {
    return document.uri.scheme === 'file' && !document.uri.fsPath.endsWith('.comment') && !!vscode.workspace.getWorkspaceFolder(document.uri);
  }
  async get(document) {
    if (!this.supports(document)) {
      return null;
    }

    const key = document.uri.toString();
    if (this.cache.has(key)) {
      return this.cache.get(key);
    }
    if (this.pending.has(key)) {
      return this.pending.get(key);
    }

    const promise = this.loadDocument(document).finally(() => this.pending.delete(key));
    this.pending.set(key, promise);
    return promise;
  }
  async loadDocument(document) {
    const text = document.getText();
    if (Buffer.byteLength(text) > MAX_FILE_BYTES) {
      throw new Error('Line Comments skips source files larger than 2 MiB.');
    }

    const root = vscode.workspace.getWorkspaceFolder(document.uri).uri.fsPath;
    const snapshot = await load(root, document.uri.fsPath);
    const current = document.getText();
    const entry = { snapshot, source: current, history: new Map(), version: document.version };
    setResults(entry, current === snapshot.source ? snapshot.results : resolveNotes(current, snapshot.notes));
    if (entry.results.length) {
      entry.history.set(current === snapshot.source ? snapshot.sourceHash : sourceHash(current), entry.results);
    }

    this.cache.set(document.uri.toString(), entry);
    this.onUpdate(document.uri);
    return entry;
  }
  changed(event) {
    const document = event.document;
    const key = document.uri.toString();
    const entry = this.cache.get(key);
    if (!entry || !event.contentChanges.length) {
      return;
    }

    const next = document.getText();
    if (Buffer.byteLength(next) > MAX_FILE_BYTES) {
      this.cache.delete(key);
      this.onUpdate(document.uri);
      return;
    }
    if (!entry.results.length) {
      entry.source = next;
      entry.version = document.version;
      this.onUpdate(document.uri);
      return;
    }

    const nextHash = sourceHash(next);
    if (entry.history.has(nextHash)) {
      setResults(entry, entry.history.get(nextHash));
    } else {
      try {
        setResults(entry, trackEdits(entry.source, next, entry.results, event.contentChanges));
      } catch {
        setResults(entry, resolveNotes(next, entry.snapshot.notes));
      }
    }

    entry.source = next;
    entry.version = document.version;
    entry.history.set(nextHash, entry.results);
    while (entry.history.size > 16) {
      entry.history.delete(entry.history.keys().next().value);
    }
    this.onUpdate(document.uri);
  }
  async saved(document) {
    const key = document.uri.toString();
    const entry = this.cache.get(key);
    if (!entry || !entry.snapshot.notes.length || !vscode.workspace.isTrusted || this.saving.has(key)) {
      return;
    }

    this.saving.add(key);
    try {
      if (await hasDirtyDocument([entry.snapshot.sidecarPath])) {
        throw new Error('Sidecar has unsaved edits. Save it before syncing tracked comments.');
      }

      const source = entry.source;
      const version = entry.version;
      await saveTracked(entry.snapshot, source, entry.results);
      const snapshot = await load(entry.snapshot.root, entry.snapshot.sourcePath);
      entry.snapshot = snapshot;
      if (entry.version === version) {
        setResults(entry, source === snapshot.source ? snapshot.results : resolveNotes(source, snapshot.notes));
      }
      this.onUpdate(document.uri);
    } catch (error) {
      this.onError(error);
    } finally {
      this.saving.delete(key);
    }
  }
  invalidate(uri) {
    const key = uri.toString();
    if (this.saving.has(key)) {
      return;
    }
    this.cache.delete(key);
  }
  close(document) {
    this.cache.delete(document.uri.toString());
  }
}
module.exports = { Store };
