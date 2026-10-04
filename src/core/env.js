'use strict';
/**
 * env.js — load .env into process.env, without hard-depending on dotenv.
 *
 * Why: on a fresh phone install, a missing/partial `npm install` used to crash
 * the app with `Cannot find module 'dotenv'`. Now dotenv is OPTIONAL: if it is
 * present we use it, otherwise we parse .env ourselves with a tiny parser.
 * Either way the app boots and tells the user if the key is missing.
 *
 * Also exposes helpers so tools report config consistently.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

/**
 * Minimal .env parser (fallback). Handles:
 *   KEY=value
 *   KEY="quoted value"   # strips surrounding quotes
 *   export KEY=value
 *   # comments and blank lines
 *   KEY=value # trailing comment (only when value is unquoted)
 * Does NOT override variables that are already set in process.env.
 */
function parseEnv(text) {
  const out = {};
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;

    const key = m[1];
    let val = m[2].trim();

    // Strip a trailing unquoted comment: value # comment
    // (only when the # is not inside quotes and there is whitespace before it)
    if (val && !/^["']/.test(val)) {
      val = val.replace(/\s+#.*$/, '').trim();
    }

    // Strip surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"') && val.length >= 2) ||
      (val.startsWith("'") && val.endsWith("'") && val.length >= 2)
    ) {
      val = val.slice(1, -1);
    }

    out[key] = val;
  }
  return out;
}

/**
 * Load .env into process.env.
 *
 * Order of preference:
 *   1. real environment (already set) always wins — never overwritten
 *   2. dotenv, if installed
 *   3. built-in parser fallback
 *
 * @param {string} [file] path to .env (default: <projectRoot>/.env)
 * @returns {{ loaded: boolean, via: 'dotenv'|'builtin'|'none', keys: string[] }}
 */
function loadEnv(file) {
  const envPath = file || path.join(ROOT, '.env');

  // 1) try dotenv (optional dependency)
  let via = 'none';
  let keys = [];
  try {
    // eslint-disable-next-line global-require
    const dotenv = require('dotenv');
    const result = dotenv.config({ path: envPath });
    if (result && result.parsed) {
      via = 'dotenv';
      keys = Object.keys(result.parsed);
    }
  } catch {
    // dotenv not installed — fall through to builtin parser
  }

  // 2) builtin fallback (also fills any gap dotenv left)
  if (via !== 'dotenv') {
    try {
      if (fs.existsSync(envPath)) {
        const parsed = parseEnv(fs.readFileSync(envPath, 'utf8'));
        let touched = 0;
        for (const [k, v] of Object.entries(parsed)) {
          // Do not override an already-set real env var.
          if (process.env[k] === undefined) {
            process.env[k] = v;
            touched += 1;
          }
        }
        via = 'builtin';
        keys = Object.keys(parsed);
        if (touched === 0 && keys.length === 0) via = 'none';
      }
    } catch {
      via = 'none';
    }
  }

  return { loaded: via !== 'none', via, keys };
}

/**
 * Which AI credential is present, and which model it points at.
 * Returns { provider, key, model, source } with key masked for display.
 */
function aiConfig() {
  const openrouter = process.env.OPENROUTER_API_KEY || '';
  const gemini = process.env.GEMINI_API_KEY || '';

  if (openrouter) {
    return {
      provider: 'openrouter',
      key: openrouter,
      model: process.env.OPENROUTER_MODEL || '(default)',
      source: 'OPENROUTER_API_KEY',
    };
  }
  if (gemini) {
    return {
      provider: 'gemini',
      key: gemini,
      model: process.env.GEMINI_MODEL || '(default)',
      source: 'GEMINI_API_KEY',
    };
  }
  return { provider: 'none', key: '', model: '', source: '' };
}

/** Mask a key for safe logging: sk-or-v1-be15...514e */
function maskKey(k) {
  if (!k) return '(missing)';
  if (k.length <= 12) return `${k.slice(0, 3)}***`;
  return `${k.slice(0, 11)}...${k.slice(-4)}`;
}

module.exports = { loadEnv, parseEnv, aiConfig, maskKey, ROOT };
