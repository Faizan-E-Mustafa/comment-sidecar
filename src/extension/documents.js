'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function identity(file) {
  try {
    return await fs.realpath(file);
  } catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) {
      throw error;
    }
    const parent = path.dirname(file);
    if (parent === file) {
      return path.resolve(file);
    }
    return path.join(await identity(parent), path.basename(file));
  }
}

async function matchingDocuments(paths, dirtyOnly = false) {
  const targets = new Set(await Promise.all(paths.map(identity)));
  const matches = [];
  for (const document of vscode.workspace.textDocuments) {
    if (document.uri.scheme !== 'file' || (dirtyOnly && !document.isDirty)) {
      continue;
    }
    if (targets.has(await identity(document.uri.fsPath))) {
      matches.push(document);
    }
  }
  return matches;
}

async function hasDirtyDocument(paths) {
  const documents = await matchingDocuments(paths, true);
  return documents.some(document => document.isDirty);
}

async function sidecarRenameEdit(files) {
  const edit = new vscode.WorkspaceEdit();
  for (const file of files) {
    if (file.oldUri.scheme !== 'file' || file.newUri.scheme !== 'file' || file.oldUri.fsPath.endsWith('.comment')) {
      continue;
    }
    if (!vscode.workspace.getWorkspaceFolder(file.newUri)) {
      continue;
    }

    const oldSidecar = vscode.Uri.file(`${file.oldUri.fsPath}.comment`);
    const newSidecar = vscode.Uri.file(`${file.newUri.fsPath}.comment`);
    try {
      await vscode.workspace.fs.stat(oldSidecar);
      if (files.some(item => item.oldUri.toString() === oldSidecar.toString())) {
        continue;
      }
      edit.renameFile(oldSidecar, newSidecar, { overwrite: false });
    } catch {}
  }
  return edit;
}

module.exports = { identity, matchingDocuments, hasDirtyDocument, sidecarRenameEdit };
