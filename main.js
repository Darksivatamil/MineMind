'use strict';
/**
 * main.js — MINEMIND-DEEP entry point.
 *
 * Boots a real LLM-driven Minecraft player:
 *   connect (mineflayer, offline, localhost:3344)
 *     -> decision loop (observe -> Gemini decides -> governor -> act)
 *     -> auto-reconnect
 *
 * Run:  npm start
 * Override target without editing files:
 *   MC_HOST=1.2.3.4 MC_PORT=3344 npm start
 */

require('dotenv').config();

const mineflayer = require('mineflayer');
const { pathfinder } = require('mineflayer-pathfinder');

const { resolveTarget } = require('./src/net/target');
const { tcpCheck } = require('./src/net/preflight');
const { createBus } = require('./src/core/bus');
const { createLogger } = require('./src/core/logger');
const { createLoop } = require('./src/core/loop');
const { TRIGGERS, TRIGGER_RULES } = require('./src/core/triggers');
const { createDecisionEngine } = require('./src/ai/decision_engine');

const settings = require('./config/settings.json');

const log = createLogger({ name: 'minemind', level: process.env.LOG_LEVEL || 'info' });
const bus = createBus();
bus.onError((err, ev) => log.error('bus listener threw', { event: ev, error: err.message }));

const target = resolveTarget({ settings, env: process.env });
for (const w of target.warnings) log.warn(w);

function banner() {
  const lines = [
    '═══════════════════════════════════════════════',
    '  MINEMIND-DEEP — LLM-driven Minecraft player',
    `  Server:  ${target.host}:${target.port}`,
    `  Account: ${target.username}`,
    `  Auth:    ${target.auth === 'offline' ? 'OFFLINE' : target.auth.toUpperCase()}`,
    `  Version: ${target.version}`,
    `  Model:   ${settings.llm?.geminiModel || process.env.GEMINI_MODEL || 'gemini-3.5-flash'}`,
    '═══════════════════════════════════════════════',
  ];
  console.log(lines.join('\n'));
}

let bot = null;
let engine = null;
let loop = null;
let stopping = false;

/** Connect (with preflight) and wire the decision loop. */
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
    startDecisionLoop();
    bot.chat(`hi ${target.owner}, AGNES inga online ah irukken.`);
  });

  bot.on('messagestr', (msg) => {
    log.info('chat', { from: 'player', msg });
    bus.emit(TRIGGERS.CHAT_MESSAGE, { message: msg });
    if (/\bhi\b|\bvanakkam\b|\bhello\b/i.test(msg) && msg.includes(target.owner)) {
      try { bot.chat('vanakkam da!'); } catch { /* ignore */ }
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
    const s = typeof reason === 'string' ? reason : JSON.stringify(reason);
    log.error('kicked by server', { reason: s });
    if (/secure chat|secure profile/i.test(s)) {
      log.error('hint: server requires secure chat; disable "enable-secure-chat" in server.properties');
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
    scheduleReconnect();
  });
}

function startDecisionLoop() {
  if (loop) return;
  engine = createDecisionEngine({ bot, settings, logger: log, bus });

  loop = createLoop({
    settings,
    bus,
    logger: log,
    handler: ({ trigger }) => engine.tick(trigger),
  });
  loop.start();
  log.info('decision loop started', {
    everyMs: settings.loop?.decisionIntervalMs,
    perMinute: settings.loop?.decisionsPerMinute,
  });
}

function scheduleReconnect() {
  if (stopping) return;
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
