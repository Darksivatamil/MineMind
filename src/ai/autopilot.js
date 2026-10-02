'use strict';
/**
 * autopilot.js — the "AI plays the game" brain.
 *
 * Three layers, fastest wins first. This is the structural difference from a
 * rule-based bot:
 *
 *   LAYER 1  REFLEX    (0 ms,    deterministic) — dodge lava, eat at 3 hp,
 *                                          jump a creeper. Cannot be talked
 *                                          out of it by a hallucinating model.
 *   LAYER 2  AUTOPILOT (LLM)    — the model picks the action, using the world
 *                                 snapshot + its own memory + the current goal.
 *   LAYER 3  PLANNER   (LLM)    — when idle, the model sets a multi-step goal
 *                                 and the autopilot advances it step by step.
 *
 * Crucially: the LLM owns goal selection and action choice. Reflexes only
 * override for a handful of "you are about to die" cases, and they are logged
 * as such. Without an LLM the bot still breathes (mock fallback) but never
 * invents an action the model didn't sanction.
 */

const { observe } = require('./observer');
const { createOrchestrator } = require('../llm/orchestrator');
const { ACTIONS, ACTION_NAMES, describeActions, isKnownAction } = require('../llm/schema');
const { createPlanner } = require('./planner');
const { createReflex } = require('./reflex');
const { createVerifier } = require('./verifier');

const ACTION_SYSTEM = `You are AGNES, a skilled Minecraft player who acts like a human player.

You receive the world state, what you remember, and your current plan.
Choose ONE next action to take right now.

Reply with ONLY JSON, no prose, no markdown:
{"action":"<verb>","target":<string|null>,"reason":"<max 12 words>","confidence":<number 0..1>}

Available actions:
${describeActions()}

How to choose (human priorities, in order):
1. Stay alive: if health or food is low, or a hostile is on top of you, deal with it FIRST.
2. Progress the plan: if you have a plan and a step is doable now, do that step.
3. Gather what you need: mine, craft, equip. Get a pickaxe before mining ore.
4. Explore when idle to find new resources.
5. Chat occasionally to your owner.

"target" rules:
- mine -> the exact block name you saw in nearbyBlocks (e.g. "iron_ore")
- craft/equip -> the exact item name from crafting.canCraft or inventory
- attack/flee -> the mob name, or null for "nearest"
- explore -> a direction from movement.clear, or null
- talk -> the sentence to say
- otherwise -> null

Only use actions and targets that actually appear in the world state. Never invent a block, item, or mob that is not listed.`;

