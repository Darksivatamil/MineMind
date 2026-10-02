'use strict';
/**
 * observer.js — build a compact, honest JSON snapshot of the live world.
 *
 * This is the model's only perception. Every field is measured off the live bot;
 * if a sensor is unavailable the field degrades to null rather than a plausible
 * guess. That distinction matters: a hallucinated "iron_ore at 3 blocks" would
 * send the bot mining nothing for a minute.
 *
 * What was added over v1, and why the bot previously stood still:
 *   - movement options (which neighbours are actually walkable) so `explore`
 *     picks a legal destination instead of walking into a wall
 *   - light level + sky visibility so it can tell day from night underground
 *   - crafting readiness (can I actually make this?) so `craft` isn't fantasy
 *   - a flat "affordances" list — the single highest-value addition: it tells
 *     the model what is POSSIBLE right now, not just what exists
 */

const { Vec3 } = require('vec3');

const HOSTILE = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman',
  'slime', 'magma_cube', 'blaze', 'wither_skeleton', 'husk', 'drowned',
  'phantom', 'pillager', 'vindicator', 'ravager', 'witch', 'stray',
]);

const PASSIVE = new Set([
  'cow', 'pig', 'sheep', 'chicken', 'rabbit', 'horse', 'donkey', 'mule',
  'llama', 'villager', 'iron_golem', 'snow_golem', 'wolf', 'cat', 'bee',
  'fox', 'turtle', 'axolotl', 'cod', 'salmon', 'tropical_fish', 'squid',
  'glow_squid', 'panda', 'strider', 'goat', 'frog', 'tadpole', 'bat',
]);

/** Blocks worth telling the model about when choosing what to do next. */
const INTERESTING = [
  'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'copper_ore', 'emerald_ore',
  'redstone_ore', 'lapis_ore', 'deepslate_coal_ore', 'deepslate_iron_ore',
  'deepslate_gold_ore', 'deepslate_diamond_ore', 'deepslate_copper_ore',
  'oak_log', 'birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'dark_oak_log',
  'stone', 'cobblestone', 'dirt', 'sand', 'gravel', 'clay',
  'crafting_table', 'furnace', 'chest', 'bed', 'red_bed', 'blue_bed',
  'torch', 'water', 'lava', 'grass_block',
];

const FOOD_RE = /beef|porkchop|chicken|mutton|rabbit|cod|salmon|bread|carrot|potato|melon|apple|beetroot|cookie/;
const TOOL_RE = /pickaxe|axe|shovel|sword|hoe/;

function round(n) {
  return Math.round(n * 10) / 10;
}

function summariseInventory(bot) {
  const items = {};
  try {
    for (const item of bot.inventory.items()) items[item.name] = (items[item.name] || 0) + item.count;
  } catch {
    return null;
  }
  const entries = Object.entries(items);
  return {
    total: entries.length,
    food: entries.filter(([n]) => FOOD_RE.test(n)),
    tools: entries.filter(([n]) => TOOL_RE.test(n)),
    blocks: entries.filter(([n]) => /planks|cobblestone|dirt|stone|sand|log/.test(n)).slice(0, 8),
    hasTorches: !!items.torch,
    hasBed: !!(items.bed || items.red_bed || items.blue_bed),
    hasCraftingTable: !!items.crafting_table,
  };
}

/** Scan a box around the bot for blocks we care about. */
function surveyBlocks(bot, radius, names) {
  const wanted = new Set(names);
  const found = new Map();
  try {
    const origin = bot.entity.position;
    const r = Math.ceil(radius);
    const yMin = Math.floor(origin.y) - r;
    const yMax = Math.floor(origin.y) + r;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = yMin; dy <= yMax; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          let block;
          try {
            block = bot.blockAt(new Vec3(origin.x + dx, dy, origin.z + dz));
          } catch {
            continue;
          }
          if (!block || !wanted.has(block.name)) continue;
          const d = round(Math.sqrt(dx * dx + dy * dy + dz * dz));
          const cur = found.get(block.name);
          if (cur) {
            cur.count++;
            if (d < cur.dist) cur.dist = d;
          } else {
            found.set(block.name, { name: block.name, count: 1, dist: d });
          }
        }
      }
    }
  } catch {
    return [];
  }
  return Array.from(found.values()).sort((a, b) => a.dist - b.dist).slice(0, 12);
}

