'use strict';
/**
 * action_executor.js — the ONLY place a decision becomes a real mineflayer call.
 *
 * Guarantees:
 *   - unknown actions are rejected here even if they slipped past validation
 *   - every action is time-boxed so one bad action can never wedge the loop
 *   - a missing precondition fails *cleanly* with a reason memory can learn from
 *     (this is what stops the bot retrying a dead end forever)
 *   - nothing is invented: if the target isn't in the world, it reports
 *     "no target" instead of faking success
 */

const { Vec3 } = require('vec3');

const HOSTILE_NAMES = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman', 'slime',
  'magma_cube', 'blaze', 'wither_skeleton', 'husk', 'drowned', 'phantom',
  'pillager', 'vindicator', 'ravager', 'witch', 'stray',
]);

const MINEABLE = new Set([
  'stone', 'cobblestone', 'coal_ore', 'iron_ore', 'copper_ore', 'gold_ore',
  'diamond_ore', 'emerald_ore', 'redstone_ore', 'lapis_ore', 'oak_log',
  'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
  'sand', 'dirt', 'gravel', 'clay', 'grass_block', 'deepslate', 'andesite',
]);

/** Hard-timeout wrapper so a stuck action can never wedge the decision loop. */
function timed(promise, ms, label) {
  let timer;
  const p = Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

function nearestHostile(bot, maxDist = 12, name = null) {
  let best = null;
  let bestD = maxDist;
  for (const e of Object.values(bot.entities || {})) {
    if (!e || e.type !== 'mob' || !e.position) continue;
    if (!HOSTILE_NAMES.has(e.name)) continue;
    if (name && e.name !== name) continue;
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
  for (const e of Object.values(bot.entities || {})) {
    if (!e || !e.position) continue;
    if (e.type !== 'item' && e.type !== 'object') continue;
    const d = e.position.distanceTo(bot.entity.position);
    if (d < bestD) {
      bestD = d;
      best = e;
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
        let b;
        try {
          b = bot.blockAt(new Vec3(origin.x + dx, origin.y + dy, origin.z + dz));
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

function bestToolFor(bot, blockName) {
  const wood = blockName && /log|planks|wood/.test(blockName);
  const order = wood
    ? ['iron_axe', 'diamond_axe', 'stone_axe', 'golden_axe', 'wooden_axe']
    : ['iron_pickaxe', 'diamond_pickaxe', 'stone_pickaxe', 'golden_pickaxe', 'wooden_pickaxe'];
  for (const t of order) {
    if (bot.inventory.items().some((i) => i.name === t)) return t;
  }
  return null;
}

/** Find a safe, walkable destination in a compass direction. */
function directionTarget(bot, dir, reach = 12) {
  const map = {
    north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0],
    northeast: [1, -1], northwest: [-1, -1], southeast: [1, 1], southwest: [-1, 1],
  };
  const v = map[String(dir).toLowerCase()];
  if (!v) return null;
  const p = bot.entity.position;
  for (const d of [reach, reach - 3, reach - 6]) {
    const t = new Vec3(p.x + v[0] * d, p.y, p.z + v[1] * d);
    let feet;
    let ground;
    try {
      feet = bot.blockAt(t);
      ground = bot.blockAt(t.offset(0, -1, 0));
    } catch {
      continue;
    }
    const feetOk = !feet || feet.boundingBox !== 'block';
    const groundOk = ground && ground.boundingBox === 'block' && ground.name !== 'lava';
    if (feetOk && groundOk) return t;
  }
  return null;
}

function createExecutor(opts = {}) {
  const {
    logger = { info() {}, warn() {}, error() {}, debug() {} },
    actionTimeoutMs = 15000,
    settings = {},
    memory = null,
  } = opts;

  const a = settings.actions || {};
  const followDistance = a.followDistance ?? 3;
  const mineMaxCount = a.mineMaxCount ?? 16;
  /** Swing cadence. Real MC allows ~1.8 swings/sec; tests set this to ~0. */
  const swingDelayMs = a.swingDelayMs ?? 550;
  /** Idle pause. */
  const idleMs = a.idleMs ?? 600;

  /**
   * Snapshot a bot's position so a handler can measure whether it moved.
   * `bot` is passed in on purpose: handlers receive it as an argument, and
   * closing over it here would silently capture `undefined` — which made every
   * movement handler report "walked nowhere" no matter how far the bot went.
   */
  const anchor = (b) => {
    try {
      const p = b.entity.position;
      return { x: p.x, y: p.y, z: p.z };
    } catch {
      return null;
    }
  };

  const handlers = {
    async idle(bot) {
      const before = anchor(bot);
      try {
        await timed(new Promise((r) => setTimeout(r, idleMs)), Math.max(2000, idleMs * 4), "idle");
      } catch { /* ignore */ }
      return { detail: 'paused', pos: before };
    },

    async explore(bot, decision) {
      if (!bot.pathfinder) return { error: 'pathfinder plugin not loaded' };
      const from = anchor(bot);
      // Prefer a direction the observer confirmed is clear; fall back to any.
      const clear = (decision.direction && String(decision.direction).toLowerCase()) || null;
      let dest = clear ? directionTarget(bot, clear, a.exploreRadius ?? 24) : null;
      if (!dest) {
        const opts2 = ['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'];
        for (const d of opts2) {
          dest = directionTarget(bot, d, a.exploreRadius ?? 24);
          if (dest) break;
        }
      }
      if (!dest) {
        // Nowhere walkable in a straight line — try a generic walk, pathfinder will route.
        const p = bot.entity.position;
        dest = new Vec3(p.x + Math.floor(Math.random() * 12) - 6, p.y, p.z + Math.floor(Math.random() * 12) - 6);
      }
      try {
        await timed(bot.pathfinder.walkTo(dest), actionTimeoutMs, 'explore');
      } catch (err) {
        return { error: `explore failed: ${err.message}` };
      }
      const to = anchor(bot);
      // float distance: rounding here used to discard short-but-real walks and
      // report "blocked" when the bot had in fact moved.
      const moved = from && to ? Math.hypot(to.x - from.x, to.z - from.z) : 0;
      if (moved < 1.5) return { error: `walked nowhere (moved ${moved.toFixed(1)} blocks)` };
      return { detail: `explored ${moved.toFixed(1)} blocks`, moved };
    },

    async goto(bot, decision) {
      if (!bot.pathfinder) return { error: 'pathfinder plugin not loaded' };
      const x = Number(decision.target?.x ?? (typeof decision.target === 'object' ? decision.target.x : NaN));
      const z = Number(decision.target?.z ?? (typeof decision.target === 'object' ? decision.target.z : NaN));
      if (!Number.isFinite(x) || !Number.isFinite(z)) return { error: 'goto needs numeric x/z' };
      const dest = new Vec3(x, bot.entity.position.y, z);
      try {
        await timed(bot.pathfinder.walkTo(dest), actionTimeoutMs, 'goto');
      } catch (err) {
        return { error: `goto failed: ${err.message}` };
      }
      return { detail: `went to ${Math.round(x)},${Math.round(z)}` };
    },

    async follow(bot) {
      const ownerName = bot.ownerName || bot._minemindOwner;
      const owner = ownerName ? bot.players?.[ownerName] : null;
      if (!owner?.entity?.position) return { error: 'owner is not visible' };
      if (!bot.pathfinder) return { error: 'pathfinder plugin not loaded' };
      const d = owner.entity.position.distanceTo(bot.entity.position);
      if (d <= followDistance + 1) return { detail: 'already with owner' };
      try {
        await timed(bot.pathfinder.walkTo(owner.entity.position, 1), actionTimeoutMs, 'follow');
      } catch (err) {
        return { error: `follow failed: ${err.message}` };
      }
      return { detail: `followed owner` };
    },

    async goto_owner(bot) {
      return handlers.follow(bot);
    },

    async flee(bot, decision) {
      const threat = nearestHostile(bot, a.fleeDistance ?? 16, decision.target || null);
      if (!threat) return { error: 'no hostile within flee distance' };
      if (!bot.pathfinder) return { error: 'pathfinder plugin not loaded' };
      const p = bot.entity.position;
      const away = new Vec3(
        p.x + (p.x - threat.position.x) * 3,
        p.y,
        p.z + (p.z - threat.position.z) * 3
      );
      try {
        await timed(bot.pathfinder.walkTo(away), actionTimeoutMs, 'flee');
      } catch (err) {
        return { error: `flee failed: ${err.message}` };
      }
      return { detail: `fled from ${threat.name}` };
    },

    /**
     * Real combat: walk into range, then keep swinging until the mob dies or
     * we drop below a safe health floor. v1 only swung once, so the bot never
     * actually killed anything.
     */
    async attack(bot, decision) {
      const name = decision.target && HOSTILE_NAMES.has(decision.target) ? decision.target : null;
      const target = nearestHostile(bot, 8, name);
      if (!target) return { error: 'no hostile in range' };

      // close the distance if we're too far to swing
      if (target.position.distanceTo(bot.entity.position) > 3.2 && bot.pathfinder) {
        try {
          await timed(bot.pathfinder.walkTo(target.position, 2), actionTimeoutMs / 2, 'approach');
        } catch { /* just swing from here */ }
      }

      let swings = 0;
      const deadline = Date.now() + actionTimeoutMs;
      while (Date.now() < deadline && swings < 24) {
        if (!target.isValid || target.health <= 0) break;
        const d = target.position.distanceTo(bot.entity.position);
        if (d > 3.2) {
          // it moved away — chase briefly
          if (bot.pathfinder) {
            try {
              await timed(bot.pathfinder.goto(target.position, 2).catch(() => {}), 2500, 'chase');
            } catch { /* ignore */ }
          }
        } else {
          try {
            bot.attack(target);
            swings++;
          } catch { /* ignore */ }
        }
        await new Promise((r) => setTimeout(r, swingDelayMs)); // ~1.8 swings/sec in-game
      }
      const killed = !target.isValid || target.health <= 0;
      if (swings === 0) return { error: 'never got in range to swing' };
      return {
        detail: killed ? `killed ${target.name} in ${swings} swings` : `hit ${target.name} ${swings}x`,
        killed,
        swings,
      };
    },

    async mine(bot, decision) {
      let block = null;
      const want = typeof decision.target === 'string' ? decision.target : null;
      if (want) {
        block = findBlock(bot, want, 12);
        if (!block && MINEABLE.has(want)) {
          // model asked for a mineable block that isn't visible -> be honest
          return { error: `no ${want} within 12 blocks` };
        }
      }
      if (!block) {
        const names = ['oak_log', 'birch_log', 'spruce_log', 'stone', 'cobblestone', 'dirt', 'coal_ore', 'copper_ore', 'iron_ore'];
        for (const n of names) {
          block = findBlock(bot, n, 10);
          if (block) break;
        }
      }
      if (!block) return { error: 'no mineable block in range' };

      const tool = bestToolFor(bot, block.name);
      if (tool) {
        try {
          await bot.equip(bot.inventory.items().find((i) => i.name === tool), 'hand');
        } catch { /* hand is fine */ }
      }

      try {
        await timed(bot.dig(block), actionTimeoutMs, 'mine');
        return { detail: `mined ${block.name}`, item: block.name };
      } catch (err) {
        if (bot.pathfinder) {
          try {
            await timed(bot.pathfinder.walkTo(block.position.offset(0, 0, 2)), actionTimeoutMs, 'approach');
            await timed(bot.dig(block), actionTimeoutMs, 'mine');
            return { detail: `approached and mined ${block.name}`, item: block.name };
          } catch {
            /* fall through */
          }
        }
        return { error: `could not mine ${block.name}: ${err.message}` };
      }
    },

    async dig(bot, decision) {
      const depth = Math.min(5, Math.max(1, Number(decision.target) || 1));
      const p = bot.entity.position;
      let dug = 0;
      for (let i = 0; i < depth; i++) {
        const below = bot.blockAt(new Vec3(p.x, p.y - 1 - i, p.z));
        if (!below || below.name === 'bedrock' || below.name === 'water' || below.name === 'lava') break;
        const tool = bestToolFor(bot, below.name);
        if (tool) {
          try {
            await bot.equip(bot.inventory.items().find((i) => i.name === tool), 'hand');
          } catch { /* ignore */ }
        }
        try {
          await timed(bot.dig(below), actionTimeoutMs, 'dig');
          dug++;
        } catch (err) {
          return { error: `could not dig: ${err.message}`, dug };
        }
      }
      if (!dug) return { error: 'nothing diggable below' };
      return { detail: `dug down ${dug}`, dug };
    },

    async gather(bot) {
      const item = nearestDroppedItem(bot, 10);
      if (!item) return { error: 'no dropped items nearby' };
      if (!bot.pathfinder) return { error: 'pathfinder plugin not loaded' };
      try {
        await timed(bot.pathfinder.walkTo(item.position, 1), actionTimeoutMs, 'gather');
      } catch (err) {
        return { error: `gather failed: ${err.message}` };
      }
      return { detail: 'collected a dropped item' };
    },

    async craft(bot, decision) {
      const itemName = typeof decision.target === 'string' ? decision.target : null;
      if (!itemName) return { error: 'craft needs a target item' };
      const item = bot.registry?.items?.[itemName];
      if (!item) return { error: `unknown item "${itemName}"` };
      let recipe = null;
      try {
        const r = bot.recipesAll?.().find((x) => x.result === item.id);
        recipe = r || null;
      } catch { /* recipe plugin missing */ }
      if (!recipe) return { error: `no recipe known for ${itemName} (missing materials?)` };

      const table = findBlock(bot, 'crafting_table', 4);
      if (!table && !bot.inventory.items().some((i) => i.name === 'crafting_table')) {
        return { error: 'need a crafting table nearby' };
      }
      const ref = table ? table.position : null;
      try {
        await timed(bot.craft(recipe, 1, ref), actionTimeoutMs, 'craft');
      } catch (err) {
        return { error: `craft failed: ${err.message}` };
      }
      return { detail: `crafted ${itemName}`, item: itemName };
    },

    async equip(bot, decision) {
      const prefer = decision.target
        ? [decision.target]
        : ['diamond_sword', 'iron_sword', 'stone_sword', 'diamond_pickaxe', 'iron_pickaxe', 'stone_pickaxe', 'diamond_axe', 'iron_axe', 'stone_axe'];
      for (const p of prefer) {
        const it = bot.inventory.items().find((i) => i.name === p);
        if (!it) continue;
        try {
          await bot.equip(it, 'hand');
          return { detail: `equipped ${p}` };
        } catch { /* try next */ }
      }
      return { error: 'nothing better to equip' };
    },

    async place(bot) {
      const held = bot.heldItem;
      if (!held || held.type === -1) return { error: 'nothing to place' };
      const ref = bot.blockAt(bot.entity.position.offset(0, -1, 0));
      if (!ref) return { error: 'no block to place against' };
      const dest = ref.position.offset(0, 1, 0);
      try {
        await timed(bot.placeBlock(ref, dest), actionTimeoutMs, 'place');
      } catch (err) {
        return { error: `could not place: ${err.message}` };
      }
      return { detail: `placed ${held.name}` };
    },

    async build(bot, decision) {
      const shape = ['platform', 'wall', 'pillar'].includes(decision.target) ? decision.target : 'wall';
      const count = Math.min(24, Math.max(2, Number(decision.count) || 8));
      const held = bot.heldItem;
      if (!held || held.type === -1) return { error: 'holding nothing to build with' };
      let placed = 0;
      const base = bot.entity.position.offset(0, -1, 0).offset(0, 1, 0);
      try {
        for (let i = 0; i < count; i++) {
          const ref = shape === 'pillar'
            ? base.offset(0, placed, 0)
            : base.offset(placed, 0, 0);
          const existing = bot.blockAt(ref);
          if (existing && existing.boundingBox === 'block') {
            placed++;
            continue;
          }
          const support = bot.blockAt(ref.offset(0, -1, 0));
          if (!support) break;
          await timed(bot.placeBlock(support, ref), 3000, 'build');
          placed++;
        }
      } catch (err) {
        return { error: `build stopped: ${err.message}`, placed };
      }
      if (!placed) return { error: 'could not place any blocks' };
      return { detail: `built ${shape} (${placed} blocks)`, placed };
    },

    async eat(bot, decision) {
      let foodItem = null;
      if (typeof decision.target === 'string') {
        foodItem = bot.inventory.items().find((i) => i.name === decision.target);
      }
      if (!foodItem) foodItem = bot.foodItems().find((i) => i.name !== 'rotten_flesh');
      if (!foodItem) return { error: 'no food in inventory' };
      try {
        await timed(bot.consume(), actionTimeoutMs, 'eat');
      } catch (err) {
        return { error: `could not eat: ${err.message}` };
      }
      return { detail: `ate ${foodItem.name}` };
    },

    async sleep(bot) {
      const bed = findBlock(bot, 'red_bed', 5) || findBlock(bot, 'blue_bed', 5) || findBlock(bot, 'bed', 5);
      if (!bed) return { error: 'no bed nearby' };
      try {
        await timed(bot.sleep(bed), actionTimeoutMs, 'sleep');
      } catch (err) {
        return { error: `could not sleep: ${err.message}` };
      }
      return { detail: 'slept until morning' };
    },

    async talk(bot, decision) {
      const msg = String(decision.target || '').slice(0, 120);
      if (!msg) return { error: 'talk needs a message' };
      try {
        bot.chat(msg);
      } catch (err) {
        return { error: `chat failed: ${err.message}` };
      }
      return { detail: `said: ${msg}` };
    },
  };

  /**
   * Execute a validated decision.
   * @returns {Promise<{ok:boolean, action:string, detail?:string, error?:string, ms:number}>}
   */
  async function execute(bot, decision) {
    const started = Date.now();
    const action = decision && decision.action;
    const handler = handlers[action];
    if (!handler) return { ok: false, action: String(action), error: 'unknown action', ms: Date.now() - started };
    try {
      const res = await handler(bot, decision);
      const ms = Date.now() - started;
      if (res && res.error) return { ok: false, action, error: res.error, detail: res.detail, ms };
      return { ok: true, action, detail: res?.detail, ms };
    } catch (err) {
      return { ok: false, action, error: err.message, ms: Date.now() - started };
    }
  }

  return { execute, handlers, names: Object.keys(handlers), findBlock, nearestHostile, directionTarget };
}

module.exports = { createExecutor, findBlock, nearestHostile, directionTarget };