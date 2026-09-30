'use strict';
/**
 * decision_engine.js — the real "AI plays the game" loop.
 *
 *   observe (real world)  ->  LLM decides (JSON)  ->  governor veto  ->  execute (mineflayer)
 *
 * This is deliberately the ONLY producer of gameplay actions. If there is no
 * LLM decision, nothing happens — which is the property that distinguishes
 * this from a rule-based bot wearing an LLM personality.
 */

const { observe } = require('./observer');
const { createProvider } = require('../llm/provider');
const { createExecutor } = require('./action_executor');
const { createGovernor } = require('./governor');

function createDecisionEngine(opts = {}) {
  const {
    bot,
    settings = {},
    logger = { info() {}, warn() {}, error() {}, debug() {} },
    bus = null,
    provider: injectedProvider = null,
    executor: injectedExecutor = null,
    governor: injectedGovernor = null,
  } = opts;

  const provider =
    injectedProvider ||
    createProvider({
      apiKey: opts.apiKey || process.env.GEMINI_API_KEY,
      model: settings.llm?.geminiModel || process.env.GEMINI_MODEL || 'gemini-3.5-flash',
      temperature: settings.llm?.temperature ?? 0.6,
      maxTokens: settings.llm?.maxTokens ?? 400,
      logger,
    });

  const executor = injectedExecutor || createExecutor({ logger, settings });
  const governor = injectedGovernor || createGovernor({ settings });

  const stats = {
    ticks: 0,
    decided: 0,
    executed: 0,
    vetoed: 0,
    llmFailed: 0,
    execFailed: 0,
  };

  let lastDecision = null;
  let lastSnapshot = null;

  /** One full decision tick. */
  async function tick(trigger = 'cadence') {
    stats.ticks++;
    const started = Date.now();

    // 1) observe the real world
    const snapshot = observe(bot, { scanRadius: 12, entityRadius: 16 });
    lastSnapshot = snapshot;

    // 2) ask the model
    const res = await provider.decide({
      ...snapshot,
      _trigger: trigger,
    });
    if (!res.ok) {
      stats.llmFailed++;
      logger.warn('no decision (llm unavailable)', { error: res.error, code: res.code });
      return { ok: false, stage: 'llm', error: res.error, code: res.code };
    }
    stats.decided++;
    const decision = res.decision;

    // 3) governor
    const verdict = governor.review(bot, decision, snapshot);
    if (!verdict.allowed) {
      stats.vetoed++;
      logger.warn('decision vetoed', { action: decision.action, rule: verdict.rule, reason: verdict.reason });
      bus?.emit('decision_vetoed', { decision, verdict });
      return { ok: false, stage: 'governor', decision, verdict };
    }

    // 4) execute for real
    const exec = await executor.execute(bot, decision);
    if (exec.ok) {
      stats.executed++;
    } else {
      stats.execFailed++;
    }
    lastDecision = { decision, exec, at: Date.now() };

    const rec = {
      ok: exec.ok,
      action: decision.action,
      target: decision.target,
      reason: decision.reason,
      confidence: decision.confidence,
      detail: exec.detail,
      error: exec.error,
      ms: Date.now() - started,
    };
    logger.info('decision', {
      action: rec.action,
      reason: rec.reason,
      conf: rec.confidence,
      result: exec.ok ? (exec.detail || 'ok') : `failed: ${exec.error}`,
    });
    bus?.emit('decision_executed', rec);
    return rec;
  }

  return {
    tick,
    provider,
    executor,
    governor,
    stats: () => ({ ...stats, ...provider.stats() }),
    lastDecision: () => lastDecision,
    lastSnapshot: () => lastSnapshot,
  };
}

module.exports = { createDecisionEngine };
