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
for (const dep of ['mineflayer', 'mineflayer-pathfinder', 'dotenv', 'vec3']) {
  try {
    require.resolve(dep, { paths: [ROOT] });
    ok(dep);
  } catch {
    bad(`${dep} missing — run: npm install`);
  }
}

console.log('\n[config]');
let settings = {};
try {
  settings = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/settings.json'), 'utf8'));
  ok('config/settings.json parses');
} catch (e) {
  bad(`config/settings.json: ${e.message}`);
}

require('dotenv').config({ path: path.join(ROOT, '.env') });
const key = process.env.GEMINI_API_KEY;
if (key && key.length > 10) ok('GEMINI_API_KEY present');
else bad('GEMINI_API_KEY missing — copy .env.example to .env and set it');

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

  console.log('\n[llm]');
  try {
    const { createProvider } = require(path.join(ROOT, 'src/llm/provider'));
    const p = createProvider({ apiKey: process.env.GEMINI_API_KEY, model: settings.llm?.geminiModel });
    ok(`provider ready (model: ${p.model}, key: ${p.hasKey ? 'present' : 'MISSING'})`);
  } catch (e) {
    bad(`provider failed to initialise: ${e.message}`);
  }

  console.log('\n[docs]');
  for (const f of ['PLAN.md', 'CONTRACTS.md', 'ARCHITECTURE.md', 'PROGRESS.md', 'SETUP.md']) {
    fs.existsSync(path.join(ROOT, f)) ? ok(f) : warn(`${f} missing`);
  }

  console.log('\n[next]');
  console.log('  1. make sure a Minecraft server is listening on ' + host + ':' + port);
  console.log('  2. run:  npm start');
  console.log('');
  process.exit(0);
})();
