class DesireSystem {
  constructor(bot) {
    this.bot = bot;
    this.desires = {
      safety: 0,
      hunger: 0,
      exploration: 0,
      social: 0,
      combat: 0,
      progression: 0
    };
  }

  update() {
    const hp = this.bot.health ?? 20;
    const food = this.bot.food ?? 20;

    this.desires.safety = Math.max(0, 1 - hp / 20) * 0.8 + (hp < 6 ? 0.2 : 0);
    this.desires.hunger = Math.max(0, 1 - food / 20) * 0.9 + (food < 6 ? 0.1 : 0);
    this.desires.exploration = 0.1 + Math.random() * 0.2;

    const nearbyMobs = this._countNearbyMobs();
    this.desires.combat = Math.min(0.8, nearbyMobs * 0.15);

    this.desires.social = 0.1;
    this.desires.progression = 0.2;
  }

  _countNearbyMobs() {
    let count = 0;
    if (!this.bot.entity) return 0;
    const pos = this.bot.entity.position;
    if (!pos) return 0;
    const HOSTILE = ['zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'witch', 'pillager', 'phantom', 'slime', 'blaze', 'ghast'];
    for (const id in this.bot.entities) {
      const e = this.bot.entities[id];
      if (!e || !e.position) continue;
      if (e === this.bot.entity) continue;
      if (e.type === 'mob' && e.position && pos.distanceTo(e.position) < 16) {
        if (e.mobType && HOSTILE.includes(e.mobType)) count++;
        else if (e.name && HOSTILE.some(h => e.name.toLowerCase().includes(h))) count++;
      }
    }
    return count;
  }

  getState() {
    return { ...this.desires };
  }

  getStrongest() {
    let max = 0;
    let key = 'exploration';
    for (const k in this.desires) {
      if (this.desires[k] > max) {
        max = this.desires[k];
        key = k;
      }
    }
    return { desire: key, strength: max };
  }
}

module.exports = { DesireSystem };
