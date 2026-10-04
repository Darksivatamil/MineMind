'use strict';
/**
 * main.js — MINEMIND-DEEP entry point.
 *
 * Boots a real LLM-driven Minecraft player:
 *   connect (mineflayer, offline, localhost:3344)
 *     -> autopilot (reflex -> LLM goal + action -> governor -> execute -> verify)
 *     -> memory (learns from outcomes)
 *     -> auto-reconnect
 *
 * Run:  npm start
 * Override target without editing files:
 *   MC_HOST=1.2.3.4 MC_PORT=3344 npm start
 */

// Dependency preflight FIRST — before any third-party require.
// Uses only Node built-ins, so it works even when node_modules is empty.
const { assertInstalled } = require('./src/core/deps');
assertInstalled();

// .env loader (dotenv is OPTIONAL — we fall back to a built-in parser).
const { loadEnv, aiConfig } = require('./src/core/env');
loadEnv();

const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');

const { resolveTarget } = require('./src/net/target');
const { tcpCheck } = require('./src/net/preflight');
const { explainKick } = require('./src/net/fabric_compat');
const { createBus } = require('./src/core/bus');
const { createLogger } = require('./src/core/logger');
const { createLoop } = require('./src/core/loop');
const { createMemory } = require('./src/core/memory');
const { TRIGGERS, TRIGGER_RULES } = require('./src/core/triggers');
const { createAutopilot } = require('./src/ai/autopilot');
const { createExecutor } = require('./src/ai/action_executor');
const { createGovernor } = require('./src/ai/governor');
const { createChat } = require('./src/chat/personality');

const settings = require('./config/settings.json');

const log = createLogger({ name: 'minemind', level: process.env.LOG_LEVEL || 'info' });
const bus = createBus();
bus.onError((err, ev) => log.error('bus listener threw', { event: ev, error: err.message }));

const target = resolveTarget({ settings, env: process.env });
for (const w of target.warnings) log.warn(w);

function banner() {
  // Report the ACTIVE provider/model, not a hardcoded guess — otherwise the
  // banner can claim Gemini while the orchestrator is really using OpenRouter.
  const ai = aiConfig();
  const modelLine =
    ai.provider === 'none'
      ? '  Model:   (none — set OPENROUTER_API_KEY or GEMINI_API_KEY in .env)'
      : `  Model:   ${ai.provider} / ${ai.model}`;

  const lines = [
    '═══════════════════════════════════════════════',
    '  MINEMIND-DEEP — LLM-driven Minecraft player',
    `  Server:  ${target.host}:${target.port}`,
    `  Account: ${target.username}`,
    `  Auth:    ${target.auth === 'offline' ? 'OFFLINE' : target.auth.toUpperCase()}`,
    `  Version: ${target.version}`,
    modelLine,
    '═══════════════════════════════════════════════',
  ];
  console.log(lines.join('\n'));

  if (ai.provider === 'none') {
    log.warn('no AI key configured — AGNES will run on the heuristic fallback (not real AI)', {
      fix: 'add OPENROUTER_API_KEY=... to .env, then run: npm run verify:key',
    });
  }
}

let bot = null;
let autopilot = null;
let memory = null;
let chat = null;
let loop = null;
let stopping = false;
let fatalModGate = false;

