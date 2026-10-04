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

// dotenv is OPTIONAL — use the project's env loader (falls back to a builtin parser).
const { loadEnv } = require('../src/core/env');
loadEnv();
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
  let anyOk = false;
  let dailyQuotaHit = false;
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
      anyOk = true;
      console.log(`${G}OK${X}`);
    } else {
      console.log(`${R}FAILED${X}`);
      console.log(`       ${R}${res.kind || '?'}: ${res.error}${X}`);
      if (/free-models-per-day|daily/i.test(String(res.error || ''))) dailyQuotaHit = true;
    }
  }

  console.log('');

  // Clear, specific guidance for the two quota flavours.
  if (anyReal && !anyOk && dailyQuotaHit) {
    console.log(`${Y}Your key is VALID, but the free-model DAILY quota is used up.${X}`);
    console.log(`${D}This is an OpenRouter account limit, not a bug in AGNES, and not a wrong key.${X}`);
    console.log(`${D}It resets on a 24h rolling window — waiting one minute will NOT help.${X}\n`);
    console.log(`${B}Three ways out:${X}`);
    console.log(`  1. ${D}Add credits (smallest fix):${X} openrouter.ai → Credits → top up 10 credits`);
    console.log(`     ${D}→ unlocks 1000 free-model requests/day.${X}`);
    console.log(`  2. ${D}Use a paid model:${X} set a small budget and pick any model, e.g.`);
    console.log(`     ${D}OPENROUTER_MODEL=deepseek/deepseek-chat-v3-0324:free${X} ${D}(still free-tier pool)${X}`);
    console.log(`     ${D}OPENROUTER_MODEL=anthropic/claude-3.5-haiku${X} ${D}(paid, very cheap)${X}`);
    console.log(`  3. ${D}Use another provider:${X} GEMINI_API_KEY=AIza...  (aistudio.google.com/apikey)\n`);
  }

  if (!anyReal) {
    console.log(`${Y}No real model configured — the bot will run on the heuristic fallback.${X}`);
    console.log(`${D}That means it moves and survives, but it is NOT choosing actions with AI.${X}\n`);
    console.log(`${B}To use a real model, put a valid key in .env:${X}`);
    console.log(`  ${D}Gemini:${X}  GEMINI_API_KEY=AIza...   ${D}(from aistudio.google.com → Get API key)${X}`);
    console.log(`  ${D}OpenRouter:${X} OPENROUTER_API_KEY=sk-or-v1-...  ${D}(from openrouter.ai)${X}`);
    process.exitCode = 1;
    return;
  }

  if (!anyOk) {
    console.log(`${D}A 403 "unregistered callers" means the key is not a valid Gemini API key.${X}`);
    console.log(`${D}A 429 quota error means the key works but the free tier is exhausted.${X}\n`);
    process.exitCode = 1;
    return;
  }

  console.log(`${G}At least one real model is reachable — AGNES is using AI to choose actions.${X}\n`);
  console.log(`${D}Check your startup log for "via: openrouter" to confirm a model picked the action.${X}`);
  console.log(`${D}(If you see "via: mock" instead, that decision came from the heuristic floor.)${X}\n`);
}

if (require.main === module) {
  main();
}