'use strict';
/**
 * target.js — resolve the Minecraft connection target from env + config.
 *
 * Precedence (highest first):
 *   1. environment (MC_HOST, MC_PORT, MC_VERSION, MC_USERNAME, MC_AUTH, OWNER)
 *   2. config/settings.json
 *   3. hard-coded safe defaults (localhost:3344)
 *
 * Pure and side-effect free apart from the optional dotenv load, so it is
 * trivially unit-testable. Returns a normalised target object; invalid values
 * are reported rather than silently coerced where it matters (e.g. non-numeric
 * port falls back to config/default and records a warning).
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');

const DEFAULTS = {
  host: 'localhost',
  port: 3344,
  version: '1.21.11',
  username: 'AGNES',
  auth: 'offline',
  owner: 'Player',
};

function loadSettings(settingsPath) {
  const p = settingsPath || path.join(ROOT, 'config', 'settings.json');
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed;
    throw new Error('settings.json did not contain an object');
  } catch (err) {
    return { _settingsError: err.message };
  }
}

/**
 * @param {object} opts
 * @param {object} [opts.settings] parsed settings (defaults to reading config/settings.json)
 * @param {object} [opts.env] process.env-like (defaults to process.env)
 * @param {string} [opts.settingsPath] override settings file location
 * @returns {{host:string,port:number,version:string,username:string,auth:string,owner:string,warnings:string[]}}
 */
function resolveTarget(opts = {}) {
  const { env = process.env, settingsPath } = opts;
  const warnings = [];

  let settings = opts.settings;
  if (settings === undefined) settings = loadSettings(settingsPath);
  if (settings && settings._settingsError) {
    warnings.push(`config/settings.json unavailable (${settings._settingsError}); using defaults`);
  }

  const pick = (envKey, configValue, fallback, label) => {
    const fromEnv = env[envKey];
    if (fromEnv !== undefined && String(fromEnv).trim() !== '') return String(fromEnv).trim();
    if (configValue !== undefined && configValue !== null && String(configValue).trim() !== '') {
      return String(configValue).trim();
    }
    return fallback;
  };

  const host = pick('MC_HOST', settings.host, DEFAULTS.host, 'host');
  const version = pick('MC_VERSION', settings.version, DEFAULTS.version, 'version');
  const username = pick('MC_USERNAME', settings.username, DEFAULTS.username, 'username');
  const auth = pick('MC_AUTH', settings.auth, DEFAULTS.auth, 'auth');
  const owner = pick('OWNER', settings.owner, DEFAULTS.owner, 'owner');

  let port;
  const rawPort = env.MC_PORT ?? settings.port ?? DEFAULTS.port;
  const nPort = Number(rawPort);
  if (!Number.isInteger(nPort) || nPort < 1 || nPort > 65535) {
    warnings.push(`invalid port "${rawPort}" (need 1-65535); falling back to ${DEFAULTS.port}`);
    port = DEFAULTS.port;
  } else {
    port = nPort;
  }

  if (auth !== 'offline' && auth !== 'microsoft' && auth !== 'mojang') {
    warnings.push(`unrecognised auth "${auth}" (expected offline|microsoft|mojang); using offline`);
  }

  return { host, port, version, username, auth, owner, warnings };
}

module.exports = { resolveTarget, loadSettings, DEFAULTS, ROOT };
