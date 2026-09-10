const vec3 = require('vec3');
const { goals } = require('mineflayer-pathfinder');

class SurvivalSystem {
  constructor(bot, actions, executor, exploration) {
    this.bot = bot;
    this.actions = actions;
    this.executor = executor;
    this.exploration = exploration;
    this.subsystems = {
      resourceWeb: new ResourceWeb(bot),
      foodPipeline: new FoodPipeline(bot, actions),
      autoFarm: new AutoFarm(bot),
      shelterManager: new ShelterManager(bot),
      torchManager: new TorchManager(bot),
      explorationGrid: exploration,
      combatReadiness: new CombatReadiness(bot),
      healthManager: new HealthManager(bot, actions)
    };
  }

  tick() {
    for (const [name, sys] of Object.entries(this.subsystems)) {
      if (sys && sys.tick) {
        try { sys.tick(); } catch (e) { console.error('[Survival] ' + name + ' tick error:', e.message); }
      }
    }
    const critical = this.getCriticalNeeds();
    if (critical.length > 0) {
      const top = critical[0];
      if (top.action) top.action();
    }
  }

  getCriticalNeeds() {
    const needs = [];

    if (this.bot.health < 6) {
      needs.push({ priority: 100, label: 'low_health', action: () => this.subsystems.healthManager.emergencyHeal() });
    } else if (this.bot.health < 10) {
      needs.push({ priority: 50, label: 'moderate_health', action: () => this.subsystems.healthManager.heal() });
    }
    if (this.bot.food < 6) {
      needs.push({ priority: 90, label: 'hungry', action: () => this.subsystems.foodPipeline.findFood() });
    } else if (this.bot.food < 10) {
      needs.push({ priority: 40, label: 'moderate_hunger', action: () => this.subsystems.foodPipeline.eatBest() });
    }

    const pos = this.bot.entity ? this.bot.entity.position : null;
    if (pos) {
      // Check surrounding blocks for shelter (not the air block the bot stands in)
      let enclosed = 0;
      try {
        for (const [ox, oy, oz] of [[1,0,0],[-1,0,0],[0,0,1],[0,0,-1],[0,1,0]]) {
          const b = this.bot.blockAt(vec3(Math.floor(pos.x)+ox, Math.floor(pos.y)+oy, Math.floor(pos.z)+oz));
          if (b && b.name !== 'air') enclosed++;
        }
      } catch (e) { /* ignore */ }
      if (enclosed === 0 && this.bot.time && this.bot.time.timeOfDay > 13000) {
        needs.push({ priority: 30, label: 'no_shelter', action: () => this.subsystems.shelterManager.findShelter() });
      }
    }

    if (this.bot.time && this.bot.time.timeOfDay > 13000) {
      needs.push({ priority: 20, label: 'night', action: () => this.subsystems.shelterManager.findShelter() });
    }

    needs.sort((a, b) => b.priority - a.priority);
    return needs;
  }

  getStatus() {
    return {
      health: this.bot.health,
      food: this.bot.food,
      subsystems: Object.keys(this.subsystems).reduce((acc, k) => {
        acc[k] = this.subsystems[k] ? 'active' : 'inactive';
        return acc;
      }, {})
    };
  }
}

class ResourceWeb {
  constructor(bot) {
    this.bot = bot;
    this.resources = {};
  }
  tick() {
    this.resources = {};
    const items = this.bot.inventory ? this.bot.inventory.items() : [];
    for (const item of items) {
      this.resources[item.name] = (this.resources[item.name] || 0) + item.count;
    }
  }
  getCount(item) { return this.resources[item] || 0; }
}

class FoodPipeline {
  constructor(bot, actions) {
    this.bot = bot;
    this.actions = actions;
  }
  findFood() {
    if (this.actions) this.actions.eat();
  }
  eatBest() {
    if (this.actions) this.actions.eat();
  }
  tick() {}
}

class AutoFarm {
  constructor(bot) { this.bot = bot; }
  tick() {}
}

class ShelterManager {
  constructor(bot) { this.bot = bot; this._lastDir = 0; }
  findShelter() {
    if (!this.bot.entity) return;
    const pos = this.bot.entity.position;
    // Rotate through 4 directions to avoid retrying same stuck spot
    const dirs = [[3,3],[-3,3],[3,-3],[-3,-3]];
    const [ox, oz] = dirs[this._lastDir % dirs.length];
    this._lastDir++;
    const dx = Math.round(pos.x) + ox;
    const dz = Math.round(pos.z) + oz;
    try {
      this.bot.pathfinder.setGoal(new goals.GoalNear(dx, pos.y, dz, 1));
    } catch (e) { console.error('[ShelterManager] setGoal error:', e.message); }
  }
  tick() {}
}

class TorchManager {
  constructor(bot) { this.bot = bot; }
  tick() {}
}

class CombatReadiness {
  constructor(bot) { this.bot = bot; }
  tick() {}
}

class HealthManager {
  constructor(bot, actions) {
    this.bot = bot;
    this.actions = actions;
  }
  emergencyHeal() {
    if (this.actions) this.actions.eat();
    this._flee();
  }
  heal() {
    if (this.actions && this.bot.food < 15) this.actions.eat();
  }
  _flee() {
    if (!this.bot.entity) return;
    const pos = this.bot.entity.position;
    const angle = Math.random() * Math.PI * 2;
    try {
      this.bot.pathfinder.setGoal(new goals.GoalNear(
        pos.x + Math.cos(angle) * 20, pos.y, pos.z + Math.sin(angle) * 20, 2
      ));
    } catch (e) { console.error('[HealthManager] flee setGoal error:', e.message); }
  }
  tick() {}
}

module.exports = { SurvivalSystem };
