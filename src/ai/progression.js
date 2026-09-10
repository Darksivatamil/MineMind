class ProgressionManager {
  constructor(bot) {
    this.bot = bot;
    this.tiers = {
      stone: ['wooden_pickaxe', 'stone_pickaxe', 'furnace'],
      iron: ['iron_pickaxe', 'iron_sword', 'bucket', 'shield'],
      diamond: ['diamond_pickaxe', 'diamond_sword', 'enchanting_table'],
      nether: ['netherite_scrap', 'netherite_ingot', 'netherite_pickaxe'],
      end: ['ender_pearl', 'blaze_rod', 'eye_of_ender']
    };
    this.unlocked = new Set(['wooden_pickaxe']);
  }

  tick() {
    const items = this.bot.inventory ? this.bot.inventory.items() : [];
    for (const item of items) {
      for (const tier in this.tiers) {
        for (const required of this.tiers[tier]) {
          if (item.name === required) {
            this.unlocked.add(required);
          }
        }
      }
    }
  }

  getCurrentTier() {
    const tiers = ['stone', 'iron', 'diamond', 'nether', 'end'];
    for (let i = tiers.length - 1; i >= 0; i--) {
      const tierItems = this.tiers[tiers[i]];
      const hasAll = tierItems.every(item => this.unlocked.has(item));
      if (hasAll) return tiers[i];
    }
    return 'wood';
  }

  getNextMilestone() {
    const current = this.getCurrentTier();
    const tiers = ['stone', 'iron', 'diamond', 'nether', 'end'];
    const idx = tiers.indexOf(current);
    if (idx >= tiers.length - 1) return null;
    const next = tiers[idx + 1];
    return { tier: next, items: this.tiers[next].filter(i => !this.unlocked.has(i)) };
  }

  isUnlocked(itemName) {
    return this.unlocked.has(itemName);
  }
}

module.exports = { ProgressionManager };
