'use strict';
/**
 * mock_bot.js — a scripted, in-memory Minecraft world.
 *
 * Real Minecraft servers need Java, which the test environment doesn't have.
 * But the whole point of this project is that gameplay comes from DECISIONS,
 * not from the transport — so to test the brain we only need a world that:
 *   - reports honest state (position, health, food, inventory, nearby blocks)
 *   - accepts the mineflayer calls the executor makes
 *   - CHANGES its state in response, so the verifier can confirm the action
 *     really happened
 *
 * This mock is intentionally adversarial: if the executor lies about success,
 * the verifier catches it, because the mock only changes state when a real
 * effect occurs. It is the test harness that keeps the "anti-fake" guarantee
 * honest — with a real LLM, with a mock provider, or with nothing at all.
 */

const { Vec3 } = require('vec3');

class MockBlock {
  constructor(name, opts = {}) {
    this.name = name;
    this.boundingBox = opts.boundingBox ?? (name === 'air' || name === 'water' ? 'empty' : 'block');
    this.position = opts.position || null;
    this.biome = opts.biome ? { name: opts.biome } : undefined;
    this.lightLevel = opts.light ?? 15;
  }
}

class MockEntity {
  constructor(name, type, pos, opts = {}) {
    this.name = name;
    this.type = type;
    this.position = pos;
    this.health = opts.health ?? 20;
    this.isValid = true;
    this.username = opts.username;
  }
}

/**
 * A block map: key "x,y,z" -> MockBlock. Ground is auto-generated.
 */
class MockWorld {
  constructor(opts = {}) {
    this.blocks = new Map();
    this.entities = new Map();
    this.nextId = 1;
    this.opened = false;
    this.chatLog = [];
    this.attacks = [];
    this.mined = [];
    this.placed = [];
    this.crafted = [];
    this.eaten = [];
    this.jumps = 0;
    this.autoGround = opts.autoGround !== false;
    this.groundName = opts.groundName || 'grass_block';
    this.groundY = opts.groundY ?? 63;
  }

  key(x, y, z) {
    return `${Math.floor(x)},${Math.floor(y)},${Math.floor(z)}`;
  }

  setBlock(x, y, z, name, opts = {}) {
    const b = new MockBlock(name, { ...opts, position: new Vec3(x, y, z) });
    this.blocks.set(this.key(x, y, z), b);
    return b;
  }

  blockAt(p) {
    if (!p) return null;
    const b = this.blocks.get(this.key(p.x, p.y, p.z));
    if (b) return b;
    if (this.autoGround) {
      // Simulate a flat surface centred on the bot's standing height: solid
      // ground exists at y <= GROUND_Y, air above. Deterministic and never
      // mutates the block map (mutation would make fingerprint() change the
      // world and confuse the verifier).
      if (p.y <= this.groundY) {
        return new MockBlock(this.groundName, { position: new Vec3(p.x, this.groundY, p.z) });
      }
      return new MockBlock('air', { boundingBox: 'empty', position: p });
    }
    return new MockBlock('air', { boundingBox: 'empty', position: p });
  }

  addEntity(e) {
    this.entities.set(this.nextId++, e);
    return e;
  }

  removeEntity(e) {
    this.entities.set(e, null);
    e.isValid = false;
  }
}

