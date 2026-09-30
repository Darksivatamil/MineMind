'use strict';
/**
 * triggers.js — the closed vocabulary of decision-tick triggers (PLAN.md §1)
 * plus their scheduling priority. A trigger only ever *asks* for a tick;
 * it never chooses an action.
 *
 * Priority ordering (higher wins when several triggers coalesce):
 *   health_drop / action_failed   — the world changed under us
 *   threat_near / hunger_critical — pressing survival pressure
 *   chat_message / goal_complete  — conversational / objective
 *   cadence                       — background thinking
 */

const TRIGGERS = Object.freeze({
  CADENCE: 'cadence',
  HEALTH_DROP: 'health_drop',
  THREAT_NEAR: 'threat_near',
  HUNGER_CRITICAL: 'hunger_critical',
  CHAT_MESSAGE: 'chat_message',
  ACTION_FAILED: 'action_failed',
  GOAL_COMPLETE: 'goal_complete',
});

const PRIORITY = Object.freeze({
  [TRIGGERS.ACTION_FAILED]: 90,
  [TRIGGERS.HEALTH_DROP]: 80,
  [TRIGGERS.THREAT_NEAR]: 70,
  [TRIGGERS.HUNGER_CRITICAL]: 60,
  [TRIGGERS.GOAL_COMPLETE]: 40,
  [TRIGGERS.CHAT_MESSAGE]: 30,
  [TRIGGERS.CADENCE]: 10,
});

/** Thresholds used by main.js to decide *when* to fire a trigger. */
const TRIGGER_RULES = Object.freeze({
  /** fire `health_drop` when the bot lost at least this much hp at once */
  healthDropAmount: 2,
  /** fire `threat_near` when the closest hostile is within this many blocks */
  threatNearBlocks: 8,
  /** fire `hunger_critical` at or below this food level */
  hungerCriticalFood: 6,
});

module.exports = { TRIGGERS, PRIORITY, TRIGGER_RULES };