/** Connect (with preflight) and wire the autopilot loop. */
async function connect() {
  if (stopping) return;

  const pre = await tcpCheck(target, { timeoutMs: 4000 });
  if (!pre.ok) {
    log.error('server not reachable', { target: `${target.host}:${target.port}`, error: pre.error, hint: pre.hint });
    scheduleReconnect();
    return;
  }
  log.info('server reachable', { target: `${target.host}:${target.port}` });

  log.info('creating bot', { username: target.username, version: target.version, auth: target.auth });
  bot = mineflayer.createBot({
    host: target.host,
    port: target.port,
    username: target.username,
    auth: target.auth,
    version: target.version,
    checkTimeoutInterval: 60000,
    hideErrors: false,
  });

  bot.ownerName = target.owner;
  bot._minemindOwner = target.owner;
  bot.loadPlugin(pathfinder);

  bot.once('spawn', () => {
    log.info('AGNES spawned in the world', {
      pos: `${bot.entity.position.x.toFixed(1)}, ${bot.entity.position.y.toFixed(1)}, ${bot.entity.position.z.toFixed(1)}`,
      health: bot.health,
      food: bot.food,
    });
    startAutopilot();
    try { bot.chat(`hi ${target.owner}, AGNES inga online ah irukken.`); } catch { /* ignore */ }
  });

  // --- player chat: give the LLM a voice -------------------------------
  bot.on('messagestr', (msg, sender) => {
    log.info('chat', { from: sender, msg });
    bus.emit(TRIGGERS.CHAT_MESSAGE, { message: msg, from: sender });
    if (chat) {
      chat.onPlayerMessage(sender, msg).then((reply) => {
        if (reply) {
          try { bot.chat(reply); } catch { /* ignore */ }
        }
      }).catch(() => { /* ignore */ });
    }
  });

  // --- trigger sources: events that should force an early decision --------
  let lastHealth = null;
  bot.on('health', () => {
    const hp = bot.health;
    if (lastHealth !== null && hp < lastHealth - TRIGGER_RULES.healthDropAmount) {
      bus.emit(TRIGGERS.HEALTH_DROP, { from: lastHealth, to: hp });
    }
    lastHealth = hp;
  });

  let lastFood = null;
  bot.on('food', () => {
    if (lastFood !== null && bot.food <= TRIGGER_RULES.hungerCriticalFood && bot.food < lastFood) {
      bus.emit(TRIGGERS.HUNGER_CRITICAL, { food: bot.food });
    }
    lastFood = bot.food;
  });

  const hostileCheck = setInterval(() => {
    try {
      for (const e of Object.values(bot.entities)) {
        if (e.type !== 'mob' || !e.position) continue;
        const d = e.position.distanceTo(bot.entity.position);
        if (d <= TRIGGER_RULES.threatNearBlocks && e.health > 0) {
          bus.emit(TRIGGERS.THREAT_NEAR, { name: e.name, dist: Math.round(d) });
          return;
        }
      }
    } catch { /* ignore */ }
  }, 3000);
  bot.on('end', () => clearInterval(hostileCheck));

  bot.on('kicked', (reason) => {
    const { text, diag } = explainKick(reason);
    log.error('kicked by server', { reason: text || '(empty reason)' });
    if (diag) {
      log.error(`why:  ${diag.title}`);
      log.error(`      ${diag.why}`);
      log.error(`fix:  ${diag.fix}`);
      if (diag.id === 'fabric-mod-gate') {
        fatalModGate = true;
        log.error('stopping: a Fabric modded server cannot accept this bot.');
        log.error('Run a VANILLA world (no Fabric API mod) on the same port and start again.');
      }
    } else {
      log.error('hint: unrecognised kick — run `npm run doctor` and share this message.');
    }
  });
  bot.on('error', (err) => log.error('bot error', { error: err.message }));

  bot.on('end', (reason) => {
    log.warn('disconnected', { reason: reason || 'unknown' });
    if (loop) {
      try { loop.stop(); } catch { /* ignore */ }
      loop = null;
    }
    try { bot.removeAllListeners('end'); } catch { /* ignore */ }
    if (fatalModGate) {
      log.error('not reconnecting: the server refused this client for a reason retrying cannot fix.');
      process.exitCode = 1;
      try { bot.quit(); } catch { /* ignore */ }
      return;
    }
    scheduleReconnect();
  });
}

function startAutopilot() {
  if (loop) return;
  memory = createMemory({ logger: log });
  const executor = createExecutor({ logger: log, settings, memory, actionTimeoutMs: settings.loop?.actionTimeoutMs ?? 15000 });
  const governor = createGovernor({ settings });
  autopilot = createAutopilot({ bot, settings, logger: log, memory, executor, governor });
  chat = createChat({ orchestrator: autopilot.orchestrator, logger: log, ownerName: target.owner });

  loop = createLoop({
    settings,
    bus,
    logger: log,
    handler: ({ trigger, payload }) => autopilot.tick(trigger, payload),
  });
  loop.start();
  log.info('autopilot started', {
    everyMs: settings.loop?.decisionIntervalMs,
    perMinute: settings.loop?.decisionsPerMinute,
    providers: autopilot.orchestrator.active(),
  });

  // periodic stats so the user can see it working
  const statsTimer = setInterval(() => {
    const s = autopilot.stats();
    log.info('status', {
      ticks: s.ticks,
      executed: s.executed,
      verified: s.verified,
      failed: s.failed,
      vetoed: s.vetoed,
      via: s.bySource,
      goal: s.planner?.current || '-',
    });
  }, 60000);
  bot.on('end', () => clearInterval(statsTimer));
}

function scheduleReconnect() {
  if (stopping || fatalModGate) return;
  const delay = settings.reconnectDelayMs ?? 5000;
  log.info('reconnecting in', { ms: delay });
  setTimeout(connect, delay);
}

function shutdown(signal) {
  if (stopping) return;
  stopping = true;
  log.info('shutting down', { signal });
  try { loop?.stop(); } catch { /* ignore */ }
  try { bot?.quit('bye'); } catch { /* ignore */ }
  setTimeout(() => process.exit(0), 300);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

banner();
connect();

module.exports = { connect };