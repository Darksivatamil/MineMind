'use strict';
/**
 * scenarios.test.js — end-to-end behaviour tests for the autopilot.
 *
 * Each scenario is a real use case with an assertion about what the bot SHOULD
 * do. They run against the mock world so they need no Minecraft server and no
 * LLM quota — but they exercise the same code path as production:
 *
 *   observe -> reflex? -> planner -> LLM/mock -> governor -> execute -> verify
 *
 * The tests are the anti-fake harness: they assert that decisions come from the
 * brain, that reflexes override the brain for survival, and that a dead brain
 * produces no invented gameplay.
 */

const test = require('node:test');
const assert = require('node:assert');

const { createMockBot, MockWorld, scenarioFlatWorld } = require('./mock_bot');
const { createAutopilot } = require('../src/ai/autopilot');
const { createExecutor } = require('../src/ai/action_executor');
const { createGovernor } = require('../src/ai/governor');
const { createMemory } = require('../src/core/memory');
const { createMockProvider } = require('../src/llm/providers');
const { createOrchestrator } = require('../src/llm/orchestrator');
const { createPlanner } = require('../src/ai/planner');
const { observe } = require('../src/ai/observer');
const fs = require('fs');
const os = require('os');
const path = require('path');

function tmpMemDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-mem-'));
}

/** Build an autopilot wired with a deterministic scripted provider. */
function rig(bot, opts = {}) {
  const memDir = opts.memDir || tmpMemDir();
  const memory = createMemory({ dataDir: memDir, logger: silent() });
  // Fast timings so the suite is not dominated by wall-clock sleeps.
  const settings = {
    ...(opts.settings || {}),
    actions: { swingDelayMs: 10, idleMs: 40, ...(opts.settings?.actions || {}) },
    verifier: { radius: 1, ...(opts.settings?.verifier || {}) },
  };
  const executor = createExecutor({ logger: silent(), settings, memory });
  const governor = createGovernor({ settings: { governor: { ...(settings.governor || {}) } } });

  // A scripted provider: each rule fires for consecutive calls in order.
  const replies = opts.replies || [{ action: 'explore', reason: 'nothing to do', confidence: 0.8 }];
  let i = 0;
  const provider = {
    name: 'scripted',
    available: true,
    async generate() {
      const r = replies[Math.min(i, replies.length - 1)];
      i++;
      return { ok: true, text: JSON.stringify(r) };
    },
  };
  const orchestrator = createOrchestrator({ providers: [provider], logger: silent() });

  // planner off by default so tests control the action loop precisely
  const planner = opts.planner
    ? createPlanner({ orchestrator, memory, logger: silent(), cfg: { minIdleTicks: 0 } })
    : null;

  const autopilot = createAutopilot({
    bot,
    settings,
    logger: silent(),
    memory,
    executor,
    governor,
    orchestrator,
    planner,
    reflex: opts.reflex || undefined,
  });
  return { autopilot, memory, executor, governor, memDir };
}

function silent() {
  return { info() {}, warn() {}, error() {}, debug() {} };
}

/* ================= USE CASE 1: it actually moves ================= */

test('use case: bot walks when the brain says explore', async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const start = bot.entity.position.clone();
  const { autopilot } = rig(bot, { replies: [{ action: 'explore', reason: 'wander', confidence: 0.9 }] });

  const rec = await autopilot.tick('cadence');
  assert.equal(rec.action, 'explore');
  assert.equal(rec.ok, true, 'explore should succeed');
  const moved = Math.hypot(bot.entity.position.x - start.x, bot.entity.position.z - start.z);
  assert.ok(moved >= 2, `bot should have moved at least 2 blocks, moved ${moved.toFixed(1)}`);
});

/* ================= USE CASE 2: survival reflex wins ============== */

test('use case: reflex overrides the brain when health is critical', async () => {
  const bot = createMockBot({ health: 4, inventory: [{ name: 'cooked_beef', count: 3 }] });
  const { autopilot } = rig(bot, {
    // brain wants to keep mining — reflex must stop it
    replies: [{ action: 'mine', target: 'stone', reason: 'keep mining', confidence: 0.99 }],
  });
  const rec = await autopilot.tick('cadence');
  assert.equal(rec.source, 'reflex', 'reflex should have taken over');
  assert.equal(rec.action, 'eat');
  assert.ok(bot.food > 4, `food should have risen from 4, is ${bot.food}`);
  assert.ok(bot._world.eaten.length === 1, 'should have eaten exactly one food item');
});

