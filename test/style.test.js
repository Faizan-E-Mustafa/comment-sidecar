'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { findViolations } = require('../scripts/check-style');

function report(source) {
  return findViolations(source).map(({ line, message }) => `${line}: ${message}`);
}

test('accepts the repository style and ignores code-like text in comments, strings and patterns', () => {
  const source = `
'use strict';
// if (ready) start();
/* first(); second(); */
const text = 'if (ready) start(); a ? b : c ? d : e';
const pattern = /[/'"]if (ready) start();/g;
const message = \`\${ready ? 'a' : 'b'} \${\`\${name}\`}\`;
const half = total / 2 / count;
for (let index = 0; index < total; index++) {
  if (index % 2) {
    continue;
  } else if (index > 8) {
    break;
  } else {
    total -= 1;
  }
}
do {
  total -= 1;
} while (total > 0);
try {
  start();
} catch (error) {
  stop(error);
} finally {
  done();
}
main().catch(error => {
  fail(error);
});
const choice = ready
  ? 'yes'
  : 'no';
call(a ? 1 : 2, b ? 3 : 4);
`;
  assert.deepEqual(report(source), []);
});

test('flags a body without braces', () => {
  const source = `
if (ready) start();
else stop();
for (const item of items) visit(item);
while (busy) wait();
`;
  assert.deepEqual(report(source), [
    '2: Put the body of `if` in braces.',
    '3: Put the body of `else` in braces.',
    '4: Put the body of `for` in braces.',
    '5: Put the body of `while` in braces.',
  ]);
});

test('flags a block written on one line', () => {
  const source = `
if (ready) { start(); }
try { start(); } catch (error) { stop(error); }
const empty = () => {};
`;
  assert.deepEqual(report(source), [
    '2: Put the body of `if` on its own lines.',
    '3: Put the body of `try` on its own lines.',
    '3: Put each statement on its own line.',
    '3: Put the body of `catch` on its own lines.',
  ]);
});

test('flags several statements on one line but not the parts of a for header', () => {
  const source = `
first(); second();
for (let index = 0; index < total; index++) {
  step();
}
`;
  assert.deepEqual(report(source), ['2: Put each statement on its own line.']);
});

test('flags nested and chained ternaries, not separate ones', () => {
  const source = `
const chain = a ? 1 : b ? 2 : 3;
const nested = a ? b ? 1 : 2 : 3;
const multiline = a
  ? 1
  : b
    ? 2
    : 3;
const separate = [a ? 1 : 2, b ? 3 : 4];
const optional = user?.name ?? 'anonymous';
`;
  assert.deepEqual(report(source), [
    '2: Do not nest ternaries.',
    '3: Do not nest ternaries.',
    '7: Do not nest ternaries.',
  ]);
});

test('reports the right line after multi-line comments and templates', () => {
  const source = `
/* line 2
   line 3 */
const text = \`a
b\`;
if (ready) start();
`;
  assert.deepEqual(report(source), ['6: Put the body of `if` in braces.']);
});
