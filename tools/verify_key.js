'use strict';
/**
 * verify_key.js — is your LLM key actually usable?
 *
 * This exists because a wrong-shaped key fails SILENTLY in the most annoying
 * way possible: the bot keeps running, on the heuristic fallback, looking like
 * it "works" while the model is never consulted. Run this to know which one you
 * have.
 *
 *   npm run verify:key
 */

require('dotenv').config();
const { createOrchestrator, buildProviders } = require('../src/llm/orchestrator');

async function main() {
  const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', D = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
  console.log(`\n${B}LLM key check${X}\n`);

  const providers = buildProviders({}, process.env, { warn() {}, info() {}, error() {}, debug() {} });
  if (!providers.length) {
    console.log(`${R}No providers configured at all.${X}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${D}configured: ${providers.map((p) => p.name).join(', ')}${X}\n`);

  // Probe each real provider once (skip the mock — it always works).
  let anyReal = false;
  for (const p of providers) {
    if (p.name === 'mock') {
      console.log(`  ${D}skip${X}  mock ${D}(heuristic fallback — always available, but not AI)${X}`);
      continue;
    }
    anyReal = true;
    process.stdout.write(`  ...  ${p.name} (${p.model}) `);
    const res = await p.generate({
      system: 'You output JSON only.',
      user: 'Reply with exactly: {"ok":true}',
      temperature: 0,
      maxTokens: 60,
      json: true,
    });
    if (res.ok) {
      console.log(`${G}OK${X}`);
    } else {
      console.log(`${R}FAILED${X}`);
      console.log(`       ${R}${res.kind || '?'}: ${res.error}${X}`);
    }
  }

  console.log('');
  if (!anyReal) {
    console.log(`${Y}No real model configured — the bot will run on the heuristic fallback.${X}`);
    console.log(`${D}That means it moves and survives, but it is NOT choosing actions with AI.${X}\n`);
    console.log(`${B}To use a real model, put a valid key in .env:${X}`);
    console.log(`  ${D}Gemini:${X}  GEMINI_API_KEY=AIza...   ${D}(from aistudio.google.com → Get API key)${X}`);
    console.log(`  ${D}OpenRouter:${X} OPENROUTER_API_KEY=sk-or-v1-...  ${D}(from openrouter.ai)${X}`);
    process.exitCode = 1;
    return;
  }

  console.log(`${D}A 403 "unregistered callers" means the key is not a valid Gemini API key.${X}`);
  console.log(`${D}A 429 means the key works but you hit the free-tier quota (wait ~1 min).${X}\n`);
}

if (require.main === module) {
  main();
}