test('use case: reflex attacks an adjacent mob even if the brain says idle', async () => {
  const world = new MockWorld();
  const bot = createMockBot({ world });
  scenarioFlatWorld(bot);
  const zombie = { name: 'zombie', type: 'mob', position: { x: 1, y: 64, z: 0, distanceTo: () => 1 }, health: 20, isValid: true };
  zombie.position.distanceTo = () => 1.5;
  bot._world.addEntity(zombie);
  bot._syncEntities();

  const { autopilot } = rig(bot, { replies: [{ action: 'idle', reason: 'rest', confidence: 0.9 }] });
  const rec = await autopilot.tick('cadence');
  assert.equal(rec.source, 'reflex');
  assert.equal(rec.action, 'attack');
  assert.ok(world.attacks.length > 0, 'should have swung at the zombie');
});

/* ================= USE CASE 3: it mines real blocks ============== */

test('use case: bot mines the block the brain names', async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const { autopilot } = rig(bot, { replies: [{ action: 'mine', target: 'coal_ore', reason: 'need coal', confidence: 0.9 }] });
  const rec = await autopilot.tick('cadence');
  assert.equal(rec.action, 'mine');
  assert.equal(rec.ok, true);
  assert.ok(bot._world.mined.includes('coal_ore'), 'should have mined coal ore');
});

/* ================= USE CASE 4: it fights to the death ========== */

test('use case: attack keeps swinging until the mob dies', async () => {
  const world = new MockWorld();
  const bot = createMockBot({ world, moveSteps: 1 });
  const zombie = { name: 'zombie', type: 'mob', position: { x: 1, y: 64, z: 0 }, health: 20, isValid: true };
  zombie.position.distanceTo = () => 2;
  world.addEntity(zombie);
  bot._syncEntities();

  const { autopilot } = rig(bot, {
    replies: [{ action: 'attack', target: 'zombie', reason: 'clear the path', confidence: 0.95 }],
    settings: { loop: { actionTimeoutMs: 8000 } },
  });
  const rec = await autopilot.tick('cadence');
  assert.equal(rec.action, 'attack');
  assert.ok(world.attacks.length >= 3, `should have swung multiple times, got ${world.attacks.length}`);
  assert.equal(zombie.isValid, false, 'zombie should be dead');
  assert.ok(String(rec.detail).includes('killed'), `detail should report a kill: ${rec.detail}`);
});

/* ================= USE CASE 5: it eats ========================= */

test('use case: bot eats when hungry', async () => {
  const bot = createMockBot({ food: 8, inventory: [{ name: 'bread', count: 5 }] });
  const { autopilot } = rig(bot, { replies: [{ action: 'eat', target: 'bread', reason: 'hungry', confidence: 0.9 }] });
  const rec = await autopilot.tick('cadence');
  assert.equal(rec.action, 'eat');
  assert.equal(rec.ok, true);
  assert.ok(bot.food > 8, `food should have risen, is ${bot.food}`);
});

/* ================= USE CASE 6: it talks ======================== */

test('use case: bot says something in chat', async () => {
  const bot = createMockBot();
  const { autopilot } = rig(bot, { replies: [{ action: 'talk', target: 'vanakkam da!', reason: 'greet owner', confidence: 0.9 }] });
  const rec = await autopilot.tick('cadence');
  assert.equal(rec.action, 'talk');
  assert.equal(rec.ok, true);
  assert.ok(bot._world.chatLog.length === 1, 'should have sent one chat line');
  assert.match(bot._world.chatLog[0], /vanakkam/);
});

/* ================= USE CASE 7: the brain is required ============ */

test('use case: a dead brain produces NO gameplay (anti-fake)', async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const start = bot.entity.position.clone();

  // no replies -> the scripted provider still answers, so use a failing one
  const failing = {
    name: 'dead',
    available: true,
    async generate() { return { ok: false, error: 'model is down', kind: 'server' }; },
  };
  const memDir = tmpMemDir();
  const memory = createMemory({ dataDir: memDir, logger: silent() });
  const executor = createExecutor({ logger: silent(), memory });
  const governor = createGovernor({ settings: {} });
  const orchestrator = createOrchestrator({ providers: [failing], logger: silent() });
  const autopilot = createAutopilot({ bot, settings: {}, logger: silent(), memory, executor, governor, orchestrator, planner: null });

  const rec = await autopilot.tick('cadence');
  assert.equal(rec.ok, false);
  assert.equal(rec.stage, 'llm');
  const moved = Math.hypot(bot.entity.position.x - start.x, bot.entity.position.z - start.z);
  assert.equal(moved, 0, 'a dead brain must not move the bot');
  assert.equal(bot._world.mined.length, 0, 'a dead brain must not mine');
  assert.equal(bot._world.attacks.length, 0, 'a dead brain must not attack');
});

