'use strict';
/**
 * reflex.js — Layer 1: instant survival reactions.
 *
 * These are the ONLY hardcoded decisions in the bot, and they are deliberately
 * tiny and life-or-death only. Rationale:
 *
 *   - An LLM round-trip takes 1-5 seconds. A creeper at 2 blocks, lava under
 *     your feet, or 2 hp remaining cannot wait that long.
 *   - Reflexes are checked BEFORE the model, so a hallucinating model cannot
 *     talk the bot out of jumping away from lava.
 *   - Everything a reflex does is logged with source='reflex', so you can see
 *     exactly which decisions were NOT the AI's.
 *
 * Everything non-urgent goes to the model. If you delete this file the bot
 * still plays — it just dies occasionally instead of instantly.
 */

const DEFAULT_CFG = {
  enabled: true,
  /** HP at or below which eating becomes automatic. */
  eatAtHealth: 6,
  /** Food at or below which eating becomes automatic. */
  eatAtFood: 12,
  /** Hostile within this many blocks triggers auto-fight rather than waiting. */
  autoFightWithin: 3.2,
  /** Never auto-fight above this HP (let the planner handle it calmly). */
  fightMinHealth: 8,
  /** Creeper closer than this = run. */
  creeperPanic: 5,
  /** Blocks below that we consider ourselves falling into the void. */
  voidY: -50,
  /** Health lost in one hit that triggers an emergency eat. */
  panicDrop: 4,
};

function createReflex(opts = {}) {
  const cfg = { ...DEFAULT_CFG, ...(opts.cfg || {}) };
  const logger = opts.logger || { info() {}, warn() {}, error() {}, debug() {} };

  let lastHealth = null;

  /**
   * @returns {{fire:boolean, decision?:object, rule?:string, why?:string}}
   */
  function check(bot, snapshot) {
    if (!cfg.enabled) return { fire: false };
    const self = snapshot?.self || {};
    const hp = self.health;
    const food = self.food;
    const inv = snapshot?.inventory;
    const hostiles = snapshot?.hostiles || [];
    const haz = snapshot?.hazards || [];

    // 1) standing in lava / falling into the void -> get out
    if (haz.some((h) => h.type === 'lava_below')) {
      return { fire: true, rule: 'lava_below', decision: { action: 'flee', target: null, reason: 'reflex: lava beneath me', confidence: 1 } };
    }
    if (typeof self.pos?.y === 'number' && self.pos.y < cfg.voidY) {
      return { fire: true, rule: 'void', decision: { action: 'idle', target: null, reason: 'reflex: above the void, do not move', confidence: 1 } };
    }

    // 2) hurt badly -> eat if we have food, else disengage
    const hurtBadly = lastHealth != null && hp != null && lastHealth - hp >= cfg.panicDrop;
    const dying = hp != null && hp <= cfg.eatAtHealth;
    const starving = food != null && food <= cfg.eatAtFood;
    if ((dying || starving || hurtBadly) && inv?.food?.length) {
      if (dying || starving || hurtBadly) {
        lastHealth = hp;
        return {
          fire: true,
          rule: hurtBadly ? 'panic_drop' : starving ? 'starving' : 'low_health',
          decision: { action: 'eat', target: inv.food[0][0], reason: `reflex: ${dying ? 'low hp' : starving ? 'starving' : 'just took damage'}`, confidence: 1 },
        };
      }
    }
    if (dying && !inv?.food?.length && hostiles.length) {
      return { fire: true, rule: 'dying_no_food', decision: { action: 'flee', target: hostiles[0].name, reason: 'reflex: too hurt to fight', confidence: 1 } };
    }

    // 3) creeper about to blow -> run
    const creeper = hostiles.find((h) => h.name === 'creeper' && h.dist <= cfg.creeperPanic);
    if (creeper) {
      return { fire: true, rule: 'creeper', decision: { action: 'flee', target: 'creeper', reason: 'reflex: creeper too close', confidence: 1 } };
    }

    // 4) mob in our face and we're healthy -> swing back, don't be a punching bag
    const adjacent = hostiles.find((h) => h.dist <= cfg.autoFightWithin);
    if (adjacent && hp != null && hp >= cfg.fightMinHealth) {
      return { fire: true, rule: 'adjacent_hostile', decision: { action: 'attack', target: adjacent.name, reason: `reflex: ${adjacent.name} is on me`, confidence: 0.95 } };
    }

    // track health for next tick's panic detection
    lastHealth = hp;
    return { fire: false };
  }

  return { check, config: cfg };
}

module.exports = { createReflex, DEFAULT_CFG };