/** Build a mineflayer-shaped bot backed by a MockWorld. */
function createMockBot(opts = {}) {
  const world = opts.world || new MockWorld(opts);

  const pos = new Vec3(opts.x ?? 0.5, opts.y ?? 64, opts.z ?? 0.5);

  const inventoryItems = () => (opts.inventory || []).map((it, i) => ({ ...it, slot: 36 + i }));

  const bot = {
    _world: world,
    entity: {
      id: 0,
      position: pos,
      yaw: 0,
      onGround: true,
    },
    health: opts.health ?? 20,
    food: opts.food ?? 20,
    experience: { level: opts.xp ?? 0 },
    game: { dimension: opts.dimension || 'overworld' },
    time: { timeOfDay: opts.time ?? 1000, isDay: () => (opts.time ?? 1000) < 13000 },
    ownerName: opts.ownerName ?? 'Player',
    _minemindOwner: opts.ownerName ?? 'Player',
    players: opts.players || {},
    entities: {},
    heldItem: opts.heldItem ?? null,
    pathfinder: null, // assigned below (needs a reference to the fully-built bot)
    registry: { items: (opts.registryItems || {}) },
    inventory: {
      items: inventoryItems,
    },

    blockAt: (p) => world.blockAt(p),

    // --- real mineflayer calls the executor uses ------------------------
    attack(entity) {
      world.attacks.push({ target: entity.name, at: Date.now() });
      // damage is applied so repeated attacks actually kill it
      entity.health = (entity.health ?? 20) - 4;
      if (entity.health <= 0) {
        entity.isValid = false;
        world.entities.delete(entity);
      }
    },
    async dig(block) {
      if (!block || !block.name) throw new Error('nothing to dig');
      world.mined.push(block.name);
      world.blocks.delete(world.key(block.position.x, block.position.y, block.position.z));
      // mining yields an item drop into inventory
      if (opts.yieldDrops !== false) {
        opts.inventory = opts.inventory || [];
        const drop = block.name.replace('_ore', '') + '_ore';
        const existing = opts.inventory.find((i) => i.name === drop);
        if (existing) existing.count++;
        else opts.inventory.push({ name: drop, count: 1 });
        bot.inventory = { items: inventoryItems };
      }
      return true;
    },
    async equip() {
      bot.heldItem = opts.inventory?.[0] || null;
      return true;
    },
    async placeBlock(ref, dest) {
      if (!opts.heldItem) throw new Error('nothing held');
      world.placed.push(opts.heldItem.name);
      world.setBlock(dest.x, dest.y, dest.z, opts.heldItem.name);
      // consume one
      const it = opts.inventory?.find((i) => i.name === opts.heldItem.name);
      if (it) {
        it.count--;
        if (it.count <= 0) opts.inventory = opts.inventory.filter((x) => x !== it);
      }
      return true;
    },
    async consume() {
      const food = (opts.inventory || []).find((i) => /beef|pork|chicken|bread|carrot|potato|melon|apple/.test(i.name));
      if (!food) throw new Error('no food');
      world.eaten.push(food.name);
      food.count--;
      bot.food = Math.min(20, bot.food + 6);
      return true;
    },
    foodItems: () => (opts.inventory || []).filter((i) => /beef|pork|chicken|bread|carrot|potato|melon|apple|rotten_flesh/.test(i.name)),
    async sleep() {
      bot.time.timeOfDay = 1000;
      return true;
    },
    chat(msg) {
      world.chatLog.push(String(msg));
    },
    recipesAll: () => opts.recipes || [],
    recipesFor: () => new Set(opts.recipes || []),
    async craft(recipe) {
      world.crafted.push(recipe);
      return true;
    },
    look: (yes) => { bot._looked = !!yes; },
    on() { return bot; },
    once() { return bot; },
    removeAllListeners() { return bot; },
  };

  // populate entities from the mock world
  function syncEntities() {
    bot.entities = {};
    for (const e of world.entities.values()) {
      if (e && e.isValid) bot.entities[e.id ?? Object.keys(bot.entities).length + 1] = e;
    }
  }
  bot._syncEntities = syncEntities;
  syncEntities();

  // pathfinder last: it closes over `bot`, so it must exist first
  if (!opts.noPathfinder) bot.pathfinder = makePathfinder(bot, world, opts);

  return bot;
}

/** A pathfinder that actually moves the bot (so the verifier sees motion). */
function makePathfinder(bot, world, opts = {}) {
  let id = 0;
  return {
    async walkTo(dest, distance = 0) {
      id++;
      const start = bot.entity.position.clone();
      const steps = opts.moveSteps ?? 8;
      for (let s = 1; s <= steps; s++) {
        const t = s / steps;
        bot.entity.position = new Vec3(
          start.x + (dest.x - start.x) * t,
          start.y + (dest.y - start.y) * t,
          start.z + (dest.z - start.z) * t
        );
        await new Promise((r) => setTimeout(r, 2));
      }
      return true;
    },
    async goto(dest) {
      return this.walkTo(dest);
    },
    stop() {},
  };
}

/* ---------------- scenario builders (the "use cases") ---------------- */

function scenarioFlatWorld(bot, extra = {}) {
  // a normal surface world with ground, sky, some trees
  bot._world.setBlock(0, 62, 0, 'grass_block');
  for (const [x, z] of [[3, 0], [4, 0], [3, 1]]) {
    bot._world.setBlock(x, 63, z, 'oak_log');
  }
  bot._world.setBlock(2, 63, 2, 'stone');
  bot._world.setBlock(-2, 63, 1, 'coal_ore');
  return { ...extra };
}

module.exports = { createMockBot, MockWorld, MockBlock, MockEntity, scenarioFlatWorld };