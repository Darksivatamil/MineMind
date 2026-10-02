'use strict';
/**
 * scorecard.js — measure MINEMIND-DEEP against a published rubric.
 *
 * This does NOT grade the code by vibes. Every point is backed by a test that
 * actually runs, and a category that has no passing test earns nothing. Run it:
 *
 *   npm run score
 *
 * The rubric is deliberately harsh. "It has a file called planner.js" scores
 * zero — a planner only scores if a test proves the bot commits to a multi-step
 * goal. That is the whole point: the previous version of this project looked
 * sophisticated and did nothing, and a scorecard that counts files would have
 * given it a perfect score.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');

const { createMockBot, MockWorld, scenarioFlatWorld } = require(path.join(__dirname, '..', 'tests', 'mock_bot'));
const { createAutopilot } = require('../src/ai/autopilot');
const { createExecutor } = require('../src/ai/action_executor');
const { createGovernor } = require('../src/ai/governor');
const { createMemory } = require('../src/core/memory');
const { createOrchestrator } = require('../src/llm/orchestrator');
const { observe } = require('../src/ai/observer');
const { createPlanner } = require('../src/ai/planner');
const { ACTIONS } = require('../src/llm/schema');

const silent = () => ({ info() {}, warn() {}, error() {}, debug() {} });

function tmpMem() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-score-'));
}

function scripted(replies) {
  let i = 0;
  return {
    name: 'scripted',
    available: true,
    async generate() {
      const r = replies[Math.min(i, replies.length - 1)];
      i++;
      return { ok: true, text: JSON.stringify(r) };
    },
  };
}

function rig(bot, replies, opts = {}) {
  const settings = {
    actions: { swingDelayMs: 10, idleMs: 40 },
    verifier: { radius: 1 },
    governor: opts.governor || {},
  };
  const memory = createMemory({ dataDir: tmpMem(), logger: silent() });
  const orchestrator = createOrchestrator({ providers: [scripted(replies)], logger: silent() });
  const autopilot = createAutopilot({
    bot,
    settings,
    logger: silent(),
    memory,
    executor: createExecutor({ logger: silent(), settings, memory }),
    governor: createGovernor({ settings }),
    orchestrator,
    planner: opts.planner || null,
  });
  return { autopilot, memory, orchestrator };
}

/* ============================ the checks ============================ */

const checks = [];
function check(category, name, weight, fn) {
  checks.push({ category, name, weight, fn });
}

// --- A. Perception (is it actually seeing the world?) -------------------
check('perception', 'observer measures real position, health, food', 6, async () => {
  const bot = createMockBot({ health: 17, food: 13 });
  scenarioFlatWorld(bot);
  const s = observe(bot, { scanRadius: 8 });
  if (s.self.health !== 17) return { ok: false, note: `health read as ${s.self.health}` };
  if (s.self.food !== 13) return { ok: false, note: `food read as ${s.self.food}` };
  if (typeof s.self.pos?.x !== 'number') return { ok: false, note: 'no position' };
  return { ok: true, note: 'health/food/position measured from live bot' };
});

check('perception', 'observer finds nearby ore by real block scan', 6, async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const s = observe(bot, { scanRadius: 8 });
  if (!s.nearbyBlocks.some((b) => b.name === 'coal_ore')) return { ok: false, note: 'coal_ore planted but not found' };
  return { ok: true, note: `found ${s.nearbyBlocks.length} block types incl. coal_ore` };
});

check('perception', 'observer never invents distant blocks', 6, async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  bot._world.setBlock(500, 60, 500, 'diamond_ore');
  const s = observe(bot, { scanRadius: 8 });
  if (s.nearbyBlocks.some((b) => b.name === 'diamond_ore')) return { ok: false, note: 'reported a block 500 blocks away' };
  return { ok: true, note: 'hallucinated ore correctly excluded' };
});

check('perception', 'observer lists legal affordances', 5, async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const s = observe(bot, { scanRadius: 8 });
  if (!Array.isArray(s.affordances) || s.affordances.length === 0) return { ok: false, note: 'no affordances' };
  return { ok: true, note: `${s.affordances.length} options offered: ${s.affordances.slice(0, 2).join(', ')}` };
});

