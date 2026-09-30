'use strict';
/**
 * governor.js — safety rails between the model's decision and the executor.
 *
 * The model proposes; the governor disposes. A decision is vetoed (not
 * silently dropped) when it would endanger the bot or ignore hard limits, and
 * every veto is returned so it can be logged and learned from.
 */

const DEFAULT_CFG = {
  enabled: true,
  healthFloor: 6,
  yFloor: -59,
  minConfidence: 0.15,
  blockBlacklist: ['bedrock', 'lava', 'magma_block', 'nether_portal', 'end_portal'],
  protectOwner: true,
};

/** Actions that make no sense when the bot is in danger. */
const DANGER_ACTIONS = new Set(['mine', 'craft', 'place', 'gather', 'explore']);

function createGovernor(opts = {}) {
  const cfg = { ...DEFAULT_CFG, ...(opts.settings?.governor || {}), ...(opts.config || {}) };

  /**
   * @returns {{allowed:boolean, reason?:string, rule?:string}}
   */
  function review(bot, decision, snapshot) {
    if (!cfg.enabled) return { allowed: true };
    if (!decision || !decision.action) return { allowed: false, reason: 'empty decision', rule: 'shape' };

    // confidence floor
    if (typeof decision.confidence === 'number' && decision.confidence < cfg.minConfidence) {
      return {
        allowed: false,
        reason: `confidence ${decision.confidence} below floor ${cfg.minConfidence}`,
        rule: 'confidence',
      };
    }

    const hp = snapshot?.self?.health;
    const food = snapshot?.self?.food;
    const y = snapshot?.self?.pos?.y;

    // don't do risky things while nearly dead
    if (typeof hp === 'number' && hp <= cfg.healthFloor && DANGER_ACTIONS.has(decision.action)) {
      return { allowed: false, reason: `health ${hp} at/below floor ${cfg.healthFloor}`, rule: 'health' };
    }

    // never risk the void
    if (typeof y === 'number' && y < cfg.yFloor) {
      return { allowed: false, reason: `y=${y} below floor ${cfg.yFloor}`, rule: 'depth' };
    }

    // starving: eating takes priority over other work
    if (
      decision.action === 'eat' &&
      typeof food === 'number' &&
      food >= 18
    ) {
      return { allowed: false, reason: `food ${food} is not low`, rule: 'hunger' };
    }

    // blacklist: refuse to target/place known-lethal blocks
    if (decision.target) {
      const t = String(decision.target).toLowerCase();
      if (cfg.blockBlacklist.includes(t)) {
        return { allowed: false, reason: `target "${t}" is blacklisted`, rule: 'blocklist' };
      }
    }

    // never attack the owner
    if (decision.action === 'attack' && cfg.protectOwner) {
      const ownerName = bot?.ownerName || bot?._minemindOwner;
      const target = String(decision.target || '').toLowerCase();
      if (ownerName && target === String(ownerName).toLowerCase()) {
        return { allowed: false, reason: 'will not attack the owner', rule: 'protect_owner' };
      }
    }

    // adjacent lava / magma under us
    if (decision.action === 'explore' || decision.action === 'follow') {
      const haz = snapshot?.hazards || [];
      if (haz.some((h) => h.type === 'lava_below')) {
        return { allowed: false, reason: 'lava beneath the bot', rule: 'hazard' };
      }
    }

    return { allowed: true };
  }

  return { review, config: cfg };
}

module.exports = { createGovernor, DEFAULT_CFG };
