class WorldKnowledge {
  constructor(bot) {
    this.bot = bot;
  }

  getBlockInfo(name) {
    try {
      const registry = this.bot.registry;
      if (!registry) return null;
      if (registry.blocksByName && registry.blocksByName[name]) return registry.blocksByName[name];
      if (!registry.blocks) return null;
      for (const id in registry.blocks) {
        const block = registry.blocks[id];
        if (block.name === name) return block;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  getItemInfo(name) {
    try {
      const registry = this.bot.registry;
      if (!registry) return null;
      if (registry.itemsByName && registry.itemsByName[name]) return registry.itemsByName[name];
      if (!registry.items) return null;
      for (const id in registry.items) {
        const item = registry.items[id];
        if (item.name === name) return item;
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  getBiome(name) {
    try {
      const registry = this.bot.registry;
      if (!registry) return null;
      if (registry.biomesByName && registry.biomesByName[name]) return registry.biomesByName[name];
      if (!registry.biomes) return null;
      for (const id in registry.biomes) {
        if (registry.biomes[id].name === name) return registry.biomes[id];
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  getRecipeFor(itemName) {
    try {
      const recipes = this.bot.recipesFor(itemName, null, 1, null);
      return recipes ? recipes[0] : null;
    } catch (e) {
      return null;
    }
  }
}

module.exports = { WorldKnowledge };
