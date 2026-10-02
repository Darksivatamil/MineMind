'use strict';
/**
 * verifier.js — did the action actually do what it claimed?
 *
 * Without this, the executor's `ok:true` is just a promise that a click landed.
 * The verifier re-reads the world AFTER the action and confirms the intended
 * effect happened (position actually changed, mob actually died, inventory
 * actually grew, block actually removed).
 *
 * If verification fails, the autopilot records the failure so memory learns it
 * and the planner skips that approach. This closes the loop between "the model
 * said I did it" and "the world says I did it".
 */

const { withTimeout } = require('./timeout');

/** Distinguish a real "moved" from a wiggle. */
function movedEnough(a, b, minBlocks = 1.5) {
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.z - b.z) >= minBlocks;
}

function createVerifier(opts = {}) {
  const logger = opts.logger || { info() {}, warn() {}, error() {}, debug() {} };
  const cfg = { strict: true, radius: 3, ...(opts.config || {}) };

  /**
   * Verify one executed action against before/after world state.
   * @returns {{verified:boolean, confidence:number, note?:string}}
   */
  function verify(action, result, before, after) {
    if (!result || !result.ok) {
      return { verified: false, confidence: 0, note: result?.error || 'action failed' };
    }

    switch (action.action) {
      case 'explore':
      case 'goto':
      case 'follow':
      case 'goto_owner':
      case 'flee': {
        const moved = movedEnough(before.pos, after.pos, 1.5);
        return moved
          ? { verified: true, confidence: 1, note: `moved ${Math.round(Math.hypot(after.pos.x - before.pos.x, after.pos.z - before.pos.z))} blocks` }
          : { verified: false, confidence: 0.2, note: 'claimed to move but did not' };
      }

      case 'attack': {
        const beforeHas = (before.hostileCount ?? 0) > 0;
        const afterHas = (after.hostileCount ?? 0);
        const killed = result.killed || (beforeHas && afterHas < before.hostileCount);
        if (killed) return { verified: true, confidence: 1, note: 'target killed' };
        // not killed, but swings happened and we may still be fighting -> partial
        if ((result.swings ?? 0) > 0) return { verified: true, confidence: 0.5, note: `landed ${result.swings} swings, target alive` };
        return { verified: false, confidence: 0.2, note: 'no swings landed' };
      }

      case 'mine':
      case 'dig': {
        // mining removes a block and/or adds a drop to inventory
        const invGrew = (after.invCount ?? 0) > (before.invCount ?? 0);
        const blockGone = before.blockCount > 0 && after.blockCount < before.blockCount;
        if (invGrew || blockGone) return { verified: true, confidence: 1, note: 'world changed' };
        return { verified: false, confidence: 0.2, note: 'no block removed' };
      }

      case 'eat': {
        if (after.food > before.food) return { verified: true, confidence: 1, note: 'food increased' };
        return { verified: false, confidence: 0.3, note: 'food did not increase' };
      }

      case 'craft': {
        const gained = (after.invNames || []).some((n) => !(before.invNames || []).includes(n));
        if (gained) return { verified: true, confidence: 1, note: 'item crafted' };
        return { verified: false, confidence: 0.2, note: 'no new item' };
      }

      case 'place':
      case 'build': {
        const blockGrew = (after.solidCount ?? 0) > (before.solidCount ?? 0);
        if (blockGrew || (result.placed ?? 0) > 0) return { verified: true, confidence: 1, note: 'blocks placed' };
        return { verified: false, confidence: 0.2, note: 'nothing placed' };
      }

      case 'gather': {
        const invGrew = (after.invCount ?? 0) > (before.invCount ?? 0);
        return invGrew
          ? { verified: true, confidence: 1, note: 'collected item' }
          : { verified: false, confidence: 0.3, note: 'inventory unchanged' };
      }

      case 'sleep': {
        const advanced = after.timeTicks !== before.timeTicks;
        return advanced
          ? { verified: true, confidence: 0.8, note: 'time advanced' }
          : { verified: false, confidence: 0.3, note: 'time did not advance' };
      }

      case 'talk': {
        // can't verify a chat round-trip from here; trust the send unless it threw
        return { verified: true, confidence: 0.6, note: 'chat sent' };
      }

      case 'equip': {
        const changed = after.heldItem !== before.heldItem;
        return changed
          ? { verified: true, confidence: 0.9, note: 'hand changed' }
          : { verified: false, confidence: 0.3, note: 'held item unchanged' };
      }

      case 'idle': {
        return { verified: true, confidence: 0.9, note: 'idle' };
      }

      default:
        return { verified: true, confidence: 0.5, note: 'no verification rule; trusting executor' };
    }
  }

  /** Take a cheap "before" fingerprint of the world for verification. */
  function fingerprint(bot, snapshot) {
    try {
      const p = bot.entity.position;
      let hostileCount = 0;
      for (const e of Object.values(bot.entities || {})) {
        if (e && HOSTILE(e.name) && e.position && e.position.distanceTo(p) < 16) hostileCount++;
      }
      let solidCount = 0;
      const r = cfg.radius;
      for (let dx = -r; dx <= r; dx++)
        for (let dy = -r; dy <= r; dy++)
          for (let dz = -r; dz <= r; dz++) {
            try {
              const b = bot.blockAt(new (require('vec3').Vec3)(p.x + dx, p.y + dy, p.z + dz));
              if (b && b.boundingBox === 'block') solidCount++;
            } catch { /* ignore */ }
          }
      return {
        pos: { x: p.x, y: p.y, z: p.z },
        health: bot.health,
        food: bot.food,
        heldItem: bot.heldItem?.name ?? null,
        invCount: (bot.inventory?.items() || []).reduce((s, i) => s + i.count, 0),
        invNames: (bot.inventory?.items() || []).map((i) => i.name),
        hostileCount,
        blockCount: solidCount,
        solidCount,
        timeTicks: bot.time?.timeOfDay ?? 0,
      };
    } catch {
      return null;
    }
  }

  function HOSTILE(name) {
    return /zombie|skeleton|creeper|spider|slime|drowned|husk|pillager|witch|ravager|enderman|phantom/.test(name || '');
  }

  return { verify, fingerprint, config: cfg };
}

module.exports = { createVerifier, movedEnough };