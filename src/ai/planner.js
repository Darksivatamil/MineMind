'use strict';
/**
 * planner.js — Layer 3: goal setting and step tracking.
 *
 * Without a planner, the model answers "what now?" in isolation every few
 * seconds and drifts — it starts mining, forgets, wanders, never builds
 * anything. A planner gives it a spine:
 *
 *   goal: "get a wooden pickaxe"
 *     step 1: mine 3 oak_log      (done when logs >= 3)
 *     step 2: craft planks        (done when planks >= 4)
 *     step 3: craft wooden_pickaxe(done when pickaxe in inventory)
 *
 * Steps are declared with a machine-checkable `doneWhen` so progress is
 * verified against the real world, not the model's optimism. The planner only
 * asks the LLM for a NEW goal when idle or when the current one is finished —
 * which keeps LLM cost low (a goal every few minutes, not every tick).
 */

const { extractJson } = require('../llm/util');

const PLANNER_SYSTEM = `You set goals for a Minecraft bot that plays like a human.

Given what it currently has and what it knows, propose ONE concrete goal broken
into 2-4 steps that the bot can actually perform with these actions:
mine, dig, gather, craft, equip, place, build, explore, goto, sleep, eat, attack, flee, talk.

Reply with ONLY JSON:
{"goal":"<short objective>","steps":[{"action":"<verb>","target":<string|null>,"doneWhen":{"kind":"inventory","item":"<item>","count":<n>}}]}

"doneWhen" must be machine-checkable. Choose from:
- {"kind":"inventory","item":"<item name>","count":<n>}  -> has N of item
- {"kind":"blocks","block":"<block name>","count":<n>}   -> N of that block nearby
- {"kind":"explored","blocks":<n>}                        -> walked N blocks total
- {"kind":"hostile_killed","mob":"<mob name>"}             -> that mob is dead
- {"kind":"always"}                                       -> step completes when attempted

Give sensible early-game goals when starting empty (get wood -> planks -> tools -> stone -> shelter).`;

const DONE_KINDS = new Set(['inventory', 'blocks', 'explored', 'hostile_killed', 'always']);

