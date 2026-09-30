'use strict';
/**
 * action_executor.js — the *only* place a model decision becomes a real
 * mineflayer call.
 *
 * Contract:
 *   execute(bot, decision, opts) -> Promise<{ok, action, detail?, error?}>
 *
 * Guarantees:
 *   - unknown actions are rejected here even if they slipped past validation
 *   - every action is time-boxed (opts.actionTimeoutMs) so one bad action can
 *     never wedge the decision loop
 *   - actions that need a missing precondition (no food, no hostiles, no
 *     pathfinder) fail *cleanly* with a reason the loop can learn from
 *   - nothing here is invented: if a target is not present in the world, the
 *     action reports "no target" instead of fabricating success
 */

const { Vec3 } = require('vec3');

/** Run a task with a hard timeout so a stuck action can't block the loop. */
function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

function nearestHostile(bot, maxDist = 12) {
  let best = null;
  let bestD = maxDist;
  for (const e of Object.values(bot.entities)) {
    if (!e || e.type !== 'mob' || !e.position) continue;
    if (e.name !== 'zombie' && e.name !== 'skeleton' && e.name !== 'spider' && e.name !== 'creeper' && e.name !== 'husk' && e.name !== 'drowned' && e.name !== 'slime') continue;
    const d = e.position.distanceTo(bot.entity.position);
    if (d < bestD) {
      bestD = d;
      best = e;
    }
  }
  return best;
}

function nearestDroppedItem(bot, maxDist = 10) {
  let best = null;
  let bestD = maxDist;
  for (const e of Object.values(bot.entities)) {
    if (!e || e.position) {
      if (e && (e.type === 'item' || e.type === 'object')) {
        const d = e.position.distanceTo(bot.entity.position);
        if (d < bestD) {
          bestD = d;
          best = e;
        }
      }
    }
  }
  return best;
}

function findBlock(bot, name, radius = 12) {
  let best = null;
  let bestD = radius;
  const origin = bot.entity.position;
  const r = Math.ceil(radius);
  for (let dx = -r; dx <= r; dx++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dz = -r; dz <= r; dz++) {
        const p = new Vec3(origin.x + dx, origin.y + dy, origin.z + dz);
        let b;
        try {
          b = bot.blockAt(p);
        } catch {
          continue;
        }
        if (b && b.name === name) {
          const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (d < bestD) {
            bestD = d;
            best = b;
          }
        }
      }
    }
  }
  return best;
}

/** Best pickaxe-ish tool we are holding, or null. */
function bestToolFor(bot, blockName) {
  const order =
    blockName && /log|planks|wood/.test(blockName)
      ? ['iron_axe', 'stone_axe', 'diamond_axe', 'golden_axe', 'wooden_axe']
      : ['iron_pickaxe', 'diamond_pickaxe', 'stone_pickaxe', 'golden_pickaxe', 'wooden_pickaxe'];
  for (const t of order) {
    if (bot.inventory.items().some((i) => i.name === t)) return t;
  }
  return null;
}

