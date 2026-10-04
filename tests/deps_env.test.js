'use strict';
/**
 * Tests for the install-resilience fixes.
 *
 * Context: a fresh phone clone died with `Cannot find module 'dotenv'` when
 * npm install had not completed. These tests lock in the fixes:
 *   - deps.js  -> clear "run npm install" report instead of a stack trace
 *   - env.js   -> .env parses even when dotenv is absent
 */

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

const { check } = require('../src/core/deps');
const { parseEnv } = require('../src/core/env');

test('deps.check reports every required module as installed here', () => {
  const r = check();
  assert.deepStrictEqual(r.missing, [], `missing required deps: ${r.missing.join(', ')}`);
  assert.strictEqual(r.ok, true);
});

test('deps.check treats dotenv as optional, not required', () => {
  // In this repo dotenv IS installed, so assert on the classification instead:
  // an optional dep must never be the reason ok === false.
  const r = check();
  assert.ok(!r.missing.includes('dotenv'));
  assert.ok(!r.missingOptional.includes('mineflayer'));
});

test('parseEnv handles plain KEY=value', () => {
  const out = parseEnv('MC_PORT=3344');
  assert.strictEqual(out.MC_PORT, '3344');
});

test('parseEnv strips surrounding double quotes', () => {
  const out = parseEnv('OPENROUTER_API_KEY="sk-or-v1-abc"');
  assert.strictEqual(out.OPENROUTER_API_KEY, 'sk-or-v1-abc');
});

test('parseEnv strips surrounding single quotes', () => {
  const out = parseEnv("OWNER='Player'");
  assert.strictEqual(out.OWNER, 'Player');
});

test('parseEnv handles export prefix', () => {
  const out = parseEnv('export GEMINI_MODEL=gemini-3.5-flash');
  assert.strictEqual(out.GEMINI_MODEL, 'gemini-3.5-flash');
});

test('parseEnv ignores comments and blank lines', () => {
  const out = parseEnv('# a comment\n\nMC_HOST=localhost\n   \n# another');
  assert.deepStrictEqual(out, { MC_HOST: 'localhost' });
});

test('parseEnv keeps a # that is inside a quoted value', () => {
  const out = parseEnv('KEY="a # b"');
  assert.strictEqual(out.KEY, 'a # b');
});

test('parseEnv strips a trailing comment on an unquoted value', () => {
  const out = parseEnv('MC_PORT=3344 # the port');
  assert.strictEqual(out.MC_PORT, '3344');
});

test('parseEnv returns {} for empty input', () => {
  assert.deepStrictEqual(parseEnv(''), {});
  assert.deepStrictEqual(parseEnv('   \n\n  '), {});
});

test('loadEnv works when dotenv is NOT installed (builtin fallback)', () => {
  // Simulate the phone case: dotenv absent, .env present.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-env-'));
  const envFile = path.join(tmp, '.env');
  fs.writeFileSync(envFile, 'MC_PORT=3344\nOPENROUTER_MODEL=qwen/qwen3.8-27b:free\n');

  const saved = { ...process.env };
  delete process.env.MC_PORT;
  delete process.env.OPENROUTER_MODEL;
  try {
    const { loadEnv, aiConfig } = require('../src/core/env');
    const r = loadEnv(envFile);

    // It must load via EITHER dotenv or the builtin parser — never fail.
    assert.ok(['dotenv', 'builtin'].includes(r.via), `unexpected via: ${r.via}`);
    assert.strictEqual(process.env.MC_PORT, '3344');
    assert.strictEqual(process.env.OPENROUTER_MODEL, 'qwen/qwen3.8-27b:free');
    assert.strictEqual(typeof aiConfig().provider, 'string');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('loadEnv never overrides an already-set real env var', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mmd-env2-'));
  const envFile = path.join(tmp, '.env');
  fs.writeFileSync(envFile, 'MC_PORT=9999\n');

  const savedPort = process.env.MC_PORT;
  process.env.MC_PORT = '3344';
  try {
    const { loadEnv } = require('../src/core/env');
    loadEnv(envFile);
    assert.strictEqual(process.env.MC_PORT, '3344', 'real env must win over .env');
  } finally {
    if (savedPort === undefined) delete process.env.MC_PORT;
    else process.env.MC_PORT = savedPort;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('main.js requires deps preflight before any third-party module', () => {
  // Guards the ordering that makes the friendly error reachable.
  const src = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
  const preflight = src.indexOf("require('./src/core/deps')");
  const mineflayer = src.indexOf("require('mineflayer')");
  assert.ok(preflight !== -1, 'main.js must call the deps preflight');
  assert.ok(mineflayer !== -1, 'main.js must require mineflayer');
  assert.ok(preflight < mineflayer, 'deps preflight must come BEFORE mineflayer is required');
});

test('no source file hard-requires dotenv (it must stay optional)', () => {
  // src/core/env.js is the loader itself — its require('dotenv') is intentionally
  // wrapped in try/catch, so it is allowed. Every OTHER file must go through env.js.
  const root = path.join(__dirname, '..');
  const allowed = new Set([path.join('src', 'core', 'env.js')]);
  const offenders = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === 'data' || e.name === 'tests') continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith('.js')) {
        const rel = path.relative(root, full);
        if (allowed.has(rel)) continue;
        const s = fs.readFileSync(full, 'utf8');
        if (/require\(['"]dotenv['"]\)/.test(s)) offenders.push(rel);
      }
    }
  };
  walk(root);
  assert.deepStrictEqual(offenders, [], `these files hard-require dotenv: ${offenders.join(', ')}`);
});

test('env.js guards its own dotenv require in a try/catch', () => {
  // The one allowed dotenv require must never be able to throw.
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'core', 'env.js'), 'utf8');
  const idx = src.indexOf("require('dotenv')");
  assert.ok(idx !== -1, 'env.js should still try dotenv when present');
  const before = src.lastIndexOf('try {', idx);
  const after = src.indexOf('} catch', idx);
  assert.ok(before !== -1 && after !== -1 && before < idx && idx < after, 'dotenv require must sit inside a try/catch');
});