/** Nearby entities, split by disposition. */
function surveyEntities(bot, radius) {
  const hostiles = [];
  const passives = [];
  const items = [];
  const players = [];
  try {
    const origin = bot.entity.position;
    for (const e of Object.values(bot.entities)) {
      if (!e || !e.position || e.id === bot.entity.id) continue;
      const d = round(e.position.distanceTo(origin));
      if (d > radius) continue;
      if (e.type === 'player') {
        players.push({ username: e.username, dist: d });
        continue;
      }
      if (e.type === 'item' || e.type === 'object') {
        items.push({ name: e.name || 'item', dist: d });
        continue;
      }
      if (HOSTILE.has(e.name)) {
        hostiles.push({ name: e.name, dist: d, hp: e.health });
      } else if (PASSIVE.has(e.name)) {
        passives.push({ name: e.name, dist: d });
      }
    }
  } catch {
    /* degrade */
  }
  const byDist = (a, b) => a.dist - b.dist;
  return {
    hostiles: hostiles.sort(byDist).slice(0, 5),
    passives: passives.sort(byDist).slice(0, 5),
    droppedItems: items.sort(byDist).slice(0, 5),
    players: players.sort(byDist).slice(0, 5),
  };
}

function timeOfDay(bot) {
  try {
    const t = bot.time.timeOfDay;
    let phase = 'day';
    if (t < 1000) phase = 'sunrise';
    else if (t < 11000) phase = 'morning';
    else if (t < 13000) phase = 'day';
    else if (t < 23000) phase = 'night';
    else phase = 'sunset';
    return { ticks: t, phase, isNight: phase === 'night' };
  } catch {
    return null;
  }
}

/**
 * Which of the 8 compass directions have a legal, non-lethal place to step.
 * This is what lets `explore` choose a real destination instead of walking
 * face-first into a wall — one of the concrete causes of "AGNES doesn't move".
 */
function movementOptions(bot, radius = 6) {
  const dirs = [
    ['north', 0, -1], ['south', 0, 1], ['east', 1, 0], ['west', -1, 0],
    ['northeast', 1, -1], ['northwest', -1, -1], ['southeast', 1, 1], ['southwest', -1, 1],
  ];
  const safe = [];
  const out = {};
  try {
    const p = bot.entity.position;
    for (const [name, dx, dz] of dirs) {
      let verdict = 'blocked';
      for (const dist of [2, 4, radius]) {
        const t = new Vec3(p.x + dx * dist, p.y, p.z + dz * dist);
        const feet = bot.blockAt(t);
        const ground = bot.blockAt(t.offset(0, -1, 0));
        const head = bot.blockAt(t.offset(0, 1, 0));
        const solidFeet = feet && feet.boundingBox === 'block';
        const solidHead = head && head.boundingBox === 'block';
        const groundOk = ground && ground.boundingBox === 'block' && ground.name !== 'lava' && ground.name !== 'magma_block';
        if (groundOk && !solidFeet && !solidHead) {
          verdict = 'clear';
          out[name] = Math.round(dist);
          break;
        }
      }
      if (verdict === 'clear') safe.push(name);
    }
  } catch {
    /* degrade */
  }
  return { clear: safe, distances: out };
}

/**
 * Can the bot actually make this right now?
 * Answers the questions the model otherwise has to guess at.
 */
