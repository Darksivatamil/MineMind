'use strict';
const test = require('node:test');
const assert = require('node:assert');
const net = require('net');

const { resolveTarget } = require('../src/net/target');
const { tcpCheck } = require('../src/net/preflight');

test('resolveTarget: env overrides config', () => {
  const t = resolveTarget({
    env: { MC_HOST: 'example.local', MC_PORT: '25599', MC_USERNAME: 'AGNES2' },
    settings: { host: 'localhost', port: 3344, username: 'AGNES', version: '1.21', auth: 'offline', owner: 'Player' },
  });
  assert.strictEqual(t.host, 'example.local');
  assert.strictEqual(t.port, 25599);
  assert.strictEqual(t.username, 'AGNES2');
  assert.strictEqual(t.version, '1.21');
});

test('resolveTarget: falls back to config then defaults', () => {
  const t = resolveTarget({ env: {}, settings: { host: 'cfg.host', port: 3000 } });
  assert.strictEqual(t.host, 'cfg.host');
  assert.strictEqual(t.port, 3000);
  assert.strictEqual(t.version, '1.21.11', 'default version used');
  assert.strictEqual(t.owner, 'Player');
});

test('resolveTarget: invalid port warns and falls back', () => {
  const t = resolveTarget({ env: { MC_PORT: 'not-a-number' }, settings: { port: 3344 } });
  assert.strictEqual(t.port, 3344);
  assert.ok(t.warnings.some((w) => w.includes('invalid port')));
});

test('resolveTarget: default settings.json parses with no warnings', () => {
  const t = resolveTarget({ env: {} });
  assert.strictEqual(t.port, 3344);
  assert.strictEqual(t.username, 'AGNES');
  assert.deepStrictEqual(t.warnings, []);
});

test('tcpCheck: succeeds against a listening socket', async () => {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const res = await tcpCheck({ host: '127.0.0.1', port }, { timeoutMs: 2000 });
  server.close();
  assert.strictEqual(res.ok, true);
});

test('tcpCheck: refused connection returns ok=false with hint', async () => {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  server.close();
  await new Promise((r) => setTimeout(r, 50));
  const res = await tcpCheck({ host: '127.0.0.1', port }, { timeoutMs: 1000 });
  assert.strictEqual(res.ok, false);
  assert.ok(res.error, 'error message present');
});

test('tcpCheck: invalid port returns ok=false without throwing', async () => {
  const res = await tcpCheck({ host: '127.0.0.1', port: 99999 });
  assert.strictEqual(res.ok, false);
  assert.ok(res.hint.includes('MC_PORT'));
});
