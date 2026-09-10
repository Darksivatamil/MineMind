require('dotenv').config();
const mineflayer = require('mineflayer');
const pathfinder = require('mineflayer-pathfinder').pathfinder;
const pvp = require('mineflayer-pvp').plugin;
const settings = require('./config/settings.json');
const AgnesAgent = require('./src/agent/agnes');
const { TerminalChat } = require('./src/chat/terminal');

let bot;
let agent;
let terminal;
let _lastChatMsg = '';
let _lastChatTime = 0;
let _reconnectScheduled = false;

function createBot() {
  console.log('═══════════════════════════════');
  console.log('  AGNES Bot v2.0');
  console.log('  Server:  ' + settings.host + ':' + settings.port);
  console.log('  Account: ' + settings.username);
  console.log('  Mode:    ' + (settings.auth === 'offline' ? 'OFFLINE (cracked)' : 'ONLINE'));
  console.log('═══════════════════════════════');
  bot = mineflayer.createBot({
    host: settings.host,
    port: settings.port,
    username: settings.username,
    auth: settings.auth
  });

  bot.loadPlugin(pathfinder);
  bot.loadPlugin(pvp);

  bot.on('spawn', () => {
    console.log('AGNES spawned in the world');
    agent = new AgnesAgent(bot, settings);
    if (terminal) {
      terminal.setBot(bot);
    } else {
      terminal = new TerminalChat(bot);
    }
  });

  const botName = settings.username.toLowerCase();

  bot.on('messagestr', (raw) => {
    if (!agent) return;
    console.log('[MSG]', raw);
    // Deduplicate identical messages within 1s window (prevents double-processing with 'chat' event)
    const now = Date.now();
    if (raw === _lastChatMsg && (now - _lastChatTime) < 1000) return;
    _lastChatMsg = raw;
    _lastChatTime = now;
    try {
      const cl = raw.replace(/§./g, '').trim();
      const sys = ['joined', 'left', 'lost connection', 'Advancement', 'has made', 'has reached', 'whispers', '->', '<--'];
      if (sys.some(s => cl.toLowerCase().includes(s))) return;

      const m = cl.match(/^<(.+?)>\s*(.+)$/);
      if (m) {
        if (m[1].toLowerCase() === botName) return;
        agent.handleChat(m[1], m[2]);
        return;
      }

      const names = Object.keys(bot.players).filter(n => n.toLowerCase() !== botName).sort((a, b) => b.length - a.length);
      for (const name of names) {
        const idx = cl.toLowerCase().indexOf(name.toLowerCase());
        if (idx === -1) continue;
        const before = cl.substring(0, idx);
        const after = cl.substring(idx + name.length);
        if (before.length > 0 && /[a-zA-Z0-9_]/.test(before[before.length - 1])) continue;
        const msg = after.replace(/^[:\)>»\]\s-]+/, '').trim();
        if (msg) { agent.handleChat(name, msg); return; }
      }

      if (cl.toLowerCase().includes(botName) && cl.length > 2 && !cl.startsWith('/')) console.log('[RAW]', cl);
    } catch (e) { console.error('cht err:', e.message); }
  });

  bot.on('chat', (username, message) => {
    if (!agent) return;
    if (username.toLowerCase() === botName) return;
    // Skip if messagestr already handled this exact message within 1s (avoids double LLM calls)
    const now = Date.now();
    const rawGuess = `<${username}> ${message}`;
    if (rawGuess === _lastChatMsg && (now - _lastChatTime) < 1000) return;
    try { agent.handleChat(username, message); }
    catch (e) { console.error('cht err:', e.message); }
  });

  bot.on('entityHurt', (entity) => {
    if (agent) agent.handleEntityHurt(entity);
  });

  bot.on('entityDead', (entity) => {
    if (agent) agent.handleEntityDead(entity);
  });

  bot.on('playerJoined', (player) => {
    if (agent) agent.handlePlayerJoined(player);
  });

  bot.on('playerLeft', (player) => {
    if (agent) agent.handlePlayerLeft(player);
  });

  bot.on('death', () => {
    console.log('AGNES died');
    if (agent) agent.handleDeath();
  });

  bot.on('kicked', (reason) => {
    console.log('AGNES was kicked:', reason);
    agent = null;
    if (terminal) terminal.setBot(null);
    _lastChatMsg = '';
    _lastChatTime = 0;
    scheduleReconnect();
  });

  bot.on('end', () => {
    console.log('AGNES disconnected');
    agent = null;
    if (terminal) terminal.setBot(null);
    _lastChatMsg = '';
    _lastChatTime = 0;
    scheduleReconnect();
  });

  bot.on('error', (err) => {
    console.error('Bot error:', err.message);
  });

  return bot;
}

function scheduleReconnect() {
  if (_reconnectScheduled) return;
  _reconnectScheduled = true;
  console.log('Reconnecting in 10 seconds...');
  setTimeout(() => {
    _reconnectScheduled = false;
    createBot();
  }, 10000);
}

function reconnect() {
  scheduleReconnect();
}

createBot();

process.on('SIGINT', () => {
  console.log('Shutting down...');
  try { if (terminal) terminal.stop(); } catch (e) { console.error('terminal stop err:', e.message); }
  try { if (bot) bot.end(); } catch (e) { console.error('bot end err:', e.message); }
  process.exit(0);
});
