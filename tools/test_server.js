#!/usr/bin/env node
'use strict';
/**
 * test_server.js — a minimal Minecraft-protocol server on 127.0.0.1:3344.
 *
 * This exists so MINEMIND-DEEP can be started, joined and verified *inside
 * this terminal* without any external device. It is a protocol harness, not a
 * full world generator: it accepts logins, puts clients into play state and
 * keeps them alive. It is enough to prove connect -> spawn -> decide -> act.
 *
 * Real gameplay should use an actual server (or a phone-hosted world); this is
 * for local verification only.
 *
 * Run:  npm run test-server
 */

const mc = require('minecraft-protocol');

// mineflayer only emits `spawn` once it receives an update_health packet,
// so the harness must send one after positioning the player.
const { Vec3 } = require('vec3');

const HOST = process.env.TEST_HOST || '127.0.0.1';
const PORT = Number(process.env.TEST_PORT || 3344);
const VERSION = process.env.TEST_VERSION || '1.21.11';

const ok = (m) => console.log(`  \x1b[32mOK\x1b[0m   ${m}`);
const info = (m) => console.log(`  \x1b[36m..\x1b[0m   ${m}`);

function validUuid(v) {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
    ? v
    : '00000000-0000-4000-8000-000000000000';
}

function safeUuid(c) {
  if (typeof c === 'string') return validUuid(c);
  return validUuid(c?.profile?.uuid || c?.session?.profile?.uuid);
}

console.log(`\nMINEMIND-DEEP test server\n  host: ${HOST}  port: ${PORT}  version: ${VERSION}\n`);

/*
 * NOTE / known limitation:
 * `minecraft-protocol`'s server mode does not fully implement the modern
 * (1.20.3+) configuration state. A real 1.21.x client (mineflayer) aborts the
 * handshake with a "cookie_request / VarInt" read error and never reaches
 * `spawn`, so this harness cannot host genuine 1.21.x gameplay.
 *
 * It is kept because it is still useful to prove the *network* layer
 * (preflight -> TCP -> login) reaches the server, and it gives a free port to
 * point the bot at. For real play, point the bot at a real Minecraft server
 * (a phone-hosted world, or any public server) — see README / SETUP.md.
 */
const server = mc.createServer({
  version: VERSION,           // MUST match the client version or schemas diverge
  'online-mode': false,       // offline/cracked clients welcome
  motd: 'MINEMIND-DEEP local harness',
  keepAlive: true,
  kickTimeout: 1e9,           // don't time out clients during verification
  checkTimeoutInterval: 1e9,
  port: PORT,                 // createServer binds immediately
  host: HOST,
});

server.on('login', (client) => {
  const name = client.username || 'unknown';
  ok(`client logged in: ${name}`);

  client.write('login', {
    entityId: 1,
    isHardcore: false,
    gameMode: 0,
    dimension: 0,
    worldName: 'world',
    hashedSeed: [0, 0],
    maxPlayers: 20,
    viewDistance: 6,
    simulationDistance: 6,
    reducedDebugInfo: false,
    enableRespawnScreen: true,
    isDebug: false,
    isFlat: false,
    hasServerData: false,
  });

  // Move the player into the world.
  client.write('position', {
    x: 0.5,
    y: 64,
    z: 0.5,
    yaw: 0,
    pitch: 0,
    flags: 0,
    teleportId: 1,
    dismountVehicle: false,
  });

  // mineflayer gates `spawn` on health > 0.
  client.write('update_health', { health: 20, food: 20, foodSaturation: 5 });
  client.write('game_state_change', { reason: 3, gameState: 0 });

  info(`${name} entered play state`);

  // Echo chat so two clients can talk.
  client.on('player_chat', (data) => {
    const msg = data?.unsignedChatContent || data?.plainMessage || '';
    const clean = String(msg).replace(/\{.*?\}/g, '');
    const sender = client.username;
    console.log(`  \x1b[35m<${sender}>\x1b[0m ${clean}`);
    for (const c of Object.values(server.clients)) {
      try {
        c.write('player_chat', {
          senderName: JSON.stringify({ text: sender }),
          senderUuid: safeUuid(c),
          content: JSON.stringify({ text: clean }),
          type: { chatType: 0 },
          isServer: true,
          unsignedChatContent: JSON.stringify({ text: clean }),
        });
      } catch { /* never let one bad packet kill a client */ }
    }
  });

  client.on('disconnect', () => {
    info(`${name} disconnected`);
  });
});

server.on('listening', () => ok(`listening on ${HOST}:${PORT}`));
server.on('error', (err) => {
  console.error(`  \x1b[31mERR\x1b[0m   ${err.message}`);
  if (err.code === 'EADDRINUSE') {
    console.error('         port already in use — stop the other server or set TEST_PORT');
  }
});

process.on('SIGINT', () => {
  console.log('\nstopping test server');
  process.exit(0);
});
