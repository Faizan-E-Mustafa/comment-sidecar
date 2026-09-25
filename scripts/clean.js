'use strict';
const fs = require('node:fs');
const path = require('node:path');

const reports = new Set(['BENCHMARK.json', 'PERFORMANCE-COMPARISON.json']);
const buildName = /^line-comments-\d+\.\d+\.\d+(?:-[\w.-]+)?(?:\.vsix|-source\.zip)$/;

function findGeneratedFiles(root) {
  const candidates = [];
  for (const folder of ['', 'dist', 'reports']) {
    const directory = path.join(root, folder);
    let stat;
    try { stat = fs.lstatSync(directory); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink()) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (!entry.isFile() || entry.isSymbolicLink()) continue;
      const isBuild = folder !== 'reports' && buildName.test(entry.name);
      const isReport = folder !== 'dist' && reports.has(entry.name);
      if (isBuild || isReport) candidates.push(path.join(folder, entry.name));
    }
  }
  return candidates.sort();
}
function clean(root, apply = false) {
  root = fs.realpathSync(root);
  const files = findGeneratedFiles(root);
  if (!apply) return files;
  for (const file of files) {
    const target = path.join(root, file);
    const parent = path.dirname(target);
    if (fs.realpathSync(parent) !== parent) throw new Error(`Refusing aliased directory: ${parent}`);
    const stat = fs.lstatSync(target);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Not a regular generated file: ${file}`);
    fs.unlinkSync(target);
  }
  return files;
}
if (require.main === module) {
  try {
    const args = process.argv.slice(2);
    if (args.some(arg => arg !== '--apply') || args.length > 1) throw new Error('Usage: npm run clean [-- --apply]');
    const apply = args.includes('--apply');
    const files = clean(path.resolve(__dirname, '..'), apply);
    console.log(apply ? 'Removed generated files:' : 'Preview only; no files deleted:');
    console.log(files.length ? files.join('\n') : '(none)');
    if (!apply) console.log('Run npm run clean -- --apply to remove only the listed artifacts.');
  } catch (error) { console.error(error.message); process.exitCode = 2; }
}
module.exports = { clean, findGeneratedFiles };