function createAutopilot(opts = {}) {
  const {
    bot,
    settings = {},
    logger = { info() {}, warn() {}, error() {}, debug() {} },
    memory,
    executor,
    governor,
    orchestrator: injectedOrch = null,
    planner: injectedPlanner = null,
    reflex: injectedReflex = null,
    verifier: injectedVerifier = null,
    llmCfg = {},
  } = opts;

  const orchestrator =
    injectedOrch ||
    createOrchestrator({
      cfg: settings.llm || {},
      env: process.env,
      logger,
    });

  const planner = injectedPlanner || createPlanner({ orchestrator, memory, logger, cfg: settings.planner || {} });
  const reflex = injectedReflex || createReflex({ logger, cfg: settings.reflex || {} });
  const verifier = injectedVerifier || createVerifier({ logger, config: settings.verifier || {} });

  const state = {
    ticks: 0,
    bySource: { reflex: 0, autopilot: 0, mock: 0 },
    executed: 0,
    verified: 0,
    vetoed: 0,
    failed: 0,
    noDecision: 0,
    lastAction: null,
    lastProvider: null,
  };

  /** Compact prompt body: world + memory + plan. */
  function buildPrompt(snapshot, trigger) {
    const mem = memory ? memory.digest(600) : '{}';
    const plan = planner ? planner.planView() : null;
    return (
      `WORLD:\n${JSON.stringify(snapshot)}\n\n` +
      `WHAT YOU REMEMBER:\n${mem}\n\n` +
      `YOUR PLAN:\n${plan ? JSON.stringify(plan) : 'none — pick your own objective'}\n\n` +
      `TRIGGER: ${trigger}\n` +
      `Choose one action now.`
    );
  }

  /** Validate a model decision against the vocabulary. */
  function validateDecision(raw) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'not an object', code: 'SHAPE' };
    const action = raw.action;
    if (!isKnownAction(action)) return { ok: false, error: `unknown action "${action}"`, code: 'BAD_ACTION' };
    const conf = Number(raw.confidence);
    return {
      ok: true,
      value: {
        action,
        target: raw.target == null ? null : String(raw.target).slice(0, 80),
        reason: typeof raw.reason === 'string' ? raw.reason.slice(0, 160) : '',
        confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
      },
    };
  }

  /**
   * One autopilot tick. Order matters: reflex first (survival), then LLM.
   * @param trigger string describing why we woke up
   */
  async function tick(trigger = 'cadence') {
    state.ticks++;
    const started = Date.now();

    let snapshot;
    try {
      snapshot = observe(bot, { scanRadius: settings.observer?.scanRadius ?? 8, entityRadius: 16 });
    } catch (err) {
      logger.warn('observer failed', { error: err.message });
      return { ok: false, stage: 'observe', error: err.message };
    }

    if (memory) {
      memory.setLastPos(bot.entity.position);
      memory.recordPlace(snapshot.self.pos, {
        biomes: null,
        biome: snapshot.environment?.biome,
        hostiles: snapshot.hostiles,
        ores: Object.fromEntries((snapshot.nearbyBlocks || []).map((b) => [b.name, b.count])),
      });
    }

    // ---- LAYER 1: reflex (survival overrides the model) ----------------
    const r = reflex.check(bot, snapshot);
    let decision = null;
    let source = 'autopilot';

    if (r.fire) {
      decision = r.decision;
      source = 'reflex';
      logger.warn('reflex override', { trigger: r.rule, action: decision.action });
    } else {
      // ---- LAYER 3: plan maintenance, then LAYER 2: choose -------------
      if (planner && planner.maybeAdvance) planner.maybeAdvance(bot, snapshot, trigger);

      const res = await orchestrator.decide({
        system: ACTION_SYSTEM,
        user: buildPrompt(snapshot, trigger),
        validate: validateDecision,
        temperature: settings.llm?.temperature ?? 0.5,
        maxTokens: settings.llm?.maxTokens ?? 300,
      });

      if (!res.ok) {
        state.noDecision++;
        logger.warn('no decision from any provider', { error: res.error, tried: res.tried });
        return { ok: false, stage: 'llm', error: res.error };
      }
      decision = res.decision;
      state.lastProvider = res.provider;
      if (res.provider === 'mock') {
        source = 'mock';
        state.bySource.mock++;
      }
    }

    state.lastAction = decision;

    // ---- governor (veto unsafe, repair un-executable) --------------------
    const verdict = governor.review(bot, decision, snapshot);
    if (!verdict.allowed) {
      state.vetoed++;
      logger.warn('vetoed', { action: decision.action, rule: verdict.rule, reason: verdict.reason });
      if (memory) memory.recordFailure(decision.action, decision.target, verdict.reason);
      if (planner && planner.noteFailure) planner.noteFailure(decision.action);
      return { ok: false, stage: 'governor', decision, verdict };
    }
    if (verdict.repaired && verdict.decision) {
      logger.info('repaired decision', {
        from: `${decision.action}:${decision.target ?? '-'}`,
        to: `${verdict.decision.action}:${verdict.decision.target ?? '-'}`,
        rule: verdict.rule,
      });
      decision = verdict.decision;
    }

    // ---- execute + verify ----------------------------------------------
    // Fingerprint the world before and after so we can prove the action did
    // something, rather than trusting the executor's own claim.
    const before = verifier ? verifier.fingerprint(bot, snapshot) : null;
    const exec = await executor.execute(bot, decision);
    const durationMs = Date.now() - started;
    const after = verifier ? verifier.fingerprint(bot, null) : null;
    const proof = verifier && before && after ? verifier.verify(decision, exec, before, after) : null;

    if (exec.ok) {
      state.executed++;
      state.bySource[source] = (state.bySource[source] || 0) + 1;
      if (proof) {
        state.verified += proof.verified ? 1 : 0;
        if (!proof.verified) {
          // The executor said ok but the world disagrees: treat it as a real
          // failure so memory learns not to repeat this approach.
          state.failed++;
          if (memory) {
            memory.recordEpisode({ action: decision.action, target: decision.target, ok: false, error: `unverified: ${proof.note}`, snapshot, durationMs, reason: decision.reason });
            memory.recordFailure(decision.action, decision.target, proof.note);
          }
          if (planner && planner.noteFailure) planner.noteFailure(decision.action);
          logger.warn('action unverified', { action: decision.action, note: proof.note });
        }
      }
      if (memory && (!proof || proof.verified)) {
        memory.recordEpisode({ action: decision.action, target: decision.target, ok: true, detail: exec.detail, snapshot, durationMs, reason: decision.reason });
        if (source !== 'reflex') memory.promote(decision.action, decision.target);
      }
      if (planner && planner.noteSuccess) planner.noteSuccess(decision.action);
    } else {
      state.failed++;
      if (memory) {
        memory.recordEpisode({ action: decision.action, target: decision.target, ok: false, error: exec.error, snapshot, durationMs, reason: decision.reason });
        memory.recordFailure(decision.action, decision.target, exec.error);
      }
      if (planner && planner.noteFailure) planner.noteFailure(decision.action);
    }

    const rec = {
      ok: exec.ok && (!proof || proof.verified),
      source,
      provider: state.lastProvider,
      action: decision.action,
      target: decision.target,
      reason: decision.reason,
      confidence: decision.confidence,
      detail: exec.detail,
      error: exec.error,
      verified: proof ? proof.verified : null,
      verifyNote: proof ? proof.note : null,
      durationMs,
    };
    logger.info('act', {
      action: rec.action,
      target: rec.target || undefined,
      via: source,
      ok: rec.ok,
      verified: rec.verified,
      detail: rec.detail || rec.error,
      ms: durationMs,
    });
    return rec;
  }

  function stats() {
    return {
      ticks: state.ticks,
      bySource: { ...state.bySource },
      executed: state.executed,
      verified: state.verified,
      vetoed: state.vetoed,
      failed: state.failed,
      noDecision: state.noDecision,
      lastAction: state.lastAction,
      lastProvider: state.lastProvider,
      llm: orchestrator.stats(),
      planner: planner ? planner.stats() : null,
    };
  }

  return { tick, stats, orchestrator, planner, reflex, verifier, validateDecision, ACTIONS, ACTION_NAMES };
}

module.exports = { createAutopilot, ACTION_SYSTEM };