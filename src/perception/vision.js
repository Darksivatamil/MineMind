const vec3 = require('vec3');

class VisionSystem {
  constructor(bot) {
    this.bot = bot;
    this.nearbyEntities = [];
    this.nearbyBlocks = [];
    this._lastScan = 0;
    this._scanThrottleMs = 1000;
  }

  scan() {
    const now = Date.now();
    if (now - this._lastScan < this._scanThrottleMs) return;
    this._lastScan = now;
    this.nearbyEntities = this._scanEntities();
    this.nearbyBlocks = this._scanBlocks();
  }

  _scanEntities() {
    const entities = [];
    if (!this.bot.entity) return entities;
    const pos = this.bot.entity.position;
    if (!pos) return entities;
    for (const id in this.bot.entities) {
      const e = this.bot.entities[id];
      if (!e || !e.position) continue;
      if (e === this.bot.entity) continue;
      const dist = pos.distanceTo(e.position);
      if (dist < 32) {
        entities.push({
          id: e.id,
          name: e.name || e.username || e.type,
          type: e.type,
          position: { x: Math.round(e.position.x), y: Math.round(e.position.y), z: Math.round(e.position.z) },
          distance: Math.round(dist),
          health: e.health
        });
      }
    }
    return entities;
  }

  _scanBlocks() {
    const blocks = [];
    if (!this.bot.entity) return blocks;
    const pos = this.bot.entity.position;
    if (!pos) return blocks;
    for (let x = -8; x <= 8; x++) {
      for (let z = -8; z <= 8; z++) {
        for (let y = -3; y <= 3; y++) {
          const bpos = vec3(Math.floor(pos.x) + x, Math.floor(pos.y) + y, Math.floor(pos.z) + z);
          try {
            const block = this.bot.blockAt(bpos);
            if (block && block.name !== 'air') {
              blocks.push({
                name: block.name,
                position: bpos
              });
            }
          } catch (e) { console.debug('[Vision] blockAt error:', e.message); }
        }
      }
    }
    return blocks;
  }

  getSummary() {
    return {
      entities: this.nearbyEntities.slice(0, 20),
      blocks: this.nearbyBlocks.slice(0, 20),
      count: this.nearbyEntities.length
    };
  }

  findNearest(type, name) {
    return this.nearbyEntities.find(e => e.type === type && (!name || e.name === name));
  }
}

module.exports = { VisionSystem };
