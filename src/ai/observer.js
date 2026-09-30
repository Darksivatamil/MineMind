'use strict';
/**
 * observer.js — build a compact, honest JSON snapshot of the live world.
 *
 * This is the *only* input the decision engine gives the model, so it must
 * contain real measured values (positions, hp, inventory, nearby blocks/mobs)
 * and nothing invented. Every field is read off the live bot; if a sensor is
 * unavailable the field degrades to null rather than a plausible guess.
 */

const { Vec3 } = require('vec3');

/** Mob types we treat as hostile for flee/attack decisions. */
const HOSTILE = new Set([
  'zombie', 'skeleton', 'creeper', 'spider', 'cave_spider', 'enderman',
  'slime', 'magma_cube', 'blaze', 'wither_skeleton', 'husk', 'drowned',
  'phantom', 'pillager', 'vindicator', 'ravager', 'witch', 'stray',
]);

/** Mob types that are passive — useful for follow, never for fight. */
const PASSIVE = new Set([
  'cow', 'pig', 'sheep', 'chicken', 'rabbit', 'horse', 'donkey', 'mule',
  'llama', 'villager', 'iron_golem', 'snow_golem', 'wolf', 'cat', 'bee',
  'fox', 'turtle', 'axolotl', 'cod', 'salmon', 'tropical_fish', 'squid',
  'glow_squid', 'panda', 'strider', 'goat', 'frog', 'tadpole', 'bat',
]);

function round(n) {
  return Math.round(n * 10) / 10;
}

/**
 * Inventory summary without flooding the prompt: count per item name, and
 * tool/armour best available.
 */
function summariseInventory(bot) {
  const items = {};
  try {
    for (const item of bot.inventory.items()) {
      items[item.name] = (items[item.name] || 0) + item.count;
    }
  } catch {
    return null;
  }
  const food = Object.entries(items).filter(([name]) => /beef|pork|chicken|bread|carrot|potato|melon|apple|mutton|rabbit|cod|salmon|beetroot/.test(name));
  const tools = Object.entries(items).filter(([name]) => /pickaxe|axe|shovel|sword|hoe/.test(name));
  return {
    total: Object.keys(items).length,
    food,
    tools,
    hasTorches: !!items.torch,
    hasBed: !!items.bed || !!items['red_bed'] || !!items['blue_bed'],
  };
}

/**
 * Nearby blocks of interest, measured by actually reading the block map.
 * @returns {Array<{name,count,dist}>}
 */