/* ================= USE CASE 8: verifier catches fake success === */

test('use case: verifier rejects an action that did nothing', async () => {
  const bot = createMockBot({ moveSteps: 0 }); // pathfinder will NOT move
  scenarioFlatWorld(bot);
  const { autopilot } = rig(bot, { replies: [{ action: 'explore', reason: 'wander', confidence: 0.9 }] });
  const rec = await autopilot.tick('cadence');
  assert.equal(rec.verified, false, 'explore with a frozen bot must not verify');
  assert.equal(rec.ok, false);
});

/* ================= USE CASE 9: governor vetoes suicide ========= */

test('use case: governor vetoes mining at 2 hp', async () => {
  const bot = createMockBot({ health: 2 });
  scenarioFlatWorld(bot);
  const { autopilot } = rig(bot, {
    replies: [{ action: 'mine', target: 'coal_ore', reason: 'rich vein', confidence: 0.99 }],
    settings: { governor: { healthFloor: 6 } },
  });
  const rec = await autopilot.tick('cadence');
  assert.equal(rec.ok, false);
  assert.equal(rec.stage, 'governor');
  assert.equal(rec.verdict.rule, 'health_critical');
  assert.equal(bot._world.mined.length, 0, 'must not have mined');
});

/* ================= USE CASE 10: governor repairs =============== */

test('use case: governor repairs mining a block that is not nearby', async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  // brain asks for diamond (not present) -> should repair to something real
  const { autopilot } = rig(bot, { replies: [{ action: 'mine', target: 'diamond_ore', reason: 'rich!', confidence: 0.9 }] });
  const rec = await autopilot.tick('cadence');
  assert.equal(rec.ok, true, 'repaired decision should execute');
  assert.notEqual(rec.action === 'mine' && rec.target, 'diamond_ore', 'should not mine a non-existent block');
});

/* ================= USE CASE 11: memory learns ================== */

test('use case: memory records what worked and what failed', async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const rig1 = rig(bot, { replies: [{ action: 'mine', target: 'coal_ore', reason: 'coal', confidence: 0.9 }] });
  await rig1.autopilot.tick('cadence');
  const s = rig1.memory.snapshotAll();
  assert.ok(s.episodes >= 1, 'memory should have an episode');
  assert.ok(Object.keys(s.skills.successes).length > 0, 'a successful action should become a skill');
  assert.ok(s.places >= 1, 'memory should have recorded where we were');
});

/* ================= USE CASE 12: it keeps going ================ */

test('use case: 8 consecutive ticks all produce decisions (no stall)', async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const replies = [
    { action: 'explore', reason: 'go', confidence: 0.9 },
    { action: 'mine', target: 'coal_ore', reason: 'coal', confidence: 0.9 },
    { action: 'explore', reason: 'go', confidence: 0.9 },
    { action: 'talk', target: 'hi', reason: 'wave', confidence: 0.9 },
    { action: 'explore', reason: 'go', confidence: 0.9 },
    { action: 'mine', target: 'coal_ore', reason: 'coal', confidence: 0.9 },
    { action: 'explore', reason: 'go', confidence: 0.9 },
    { action: 'eat', target: null, reason: 'snack', confidence: 0.9 },
  ];
  const bot2 = createMockBot({ inventory: [{ name: 'bread', count: 5 }] });
  scenarioFlatWorld(bot2);
  const { autopilot } = rig(bot2, { replies, settings: { governor: {} } });
  let decisions = 0;
  for (let i = 0; i < 8; i++) {
    const rec = await autopilot.tick('cadence');
    if (rec.stage !== 'llm') decisions++;
  }
  assert.ok(decisions >= 7, `expected nearly every tick to decide, got ${decisions}/8`);
  const s = autopilot.stats();
  assert.ok(s.ticks === 8);
  assert.ok(s.executed + s.failed >= 7, 'most ticks should reach execute');
});

/* ================= USE CASE 13: observer honesty ============ */

test('use case: observer only reports blocks that exist', async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  // plant a diamond ore far away — must NOT appear in a radius-8 scan
  bot._world.setBlock(100, 60, 100, 'diamond_ore');
  const snap = observe(bot, { scanRadius: 8 });
  assert.ok(!snap.nearbyBlocks.some((b) => b.name === 'diamond_ore'), 'far ore must not be reported');
  assert.ok(snap.affordances.length > 0, 'observer must list what is possible');
  assert.ok(snap.movement.clear.length > 0, 'should find at least one walkable direction');
});