// --- B. Decision authority (does the model drive?) ---------------------
check('decision', 'model choice is what gets executed', 8, async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const { autopilot } = rig(bot, [{ action: 'mine', target: 'coal_ore', reason: 'need coal', confidence: 0.9 }]);
  const rec = await autopilot.tick('cadence');
  if (rec.action !== 'mine') return { ok: false, note: `executed ${rec.action} instead of mine` };
  if (!bot._world.mined.includes('coal_ore')) return { ok: false, note: 'coal_ore was not actually mined' };
  return { ok: true, note: 'model said mine -> coal_ore was mined' };
});

check('decision', 'different worlds produce different choices', 7, async () => {
  const botA = createMockBot({ health: 20, food: 20 });
  scenarioFlatWorld(botA);
  const a = await rig(botA, [{ action: 'explore', reason: 'wander', confidence: 0.9 }]).autopilot.tick('cadence');

  const botB = createMockBot({ health: 20, food: 20 });
  scenarioFlatWorld(botB);
  const w = new MockWorld();
  const zombie = { name: 'zombie', type: 'mob', position: { x: 1, y: 64, z: 0 }, health: 20, isValid: true };
  zombie.position.distanceTo = () => 2;
  botB._world.addEntity(zombie);
  botB._syncEntities();
  const b = await rig(botB, [{ action: 'explore', reason: 'wander', confidence: 0.9 }]).autopilot.tick('cadence');

  // same scripted decision, but the world changed the outcome => reflexes are world-aware
  if (a.action === b.action && a.source === b.source) {
    return { ok: false, note: 'identical outcome in different worlds' };
  }
  return { ok: true, note: `safe world -> ${a.action}/${a.source}; threat world -> ${b.action}/${b.source}` };
});

check('decision', 'a dead brain produces zero gameplay', 10, async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const start = bot.entity.position.clone();
  const dead = { name: 'dead', available: true, async generate() { return { ok: false, error: 'down', kind: 'server' }; } };
  const memory = createMemory({ dataDir: tmpMem(), logger: silent() });
  const settings = { verifier: { radius: 1 } };
  const autopilot = createAutopilot({
    bot, settings, logger: silent(), memory,
    executor: createExecutor({ logger: silent(), settings, memory }),
    governor: createGovernor({ settings }),
    orchestrator: createOrchestrator({ providers: [dead], logger: silent() }),
    planner: null,
  });
  const rec = await autopilot.tick('cadence');
  const moved = Math.hypot(bot.entity.position.x - start.x, bot.entity.position.z - start.z);
  if (rec.ok) return { ok: false, note: 'dead brain still produced an action' };
  if (moved > 0.1) return { ok: false, note: `dead brain moved the bot ${moved}` };
  if (bot._world.mined.length || bot._world.attacks.length) return { ok: false, note: 'dead brain mined/attacked' };
  return { ok: true, note: 'LLM down => no movement, no mining, no attacks' };
});

check('decision', 'out-of-vocabulary action is rejected', 5, async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const { autopilot } = rig(bot, [{ action: 'launch_rocket', reason: 'space', confidence: 1 }]);
  const rec = await autopilot.tick('cadence');
  if (rec.ok) return { ok: false, note: 'accepted an action outside the schema' };
  return { ok: true, note: 'schema blocked an invented verb' };
});

// --- C. Action vocabulary (what can it actually DO?) -------------------
check('action-set', 'action vocabulary covers survival verbs', 6, async () => {
  const need = ['attack', 'flee', 'eat', 'sleep'];
  const missing = need.filter((a) => !ACTIONS[a]);
  if (missing.length) return { ok: false, note: `missing: ${missing.join(', ')}` };
  return { ok: true, note: `${Object.keys(ACTIONS).length} verbs incl. ${need.join(', ')}` };
});

check('action-set', 'action vocabulary covers gathering/building', 6, async () => {
  const need = ['mine', 'dig', 'craft', 'gather', 'equip', 'place', 'build'];
  const missing = need.filter((a) => !ACTIONS[a]);
  if (missing.length) return { ok: false, note: `missing: ${missing.join(', ')}` };
  return { ok: true, note: `${Object.keys(ACTIONS).length} verbs incl. mine/dig/craft/build` };
});

check('action-set', 'every declared action has a real executor', 8, async () => {
  const settings = {};
  const ex = createExecutor({ logger: silent(), settings });
  const missing = Object.keys(ACTIONS).filter((a) => typeof ex.handlers[a] !== 'function');
  if (missing.length) return { ok: false, note: `declared but not implemented: ${missing.join(', ')}` };
  return { ok: true, note: `all ${Object.keys(ACTIONS).length} verbs implemented` };
});

