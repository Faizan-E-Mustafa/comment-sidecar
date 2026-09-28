'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

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
      // Compile each file as a CommonJS module body, as `node --check` does, without a process per file.
      const source = fs.readFileSync(file, 'utf8').replace(/^#!.*/, '');
      vm.compileFunction(source, ['exports', 'require', 'module', '__filename', '__dirname'], { filename: file });
      count++;
    }
  }
}
console.log(`Syntax checked ${count} JavaScript files.`);
