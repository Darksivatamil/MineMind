'use strict';
/**
 * governor.js — safety rails + self-repair between the model's decision and
 * the executor.
 *
 * The model proposes; the governor disposes. A veto is never silent — it is
 * returned, logged, and written to memory so the planner learns to avoid the
 * same dead end.
 *
 * Two jobs:
 *   1. VETO decisions that would kill the bot (low HP mining, the void,
 *      attacking the owner, lethal blocks, night-time wandering with no light).
 *   2. REPAIR decisions that are merely un-executable right now (craft with no
 *      table, mine an ore that isn't nearby) by rewriting them into the nearest
 *      sensible alternative — this is what stops the bot standing still while
 *      the model insists on an impossible action.
 */

const DEFAULT_CFG = {
  enabled: true,
  healthFloor: 6,
  yFloor: -59,
  minConfidence: 0.1,
  blockBlacklist: ['bedrock', 'lava', 'magma_block', 'nether_portal', 'end_portal', 'water', 'tnt'],
  protectOwner: true,
  /** Rewrite impossible actions instead of dropping them. */
  repair: true,
  /** Below this light at night, prefer retreat over wandering. */
  nightRetreat: true,
  /** Don't attack if the mob would win a straight fight (rough heuristic). */
  avoidPointlessFights: true,
};

const DANGER_WHILE_HURT = new Set(['mine', 'dig', 'craft', 'place', 'gather', 'build']);
const RISKY = new Set(['mine', 'dig', 'explore', 'goto', 'follow', 'flee', 'build', 'place']);

function createGovernor(opts = {}) {
  const cfg = { ...DEFAULT_CFG, ...(opts.settings?.governor || {}), ...(opts.config || {}) };

  /**
   * Review a decision. Returns {allowed, reason?, rule?, repaired?}.
   * `repaired` means the decision was rewritten to something legal.
   */
  function review(bot, decision, snapshot) {
    if (!cfg.enabled) return { allowed: true };
    if (!decision || !decision.action) return { allowed: false, reason: 'empty decision', rule: 'shape' };

    const hp = snapshot?.self?.health;
    const food = snapshot?.self?.food;
    const y = snapshot?.self?.pos?.y;
    const isNight = snapshot?.time?.isNight;
    const lowLight = snapshot?.environment?.light != null && snapshot?.environment?.light <= 7;

    // --- hard vetoes (safety beats curiosity) ---------------------------
    if (typeof y === 'number' && y < cfg.yFloor) {
      return { allowed: false, reason: `y=${y} below floor ${cfg.yFloor}`, rule: 'depth' };
    }
    if (typeof hp === 'number' && hp <= 3 && DANGER_WHILE_HURT.has(decision.action)) {
      return { allowed: false, reason: `health ${hp} critically low`, rule: 'health_critical' };
    }
    if (typeof hp === 'number' && hp <= cfg.healthFloor && DANGER_WHILE_HURT.has(decision.action)) {
      return { allowed: false, reason: `health ${hp} at/below floor ${cfg.healthFloor}`, rule: 'health' };
    }
    if (typeof decision.confidence === 'number' && decision.confidence < cfg.minConfidence) {
      return { allowed: false, reason: `confidence ${decision.confidence} below floor ${cfg.minConfidence}`, rule: 'confidence' };
    }

    // never eat when not hungry (wastes food)
    if (decision.action === 'eat' && typeof food === 'number' && food >= 18 && !(hp <= 8)) {
      return { allowed: false, reason: `food ${food} is not low`, rule: 'hunger' };
    }

    // never target lethal blocks
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
      // and never attack a player at all by name
      if (target && snapshot?.players?.some((p) => String(p.username).toLowerCase() === target)) {
        return { allowed: false, reason: `will not attack player "${target}"`, rule: 'no_pvp' };
      }
    }

    // walking over lava / into the void
    if (decision.action === 'explore' || decision.action === 'goto' || decision.action === 'follow') {
      if ((snapshot?.hazards || []).some((h) => h.type === 'lava_below')) {
        return { allowed: false, reason: 'lava beneath the bot', rule: 'hazard' };
      }
    }

    // --- repairs (keep the bot moving instead of idling) -----------------
    if (cfg.repair) {
      // craft with nothing craftable nearby -> go get materials instead
      if (decision.action === 'craft' && !(snapshot?.crafting?.canCraft || []).length) {
        const need = decision.target && /log/.test(String(decision.target)) ? decision.target : 'oak_log';
        return {
          allowed: true,
          repaired: true,
          reason: 'craft not possible yet; gathering materials first',
          rule: 'repair_craft',
          decision: { ...decision, action: 'mine', target: need, reason: 'need materials to craft' },
        };
      }
      // mine a block that isn't in the snapshot -> mine something that is
      if (decision.action === 'mine') {
        const want = String(decision.target || '');
        const nearby = (snapshot?.nearbyBlocks || []).find((b) => b.name === want);
        if (want && !nearby) {
          const anyOre = (snapshot?.nearbyBlocks || []).find((b) => /_ore$|log$/.test(b.name));
          const fallback = anyOre?.name || (snapshot?.nearbyBlocks || [])[0]?.name;
          if (fallback) {
            return {
              allowed: true,
              repaired: true,
              reason: `${want} not nearby; mining ${fallback} instead`,
              rule: 'repair_mine',
              decision: { ...decision, target: fallback },
            };
          }
          // nothing mineable in view -> explore to find material
          if ((snapshot?.movement?.clear || []).length) {
            return {
              allowed: true,
              repaired: true,
              reason: 'nothing mineable in view; exploring',
              rule: 'repair_mine_explore',
              decision: { ...decision, action: 'explore', target: null, reason: 'looking for mineable blocks' },
            };
          }
        }
      }
      // pointless fight: healthy mob vs very low hp us
      if (cfg.avoidPointlessFights && decision.action === 'attack') {
        const threat = (snapshot?.hostiles || [])[0];
        if (typeof hp === 'number' && hp <= 8 && threat && threat.hp >= 12) {
          return {
            allowed: true,
            repaired: true,
            reason: 'too weak for this fight; retreating instead',
            rule: 'repair_fight',
            decision: { ...decision, action: 'flee', target: threat.name, reason: 'outmatched, retreat' },
          };
        }
      }
      // night + no light + wandering -> head back toward owner or just shelter
      if (cfg.nightRetreat && isNight && lowLight && (decision.action === 'explore' || decision.action === 'goto')) {
        const owner = snapshot?.owner;
        if (owner?.visible) {
          return {
            allowed: true,
            repaired: true,
            reason: 'dark and far from owner; heading back',
            rule: 'repair_night',
            decision: { ...decision, action: 'follow', target: null, reason: 'it is dark, regrouping' },
          };
        }
      }
    }

    return { allowed: true };
  }

  return { review, config: cfg, RISKY, DANGER_WHILE_HURT };
}

module.exports = { createGovernor, DEFAULT_CFG };