// --- D. Execution quality ---------------------------------------------
check('execution', 'bot actually moves when told to explore', 8, async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const start = bot.entity.position.clone();
  const { autopilot } = rig(bot, [{ action: 'explore', reason: 'wander', confidence: 0.9 }]);
  const rec = await autopilot.tick('cadence');
  const moved = Math.hypot(bot.entity.position.x - start.x, bot.entity.position.z - start.z);
  if (!rec.ok) return { ok: false, note: `explore failed: ${rec.error}` };
  if (moved < 2) return { ok: false, note: `only moved ${moved.toFixed(1)} blocks` };
  return { ok: true, note: `walked ${moved.toFixed(1)} blocks` };
});

check('execution', 'combat is a loop, not a single swing', 8, async () => {
  const bot = createMockBot({ moveSteps: 1 });
  const zombie = { name: 'zombie', type: 'mob', position: { x: 1, y: 64, z: 0 }, health: 20, isValid: true };
  zombie.position.distanceTo = () => 2;
  bot._world.addEntity(zombie);
  bot._syncEntities();
  const { autopilot } = rig(bot, [{ action: 'attack', target: 'zombie', reason: 'fight', confidence: 0.95 }]);
  const rec = await autopilot.tick('cadence');
  if (bot._world.attacks.length < 3) return { ok: false, note: `only ${bot._world.attacks.length} swings` };
  if (zombie.isValid) return { ok: false, note: 'mob survived' };
  return { ok: true, note: `${bot._world.attacks.length} swings until kill` };
});

check('execution', 'bot talks in chat', 5, async () => {
  const bot = createMockBot();
  const { autopilot } = rig(bot, [{ action: 'talk', target: 'vanakkam da!', reason: 'greet', confidence: 0.9 }]);
  const rec = await autopilot.tick('cadence');
  if (!bot._world.chatLog.length) return { ok: false, note: 'no chat sent' };
  return { ok: true, note: `said "${bot._world.chatLog[0]}"` };
});

check('execution', 'bot eats to restore hunger', 5, async () => {
  const bot = createMockBot({ food: 8, inventory: [{ name: 'bread', count: 3 }] });
  const { autopilot } = rig(bot, [{ action: 'eat', target: 'bread', reason: 'hungry', confidence: 0.9 }]);
  const rec = await autopilot.tick('cadence');
  if (!rec.ok) return { ok: false, note: rec.error };
  if (bot.food <= 8) return { ok: false, note: `food still ${bot.food}` };
  return { ok: true, note: `food 8 -> ${bot.food}` };
});

// --- E. Safety ---------------------------------------------------------
check('safety', 'reflex beats the model when health is critical', 9, async () => {
  const bot = createMockBot({ health: 4, inventory: [{ name: 'bread', count: 3 }] });
  const { autopilot } = rig(bot, [{ action: 'mine', target: 'coal_ore', reason: 'keep mining', confidence: 0.99 }]);
  const rec = await autopilot.tick('cadence');
  if (rec.source !== 'reflex') return { ok: false, note: `model overruled survival (source=${rec.source})` };
  if (rec.action !== 'eat') return { ok: false, note: `reflex chose ${rec.action}` };
  return { ok: true, note: 'model wanted to mine at 4hp; reflex made it eat' };
});

check('safety', 'governor vetoes suicide', 8, async () => {
  const bot = createMockBot({ health: 2 });
  scenarioFlatWorld(bot);
  const { autopilot } = rig(bot, [{ action: 'mine', target: 'coal_ore', reason: 'rich', confidence: 0.99 }], { governor: { healthFloor: 6 } });
  const rec = await autopilot.tick('cadence');
  if (rec.ok) return { ok: false, note: 'veto failed' };
  if (bot._world.mined.length) return { ok: false, note: 'mined anyway' };
  return { ok: true, note: `vetoed by rule "${rec.verdict.rule}"` };
});

