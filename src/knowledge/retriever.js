const fs = require('fs');
const path = require('path');

class KnowledgeRetriever {
  constructor() {
    this.cache = {};
    this._loadAll();
  }

  _loadAll() {
    const categoriesPath = path.join(__dirname, 'categories');
    const files = ['biomes', 'items', 'mobs', 'recipes', 'potions', 'progression', 'structures', 'enchantments'];
    for (const file of files) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(categoriesPath, `${file}.json`), 'utf8'));
        this.cache[file] = data;
      } catch (e) {
        console.warn(`Could not load knowledge category: ${file}`);
        this.cache[file] = {};
      }
    }
    try {
      const mainData = JSON.parse(fs.readFileSync(path.join(__dirname, 'minecraft_knowledge.json'), 'utf8'));
      this.cache.main = mainData;
    } catch (e) {
      this.cache.main = {};
    }
  }

  query(category, key) {
    const cat = this.cache[category];
    if (!cat) return null;
    if (key) return cat[key] || null;
    return cat;
  }

  search(query) {
    if (!query || typeof query !== 'string') return [];
    const q = query.toLowerCase();
    const results = [];
    for (const [category, data] of Object.entries(this.cache)) {
      if (data != null && typeof data === 'object' && !Array.isArray(data)) {
        for (const key of Object.keys(data)) {
          if (key.toLowerCase().includes(q)) {
            results.push({ category, key, value: data[key] });
          } else {
            const val = data[key];
            if (val != null && typeof val === 'object') {
              const nested = JSON.stringify(val).toLowerCase();
              if (nested.includes(q)) results.push({ category, key, value: val });
            }
          }
        }
      }
    }
    return results.slice(0, 10);
  }

  getRecipeFor(item) {
    return this.query('recipes', item);
  }

  getMobInfo(mob) {
    return this.query('mobs', mob);
  }

  getItemInfo(item) {
    return this.query('items', item);
  }
}

module.exports = { KnowledgeRetriever };
