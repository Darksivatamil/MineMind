'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createLogger } = require('../src/core/logger');
const { createJsonl } = require('../src/core/jsonl');
const { createBus } = require('../src/core/bus');
const { createLoop } = require('../src/core/loop');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-core-'));
}

test('logger writes to console and file, honours level', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'events.log');
  const logger = createLogger({ name: 'test', level: 'warn', file });
  logger.debug('should not appear');
  logger.warn('hello', { a: 1 });
  const contents = fs.readFileSync(file, 'utf8');
  assert.ok(contents.includes('hello'), 'warn line present');
  assert.ok(!contents.includes('should not appear'), 'debug filtered out');
});

test('jsonl appends one object per line and readTail returns them', () => {
  const dir = tmpDir();
  const file = path.join(dir, 'decisions.jsonl');
  const j = createJsonl({ file });
  assert.ok(j.write({ source: 'llm', action: 'mine', thought: 'need wood' }));
  j.write({ source: 'reflex', veto: 'health_floor' });
  const tail = j.readTail(10);
  assert.strictEqual(tail.length, 2);
  assert.strictEqual(tail[0].source, 'llm');
  assert.strictEqual(typeof tail[0].t, 'number');
  assert.strictEqual(tail[1].source, 'reflex');
  assert.strictEqual(j.errors(), 0);
});

test('bus emits to multiple listeners and isolates throwing listeners', () => {
  const bus = createBus();
  let got = 0;
  let errors = 0;
  bus.onError(() => errors++);
  bus.on('ev', () => { got++; });
  bus.on('ev', () => { throw new Error('boom'); });
  bus.on('ev', () => { got++; });
  const delivered = bus.emit('ev', { x: 1 });
  assert.strictEqual(got, 2, 'non-throwing listeners still run');
  assert.strictEqual(delivered, 2);
  assert.strictEqual(errors, 1, 'throwing listener reported once');
});

test('bus on() returns an off function', () => {
  const bus = createBus();
  let n = 0;
  const off = bus.on('x', () => n++);
  bus.emit('x');
  off();
  bus.emit('x');
  assert.strictEqual(n, 1);
});

test('loop: cadence tick calls handler exactly once per interval', async () => {
  const calls = [];
  const loop = createLoop({
    intervalMs: 20,
    decisionsPerMinute: 100000, // effectively no rate limiting for this test
    handler: async ({ trigger }) => { calls.push(trigger); },
  });
  loop.start();
  await new Promise((r) => setTimeout(r, 90));
  loop.stop();
  assert.ok(calls.length >= 2, `expected >=2 cadence ticks, got ${calls.length}`);
  assert.ok(calls.every((t) => t === 'cadence'), 'only cadence fired');
});

test('loop: no handler -> ticks are skipped, nothing "played"', async () => {
  const loop = createLoop({ intervalMs: 10, decisionsPerMinute: 100000, handler: null });
  loop.start();
  await new Promise((r) => setTimeout(r, 60));
  const s = loop.stats();
  loop.stop();
  assert.ok(s.ticks >= 2, 'ticks fired');
  assert.ok(s.skippedNoHandler >= 2, 'every tick skipped without handler');
  assert.strictEqual(s.handled, 0, 'nothing handled -> no gameplay');
});

test('loop: rate limiter caps decisions per minute', async () => {
  let calls = 0;
  // 60 decisions/minute => 1000ms gap. Burst many requests, only ~1 per gap.
  const loop = createLoop({
    intervalMs: 5,
    decisionsPerMinute: 60,
    handler: async () => { calls++; },
  });
  assert.strictEqual(loop.minGapMs, 1000);
  loop.start();
  for (let i = 0; i < 20; i++) loop.request('threat_near');
  await new Promise((r) => setTimeout(r, 120));
  const s = loop.stats();
  loop.stop();
  assert.ok(calls <= 2, `rate limiter should hold calls low, got ${calls}`);
  assert.ok(s.byTrigger.threat_near >= 1, 'request was recorded');
});

test('loop: salient event via bus triggers an early tick', async () => {
  const bus = createBus();
  const calls = [];
  const loop = createLoop({
    intervalMs: 100000, // cadence far away; event must preempt
    decisionsPerMinute: 100000,
    bus,
    handler: async ({ trigger }) => { calls.push(trigger); },
  });
  loop.start();
  bus.emit('health_drop', { amount: 3 });
  await loop.flush();
  loop.stop();
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0], 'health_drop');
});