check('safety', 'reflex flees a creeper', 7, async () => {
  const bot = createMockBot({ health: 20 });
  scenarioFlatWorld(bot);
  const creeper = { name: 'creeper', type: 'mob', position: { x: 2, y: 64, z: 0 }, health: 20, isValid: true };
  creeper.position.distanceTo = () => 2.5;
  bot._world.addEntity(creeper);
  bot._syncEntities();
  const { autopilot } = rig(bot, [{ action: 'idle', reason: 'rest', confidence: 0.9 }]);
  const rec = await autopilot.tick('cadence');
  if (rec.action !== 'flee') return { ok: false, note: `chose ${rec.action} with a creeper at 2 blocks` };
  return { ok: true, note: 'fled the creeper' };
});

check('safety', 'governor never lets the model attack the owner', 6, async () => {
  const bot = createMockBot({ health: 20 });
  const { autopilot } = rig(bot, [{ action: 'attack', target: 'Player', reason: '?', confidence: 1 }]);
  const rec = await autopilot.tick('cadence');
  if (rec.ok) return { ok: false, note: 'allowed attacking the owner' };
  return { ok: true, note: 'owner protected' };
});

// --- F. Self-correction ------------------------------------------------
check('self-correct', 'verifier catches a fake success', 9, async () => {
  const bot = createMockBot({ moveSteps: 0 }); // pathfinder that does nothing
  scenarioFlatWorld(bot);
  const { autopilot } = rig(bot, [{ action: 'explore', reason: 'wander', confidence: 0.9 }]);
  const rec = await autopilot.tick('cadence');
  if (rec.verified !== false) return { ok: false, note: 'verified an action that did nothing' };
  return { ok: true, note: `rejected: "${rec.verifyNote}"` };
});

check('self-correct', 'governor repairs an impossible action', 8, async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const { autopilot } = rig(bot, [{ action: 'mine', target: 'diamond_ore', reason: 'rich!', confidence: 0.9 }]);
  const rec = await autopilot.tick('cadence');
  if (!rec.ok) return { ok: false, note: `did not repair: ${rec.error}` };
  if (rec.target === 'diamond_ore') return { ok: false, note: 'still tried to mine a block that is not there' };
  return { ok: true, note: `repaired diamond_ore -> ${rec.target}` };
});

check('self-correct', 'failed actions are remembered', 7, async () => {
  const bot = createMockBot({ health: 20, food: 20, inventory: [] });
  const { autopilot, memory } = rig(bot, [{ action: 'craft', target: 'diamond_pickaxe', reason: 'craft', confidence: 0.9 }]);
  await autopilot.tick('cadence');
  await autopilot.tick('cadence');
  const s = memory.snapshotAll();
  const hasFailure = Object.keys(s.skills.failures).length > 0 || s.episodes >= 1;
  if (!hasFailure) return { ok: false, note: 'failure was not recorded' };
  return { ok: true, note: `${s.episodes} episodes, ${Object.keys(s.skills.failures).length} failure patterns learned` };
});

// --- G. Memory / learning ----------------------------------------------
check('memory', 'memory records where the bot has been', 6, async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const { autopilot, memory } = rig(bot, [{ action: 'explore', reason: 'wander', confidence: 0.9 }]);
  await autopilot.tick('cadence');
  const s = memory.snapshotAll();
  if (s.places < 1) return { ok: false, note: 'no places recorded' };
  return { ok: true, note: `${s.places} place(s) mapped` };
});

check('memory', 'successful actions become reusable skills', 6, async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const { autopilot, memory } = rig(bot, [{ action: 'mine', target: 'coal_ore', reason: 'coal', confidence: 0.9 }]);
  await autopilot.tick('cadence');
  const s = memory.snapshotAll();
  if (Object.keys(s.skills.successes).length === 0) return { ok: false, note: 'nothing promoted to a skill' };
  return { ok: true, note: `skills: ${Object.keys(s.skills.successes).join(', ')}` };
});

check('memory', 'memory survives across sessions (persisted to disk)', 6, async () => {
  const dir = tmpMem();
  const m1 = createMemory({ dataDir: dir, logger: silent() });
  m1.recordPlace({ x: 10, y: 64, z: 10 }, { ores: { iron_ore: 3 } });
  m1.recordEpisode({ action: 'mine', target: 'iron_ore', ok: true, snapshot: { self: { pos: { x: 10, y: 64, z: 10 } } } });
  m1.setGoal({ text: 'mine iron' });
  const m2 = createMemory({ dataDir: dir, logger: silent() });
  const s = m2.snapshotAll();
  if (s.places < 1) return { ok: false, note: 'places did not persist' };
  if (s.episodes < 1) return { ok: false, note: 'episodes did not persist' };
  return { ok: true, note: `reloaded ${s.places} place(s), ${s.episodes} episode(s), goal "${s.goals.current?.text}"` };
});

