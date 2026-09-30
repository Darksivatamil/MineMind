#!/usr/bin/env node
'use strict';
/**
 * verify_antifake.js — prove gameplay is decided by the LLM, not by if-else rules.
 *
 * The original MineMind project looked like an AI player but its gameplay was
 * 100% hardcoded: the model was only ever asked to write chat lines, and the one
 * LLM->gameplay link was a literal "[ACTION:FIGHT]" string tag.
 *
 * This tool runs static + dynamic checks that would FAIL on that design:
 *
 *   1. STATIC  — no gameplay module may call a mineflayer movement/action API
 *                (walkTo/dig/attack/placeBlock/...) on its own initiative.
 *                Only action_executor.js may, and only from a validated decision.
 *   2. STATIC  — the LLM must have a decision path whose result is executed.
 *   3. DYNAMIC — with a stub LLM returning a chosen action, exactly that action
 *                executes; with the LLM broken, nothing executes at all.
 *                (Rule-based bots fail this: they keep playing with no LLM.)
 *
 * Run:  npm run verify:antifake
 */

const fs = require('fs');
const path = require('path');
const { Vec3 } = require('vec3');

const ROOT = path.join(__dirname, '..');
const { createDecisionEngine } = require('../src/ai/decision_engine');
const settings = require('../config/settings.json');

let failures = 0;
const ok = (m) => console.log(`  \x1b[32mPASS\x1b[0m  ${m}`);
const fail = (m) => { failures++; console.log(`  \x1b[31mFAIL\x1b[0m  ${m}`); };
const info = (m) => console.log(`  \x1b[36m..\x1b[0m    ${m}`);

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      walk(p, acc);
    } else if (e.name.endsWith('.js')) {
      acc.push(p);
    }
  }
  return acc;
}

console.log('\nMINEMIND-DEEP anti-fake audit\n');
console.log('[1] static: gameplay APIs are confined to the executor\n');

// --- 1. static check ------------------------------------------------------
const GAMEPLAY_APIS = [
  'bot.pathfinder.walkTo', 'bot.dig(', 'bot.attack(', 'bot.placeBlock(',
  'bot.consume(', 'bot.equip(', 'bot.sleep(', 'bot.craft(',
];
const files = walk(path.join(ROOT, 'src'));
const executorFile = path.join(ROOT, 'src', 'ai', 'action_executor.js');

for (const f of files) {
  if (f === executorFile) continue;
  const src = fs.readFileSync(f, 'utf8');
  const hits = GAMEPLAY_APIS.filter((api) => src.includes(api));
  if (hits.length) {
    fail(`${path.relative(ROOT, f)} calls gameplay APIs directly: ${hits.join(', ')}`);
  }
}
if (!failures) ok('no non-executor module calls a gameplay API');

// --- 2. static: the LLM has an executed decision path ---------------------
console.log('\n[2] static: LLM decision is wired to execution\n');
const engineSrc = fs.readFileSync(path.join(ROOT, 'src', 'ai', 'decision_engine.js'), 'utf8');
const hasProviderCall = /\.decide\s*\(/.test(engineSrc);
const hasExecuteCall = /\.execute\s*\(/.test(engineSrc);
if (hasProviderCall && hasExecuteCall) ok('decision_engine calls provider.decide() then executor.execute()');
else fail('decision_engine does not connect provider.decide() to executor.execute()');

const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
if (/createDecisionEngine/.test(mainSrc) && /\.tick\s*\(/.test(mainSrc)) ok('main.js runs the decision engine');
else fail('main.js does not drive the decision engine');

// --- 3. dynamic: no LLM => no gameplay (rule-based bots fail here) --------
function makeBot() {
  const calls = [];
  const bot = {
    entity: { id: 1, position: new Vec3(10, 64, 10), yaw: 0, onGround: true, health: 20 },
    health: 20,
    food: 20,
    game: { dimension: 'overworld' },
    time: { timeOfDay: 1000, isDay: () => true },
    experience: { level: 0 },
    inventory: { items: () => [] },
    heldItem: { type: -1 },
    entities: {},
    players: {},
    pathfinder: { walkTo: async (d) => { calls.push('walkTo'); bot.entity.position = new Vec3(d.x, d.y, d.z); } },
    blockAt: () => null,
    dig: async () => { calls.push('dig'); },
    attack: () => calls.push('attack'),
    chat: (m) => calls.push('chat:' + m),
    look: () => calls.push('look'),
    eat: async () => calls.push('eat'),
    placeBlock: async () => calls.push('placeBlock'),
    equip: async () => calls.push('equip'),
    quit: () => {},
  };
  bot.ownerName = 'Player';
  bot._minemindOwner = 'Player';
  bot._calls = calls;
  return bot;
}

// 3a. broken LLM => zero gameplay calls
(async () => {
  console.log('\n[3] dynamic: gameplay follows the LLM\n');

  const brokenBot = makeBot();
  const brokenEngine = createDecisionEngine({
    bot: brokenBot,
    settings,
    provider: { hasKey: true, stats: () => ({}), decide: async () => ({ ok: false, error: 'simulated outage', code: 'TEST' }) },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  await brokenEngine.tick('cadence');
  await brokenEngine.tick('cadence');
  if (brokenBot._calls.length === 0) {
    ok('LLM down => 0 gameplay actions (a rule-based bot would still act)');
  } else {
    fail(`LLM down but ${brokenBot._calls.length} actions ran: ${brokenBot._calls.join(',')}`);
  }

  // 3b. LLM chooses => exactly that action runs
  const chosen = makeBot();
  const scriptedEngine = createDecisionEngine({
    bot: chosen,
    settings,
    provider: {
      hasKey: true,
      stats: () => ({}),
      decide: async () => ({ ok: true, decision: { action: 'explore', target: null, reason: 'scripted', confidence: 0.9 } }),
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  const res = await scriptedEngine.tick('cadence');
  if (res && res.ok && res.action === 'explore' && chosen._calls.includes('walkTo')) {
    ok("model chose 'explore' => bot.pathfinder.walkTo() was actually called");
  } else {
    fail(`model chose 'explore' but actions were: ${JSON.stringify(chosen._calls)}`);
  }

  // 3c. veto: governor must block a dangerous decision
  const risky = makeBot();
  risky.health = 3;          // observer reads bot.health
  risky.entity.health = 3;
  const vetoEngine = createDecisionEngine({
    bot: risky,
    settings,
    provider: {
      hasKey: true,
      stats: () => ({}),
      decide: async () => ({ ok: true, decision: { action: 'mine', target: 'diamond_ore', reason: 'scripted', confidence: 0.9 } }),
    },
    logger: { info() {}, warn() {}, error() {}, debug() {} },
  });
  const vetoRes = await vetoEngine.tick('cadence');
  if (vetoRes && vetoRes.stage === 'governor' && risky._calls.length === 0) {
    ok(`governor vetoed a risky decision at 3hp (rule: ${vetoRes.verdict.rule})`);
  } else {
    fail(`governor did not veto mining at 3hp; actions: ${JSON.stringify(risky._calls)}`);
  }

  console.log('\n=== result ===');
  if (failures === 0) {
    console.log('PASS — gameplay is model-driven, not rule-driven.');
    process.exit(0);
  }
  console.log(`FAIL — ${failures} check(s) failed.`);
  process.exit(1);
})();
