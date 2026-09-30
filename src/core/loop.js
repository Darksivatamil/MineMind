'use strict';
/**
 * loop.js — the decision tick scheduler (PLAN.md §1).
 *
 * Responsibilities (real, not decorative):
 *   - cadence timer        -> a tick every `loop.decisionIntervalMs`
 *   - salient event queue  -> bot/agent events (bus) request an *early* tick
 *   - global rate limit    -> never more than `loop.decisionsPerMinute` LLM calls
 *   - exactly-on-one-inflight -> ticks are serialised; overlapping requests coalesce
 *
 * The loop NEVER invents gameplay. It only schedules calls into an injected
 * `handler` (wired in main.js = observe -> LLM -> validate -> governor -> execute).
 * With no handler, every tick is recorded as `skipped: no handler` — which is
 * exactly the anti-fake property: no decision source, no gameplay.
 *
 * handler: async ({ trigger, payload }) => any   (may throw; the loop catches)
 */

const { TRIGGERS, PRIORITY } = require('./triggers');

const DEFAULT_INTERVAL_MS = 5000;
const DEFAULT_DECISIONS_PER_MINUTE = 12;

function createLoop(opts = {}) {
  const {
    settings = {},
    bus = null,
    logger = { info() {}, warn() {}, error() {}, debug() {} },
    handler = null,
    intervalMs = settings.loop?.decisionIntervalMs ?? DEFAULT_INTERVAL_MS,
    decisionsPerMinute = settings.loop?.decisionsPerMinute ?? DEFAULT_DECISIONS_PER_MINUTE,
    clock = () => Date.now(),
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  } = opts;

  // At most 1 LLM decision per `minGapMs`. For dpm=12 this is a 5000 ms floor,
  // which is also the cadence — so cadence ticks never burst, and event ticks
  // wait for the next budget slot instead of doubling the call rate.
  const dpm = Number(decisionsPerMinute) > 0 ? Number(decisionsPerMinute) : DEFAULT_DECISIONS_PER_MINUTE;
  const minGapMs = Math.max(0, Math.round(60000 / dpm));

  let running = false;
  let timer = null;
  let cadenceTimer = null;
  let inflight = false;
  let pending = null; // { trigger, payload, priority, at }
  let lastDecisionAt = -Infinity;
  let timerDueAt = Infinity; // when the cadence timer next fires

  const stats = {
    ticks: 0,
    handled: 0,
    failed: 0,
    skippedNoHandler: 0,
    rateLimited: 0,
    coalesced: 0,
    byTrigger: Object.create(null),
  };

  // --- bus wiring: salient events ask for an early tick -------------------
  const unsubscribes = [];
  if (bus && typeof bus.on === 'function') {
    for (const trigger of Object.values(TRIGGERS)) {
      if (trigger === TRIGGERS.CADENCE) continue; // cadence is timer-driven
      unsubscribes.push(bus.on(trigger, (payload) => request(trigger, payload)));
    }
  }

  function noteTrigger(trigger) {
    stats.byTrigger[trigger] = (stats.byTrigger[trigger] || 0) + 1;
  }

  /**
   * Request a decision tick. Coalesces: if a tick is already pending or a tick
   * is already running, the highest-priority trigger wins and we keep that
   * trigger's payload. Returns true if this call created a fresh pending tick.
   */
  function request(trigger, payload) {
    if (!running) return false;
    noteTrigger(trigger);
    const priority = PRIORITY[trigger] ?? 0;
    const now = clock();
    const item = { trigger, payload, priority, at: now };

    if (inflight || pending) {
      stats.coalesced++;
      pending = pickStronger(pending, item);
      return false;
    }

    pending = item;
    scheduleDue(0);
    return true;
  }

  function pickStronger(current, candidate) {
    if (!current) return candidate;
    // Critical threats preempt; otherwise the earlier requester keeps its slot.
    if (candidate.priority > current.priority) return candidate;
    return current;
  }

  /** Ask the next tick to run as soon as both the queue and the rate budget allow. */
  function scheduleDue(delayMs) {
    if (timer) {
      clearTimeoutFn(timer);
      timer = null;
    }
    const budgetAt = lastDecisionAt + minGapMs;
    const wakeAt = Math.max(clock() + Math.max(0, delayMs), budgetAt);
    timerDueAt = wakeAt;
    timer = setTimeoutFn(() => {
      timer = null;
      void drain();
    }, Math.max(0, wakeAt - clock()));
    // Do NOT unref: the decision loop is the process's reason to stay alive.
  }

  /** Cadence heartbeat: fires a cadence trigger, then re-arms itself. */
  function scheduleCadence() {
    if (cadenceTimer) {
      clearTimeoutFn(cadenceTimer);
      cadenceTimer = null;
    }
    cadenceTimer = setTimeoutFn(() => {
      cadenceTimer = null;
      if (!running) return;
      request(TRIGGERS.CADENCE, { source: 'cadence' });
      scheduleCadence();
    }, Math.max(0, intervalMs));
  }

  async function drain() {
    if (inflight || !pending) return;
    const item = pending;
    pending = null;

    const now = clock();
    if (now - lastDecisionAt < minGapMs) {
      stats.rateLimited++;
      logger.debug('loop: rate limited, deferring tick', { trigger: item.trigger });
      pending = item; // keep it queued for the next budget slot
      scheduleDue(minGapMs - (now - lastDecisionAt));
      return;
    }

    inflight = true;
    lastDecisionAt = now;
    stats.ticks++;
    try {
      if (!handler) {
        stats.skippedNoHandler++;
        logger.warn('loop: tick with no decision handler — no action taken', { trigger: item.trigger });
      } else {
        await handler({ trigger: item.trigger, payload: item.payload });
        stats.handled++;
      }
    } catch (err) {
      stats.failed++;
      logger.error('loop: decision handler threw', { trigger: item.trigger, error: err && err.message });
    } finally {
      inflight = false;
      // Cadence re-arms itself; if a tick is still queued (e.g. coalesced while
      // running) make sure it fires at the next budget slot.
      if (running && pending) scheduleDue(0);
    }
  }

  function start() {
    if (running) return false;
    running = true;
    lastDecisionAt = -Infinity;
    scheduleCadence();
    logger.info('loop started', { intervalMs, decisionsPerMinute: dpm });
    return true;
  }

  function stop() {
    running = false;
    if (timer) {
      clearTimeoutFn(timer);
      timer = null;
    }
    if (cadenceTimer) {
      clearTimeoutFn(cadenceTimer);
      cadenceTimer = null;
    }
    pending = null;
    timerDueAt = Infinity;
    logger.info('loop stopped', { ticks: stats.ticks, handled: stats.handled });
    return true;
  }

  return {
    start,
    stop,
    request,
    /** Force the queued tick to run now (used by tools/tests); respects the budget. */
    async flush() {
      if (timer) {
        clearTimeoutFn(timer);
        timer = null;
      }
      await drain();
    },
    isRunning: () => running,
    isIdle: () => !inflight && !pending,
    nextTickAt: () => timerDueAt,
    minGapMs,
    intervalMs,
    decisionsPerMinute: dpm,
    stats: () => ({ ...stats, byTrigger: { ...stats.byTrigger } }),
    hasHandler: () => typeof handler === 'function',
    setHandler(fn) {
      handler = fn;
    },
    dispose() {
      stop();
      for (const u of unsubscribes) {
        try {
          u();
        } catch { /* ignore */ }
      }
      unsubscribes.length = 0;
    },
  };
}

module.exports = { createLoop, DEFAULT_INTERVAL_MS, DEFAULT_DECISIONS_PER_MINUTE };