function createPlanner(opts = {}) {
  const { orchestrator, memory, logger = { info() {}, warn() {}, error() {} }, cfg = {} } = opts;
  const state = {
    goalsCreated: 0,
    goalsCompleted: 0,
    goalsAbandoned: 0,
    stepAdvances: 0,
    llmCalls: 0,
    current: null,
    lastResult: null,
  };

  const minIdleTicks = cfg.minIdleTicks ?? 8;
  let idleTicks = 0;

  /** Verify a step's completion against the real world. */
  function stepDone(step, bot, snapshot) {
    const w = step.doneWhen || { kind: 'always' };
    switch (w.kind) {
      case 'inventory': {
        try {
          const it = bot.inventory.items().find((i) => i.name === w.item);
          return !!it && it.count >= (w.count ?? 1);
        } catch {
          return false;
        }
      }
      case 'blocks': {
        const b = (snapshot?.nearbyBlocks || []).find((x) => x.name === w.block);
        return !!b && b.count >= (w.count ?? 1);
      }
      case 'explored': {
        const p = memory?.lastKnownPos?.();
        const d = state.exploreAnchor;
        if (!p || !d) return false;
        return Math.hypot(p.x - d.x, p.z - d.z) >= (w.blocks ?? 20);
      }
      case 'hostile_killed': {
        try {
          return !Object.values(bot.entities).some((e) => e?.name === w.mob && e.position?.distanceTo(bot.entity.position) < 24);
        } catch {
          return false;
        }
      }
      case 'always':
        return true;
      default:
        return false;
    }
  }

  /** Validate the model's goal JSON before trusting it. */
  function validateGoal(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const text = typeof raw.goal === 'string' ? raw.goal.slice(0, 120) : null;
    if (!text) return null;
    const steps = Array.isArray(raw.steps) ? raw.steps.slice(0, 4) : [];
    const clean = steps
      .filter((s) => s && typeof s.action === 'string')
      .map((s) => ({
        action: s.action.slice(0, 24),
        target: s.target == null ? null : String(s.target).slice(0, 40),
        doneWhen: s.doneWhen && DONE_KINDS.has(s.doneWhen.kind) ? s.doneWhen : { kind: 'always' },
        done: false,
      }));
    if (!clean.length) return null;
    return { text, steps: clean, createdAt: Date.now(), anchor: memory?.lastKnownPos?.() || null };
  }

  /**
   * Called every tick before the model chooses. Advances the plan if possible;
   * asks for a new goal only when idle or finished.
   */
  function maybeAdvance(bot, snapshot, trigger) {
    idleTicks++;
    const g = state.current;

    // no goal yet -> maybe create one
    if (!g) {
      if (idleTicks < minIdleTicks) return null;
      return requestGoal(bot, snapshot, trigger);
    }

    // check the active step
    const step = g.steps.find((s) => !s.done);
    if (!step) {
      state.goalsCompleted++;
      state.lastResult = { goal: g.text, outcome: 'completed' };
      logger.info('goal completed', { goal: g.text });
      memory?.completeGoal?.('completed');
      state.current = null;
      idleTicks = minIdleTicks; // immediately think about the next one
      return requestGoal(bot, snapshot, trigger);
    }

    if (stepDone(step, bot, snapshot)) {
      step.done = true;
      state.stepAdvances++;
      logger.info('plan step done', { goal: g.text, step: step.action, remaining: g.steps.filter((s) => !s.done).length });
    }
    return step;
  }

  /** Ask the LLM for a new goal. */
  async function requestGoal(bot, snapshot, trigger) {
    idleTicks = 0;
    const has = snapshot?.inventory;
    const known = memory?.knowledgeSummary?.();
    const user =
      `CURRENT INVENTORY: ${has ? JSON.stringify({ food: has.food, tools: has.tools, blocks: has.blocks, hasBed: has.hasBed, hasCraftingTable: has.hasCraftingTable }) : 'unknown'}\n` +
      `NEARBY BLOCKS: ${JSON.stringify((snapshot?.nearbyBlocks || []).slice(0, 6))}\n` +
      `NIGHT: ${snapshot?.time?.isNight ? 'yes' : 'no'}   HEALTH: ${snapshot?.self?.health}\n` +
      `PLACES VISITED: ${known?.placesVisited ?? 0}\n` +
      `PAST FAILURES: ${JSON.stringify(known?.failed || [])}\n` +
      `Give the next goal.`;

    state.llmCalls++;
    const res = await orchestrator.decide({
      system: PLANNER_SYSTEM,
      user,
      validate: (raw) => {
        const goal = validateGoal(raw);
        return goal ? { ok: true, value: goal } : { ok: false, error: 'malformed goal', code: 'BAD_GOAL' };
      },
      temperature: 0.6,
      maxTokens: 500,
    });

    if (!res.ok) {
      logger.warn('planner could not set a goal', { error: res.error });
      state.current = fallbackGoal(bot);
      idleTicks = 0;
      return state.current;
    }

    state.current = res.decision;
    state.goalsCreated++;
    memory?.setGoal?.(res.decision);
    logger.info('new goal', { goal: res.decision.text, steps: res.decision.steps.map((s) => s.action).join(' > ') });
    return state.current;
  }

  /** A safe default goal chain used when the LLM can't plan. */
  function fallbackGoal(bot) {
    const inv = bot?.inventory?.items?.().map((i) => i.name) || [];
    const hasPick = inv.some((n) => /pickaxe/.test(n));
    const hasWood = inv.some((n) => /log/.test(n));
    const goal = hasPick
      ? { text: 'gather stone and upgrade', steps: [{ action: 'mine', target: 'stone', doneWhen: { kind: 'blocks', block: 'stone', count: 8 }, done: false }] }
      : hasWood
        ? { text: 'craft a pickaxe', steps: [{ action: 'craft', target: 'planks', doneWhen: { kind: 'inventory', item: 'planks', count: 4 }, done: false }, { action: 'craft', target: 'wooden_pickaxe', doneWhen: { kind: 'inventory', item: 'wooden_pickaxe', count: 1 }, done: false }] }
        : { text: 'gather wood', steps: [{ action: 'mine', target: 'oak_log', doneWhen: { kind: 'inventory', item: 'oak_log', count: 3 }, done: false }] };
    goal.createdAt = Date.now();
    state.goalsCreated++;
    memory?.setGoal?.(goal);
    return goal;
  }

  /** The plan block shown to the action model. */
  function planView() {
    const g = state.current;
    if (!g) return null;
    return {
      goal: g.text,
      step: g.steps.findIndex((s) => !s.done) + 1,
      total: g.steps.length,
      steps: g.steps.map((s) => `${s.done ? '[x]' : '[ ]'} ${s.action}${s.target ? `:${s.target}` : ''}`),
    };
  }

  function noteSuccess(action) {
    /* planner advances via maybeAdvance; kept for symmetry + stats */
  }
  function noteFailure(action) {
    /* failure stats are captured by memory */
  }

  function setGoal(g) {
    state.current = validateGoal(g) || g;
  }

  function clear() {
    state.current = null;
    idleTicks = 0;
  }

  function stats() {
    return {
      goalsCreated: state.goalsCreated,
      goalsCompleted: state.goalsCompleted,
      goalsAbandoned: state.goalsAbandoned,
      stepAdvances: state.stepAdvances,
      llmCalls: state.llmCalls,
      current: state.current ? state.current.text : null,
    };
  }

  return { maybeAdvance, requestGoal, planView, setGoal, clear, stats, validateGoal, fallbackGoal, stepDone, _state: state };
}

module.exports = { createPlanner, PLANNER_SYSTEM };