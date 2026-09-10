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
    for (let x = -range; x <= range; x++) {
      for (let y = -range; y <= range; y++) {
        for (let z = -range; z <= range; z++) {
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
      const blockId = this.bot.registry && this.bot.registry.blocksByName && this.bot.registry.blocksByName[name]
        ? this.bot.registry.blocksByName[name].id : null;
      return this.bot.findBlock({
        matching: blockId != null ? blockId : name,
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
      return this.bot.world.raycast(pos, { x: dx, y: dy, z: dz }, distance || 8);
    } catch (e) {
      return null;
    }
  }
}

module.exports = { WorldPerception };
