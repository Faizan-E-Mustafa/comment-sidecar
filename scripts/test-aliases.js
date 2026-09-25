'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');

async function main() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'line-comments-alias-suite-'));
  try {
    const real = path.join(directory, 'real');
    const alias = path.join(directory, 'alias');
    await fs.mkdir(real);
    await fs.symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
    const root = path.resolve(__dirname, '..');
    const tests = (await fs.readdir(path.join(root, 'test'))).filter(name => name.endsWith('.test.js')).sort().map(name => path.join('test', name));
    console.log('Running the full suite with TMPDIR/TEMP/TMP pointing through a directory alias.');
    const child = spawn(process.execPath, ['--test', ...tests], {
      cwd: root, stdio: 'inherit', env: { ...process.env, TMPDIR: alias, TEMP: alias, TMP: alias },
    });
    process.exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => resolve(signal ? 1 : code ?? 1));
    });
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
