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
 * 1. MOD GATE / FABRIC API REQUIREMENT  (the one we actually hit)
 *    "This server requires Fabric Loader and Fabric API installed on your client!"
 *    Fabric API performs a server-side handshake in the login phase: the server
 *    asks the client to identify itself over the custom payload channel
 *    `fabric:register` / `fabric:handshake`, then refuses the login when the
 *    answer is absent. A plain mineflayer client sends no such payload, so the
 *    server rejects it. This is NOT fixable from the bot side — see
 *    MOD_GATE below for why.
 *
 * 2. SECURE CHAT ("This server requires secure chat" / kicked on login)
 *    Fabric 1.19.1+ servers commonly enable enforce-secure-profile. A bot that
 *    does not implement the signed chat profile is rejected at login.
 *    Fixes: server-side `enforce-secure-profile=false` in server.properties
 *    (works for LAN), or the client option below.
 *
 * 3. FABRIC "Open to LAN" PORT
 *    Fabric still opens LAN on a random port unless the host specifies one.
 *    The bot must target the exact port shown in the LAN screen.
 *
 * 4. OFFLINE / CRACKED
 *    A phone-hosted world runs online-mode=false. The bot MUST use auth=offline,
 *    otherwise the login handshake fails with a profile-key error.
 *
 * 5. REGISTRY SYNC
 *    Fabric servers ship custom blocks/items/entities (e.g. `animal_pen`) that
 *    are synced over `fabric:registry/sync_*` payloads. mineflayer has no
 *    decoder for these, so a modded world is not fully navigable even if the
 *    mod gate were somehow passed.
 */

/** Client options that maximise compatibility with a phone-hosted world. */
function mineflayerOptions(target, extra = {}) {
  return {
    host: target.host,
    port: target.port,
    username: target.username,
    auth: target.auth === 'online' ? 'offline' : target.auth || 'offline',
    version: target.version,
    checkTimeoutInterval: 60 * 1000,
    hideErrors: false,
    ...extra,
  };
}

/* ------------------------------------------------------------------ *
 * Plain-text extraction for NBT chat components
 * ------------------------------------------------------------------ */

/**
 * Flatten a Minecraft text component into readable plain text.
 * Handles: plain strings, {text:...}, {"":...} (compact form used by the
 * modern protocol), {extra:[...]} children, and {translate/with}.
 */
function plainText(node) {
  const out = [];
  const walk = (n) => {
    if (n == null) return;
    if (typeof n === 'string') { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (typeof n !== 'object') return;
    if (n.text && n.text.value !== undefined) out.push(n.text.value);
    if (n[''] && n[''].value !== undefined) out.push(n[''].value);
    if (n.value && typeof n.value === 'string') out.push(n.value);
    if (n.translate && n.translate.value !== undefined) {
      out.push(String(n.translate.value));
    }
    if (n.extra) walk(n.extra);
    if (n.with) walk(n.with);
    if (n.value && typeof n.value === 'object') walk(n.value);
  };
  walk(node);
  return out.join('');
}

/**
 * Turn a kick reason (string, JSON string, or NBT object) into readable text.
 * The raw payload is an NBT component tree and is unreadable in logs.
 */
function decodeKickReason(reason) {
  if (reason == null) return '';
  if (typeof reason !== 'string') return plainText(reason);
  const trimmed = reason.trim();
  if (!trimmed) return '';
  if (trimmed[0] === '{' || trimmed[0] === '[' || trimmed[0] === '"') {
    try {
      return plainText(JSON.parse(trimmed)) || trimmed;
    } catch {
      /* not JSON — fall through */
    }
  }
  return reason;
}

/* ------------------------------------------------------------------ *
 * Failure diagnosis
 * ------------------------------------------------------------------ */

/** The mod gate: unfixable from the bot side. */
const MOD_GATE = {
  id: 'fabric-mod-gate',
  title: 'Server requires Fabric Loader + Fabric API',
  why:
    'This is a Fabric modded server. During login the server asks the client to ' +
    'identify itself over the `fabric:register` custom-payload channel and ' +
    'refuses any client that does not answer. AGNES is a plain mineflayer client ' +
    'with no Fabric Loader, so it cannot pass this check.',
  fix:
    'Run a VANILLA world on the same port: in your launcher, remove the Fabric ' +
    'API mod (or start an instance without Fabric), then Open to LAN on port ' +
    '3344. AGNES cannot be patched to satisfy this — it is a server-side gate.',
};

const TABLE = [
  MOD_GATE,
  {
    id: 'secure-chat',
    match: ['secure chat', 'secure profile', 'enforces secure'],
    title: 'Server enforces secure chat',
    why: 'This world requires signed chat profiles; the bot does not present one.',
    fix: 'In the world/LAN settings disable "enforce-secure-profile", or set enforce-secure-profile=false in server.properties.',
  },
  {
    id: 'registry',
    match: ['registry entry', 'registry sync', 'unknown registry'],
    title: 'Unknown registry entries (modded content)',
    why: 'The server ships custom blocks/items that this client cannot decode.',
    fix: 'Use a vanilla world, or accept that modded blocks will not be recognised.',
  },
  {
    id: 'version',
    match: ['outdated server', 'outdated client', 'version'],
    title: 'Version mismatch',
    why: 'The server version does not match the bot protocol version.',
    fix: 'Set MC_VERSION to the exact version shown on the world (1.21.11 for your setup).',
  },
  {
    id: 'auth',
    match: ['authentication', 'profile', 'online', 'cracked'],
    title: 'Authentication / online-mode problem',
    why: 'A phone world is offline-mode; the bot must log in offline.',
    fix: 'Set MC_AUTH=offline in .env (or config auth="offline").',
  },
];

/**
 * Map a login/kick failure to a human-readable diagnosis.
 * Returns null when nothing matches.
 */
function explainLoginFailure(err) {
  const text = decodeKickReason(err && err.message ? err.message : err);
  const lower = text.toLowerCase();
  // Mod gate must be tested before the generic 'mod' rule.
  if (/fabric loader|fabric api/.test(lower)) {
    return { ...MOD_GATE, reason: text };
  }
  for (const row of TABLE) {
    if (row.match.some((m) => lower.includes(m))) return { ...row, reason: text };
  }
  return null;
}

/**
 * Full formatted guidance for a kick, always including the decoded text so the
 * user always sees what the server actually said.
 */
function explainKick(reason) {
  const text = decodeKickReason(reason);
  const diag = explainLoginFailure(text);
  return { text, diag };
}

module.exports = {
  mineflayerOptions,
  explainLoginFailure,
  decodeKickReason,
  explainKick,
  plainText,
  MOD_GATE,
};