class Actions {
  constructor(bot) {
    this.bot = bot;
    this.lastMineTime = 0;
    this.lastUrgentMineTime = 0;
    this.cooldowns = {};
  }

  isOnCooldown(action) {
    const last = this.cooldowns[action];
    if (!last) return false;
    return Date.now() - last < this._getCooldown(action);
  }

  _getCooldown(action) {
    if (action === 'mine') return 15000;
    if (action === 'urgentMine') return 30000;
    if (action === 'attack') return 500;
    if (action === 'eat') return 1000;
    return 1000;
  }

  async mineBlock(block, urgent) {
    if (!block) return false;
    if (urgent) {
      if (this.isOnCooldown('urgentMine')) return false;
      this.cooldowns['urgentMine'] = Date.now();
    } else {
      if (this.isOnCooldown('mine')) return false;
      this.cooldowns['mine'] = Date.now();
    }
    try {
      await this.bot.tool.equipForBlock(block);
      await this.bot.dig(block);
      return true;
    } catch (e) {
      console.log('Dig error:', e.message);
      return false;
    }
  }

  async equip(itemName) {
    if (this.isOnCooldown('equip')) return false;
    this.cooldowns['equip'] = Date.now();
    try {
      const item = this.bot.inventory.items().find(i => i.name === itemName);
      if (item) {
        await this.bot.equip(item, 'hand');
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  async placeBlock(blockType, referenceBlock, offset) {
    if (this.isOnCooldown('place')) return false;
    this.cooldowns['place'] = Date.now();
    try {
      const item = this.bot.inventory.items().find(i => i.name === blockType);
      if (!item) return false;
      await this.bot.equip(item, 'hand');
      await this.bot.placeBlock(referenceBlock, offset || { x: 0, y: 1, z: 0 });
      return true;
    } catch (e) {
      return false;
    }
  }

  attack(entity) {
    if (!entity) return false;
    if (this.isOnCooldown('attack')) return false;
    this.cooldowns['attack'] = Date.now();
    try {
      this.bot.attack(entity);
      return true;
    } catch (e) {
      return false;
    }
  }

  async eat() {
    if (this.isOnCooldown('eat')) return false;
    this.cooldowns['eat'] = Date.now();
    try {
      const food = this.bot.inventory.items().find(i => i.foodPoints > 0);
      if (food) {
        await this.bot.equip(food, 'hand');
        await this.bot.consume();
        return true;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  sleep(bed) {
    if (!bed) return false;
    try {
      this.bot.sleep(bed);
      return true;
    } catch (e) {
      return false;
    }
  }
}

module.exports = { Actions };
