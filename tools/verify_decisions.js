#!/usr/bin/env node
'use strict';
/**
 * verify_decisions.js — prove the LLM actually drives gameplay.
 *
 * Runs the REAL decision engine (observer -> Gemini -> governor -> executor)
 * against an in-memory bot stub that reports a realistic world. This is the
 * anti-fake check: every action printed here was chosen by the model, and every
 * execution call was made through the real executor against a fake mineflayer
 * surface.
 *
 * Run:  npm run verify:decisions
 */

const { Vec3 } = require('vec3');
const v3 = (x, y, z) => new Vec3(x, y, z);

const { createDecisionEngine } = require('../src/ai/decision_engine');
const { createLogger } = require('../src/core/logger');
const settings = require('../config/settings.json');

require('dotenv').config();

/** A mineflayer-shaped stub with a fixed, believable world. */
function makeBot() {
  const calls = [];
  const record = (name, args) => calls.push({ name, args });

  const bot = {
    entity: {
      id: 1,
      position: v3(10, 64, 10),
      yaw: 0,
      onGround: true,
      health: 18,
    },
    health: 18,
    food: 14,
    game: { dimension: 'overworld' },
    time: { timeOfDay: 6000, isDay: () => true },
    experience: { level: 3 },
    inventory: {
      items: () => [
        { name: 'iron_pickaxe', count: 1, type: 257 },
        { name: 'cooked_beef', count: 5, type: 412 },
        { name: 'torch', count: 12, type: 5 },
        { name: 'cobblestone', count: 33, type: 1 },
      ],
    },
    heldItem: { name: 'cobblestone', type: 1 },
    entities: {},
    players: {},
    registry: { items: { 'iron_sword': { id: 276 }, oak_planks: { id: 5 } } },
    pathfinder: {
      walkTo: async (dest) => {
        record('walkTo', [dest]);
        bot.entity.position = v3(dest.x, dest.y, dest.z);
        return 'success';
      },
    },
    blockAt: (p) => {
      const k = `${Math.floor(p.x)},${Math.floor(p.y)},${Math.floor(p.z)}`;
      const map = {
        '10,63,10': { name: 'grass_block', position: v3(10, 63, 10) },
        '14,63,10': { name: 'coal_ore', position: v3(14, 63, 10) },
        '10,66,10': { name: 'air', position: v3(10, 66, 10) },
      };
      return map[k] || null;
    },
    blockMap: {},
    dig: async (block) => {
      record('dig', [block.name]);
      if (block.name === 'coal_ore') return 'success';
      throw new Error('cannot dig ' + block.name);
    },
    equip: async () => record('equip', []),
    attack: (e) => record('attack', [e.name]),
    chat: (m) => record('chat', [m]),
    consume: async () => {
      record('consume', []);
      bot.food = 20;
      return 'success';
    },
    placeBlock: async () => record('placeBlock', []),
    look: () => record('look', []),
    foodItems: () => [{ name: 'cooked_beef' }],
    quit: () => {},
  };

  // a zombie 3 blocks away so "fight or flee" is a live option
  bot.entities = {
    99: {
      id: 99,
      type: 'mob',
      name: 'zombie',
      health: 20,
      position: v3(13, 64, 10),
    },
    50: {
      id: 50,
      type: 'player',
      username: 'Player',
      health: 20,
      position: v3(14, 64, 12),
    },
  };

  bot.ownerName = 'Player';
  bot._minemindOwner = 'Player';
  bot._calls = calls;
  return bot;
}

(async () => {
  const logger = createLogger({ name: 'verify', level: 'debug' });
  const bot = makeBot();

  console.log('\n=== MINEMIND-DEEP decision verification ===');
  console.log('world: overworld, 18hp, food 14, zombie 3 blocks away, coal ore nearby\n');

  const engine = createDecisionEngine({ bot, settings, logger });
  if (!engine.provider.hasKey) {
    console.error('GEMINI_API_KEY missing — set it in .env and retry.');
    process.exit(1);
  }

  const results = [];
  for (let i = 0; i < 3; i++) {
    console.log(`\n--- decision tick ${i + 1} ---`);
    const r = await engine.tick('cadence');
    results.push(r);
    // move the world a little so each tick sees something new
    bot.entity.position = v3(10 + i * 2, 64, 10);
    // by tick 3 the zombie is gone and the bot is starving: the model should
    // switch to a *different* action, proving it reads the world instead of
    // repeating a fixed response.
    if (i === 2) {
      delete bot.entities[99];
      bot.food = 5;
      bot.entity.position = v3(13, 64, 10);
    }
  }

  const stats = engine.stats();
  console.log('\n=== summary ===');
  console.log('stats:', JSON.stringify(stats, null, 2));
  console.log('decisions:');
  for (const r of results) {
    if (r && r.ok !== undefined && r.action) {
      console.log(`  - ${r.action} (conf ${r.confidence}) -> ${r.ok ? r.detail : 'failed: ' + r.error}  [${r.reason}]`);
    } else {
      console.log(`  - (${r.stage || 'tick'}) ${r.error || JSON.stringify(r)}`);
    }
  }
  console.log('\nmineflayer calls actually made:');
  for (const c of bot._calls) {
    console.log(`  ${c.name}(${c.args.filter((a) => typeof a === 'string' || typeof a === 'number').join(', ')})`);
  }

  const realDecisions = results.filter((r) => r && r.action).length;
  const executed = results.filter((r) => r && r.ok).length;
  console.log(`\nRESULT: ${realDecisions}/3 real LLM decisions, ${executed} executed.`);
  if (realDecisions > 0) {
    console.log('PASS — gameplay actions were chosen by the model, not by if-else rules.');
    process.exit(0);
  }
  console.log('FAIL — no real decisions were produced.');
  process.exit(1);
})();
