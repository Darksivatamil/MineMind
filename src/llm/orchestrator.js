'use strict';
/**
 * orchestrator.js — multi-provider LLM brain with automatic rotation.
 *
 * THE FIX for "AGNES doesn't move": previously a single provider's 429 quota
 * error meant zero decisions, so the bot stood still forever. Now:
 *
 *   providers = [gemini, openrouter, ollama, mock]
 *        ↓
 *   try gemini → quota? mark it COOLDOWN for N seconds → try openrouter → ok
 *        ↓
 *   decision returned, gameplay continues
 *
 * A provider that exhausts its quota is benched (not retried) until its
 * cooldown expires, so the bot keeps a warm spare instead of stalling.
 */

const {
  createGeminiProvider,
  createOpenAICompatibleProvider,
  createOllamaProvider,
  createMockProvider,
} = require('./providers');
const { extractJson } = require('./util');

const noop = { info() {}, warn() {}, error() {}, debug() {} };

/** Build the provider chain from settings + env. Unavailable ones are dropped. */
function buildProviders(cfg = {}, env = process.env, logger = noop) {
  const list = [];
  const enabled = cfg.enabled || ['gemini', 'openrouter', 'ollama', 'mock'];

  if (enabled.includes('gemini')) {
    const p = createGeminiProvider({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL || cfg.geminiModel || 'gemini-3.5-flash',
      timeoutMs: cfg.timeoutMs,
      retries: cfg.retries,
      logger,
    });
    if (p.available) list.push(p);
    else logger.warn('provider gemini unavailable', { reason: p.reason });
  }

  if (enabled.includes('openrouter') && (env.OPENROUTER_API_KEY || env.LLM_API_KEY)) {
    const p = createOpenAICompatibleProvider({
      apiKey: env.OPENROUTER_API_KEY || env.LLM_API_KEY,
      baseUrl: env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
      model: env.OPENROUTER_MODEL || cfg.openrouterModel || 'google/gemini-2.5-flash',
      timeoutMs: cfg.timeoutMs,
      retries: cfg.retries,
      logger,
      name: 'openrouter',
    });
    if (p.available) list.push(p);
    else logger.warn('provider openrouter unavailable', { reason: p.reason });
  }

  if (enabled.includes('ollama') && (cfg.enableOllama || env.OLLAMA_ENABLED === '1')) {
    list.push(
      createOllamaProvider({
        baseUrl: env.OLLAMA_BASE_URL,
        model: env.OLLAMA_MODEL || cfg.ollamaModel,
        timeoutMs: 60000,
        retries: 0,
        logger,
      })
    );
  }

  // Always-available last-resort so the bot is never completely mute.
  if (enabled.includes('mock') && cfg.mockFallback !== false) {
    list.push(
      createMockProvider({
        logger,
        rules: cfg.mockRules || defaultMockRules(),
      })
    );
  }

  return list;
}

/**
 * A heuristic stand-in that picks a sensible action from the snapshot text.
 * This is NOT the AI — it is the floor that guarantees the bot still acts when
 * every real model is unavailable. Always logged as provider 'mock'.
 */
function defaultMockRules() {
  return [
    {
      when: (user) => /"health"\s*:\s*([0-9]|1[0-5])([.,}]|\s)/.test(user),
      reply: { action: 'flee', reason: 'mock: health critical', confidence: 0.95 },
    },
    {
      when: (user) => /"food"\s*:\s*([0-5])[.,}]/.test(user),
      reply: { action: 'eat', reason: 'mock: hungry', confidence: 0.9 },
    },
    {
      when: (user) => /hostiles"\s*:\s*\[\s*\{[^}]*"dist"\s*:\s*([0-8])/.test(user),
      reply: { action: 'attack', reason: 'mock: hostile is close', confidence: 0.9 },
    },
    {
      when: (user) => /iron_ore|coal_ore|copper_ore/.test(user),
      reply: { action: 'mine', target: 'iron_ore', reason: 'mock: ore nearby', confidence: 0.85 },
    },
    { when: () => true, reply: { action: 'explore', reason: 'mock: nothing notable, wander', confidence: 0.7 } },
  ];
}