// --- H. Planning -------------------------------------------------------
check('planning', 'planner creates a multi-step goal from the LLM', 8, async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const memory = createMemory({ dataDir: tmpMem(), logger: silent() });
  const settings = { verifier: { radius: 1 }, actions: { swingDelayMs: 10 } };
  const goalProvider = scripted([
    {
      action: 'idle',
      reason: 'planner',
      confidence: 1,
      _goal: true,
    },
  ]);
  // planner uses orchestrator.decide, so feed it a goal object through the
  // same validate path by returning a goal-shaped JSON as the decision
  const goalJson = {
    goal: 'get a wooden pickaxe',
    steps: [
      { action: 'mine', target: 'oak_log', doneWhen: { kind: 'inventory', item: 'oak_log', count: 3 } },
      { action: 'craft', target: 'planks', doneWhen: { kind: 'inventory', item: 'planks', count: 4 } },
      { action: 'craft', target: 'wooden_pickaxe', doneWhen: { kind: 'inventory', item: 'wooden_pickaxe', count: 1 } },
    ],
  };
  const provider = {
    name: 'goal',
    available: true,
    async generate({ system }) {
      if (system.includes('set goals')) return { ok: true, text: JSON.stringify(goalJson) };
      return { ok: true, text: JSON.stringify({ action: 'mine', target: 'oak_log', reason: 'follow the plan', confidence: 0.9 }) };
    },
  };
  const orchestrator = createOrchestrator({ providers: [provider], logger: silent() });
  const planner = createPlanner({ orchestrator, memory, logger: silent(), cfg: { minIdleTicks: 0 } });
  const autopilot = createAutopilot({
    bot, settings, logger: silent(), memory,
    executor: createExecutor({ logger: silent(), settings, memory }),
    governor: createGovernor({ settings }),
    orchestrator, planner,
  });
  await autopilot.tick('cadence');
  const g = planner._state.current; // stats() returns only the goal text
  if (!g) return { ok: false, note: 'no goal was created' };
  if (!Array.isArray(g.steps) || g.steps.length < 2) return { ok: false, note: `goal has ${g.steps?.length ?? 0} steps` };
  return { ok: true, note: `"${g.text}" with ${g.steps.length} steps` };
});

check('planning', 'plan steps complete against the real world', 8, async () => {
  const bot = createMockBot({ inventory: [{ name: 'oak_log', count: 5 }] });
  scenarioFlatWorld(bot);
  const memory = createMemory({ dataDir: tmpMem(), logger: silent() });
  const orchestrator = createOrchestrator({ providers: [scripted([{ action: 'idle', reason: 'x', confidence: 1 }])], logger: silent() });
  const planner = createPlanner({ orchestrator, memory, logger: silent() });
  planner.setGoal({
    text: 'collect wood',
    steps: [{ action: 'mine', target: 'oak_log', doneWhen: { kind: 'inventory', item: 'oak_log', count: 3 }, done: false }],
  });
  const snap = observe(bot, { scanRadius: 8 });
  planner.maybeAdvance(bot, snap, 'test');
  const s = planner.stats();
  const step = planner._state.current.steps[0];
  if (!step.done) return { ok: false, note: 'step with 5 oak_log in inventory was not marked done' };
  return { ok: true, note: 'step verified complete from real inventory' };
});

// --- I. Resilience -----------------------------------------------------
check('resilience', 'provider rotation survives a quota error', 9, async () => {
  const events = [];
  const gemini = {
    name: 'gemini', available: true,
    async generate() { events.push('gemini'); return { ok: false, error: 'quota exceeded', kind: 'quota' }; },
  };
  const openrouter = {
    name: 'openrouter', available: true,
    async generate() { events.push('openrouter'); return { ok: true, text: JSON.stringify({ action: 'explore', reason: 'ok', confidence: 0.9 }) }; },
  };
  let now = 1000;
  const orch = createOrchestrator({ providers: [gemini, openrouter], logger: silent(), clock: () => now });
  const res = await orch.decide({ system: 's', user: 'u', validate: (p) => ({ ok: true, value: p }) });
  if (!res.ok) return { ok: false, note: 'rotation did not recover' };
  if (res.provider !== 'openrouter') return { ok: false, note: `answered by ${res.provider}` };
  // second call should skip the benched provider
  const res2 = await orch.decide({ system: 's', user: 'u', validate: (p) => ({ ok: true, value: p }) });
  if (events.filter((e) => e === 'gemini').length !== 1) {
    return { ok: false, note: 'benched provider was called again' };
  }
  return { ok: true, note: 'quota error rotated to the spare provider and benched the dead one' };
});

