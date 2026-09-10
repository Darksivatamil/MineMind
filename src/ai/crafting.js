class CraftingSystem {
  constructor(bot) {
    this.bot = bot;
    this.recipes = {};
  }

  async craft(itemName, count) {
    count = count || 1;
    try {
      const recipes = this.bot.recipesFor(itemName, null, 1, null);
      if (!recipes || recipes.length === 0) return false;
      const recipe = recipes[0];
      await this.bot.craft(recipe, count, null);
      return true;
    } catch (e) {
      console.error('[Crafting] craft error:', e.message);
      return false;
    }
  }

  canCraft(itemName) {
    try {
      const recipes = this.bot.recipesFor(itemName, null, 1, null);
      return recipes && recipes.length > 0;
    } catch (e) {
      return false;
    }
  }

  getAvailableRecipes() {
    // Check common craftables against inventory instead of empty this.recipes
    const candidates = ['crafting_table', 'stick', 'torch', 'furnace', 'wooden_pickaxe', 'stone_pickaxe', 'stone_sword', 'chest'];
    const available = [];
    for (const name of candidates) {
      if (this.canCraft(name)) available.push(name);
    }
    return available;
  }
}

module.exports = { CraftingSystem };
