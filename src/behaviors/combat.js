class CombatBehavior {
  constructor(bot, systems) {
    this.bot = bot;
    this.systems = systems;
    this.target = null;
    this.combatMode = false;
  }

  engage(entity) {
    this.target = entity;
    this.combatMode = true;
  }

  disengage() {
    this.target = null;
    this.combatMode = false;
    try { this.bot.pvp.stop(); } catch (e) { console.error('[Combat] disengage stop error:', e.message); }
  }

  tick() {
    if (!this.combatMode || !this.target) return;
    const hp = this.target.health;
    if (hp != null && hp <= 0) {
      this.disengage();
      return;
    }

    if (!this.bot.entity || !this.target.position || !this.bot.entity.position) { this.disengage(); return; }
    const dist = this.bot.entity.position.distanceTo(this.target.position);
    if (dist > 32) {
      this.disengage();
      return;
    }

    try {
      if (!this.bot.pvp || typeof this.bot.pvp.attack !== 'function') { console.error('[Combat] pvp plugin missing'); this.disengage(); return; }
      this.bot.pvp.attack(this.target);
    } catch (e) { console.error('[Combat] attack error:', e.message); }
  }

  isFighting() {
    if (!this.combatMode || !this.target) return false;
    const hp = this.target.health;
    if (hp == null) return true;
    return hp > 0 && !Number.isNaN(hp);
  }
}

module.exports = { CombatBehavior };