check('resilience', 'mock floor keeps the bot acting with no LLM', 7, async () => {
  const bot = createMockBot();
  scenarioFlatWorld(bot);
  const orch = require('../src/llm/orchestrator');
  const providers = orch.buildProviders({ enabled: ['mock'], mockFallback: true }, {}, silent());
  const settings = { verifier: { radius: 1 } };
  const memory = createMemory({ dataDir: tmpMem(), logger: silent() });
  const autopilot = createAutopilot({
    bot, settings, logger: silent(), memory,
    executor: createExecutor({ logger: silent(), settings, memory }),
    governor: createGovernor({ settings }),
    orchestrator: createOrchestrator({ providers, logger: silent() }),
    planner: null,
  });
  const rec = await autopilot.tick('cadence');
  if (!rec.action) return { ok: false, note: 'no action with no LLM' };
  return { ok: true, note: `heuristic floor chose "${rec.action}" (source=${rec.source})` };
});

check('resilience', 'every tick is time-bounded (no wedge)', 5, async () => {
  const bot = createMockBot({ noPathfinder: true });
  scenarioFlatWorld(bot);
  const { autopilot } = rig(bot, [{ action: 'explore', reason: 'wander', confidence: 0.9 }]);
  const t = Date.now();
  await autopilot.tick('cadence');
  const ms = Date.now() - t;
  if (ms > 8000) return { ok: false, note: `tick took ${ms}ms` };
  return { ok: true, note: `tick returned in ${ms}ms` };
});

/* ============================ the runner ============================ */

async function main() {
  const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
  console.log(`\n${B}MINEMIND-DEEP scorecard${X}`);
  console.log(`${D}every point below is backed by a check that actually runs${X}\n`);

  const byCategory = new Map();
  for (const c of checks) {
    if (!byCategory.has(c.category)) byCategory.set(c.category, []);
    byCategory.get(c.category).push(c);
  }

  let earned = 0;
  let possible = 0;
  const failures = [];

  for (const [category, list] of byCategory) {
    console.log(`${B}${category.toUpperCase()}${X}`);
    for (const c of list) {
      let res;
      try {
        res = await c.fn();
      } catch (err) {
        res = { ok: false, note: `threw: ${err.message}` };
      }
      possible += c.weight;
      if (res.ok) {
        earned += c.weight;
        console.log(`  ${G}PASS${X} ${c.name} ${D}(${c.weight})${X}`);
        console.log(`       ${D}${res.note}${X}`);
      } else {
        failures.push({ ...c, note: res.note });
        console.log(`  ${R}FAIL${X} ${c.name} ${D}(${c.weight})${X}`);
        console.log(`       ${R}${res.note}${X}`);
      }
    }
    console.log('');
  }

  const pct = possible ? (earned / possible) * 100 : 0;
  console.log(`${D}${'─'.repeat(56)}${X}`);
  console.log(`${B}SCORE${X}  ${earned} / ${possible}  ${D}=${X} ${B}${pct.toFixed(1)} / 100`);
  console.log(`${D}checks: ${checks.length}, passed: ${checks.length - failures.length}, failed: ${failures.length}${X}`);

  if (failures.length) {
    console.log(`\n${Y}Weak areas:${X}`);
    for (const f of failures) console.log(`  - ${f.name}: ${f.note}`);
  }

  // honest note about what this score does NOT prove
  console.log(`\n${D}What this score does NOT prove:${X}`);
  console.log(`${D}  - It has never joined a real Minecraft server (no Java in the test env).${X}`);
  console.log(`${D}  - It does not prove the model is smart, only that its choices are${X}`);
  console.log(`${D}    genuinely executed, verified, and safe-guarded.${X}`);
  console.log(`${D}  - Model quality depends on the provider you configure.${X}`);

  process.exitCode = pct >= 70 ? 0 : 1;
  return pct;
}

module.exports = { main, checks };

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}