class ReactiveSystem {
  constructor(bot, actions, executor) {
    this.bot = bot;
    this.actions = actions;
    this.executor = executor;
    this.lastDamageTime = 0;
    this.threatEntity = null;
  }

  check() {
    if (!this.bot.entity) return;
    const hp = this.bot.health ?? 20;
    if (hp < 6) {
      this._flee();
    } else if (this.threatEntity) {
      this._fightThreat();
    }
  }

  onEntityHurt(entity) {
    if (entity === this.bot.entity) {
      this.lastDamageTime = Date.now();
      const attacker = this._findAttacker();
      if (attacker) {
        this.threatEntity = attacker;
      }
    }
  }

  onEntityDead(entity) {
    if (this.threatEntity && entity === this.threatEntity) {
      this.threatEntity = null;
    }
  }

  _findAttacker() {
    if (!this.bot.entity) return null;
    const pos = this.bot.entity.position;
    if (!pos) return null;
    let nearest = null;
    let minDist = 16;
    for (const id in this.bot.entities) {
      const e = this.bot.entities[id];
      if (!e || !e.position) continue;
      if (e === this.bot.entity || e.type !== 'mob') continue;
      const dist = pos.distanceTo(e.position);
      if (dist < minDist) {
        minDist = dist;
        nearest = e;
      }
    }
    return nearest;
  }

  _flee() {
    if (!this.bot.entity) return;
    const pos = this.bot.entity.position;
    if (!pos) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = 20;
    const tx = pos.x + Math.cos(angle) * dist;
    const tz = pos.z + Math.sin(angle) * dist;
    this.executor.queue.add({ type: 'move', x: tx, y: pos.y, z: tz }, 100);
  }

  _fightThreat() {
    if (!this.threatEntity) return;
    const hp = this.threatEntity.health;
    if (hp == null || hp > 0) {
      this.executor.queue.add({ type: 'attack', entity: this.threatEntity }, 90);
    } else {
      this.threatEntity = null;
    }
  }
}

module.exports = { ReactiveSystem };
