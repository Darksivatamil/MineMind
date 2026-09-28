class WorldPerception {
  constructor(bot) {
    this.bot = bot;
  }

  getBlock(pos) {
    if (!this.bot.world) return null;
    try {
      return this.bot.blockAt(pos);
    } catch (e) {
      return null;
    }
  }

  getBlocksInRange(range) {
    const blocks = [];
    if (!this.bot.entity) return blocks;
    const safeRange = Math.min(Math.max(1, range || 4), 8);
    const pos = this.bot.entity.position;
    if (!pos) return blocks;
    for (let x = -safeRange; x <= safeRange; x++) {
      for (let y = -safeRange; y <= safeRange; y++) {
        for (let z = -safeRange; z <= safeRange; z++) {
          const block = this.getBlock({ x: pos.x + x, y: pos.y + y, z: pos.z + z });
          if (block && block.name !== 'air') {
            blocks.push(block);
          }
        }
      }
    }
    return blocks;
  }

  findBlock(name, maxDistance) {
    if (!this.bot.entity) return null;
    try {
      const key = String(name || '').toLowerCase();
      const entry = this.bot.registry && this.bot.registry.blocksByName && this.bot.registry.blocksByName[key];
      if (!entry) return null;
      return this.bot.findBlock({
        matching: entry.id,
        maxDistance: Math.min(maxDistance || 32, 64)
      });
    } catch (e) {
      return null;
    }
  }

  raycast(distance) {
    if (!this.bot.entity) return null;
    const pos = this.bot.entity.position;
    if (!pos) return null;
    const dir = this.bot.entity.yaw;
    const pitch = this.bot.entity.pitch;
    const dx = -Math.sin(dir) * Math.cos(pitch);
    const dy = -Math.sin(pitch);
    const dz = Math.cos(dir) * Math.cos(pitch);
    try {
      const eye = { x: pos.x, y: pos.y + 1.62, z: pos.z };
      return this.bot.world.raycast(eye, { x: dx, y: dy, z: dz }, distance || 8);
    } catch (e) {
      return null;
    }
  }
}

module.exports = { WorldPerception };