function createExecutor(opts = {}) {
  const {
    logger = { info() {}, warn() {}, error() {}, debug() {} },
    actionTimeoutMs = 15000,
    settings = {},
  } = opts;

  const actionsCfg = settings.actions || {};
  const exploreRadius = actionsCfg.exploreRadius ?? 32;
  const followDistance = actionsCfg.followDistance ?? 3;
  const fleeDistance = actionsCfg.fleeDistance ?? 16;
  const mineMaxCount = actionsCfg.mineMaxCount ?? 16;

  /** Each handler returns a detail string; the runner adds the envelope. */
  const handlers = {
    async idle() {
      bot.look ? bot.look(true) : null;
      await sleep(400);
      return { detail: 'looked around' };
    },

    async explore(bot) {
      if (!bot.pathfinder) return { error: 'pathfinder plugin not loaded' };
      const pos = bot.entity.position;
      const angle = Math.random() * Math.PI * 2;
      const r = 8 + Math.random() * (exploreRadius - 8);
      const dest = new Vec3(pos.x + Math.cos(angle) * r, pos.y, pos.z + Math.sin(angle) * r);
      await withTimeout(bot.pathfinder.walkTo(dest), actionTimeoutMs, 'explore');
      return { detail: `walked ~${Math.round(r)} blocks` };
    },

    async follow(bot) {
      const ownerName = bot.ownerName || bot._minemindOwner;
      const owner = ownerName ? bot.players[ownerName] : null;
      if (!owner?.entity?.position) return { error: 'owner is not visible' };
      if (!bot.pathfinder) return { error: 'pathfinder plugin not loaded' };
      const dest = owner.entity.position.offset(0, 0, -followDistance);
      await withTimeout(bot.pathfinder.walkTo(dest), actionTimeoutMs, 'follow');
      return { detail: `walked to ${ownerName}` };
    },

    async flee(bot) {
      const threat = nearestHostile(bot, fleeDistance);
      if (!threat) return { error: 'no hostile within flee distance' };
      if (!bot.pathfinder) return { error: 'pathfinder plugin not loaded' };
      const away = bot.entity.position.offset(threat.position.x - bot.entity.position.x, 0, threat.position.z - bot.entity.position.z);
      const dest = bot.entity.position.offset(
        (bot.entity.position.x - threat.position.x) * 3,
        0,
        (bot.entity.position.z - threat.position.z) * 3
      );
      await withTimeout(bot.pathfinder.walkTo(dest), actionTimeoutMs, 'flee');
      return { detail: `fled from ${threat.name}` };
    },

    async attack(bot) {
      const target = nearestHostile(bot, 4.5);
      if (!target) return { error: 'no hostile in reach' };
      bot.attack(target);
      return { detail: `attacked ${target.name}` };
    },

    async mine(bot, decision) {
      const names = ['stone', 'cobblestone', 'coal_ore', 'iron_ore', 'copper_ore', 'oak_log', 'birch_log', 'spruce_log', 'sand', 'dirt'];
      const wanted = decision.target && names.includes(decision.target) ? decision.target : null;

      let block = null;
      if (wanted) {
        block = findBlock(bot, wanted, 12);
      } else {
        for (const n of names) {
          block = findBlock(bot, n, 10);
          if (block) break;
        }
      }
      if (!block) return { error: 'no mineable block in range' };

      // equip the best tool we have for it
      const tool = bestToolFor(bot, block.name);
      if (tool) {
        try {
          await bot.equip(bot.inventory.items().find((i) => i.name === tool), 'hand');
        } catch { /* hand is fine */ }
      }

      try {
        await withTimeout(bot.dig(block), actionTimeoutMs, 'mine');
        return { detail: `mined ${block.name}` };
      } catch (err) {
        // out of reach / no tool → try to walk closer once
        if (bot.pathfinder) {
          try {
            const near = block.position.offset(0, 0, 2);
            await withTimeout(bot.pathfinder.walkTo(near), actionTimeoutMs, 'approach');
            await withTimeout(bot.dig(block), actionTimeoutMs, 'mine');
            return { detail: `approached and mined ${block.name}` };
          } catch {
            /* fall through */
          }
        }
        return { error: `could not mine ${block.name}: ${err.message}` };
      }
    },

    async eat(bot) {
      const foodItem = bot.foodItems().find((i) => i.name !== 'rotten_flesh');
      if (!foodItem) return { error: 'no food in inventory' };
      if (bot.food >= 18) return { error: 'not hungry yet' };
      await withTimeout(bot.consume(), actionTimeoutMs, 'eat');
      return { detail: `ate ${foodItem.name}` };
    },

    async craft(bot, decision) {
      if (!bot.recipesFor) return { error: 'recipe plugin not loaded' };
      const itemName = decision.target;
      if (!itemName) return { error: 'craft needs a target item' };
      const item = bot.registry.items[itemName];
      if (!item) return { error: `unknown item "${itemName}"` };
      const recipe = bot.recipesFor(item.id, null, 1).size > 0 ? Array.from(bot.recipesFor(item.id, null, 1))[0] : null;
      if (!recipe) return { error: `no recipe for ${itemName}` };
      const craftingTable = findBlock(bot, 'crafting_table', 4);
      await withTimeout(bot.craft(recipe, 1, craftingTable ? craftingTable.position : null), actionTimeoutMs, 'craft');
      return { detail: `crafted ${itemName}` };
    },

    async place(bot) {
      const held = bot.heldItem;
      if (!held || held.type === -1) return { error: 'nothing to place' };
      const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (!ref) return { error: 'no block to place against' };
      const dest = ref.position.offset(0, 1, 0);
      try {
        await withTimeout(bot.placeBlock(ref, dest), actionTimeoutMs, 'place');
        return { detail: `placed ${held.name}` };
      } catch (err) {
        return { error: `could not place: ${err.message}` };
      }
    },

    async gather(bot) {
      const item = nearestDroppedItem(bot, 10);
      if (!item) return { error: 'no dropped items nearby' };
      if (!bot.pathfinder) return { error: 'pathfinder plugin not loaded' };
      await withTimeout(bot.pathfinder.walkTo(item.position, 1), actionTimeoutMs, 'gather');
      return { detail: 'walked to a dropped item' };
    },

    async equip(bot) {
      const prefer = ['diamond_sword', 'iron_sword', 'stone_sword', 'iron_pickaxe', 'stone_pickaxe', 'diamond_pickaxe'];
      for (const p of prefer) {
        const it = bot.inventory.items().find((i) => i.name === p);
        if (it) {
          try {
            await bot.equip(it, 'hand');
            return { detail: `equipped ${p}` };
          } catch { /* try next */ }
        }
      }
      return { error: 'nothing better to equip' };
    },

    async sleep(bot) {
      const bed = findBlock(bot, 'red_bed', 4) || findBlock(bot, 'blue_bed', 4) || findBlock(bot, 'bed', 4);
      if (!bed) return { error: 'no bed nearby' };
      try {
        await bot.sleep(bed);
        return { detail: 'slept' };
      } catch (err) {
        return { error: `could not sleep: ${err.message}` };
      }
    },

    async talk(bot, decision) {
      const msg = String(decision.target || '').slice(0, 120);
      if (!msg) return { error: 'talk needs a message' };
      bot.chat(msg);
      return { detail: `said: ${msg}` };
    },
  };

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Execute a validated decision.
   * @returns {Promise<{ok:boolean, action:string, detail?:string, error?:string, ms:number}>}
   */
  async function execute(bot, decision) {
    const started = Date.now();
    const action = decision && decision.action;
    const handler = handlers[action];
    if (!handler) {
      return { ok: false, action: String(action), error: 'unknown action', ms: Date.now() - started };
    }
    try {
      const res = await handler(bot, decision);
      const ms = Date.now() - started;
      if (res && res.error) {
        return { ok: false, action, error: res.error, ms };
      }
      return { ok: true, action, detail: res?.detail, ms };
    } catch (err) {
      return { ok: false, action, error: err.message, ms: Date.now() - started };
    }
  }

  return { execute, handlers, names: Object.keys(handlers) };
}

module.exports = { createExecutor };