function createOrchestrator(opts = {}) {
  const {
    cfg = {},
    env = process.env,
    logger = noop,
    clock = () => Date.now(),
    providers: injected = null,
  } = opts;

  const providers = injected || buildProviders(cfg, env, logger);
  if (!providers.length) throw new Error('orchestrator: no providers available');

  /** name -> ms timestamp until which the provider is benched */
  const benched = new Map();

  const stats = {
    calls: 0,
    ok: 0,
    failed: 0,
    rotations: 0,
    parseFails: 0,
    perProvider: Object.create(null),
  };

  function bump(name, field) {
    const row = (stats.perProvider[name] = stats.perProvider[name] || { ok: 0, failed: 0, benched: 0 });
    row[field]++;
  }

  /** Providers that are available and not benched, in priority order. */
  function active() {
    const now = clock();
    return providers.filter((p) => {
      const until = benched.get(p.name) || 0;
      if (until > now) {
        bump(p.name, 'benched');
        return false;
      }
      return true;
    });
  }

  /**
   * Generate text, rotating on quota/auth/server failures.
   * Returns {ok, text, provider} or {ok:false, error, tried:[]}.
   */
  async function generate(req) {
    const chain = active();
    const tried = [];

    if (!chain.length) {
      // Everything benched → let the shortest bench lapse, then use it anyway.
      const soonest = Math.min(...benched.values());
      const waitMs = Math.max(0, soonest - clock());
      if (waitMs > 0) logger.warn('all providers benched', { waitMs });
      for (const p of providers) benched.delete(p.name);
    }

    const order = chain.length ? chain : providers;
    stats.calls++;

    for (const p of order) {
      const res = await p.generate(req);
      tried.push(p.name);
      if (res.ok) {
        stats.ok++;
        bump(p.name, 'ok');
        benched.delete(p.name);
        return { ok: true, text: res.text, provider: p.name };
      }
      bump(p.name, 'failed');
      stats.failed++;
      const kind = res.kind || 'protocol';
      // Bench quota/auth for a while; transient/server gets a shorter bench.
      if (kind === 'quota' || kind === 'auth') {
        benched.set(p.name, clock() + (cfg.quotaCooldownMs ?? 120000));
      } else if (kind === 'server' || kind === 'transient') {
        benched.set(p.name, clock() + (cfg.errorCooldownMs ?? 20000));
      }
      if (tried.length > 1) stats.rotations++;
      logger.warn('provider failed, rotating', {
        provider: p.name,
        kind,
        error: res.error,
        next: (order[order.indexOf(p) + 1] || {}).name,
      });
    }

    return { ok: false, error: 'all providers failed', tried };
  }

  /**
   * Ask for a JSON decision and validate it against the action vocabulary.
   * @returns {ok:true, decision, provider} | {ok:false, error, code}
   */
  async function decide({ system, user, validate, temperature, maxTokens }) {
    const res = await generate({ system, user, temperature, maxTokens, json: true });
    if (!res.ok) return { ok: false, error: res.error, tried: res.tried, code: 'ALL_FAILED' };

    const parsed = extractJson(res.text);
    if (!parsed || typeof parsed !== 'object') {
      stats.parseFails++;
      return { ok: false, error: 'model reply was not valid JSON', code: 'BAD_JSON', provider: res.provider, raw: res.text };
    }

    if (typeof validate === 'function') {
      const v = validate(parsed);
      if (!v.ok) {
        return { ok: false, error: v.error, code: v.code || 'INVALID', provider: res.provider, raw: res.text };
      }
      return { ok: true, decision: v.value, provider: res.provider };
    }
    return { ok: true, decision: parsed, provider: res.provider };
  }

  /** Plain-text generation (personality/chat), no JSON requirement. */
  async function chat({ system, user, temperature, maxTokens }) {
    const res = await generate({ system, user, temperature, maxTokens, json: false });
    if (!res.ok) return { ok: false, error: res.error };
    return { ok: true, text: res.text, provider: res.provider };
  }

  return {
    generate,
    decide,
    chat,
    providers,
    benched: () => Object.fromEntries(benched),
    active: () => active().map((p) => p.name),
    stats: () => ({
      calls: stats.calls,
      ok: stats.ok,
      failed: stats.failed,
      rotations: stats.rotations,
      parseFails: stats.parseFails,
      perProvider: JSON.parse(JSON.stringify(stats.perProvider)),
    }),
  };
}

module.exports = { createOrchestrator, buildProviders, defaultMockRules };