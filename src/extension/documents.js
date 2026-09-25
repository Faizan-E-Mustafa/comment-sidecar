'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const vscode = require('vscode');

async function identity(file) {
  try { return await fs.realpath(file); }
  catch (error) {
    if (!['ENOENT', 'ENOTDIR'].includes(error.code)) throw error;
    const parent = path.dirname(file);
    if (parent === file) return path.resolve(file);
    return path.join(await identity(parent), path.basename(file));
  }
}
async function matchingDocuments(paths, dirtyOnly = false) {
  const targets = new Set(await Promise.all(paths.map(identity)));
  const matches = [];
  for (const document of vscode.workspace.textDocuments) {
    if (document.uri.scheme !== 'file' || (dirtyOnly && !document.isDirty)) continue;
    if (targets.has(await identity(document.uri.fsPath))) matches.push(document);
  }
  return matches;
}
async function hasDirtyDocument(paths) {
  return (await matchingDocuments(paths, true)).some(document => document.isDirty);
}
module.exports = { identity, matchingDocuments, hasDirtyDocument };