function craftingReadiness(bot) {
  const ready = [];
  const missing = [];
  try {
    const has = (n) => bot.inventory.items().some((i) => i.name === n);
    const hasTable = (() => {
      if (has('crafting_table')) return true;
      // a nearby table also counts
      for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
          try {
            const b = bot.blockAt(bot.entity.position.offset(dx, 0, dz));
            if (b && b.name === 'crafting_table') return true;
          } catch { /* ignore */ }
        }
      }
      return false;
    })();

    if (hasTable) {
      if (has('oak_log') || has('birch_log') || has('spruce_log') || has('planks')) ready.push('crafting_table(place)');
      if (has('cobblestone') || has('stone')) ready.push('stone_tools');
      if (has('planks') && has('cobblestone')) ready.push('wood_and_stone_tools');
      if (has('torch') && (has('coal') || has('charcoal'))) ready.push('torches');
    } else {
      missing.push('crafting_table');
    }
    if (has('wooden_pickaxe')) missing.push('better_pickaxe');
    else if (!TOOL_RE.test(Object.keys(Object.fromEntries(bot.inventory.items().map((i) => [i.name, 1])))[0] || '')) missing.push('any_tool');
  } catch {
    /* degrade */
  }
  return { canCraft: ready, blockedBy: missing, hasNearbyTable: ready.length > 0 };
}

/**
 * The highest-value field: a plain list of what is POSSIBLE right now.
 * A model asked "what do you do?" answers far better when given a menu of
 * legal moves than when handed raw coordinates.
 */
function affordances(bot, ctx) {
  const a = [];
  const inv = ctx.inventory;
  if (ctx.hostiles.length) {
    const h = ctx.hostiles[0];
    a.push(`attack:${h.name}@${h.dist} or flee`);
  }
  if (inv?.food?.length && ctx.food <= 16) a.push(`eat:${inv.food[0][0]}`);
  if (ctx.nearbyBlocks.length) {
    for (const b of ctx.nearbyBlocks.slice(0, 3)) a.push(`mine:${b.name}@${b.dist}`);
  }
  if (ctx.droppedItems.length) a.push(`gather:${ctx.droppedItems[0].dist}`);
  if (ctx.movement.clear.length) a.push(`explore via ${ctx.movement.clear.slice(0, 3).join('/')}`);
  if (ctx.owner?.visible) a.push(`follow owner @${ctx.owner.dist}`);
  if (ctx.crafting.canCraft.length) a.push(`craft:${ctx.crafting.canCraft[0].split('(')[0]}`);
  if (inv?.blocks?.length) a.push(`place:${inv.blocks[0][0]}`);
  if (inv?.tools?.length) a.push(`equip:${inv.tools[0][0]}`);
  if (ctx.hazards.some((h) => h.type === 'low_health')) a.push('RETREAT (low health)');
  if (ctx.time?.isNight && inv?.hasBed) a.push('sleep (night)');
  return a.slice(0, 10);
}

