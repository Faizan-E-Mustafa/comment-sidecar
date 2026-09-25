'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const manifest = require('../package.json');
const { readSettings } = require('../src/extension/settings');
const { createHandler } = require('../src/mcp');
const { argumentsOf } = require('../src/cli');

function config(values = {}) {
  return { get: (key, fallback) => Object.hasOwn(values, key) ? values[key] : fallback };
}

test('editor defaults come directly from the extension manifest', () => {
  const expected = Object.fromEntries(
    Object.entries(manifest.contributes.configuration.properties)
      .map(([key, schema]) => [key.slice('lineComments.'.length), schema.default]),
  );
  assert.deepEqual(readSettings(config()), expected);
  assert.deepEqual(expected, {
    showMarkers: true,
    showHoverMetadata: false,
    highlightStyle: 'line',
    markerStyle: 'label',
  });
});

test('explicit marker preferences are respected, including showMarkers false', () => {
  assert.equal(readSettings(config({ showMarkers: false })).showMarkers, false);
  assert.equal(readSettings(config({ markerStyle: 'icon' })).markerStyle, 'icon');
  assert.equal(readSettings(config({ markerStyle: 'off' })).markerStyle, 'off');
});

test('invalid configuration falls back to manifest defaults', () => {
  assert.deepEqual(readSettings(config({
    showMarkers: 'false',
    showHoverMetadata: null,
    highlightStyle: 'glow',
    markerStyle: 'dot',
  })), readSettings(config()));
});

test('CLI version and help match the package being shipped', () => {
  const cli = path.resolve(__dirname, '../src/cli.js');
  for (const flag of ['--version', '--help']) {
    const result = spawnSync(process.execPath, [cli, flag], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes(manifest.version));
    assert.equal(result.stderr, '');
    if (flag === '--version') {
      assert.equal(result.stdout.trim(), manifest.version);
    }
  }
  assert.equal(argumentsOf(['--version']).flags.version, true);
});

test('MCP advertises the same package version as the extension and CLI', async () => {
  const handle = createHandler(path.resolve(__dirname, '..'));
  const response = await handle({
    jsonrpc: '2.0', id: 1, method: 'initialize',
    params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'test', version: '1' } },
  });
  assert.equal(response.result.serverInfo.version, manifest.version);
  assert.equal(response.result.serverInfo.name, manifest.name);
});

test('sidecars nest collapsed under their source file by default', () => {
  assert.deepEqual(manifest.contributes.configurationDefaults, {
    'explorer.fileNesting.enabled': true,
    'explorer.fileNesting.expand': false,
    'explorer.fileNesting.patterns': { '*': '${capture}.comment' },
  });
});
