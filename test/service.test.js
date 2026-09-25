'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { promisify } = require('node:util');
const { execFile } = require('node:child_process');
const exec = promisify(execFile);
const service = require('../src/node/service');
const { resolveSource } = require('../src/node/workspace');
const { createHandler } = require('../src/mcp');
const { parse } = require('../src/core/format');
const SOURCE = 'const ready = false;\nif (!ready) wait();\nstart();\n';
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'line-comments-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(root, 'app.ts'), SOURCE);
  return root;
}
async function add(root, text = 'Wait until initialization completes.') {
  const snapshot = await service.load(root, 'app.ts');
  return service.write(root, 'app.ts', { operation: 'add', line: 2, text, expectedText: 'if (!ready) wait();', expectedSource: snapshot.sourceHash, expectedSidecar: snapshot.sidecarHash });
}
function revisions(snapshot) { return { expectedSource: snapshot.sourceHash, expectedSidecar: snapshot.sidecarHash }; }

test('end-to-end CRUD never modifies source', async t => {
  const root = await fixture(t);
  const original = await fs.readFile(path.join(root, 'app.ts'));
  const created = await add(root);
  let snapshot = await service.read(root, 'app.ts');
  assert.match(snapshot.output, /Wait until initialization/);
  await service.write(root, 'app.ts', { operation: 'update', id: created.id, text: 'Updated reason.\nSecond line.', ...revisions(snapshot) });
  snapshot = await service.load(root, 'app.ts');
  assert.equal(snapshot.notes[0].text, 'Updated reason.\nSecond line.');
  await service.write(root, 'app.ts', { operation: 'remove', id: created.id, ...revisions(snapshot) });
  assert.deepEqual((await service.load(root, 'app.ts')).notes, []);
  assert.deepEqual(await fs.readFile(path.join(root, 'app.ts')), original);
});
test('requires exact source, sidecar and target text guards', async t => {
  const root = await fixture(t);
  const snapshot = await service.load(root, 'app.ts');
  await assert.rejects(() => service.write(root, 'app.ts', { operation: 'add', line: 2, text: 'x' }), /revision/);
  await assert.rejects(() => service.write(root, 'app.ts', { operation: 'add', line: 2, text: 'x', expectedText: 'wrong', ...revisions(snapshot) }), /Target text/);
});
test('source changed after read rejects a stale write', async t => {
  const root = await fixture(t), snapshot = await service.load(root, 'app.ts');
  await fs.appendFile(path.join(root, 'app.ts'), '\n');
  await assert.rejects(() => service.write(root, 'app.ts', { operation: 'add', line: 2, text: 'x', expectedText: 'if (!ready) wait();', ...revisions(snapshot) }), /Source revision/);
});
test('concurrent writers cannot silently overwrite each other', async t => {
  const root = await fixture(t), snapshot = await service.load(root, 'app.ts');
  const options = { operation: 'add', line: 2, text: 'Reason.', expectedText: 'if (!ready) wait();', ...revisions(snapshot) };
  const attempts = await Promise.allSettled([service.write(root, 'app.ts', options), service.write(root, 'app.ts', options)]);
  assert.equal(attempts.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal((await service.load(root, 'app.ts')).notes.length, 1);
});
test('external target edit produces check failure and explicit reanchor repairs it', async t => {
  const root = await fixture(t), created = await add(root);
  await fs.writeFile(path.join(root, 'app.ts'), SOURCE.replace('if (!ready) wait();', 'if (!ready) awaitReady();'));
  assert.equal((await service.check(root)).problems, 1);
  const snapshot = await service.load(root, 'app.ts');
  await service.write(root, 'app.ts', { operation: 'reanchor', id: created.id, line: 2, expectedText: 'if (!ready) awaitReady();', ...revisions(snapshot) });
  assert.equal((await service.check(root)).problems, 0);
});
test('external file rename leaves old sidecar as an explicit error', async t => {
  const root = await fixture(t); await add(root);
  await fs.rename(path.join(root, 'app.ts'), path.join(root, 'new.ts'));
  const result = await service.check(root);
  assert.equal(result.problems, 1); assert.equal(result.reports[0].status, 'error');
});
test('rejects traversal and paths outside workspace', async t => {
  const root = await fixture(t);
  await assert.rejects(() => resolveSource(root, '../escape.ts'), /inside/);
  await assert.rejects(() => resolveSource(root, '/etc/passwd'), /inside/);
});
test('rejects source and sidecar symlinks', async t => {
  const root = await fixture(t);
  await fs.symlink(path.join(root, 'app.ts'), path.join(root, 'linked.ts'));
  await assert.rejects(() => service.load(root, 'linked.ts'), /non-symlink/);
  await fs.symlink(path.join(root, 'app.ts'), path.join(root, 'app.ts.comment'));
  await assert.rejects(() => service.load(root, 'app.ts'), /symlink/);
});
test('rejects escaping directory symlinks', async t => {
  const root = await fixture(t);
  await fs.symlink('/etc', path.join(root, 'outside'));
  await assert.rejects(() => service.load(root, 'outside/passwd'), /escape/);
});
test('rejects dependency directories and binary files', async t => {
  const root = await fixture(t);
  await fs.mkdir(path.join(root, 'node_modules'));
  await fs.writeFile(path.join(root, 'node_modules/a.js'), 'x');
  await assert.rejects(() => service.load(root, 'node_modules/a.js'), /excluded/);
  await fs.writeFile(path.join(root, 'binary'), Buffer.from([0, 1, 2]));
  await assert.rejects(() => service.load(root, 'binary'), /Binary/);
});
test('does not overwrite a dirty/malformed existing sidecar', async t => {
  const root = await fixture(t);
  await fs.writeFile(path.join(root, 'app.ts.comment'), 'user content');
  await assert.rejects(() => add(root), /Sidecar|sidecar/);
  assert.equal(await fs.readFile(path.join(root, 'app.ts.comment'), 'utf8'), 'user content');
});
test('CLI subprocess reads, writes, and reports status with exit codes', async t => {
  const root = await fixture(t), cli = path.join(__dirname, '../src/cli.js');
  const response = await exec(process.execPath, [cli, 'read', 'app.ts', '--root', root, '--json']);
  const snapshot = JSON.parse(response.stdout);
  await exec(process.execPath, [cli, 'add', 'app.ts', '--root', root, '--line', '2', '--text', 'CLI note.', '--expected-text', 'if (!ready) wait();', '--source-hash', snapshot.source, '--sidecar-hash', snapshot.sidecar]);
  const read = await exec(process.execPath, [cli, 'read', 'app.ts', '--root', root]);
  assert.match(read.stdout, /CLI note/);
  await fs.writeFile(path.join(root, 'app.ts'), 'rewritten\n');
  await assert.rejects(() => exec(process.execPath, [cli, 'check', '--root', root]), error => error.code === 1);
  await assert.rejects(() => exec(process.execPath, [cli, 'read', '--nonsense']), error => error.code === 2);
});
test('MCP initialize, tool discovery, read and write through real service', async t => {
  const root = await fixture(t), handler = createHandler(root, true);
  let response = await handler({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  assert.equal(response.result.protocolVersion, '2025-11-25');
  await handler({ jsonrpc: '2.0', method: 'notifications/initialized' });
  response = await handler({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(response.result.tools.length, 3);
  const snapshot = await service.load(root, 'app.ts');
  response = await handler({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'line_comments_write', arguments: { file: 'app.ts', operation: 'add', line: 2, text: 'MCP note.', expectedText: 'if (!ready) wait();', ...revisions(snapshot) } } });
  assert.equal(response.result.isError, undefined);
  response = await handler({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'line_comments_read', arguments: { file: 'app.ts', start: 2, end: 2 } } });
  assert.match(response.result.content[0].text, /MCP note/);
});
test('MCP read-only mode exposes no write tool', async t => {
  const root = await fixture(t), handler = createHandler(root);
  await handler({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } });
  await handler({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const list = await handler({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.equal(list.result.tools.length, 2);
  const denied = await handler({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'line_comments_write', arguments: {} } });
  assert.equal(denied.error.code, -32602);
});
test('MCP validates inputs and returns file errors as tool errors', async t => {
  const root = await fixture(t), handler = createHandler(root);
  await handler({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  await handler({ jsonrpc: '2.0', method: 'notifications/initialized' });
  let result = await handler({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'line_comments_read', arguments: { file: 'app.ts', start: -1 } } });
  assert.equal(result.error.code, -32602);
  result = await handler({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'line_comments_read', arguments: { file: '../escape' } } });
  assert.equal(result.result.isError, true);
});
test('saved tracked comments use optimistic sidecar conflict detection', async t => {
  const root = await fixture(t); await add(root);
  const snapshot = await service.load(root, 'app.ts');
  const external = parse(snapshot.raw); external.notes[0].text = 'Other author.';
  const { serialize } = require('../src/core/format');
  await fs.writeFile(snapshot.sidecarPath, serialize('app.ts', external.notes));
  await assert.rejects(() => service.saveTracked(snapshot, SOURCE, snapshot.results), /concurrently/);
});
test('MCP stdio subprocess accepts newline-delimited JSON and returns no stdout logging', async t => {
  const root = await fixture(t);
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, [path.join(__dirname, '../src/mcp.js'), '--root', root]);
  t.after(() => child.kill());
  let stdout = '', stderr = '';
  child.stdout.on('data', value => { stdout += value; });
  child.stderr.on('data', value => { stderr += value; });
  child.stdin.end([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'line_comments_read', arguments: { file: 'app.ts' } } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
  assert.equal(code, 0); assert.equal(stderr, '');
  const messages = stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(messages.length, 3);
  assert.match(messages[2].result.content[0].text, /if \(!ready\) wait/);
});