/** Full world snapshot. */
function observe(bot, opts = {}) {
  const {
    scanRadius = 8,
    entityRadius = 16,
    interesting = INTERESTING,
  } = opts;

  const snapshot = {
    self: { pos: null, health: null, food: null, xp: null, dimension: null, onGround: null, looking: null },
    time: null,
    environment: { biome: null, blockAtFeet: null, blockAbove: null, light: null, canSeeSky: null },
    inventory: null,
    nearbyBlocks: [],
    hostiles: [],
    passives: [],
    droppedItems: [],
    players: [],
    movement: { clear: [], distances: {} },
    crafting: { canCraft: [], blockedBy: [] },
    owner: null,
    hazards: [],
    affordances: [],
  };

  // --- self -------------------------------------------------------------
  try {
    const p = bot.entity.position;
    snapshot.self = {
      pos: { x: round(p.x), y: round(p.y), z: round(p.z) },
      yaw: round(bot.entity.yaw * (180 / Math.PI)),
      health: bot.health ?? null,
      food: bot.food ?? null,
      xp: bot.experience?.level ?? null,
      dimension: bot.game?.dimension ?? null,
      onGround: bot.entity.onGround ?? null,
    };
  } catch (err) {
    snapshot.self.error = err.message;
  }

  snapshot.time = timeOfDay(bot);
  snapshot.inventory = summariseInventory(bot);

  // --- environment ------------------------------------------------------
  try {
    const p = bot.entity.position;
    const feet = bot.blockAt(p.offset(0, -0.2, 0));
    const above = bot.blockAt(p.offset(0, 1.8, 0));
    snapshot.environment.blockAtFeet = feet ? feet.name : null;
    snapshot.environment.blockAbove = above ? above.name : null;
    try {
      snapshot.environment.light = bot.blockAt(p.offset(0, 2, 0))?.lightLevel ?? null;
    } catch { /* optional */ }
    snapshot.environment.canSeeSky = snapshot.environment.light == null ? null : snapshot.environment.light >= 15;
  } catch { /* degrade */ }
  try {
    const biome = bot.blockAt(bot.entity.position.offset(0, 0.5, 0));
    if (biome?.biome?.name) snapshot.environment.biome = biome.biome.name;
  } catch { /* optional */ }

  // --- surroundings -----------------------------------------------------
  snapshot.nearbyBlocks = surveyBlocks(bot, scanRadius, interesting);
  const ent = surveyEntities(bot, entityRadius);
  snapshot.hostiles = ent.hostiles;
  snapshot.passives = ent.passives;
  snapshot.droppedItems = ent.droppedItems;
  snapshot.players = ent.players;
  snapshot.movement = movementOptions(bot);
  snapshot.crafting = craftingReadiness(bot);

  // --- owner ------------------------------------------------------------
  try {
    const ownerName = bot.ownerName || bot._minemindOwner || null;
    if (ownerName) {
      const o = bot.players?.[ownerName];
      if (o?.entity?.position) {
        const d = round(o.entity.position.distanceTo(bot.entity.position));
        snapshot.owner = { name: ownerName, dist: d, visible: d <= 64, health: o.entity.health };
      } else {
        snapshot.owner = { name: ownerName, dist: null, visible: false };
      }
    }
  } catch { /* ignore */ }

  // --- hazards ----------------------------------------------------------
  try {
    const p = bot.entity.position;
    const below = bot.blockAt(p.offset(0, -2, 0));
    if (below && (below.name === 'lava' || below.name === 'magma_block')) {
      snapshot.hazards.push({ type: 'lava_below', block: below.name });
    }
    if (snapshot.self.health != null && snapshot.self.health <= 6) snapshot.hazards.push({ type: 'low_health', value: snapshot.self.health });
    if (snapshot.self.food != null && snapshot.self.food <= 6) snapshot.hazards.push({ type: 'low_food', value: snapshot.self.food });
    if (snapshot.self.onGround === false) snapshot.hazards.push({ type: 'falling' });
    if (snapshot.hostiles.length && snapshot.hostiles[0].dist <= 3) {
      snapshot.hazards.push({ type: 'mob_adjacent', name: snapshot.hostiles[0].name, dist: snapshot.hostiles[0].dist });
    }
    if (snapshot.time?.isNight) snapshot.hazards.push({ type: 'night' });
  } catch { /* ignore */ }

  snapshot.affordances = affordances(bot, {
    inventory: snapshot.inventory,
    hostiles: snapshot.hostiles,
    nearbyBlocks: snapshot.nearbyBlocks,
    droppedItems: snapshot.droppedItems,
    movement: snapshot.movement,
    owner: snapshot.owner,
    crafting: snapshot.crafting,
    hazards: snapshot.hazards,
    time: snapshot.time,
    food: snapshot.self.food,
  });

  return snapshot;
}

module.exports = { observe, movementOptions, craftingReadiness, affordances, HOSTILE, PASSIVE, INTERESTING };