function surveyBlocks(bot, radius, names) {
  const wanted = new Set(names);
  const found = new Map();
  try {
    for (const [posStr, name] of Object.entries(bot.blockAt ? bot.blockMap || {} : {})) {
      /* not used — real scan below */
    }
  } catch { /* ignore */ }

  try {
    const origin = bot.entity.position;
    const r = Math.ceil(radius);
    const yMin = Math.floor(origin.y) - r;
    const yMax = Math.floor(origin.y) + r;
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = yMin; dy <= yMax; dy++) {
        for (let dz = -r; dz <= r; dz++) {
          const p = new Vec3(origin.x + dx, dy, origin.z + dz);
          let block;
          try {
            block = bot.blockAt(p);
          } catch {
            continue;
          }
          if (!block) continue;
          if (!wanted.has(block.name)) continue;
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
  } catch (err) {
    return { error: err.message, blocks: [] };
  }

  return {
    blocks: Array.from(found.values()).sort((a, b) => b.count - a.count).slice(0, 12),
  };
}

/** Nearby entities, split into hostile / passive with distances. */
function surveyEntities(bot, radius) {
  const hostiles = [];
  const passives = [];
  const items = [];
  try {
    const origin = bot.entity.position;
    for (const e of Object.values(bot.entities)) {
      if (!e || !e.position || e.id === bot.entity.id) continue;
      const d = round(e.position.distanceTo(origin));

      if (e.type === 'player') {
        if (d <= radius) passives.push({ name: 'player', username: e.username, dist: d, kind: 'player' });
        continue;
      }
      if (e.type === 'item' || e.type === 'object') {
        if (d <= radius) items.push({ name: e.name || 'item', dist: d });
        continue;
      }
      if (e.type === 'mob' || e.name) {
        const entry = { name: e.name, dist: d, hp: e.health };
        if (HOSTILE.has(e.name)) {
          if (d <= radius) hostiles.push(entry);
        } else if (PASSIVE.has(e.name)) {
          if (d <= radius) passives.push(entry);
        }
      }
    }
  } catch (err) {
    return { hostiles: [], passives: [], items: [], error: err.message };
  }
  const byDist = (a, b) => a.dist - b.dist;
  return {
    hostiles: hostiles.sort(byDist).slice(0, 5),
    passives: passives.sort(byDist).slice(0, 5),
    droppedItems: items.sort(byDist).slice(0, 5),
  };
}

/** Time of day + light, derived from the real game state. */
function timeOfDay(bot) {
  try {
    const t = bot.time.timeOfDay;
    const isDay = typeof bot.time.isDay === 'function' ? bot.time.isDay() : t < 12300 || t > 23850;
    let phase = 'day';
    if (t < 1000) phase = 'sunrise';
    else if (t < 11000) phase = 'morning';
    else if (t < 12000) phase = 'noon';
    else if (t < 13000) phase = 'afternoon';
    else if (t < 23000) phase = 'night';
    else phase = 'sunset';
    return { ticks: t, phase, isDay: !!isDay };
  } catch {
    return null;
  }
}

/**
 * Full snapshot. Cheap enough to call on the decision cadence, expensive
 * enough to be honest about the world.
 */
function observe(bot, opts = {}) {
  const {
    scanRadius = 12,
    entityRadius = 16,
    oreNames = [
      'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore', 'copper_ore',
      'emerald_ore', 'redstone_ore', 'lapis_ore', 'deepslate_coal_ore',
      'deepslate_iron_ore', 'deepslate_gold_ore', 'deepslate_diamond_ore',
      'oak_log', 'birch_log', 'spruce_log', 'stone', 'cobblestone', 'sand',
    ],
  } = opts;

  const snapshot = {
    self: {
      pos: null,
      health: null,
      food: null,
      xp: null,
      dimension: null,
      onGround: null,
    },
    time: null,
    environment: { biomes: [], blockAtFeet: null, blockAbove: null, light: null },
    inventory: null,
    nearbyBlocks: [],
    hostiles: [],
    passives: [],
    droppedItems: [],
    owner: null,
    hazards: [],
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

  // --- surroundings -----------------------------------------------------
  try {
    const p = bot.entity.position;
    const feet = bot.blockAt(p.offset(0, -0.2, 0));
    const above = bot.blockAt(p.offset(0, 1.8, 0));
    snapshot.environment.blockAtFeet = feet ? feet.name : null;
    snapshot.environment.blockAbove = above ? above.name : null;
  } catch { /* degrade to nulls */ }

  const blockSurvey = surveyBlocks(bot, scanRadius, oreNames);
  if (blockSurvey && !blockSurvey.error) {
    snapshot.nearbyBlocks = blockSurvey.blocks;
  }

  const ent = surveyEntities(bot, entityRadius);
  snapshot.hostiles = ent.hostiles;
  snapshot.passives = ent.passives;
  snapshot.droppedItems = ent.droppedItems;

  // --- owner ------------------------------------------------------------
  try {
    const ownerName = bot.ownerName || (bot._minemindOwner || null);
    if (ownerName) {
      const o = bot.players[ownerName];
      if (o?.entity?.position) {
        const d = round(o.entity.position.distanceTo(bot.entity.position));
        snapshot.owner = { name: ownerName, dist: d, visible: d <= 48, health: o.entity.health };
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
    if (snapshot.self.health !== null && snapshot.self.health <= 6) {
      snapshot.hazards.push({ type: 'low_health', value: snapshot.self.health });
    }
    if (snapshot.self.food !== null && snapshot.self.food <= 6) {
      snapshot.hazards.push({ type: 'low_food', value: snapshot.self.food });
    }
    if (snapshot.hostiles.length && snapshot.hostiles[0].dist <= 4) {
      snapshot.hazards.push({ type: 'mob_adjacent', name: snapshot.hostiles[0].name, dist: snapshot.hostiles[0].dist });
    }
  } catch { /* ignore */ }

  return snapshot;
}

module.exports = { observe, summariseInventory, surveyEntities, surveyBlocks, HOSTILE, PASSIVE };
