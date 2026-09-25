'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { hash } = require('../core/text');
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const IGNORED = new Set(['.git', 'node_modules', 'dist', 'build', '.next', '.venv', 'vendor', '.turbo', 'coverage']);

function inside(root, file) {
  const relative = path.relative(root, file);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function resolveSource(root, file) {
  const requestedRoot = path.resolve(root);
  const canonicalRoot = await fs.realpath(requestedRoot);
  const requested = path.resolve(requestedRoot, file);
  const inRequestedRoot = inside(requestedRoot, requested);
  const inCanonicalRoot = inside(canonicalRoot, requested);

  if (requested === requestedRoot || requested === canonicalRoot || (!path.isAbsolute(file) && !inRequestedRoot)) {
    throw new Error('File must be inside the selected workspace.');
  }
  if (requested.endsWith('.comment') || /[\r\n\0]/.test(requested)) {
    throw new Error('Select a source file, not a sidecar.');
  }

  const lexicalRoot = inRequestedRoot ? requestedRoot : inCanonicalRoot ? canonicalRoot : null;

  if (lexicalRoot && path.relative(lexicalRoot, requested).split(path.sep).some(part => IGNORED.has(part))) {
    throw new Error('Generated, dependency, and VCS directories are excluded.');
  }

  let parent;
  try {
    parent = await fs.realpath(path.dirname(requested));
  } catch (error) {
    if (!lexicalRoot) {
      throw new Error('File must be inside the selected workspace.');
    }
    throw error;
  }

  const absolute = path.join(parent, path.basename(requested));

  if (!inside(canonicalRoot, absolute) || absolute === canonicalRoot) {
    throw new Error(lexicalRoot ? 'Symlinks may not escape the workspace.' : 'File must be inside the selected workspace.');
  }
  if (path.relative(canonicalRoot, absolute).split(path.sep).some(part => IGNORED.has(part))) {
    throw new Error('Generated, dependency, and VCS directories are excluded.');
  }

  const stat = await fs.lstat(absolute);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error('Source must be a regular, non-symlink file.');
  }

  const real = await fs.realpath(absolute);
  if (!inside(canonicalRoot, real)) {
    throw new Error('Symlinks may not escape the workspace.');
  }

  return { root: canonicalRoot, sourcePath: real, sidecarPath: `${real}.comment`, file: path.relative(canonicalRoot, real).split(path.sep).join('/') };
}
async function readText(file, optional = false) {
  let handle;
  try {
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error('Refusing a non-regular or symlink file.');
    }
    if (stat.size > MAX_FILE_BYTES) {
      throw new Error(`File exceeds ${MAX_FILE_BYTES / 1024 / 1024} MiB: ${path.basename(file)}`);
    }

    handle = await fs.open(file, 'r');
    const bytes = await handle.readFile();
    if (bytes.length > MAX_FILE_BYTES) {
      throw new Error('File grew beyond the size limit.');
    }

    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) {
      throw new Error('Binary files are not supported.');
    }

    return text;
  } catch (error) {
    if (optional && error.code === 'ENOENT') {
      return null;
    }
    throw error;
  } finally {
    await handle?.close();
  }
}
async function withLock(file, action) {
  const lock = `${file}.lock`;
  let handle;

  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      handle = await fs.open(lock, 'wx', 0o600);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  }
  if (!handle) {
    throw new Error(`Sidecar is busy. Retry; if a crashed process left ${path.basename(lock)}, remove it only after confirming no writer is running.`);
  }

  try {
    return await action();
  } finally {
    await handle.close();
    await fs.unlink(lock).catch(() => {});
  }
}
async function atomicWrite(file, value, expectedHash) {
  const current = await readText(file, true);
  if (hash(current ?? '') !== expectedHash) {
    throw new Error('Sidecar changed concurrently. Read again before writing.');
  }

  const temp = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temp, value, { flag: 'wx', mode: 0o600 });
    const latest = await readText(file, true);
    if (hash(latest ?? '') !== expectedHash) {
      throw new Error('Sidecar changed concurrently. Read again before writing.');
    }
    await fs.rename(temp, file);
  } finally {
    await fs.unlink(temp).catch(() => {});
  }
}
async function findSidecars(root, limit = 5000) {
  const result = [];
  const pending = [await fs.realpath(root)];
  let visited = 0;

  while (pending.length) {
    const directory = pending.pop();
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (++visited > 200000) {
        throw new Error('Workspace scan limit exceeded; check individual files instead.');
      }
      if (entry.isSymbolicLink() || IGNORED.has(entry.name)) {
        continue;
      }

      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(file);
      }
      if (!entry.isFile() || !entry.name.endsWith('.comment')) {
        continue;
      }
      if (result.length >= limit) {
        throw new Error('Too many sidecars; check individual files instead.');
      }

      result.push(file);
    }
  }

  return result.sort();
}
module.exports = { resolveSource, readText, withLock, atomicWrite, findSidecars, inside, MAX_FILE_BYTES };
