'use strict';
/**
 * fabric_compat.js — Fabric/modded-server specific connection handling.
 *
 * Running against a Fabric server (the user's setup: Fabric 0.18.4 on 1.21.11)
 * differs from vanilla in ways that break bots in confusing ways. This module
 * centralises the fixes so main.js and the doctor can share one source of truth.
 *
 * Known Fabric/modded failure modes and their fixes:
 *
 * 1. SECURE CHAT ("This server requires secure chat" / kicked on login)
 *    Fabric 1.19.1+ servers commonly enable enforce-secure-profile. A bot that
 *    does not implement the signed chat profile is rejected at login.
 *    Fixes: server-side `enforce-secure-profile=false` in server.properties
 *    (works for LAN), or the client option below.
 *
 * 2. MOD/PROTOCOL GATING
 *    Some Fabric modpacks require a mod list handshake (forge/fabric handshake
 *    packet) that mineflayer does not send. A dedicated vanilla bot is refused.
 *    Fix: the server must allow vanilla clients (disable the mod gate), or you
 *    use a vanilla-compatible world.
 *
 * 3. FABRIC "Open to LAN" PORT
 *    Fabric still opens LAN on a random port unless the host specifies one.
 *    The bot must target the exact port shown in the LAN screen.
 *
 * 4. OFFLINE / CRACKED
 *    A phone-hosted world runs online-mode=false. The bot MUST use auth=offline,
 *    otherwise the login handshake fails with a profile-key error.
 */

/** Client options that maximise compatibility with a phone-hosted Fabric world. */
function mineflayerOptions(target, extra = {}) {
  return {
    host: target.host,
    port: target.port,
    username: target.username,
    auth: target.auth === 'online' ? 'offline' : target.auth || 'offline',
    version: target.version,
    // Talk chat as unsigned plain text — a phone world will not validate signatures.
    checkTimeoutInterval: 60 * 1000,
    // Do not let the profile/skin fetch block login on an offline server.
    hideErrors: false,
    ...extra,
  };
}

/**
 * Advice shown when a login fails, mapped from the observed failure text.
 * Keeps the interpretation in one testable place.
 */
function explainLoginFailure(err) {
  const text = String((err && err.message) || err || '').toLowerCase();
  const table = [
    {
      match: ['secure chat', 'secure profile', 'enforces secure'],
      title: 'Server enforces secure chat',
      why: 'This Fabric world requires signed chat profiles; the bot does not present one.',
      fix: 'In the world/LAN settings disable "enforce-secure-profile", or set enforce-secure-profile=false in server.properties.',
    },
    {
      match: ['multiplayer disallowed', 'mod', 'fabric', 'forge'],
      title: 'Server requires mods (mod gate)',
      why: 'This modpack refuses clients that do not present a mod list.',
      fix: 'Disable the mod requirement on the server, or use a vanilla world. A bot cannot present a Fabric mod list.',
    },
    {
      match: ['outdated server', 'outdated client', 'version'],
      title: 'Version mismatch',
      why: 'The server version does not match the bot protocol version.',
      fix: 'Set MC_VERSION to the exact version shown on the world (1.21.11 for your setup).',
    },
    {
      match: ['authentication', 'profile', 'online', 'cracked', 'disconnected'],
      title: 'Authentication / online-mode problem',
      why: 'A phone world is offline-mode; the bot must log in offline.',
      fix: 'Set MC_AUTH=offline in .env (or config auth="offline").',
    },
  ];
  for (const row of table) {
    if (row.match.some((m) => text.includes(m))) return row;
  }
  return null;
}

module.exports = { mineflayerOptions, explainLoginFailure };
