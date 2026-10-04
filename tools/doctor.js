#!/usr/bin/env node
/**
 * doctor.js — preflight checks before running MINEMIND-DEEP.
 * Verifies deps, config, keys. Does NOT connect to Minecraft.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ok = (m) => console.log(`  \x1b[32mOK\x1b[0m   ${m}`);
const bad = (m) => console.log(`  \x1b[31mFAIL\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33mWARN\x1b[0m ${m}`);

console.log('\nMINEMIND-DEEP doctor\n');

console.log('[deps]');
// REQUIRED deps: missing means the app cannot start at all.
for (const dep of ['mineflayer', 'vec3']) {
  try {
    require.resolve(dep, { paths: [ROOT] });
    ok(dep);
  } catch {
    bad(`${dep} missing — run: npm install`);
  }
}
// OPTIONAL deps: app still runs without these.
for (const dep of ['mineflayer-pathfinder', 'dotenv']) {
  try {
    require.resolve(dep, { paths: [ROOT] });
    ok(dep);
  } catch {
    warn(`${dep} missing — optional, app falls back (npm install to enable)`);
  }
}
console.log('  \x1b[2mif npm install fails on a phone, retry: npm install --fetch-timeout=600000\x1b[0m');

console.log('\n[config]');
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/settings.json'), 'utf8'));
  ok('config/settings.json parses');
} catch (e) {
  bad(`config/settings.json: ${e.message}`);
}

// dotenv is OPTIONAL — use the project's env loader (falls back to a builtin parser).
const { loadEnv, aiConfig, maskKey } = require('../src/core/env');
loadEnv(path.join(ROOT, '.env'));

const ai = aiConfig();
if (ai.provider === 'none') {
  bad('No AI key found — copy .env.example to .env and set OPENROUTER_API_KEY or GEMINI_API_KEY');
} else {
  ok(`AI key present (${ai.provider}, model: ${ai.model}, key: ${maskKey(ai.key)})`);
}

console.log('\n[target]');
const host = process.env.MC_HOST || settings.host || 'localhost';
const port = Number(process.env.MC_PORT || settings.port || 3344);
const version = process.env.MC_VERSION || settings.version || '1.21.11';
const auth = process.env.MC_AUTH || settings.auth || 'offline';
console.log(`  host=${host}  port=${port}  version=${version}  auth=${auth}`);

(async () => {
  console.log('\n[reachability]');
  const { tcpCheck } = require(path.join(ROOT, 'src/net/preflight'));
  const res = await tcpCheck({ host, port }, { timeoutMs: 3000 });
  if (res.ok) {
    ok(`something is listening on ${host}:${port}`);
  } else {
    warn(`${host}:${port} is not reachable — ${res.error}`);
    console.log('         A Minecraft server must be running and listening on that port.');
    console.log('         If "localhost" fails, that means *this machine* has no server —');
    console.log('         a phone-hosted world on the same Wi-Fi is NOT localhost here.');
  }

  console.log('\n[modded-server check]');
  const { MOD_GATE } = require(path.join(ROOT, 'src/net/fabric_compat'));
  console.log('  If your world uses Fabric/Forge mods, AGNES CANNOT join it.');
  console.log('  Those servers demand a mod-list handshake this bot cannot perform.');
  console.log(`  ${MOD_GATE.fix}`);
  console.log('  This check cannot auto-detect — only a real login attempt proves it.');
  console.log('  A kick reading "requires Fabric Loader and Fabric API" means this.');

  console.log('\n[llm — live key check]');
  try {
    const { buildProviders } = require(path.join(ROOT, 'src/llm/orchestrator'));
    const providers = buildProviders(settings.llm || {}, process.env, { warn() {}, info() {}, error() {}, debug() {} });
    const real = providers.filter((p) => p.name !== 'mock');
    if (!real.length) {
      bad('no real model provider configured — the bot would run on the heuristic fallback (not AI)');
      console.log('       Set GEMINI_API_KEY (aistudio.google.com) or OPENROUTER_API_KEY in .env');
    }
    for (const p of real) {
      process.stdout.write(`  ...  ${p.name} (${p.model}) `);
      const r = await p.generate({
        system: 'You output JSON only.',
        user: 'Reply with exactly: {"ok":true}',
        temperature: 0,
        maxTokens: 60,
        json: true,
      });
      if (r.ok) {
        ok(`${p.name} reachable`);
      } else if (r.kind === 'auth') {
        bad(`${p.name} key is INVALID (${r.status}): ${String(r.error).slice(0, 90)}`);
        console.log('       This key cannot call the model. The bot will fall back to heuristics.');
        console.log('       For Gemini, use a key from https://aistudio.google.com/apikey');
      } else if (r.kind === 'quota') {
        const msg = String(r.error || '');
        if (/free-models-per-day|daily/i.test(msg)) {
          warn(`${p.name} DAILY free-model quota is used up (key is valid).`);
          console.log('       This is an OpenRouter account limit on a 24h window — waiting a minute will NOT help.');
          console.log('       Fix: openrouter.ai -> Credits -> top up 10 credits (unlocks 1000/day),');
          console.log('       or set a paid model, e.g. OPENROUTER_MODEL=anthropic/claude-3.5-haiku');
        } else {
          warn(`${p.name} quota exceeded — rate limited (typically 20 req/min on free models). Wait ~1 minute.`);
        }
      } else {
        bad(`${p.name} failed (${r.kind}): ${String(r.error).slice(0, 90)}`);
      }
    }
    console.log('  \x1b[2mThe bot always has a heuristic fallback, so it never stalls —\x1b[0m');
    console.log('  \x1b[2mbut a fallback run is NOT the model playing. Check the log for "via: mock".\x1b[0m');
  } catch (e) {
    bad(`llm check failed to run: ${e.message}`);
  }

  console.log('\n[docs]');
  for (const f of ['CONTROL.md', 'FEATURES.md', 'PLAN.md', 'CONTRACTS.md', 'ARCHITECTURE.md', 'SETUP.md']) {
    fs.existsSync(path.join(ROOT, f)) ? ok(f) : warn(`${f} missing`);
  }

  console.log('\n[next]');
  console.log(`  1. make sure a Minecraft server is listening on ${host}:${port}`);
  console.log('  2. verify your AI key works:   npm run verify:key');
  console.log('  3. run the bot:                npm start');
  console.log('');
  process.exit(0);
})();
