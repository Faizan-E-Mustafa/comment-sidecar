'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const pending = ['src', 'test', 'scripts'].map(folder => path.join(root, folder));
let count = 0;
while (pending.length) {
  const directory = pending.pop();
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      pending.push(file);
    } else if (file.endsWith('.js')) {
      execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
      count++;
    }
  }
}
console.log(`Syntax checked ${count} JavaScript files.`);
