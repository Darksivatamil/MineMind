class GazeSystem {
  constructor(bot) {
    this.bot = bot;
    this.target = null;
  }

  lookAt(position) {
    if (!position) return;
    this.target = position;
    try {
      const p = this.bot.lookAt(position, true);
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (e) { console.error('[Gaze] lookAt error:', e.message); }
  }

  lookAtEntity(entity) {
    if (!entity || !entity.position) return;
    // Aim at head height for human-like eye contact
    const p = entity.position.clone ? entity.position.clone() : entity.position;
    try { if (p && p.offset) p.y += 1.5; else if (p) p.y += 1.5; } catch (e) {}
    this.lookAt(p);
  }

  update() {
    if (this.target && this.bot.entity) {
      try {
        const dist = this.bot.entity.position.distanceTo(this.target);
        if (dist > 32) {
          this.target = null;
          return;
        }
        // Continuous re-track: keep head locked while target is close
        const p = this.bot.lookAt(this.target, true);
        if (p && typeof p.catch === 'function') p.catch(() => {});
      } catch (e) {}
    }
  }

  getHeadDirection() {
    return {
      yaw: this.bot.entity ? this.bot.entity.yaw : 0,
      pitch: this.bot.entity ? this.bot.entity.pitch : 0
    };
  }

  clearTarget() {
    this.target = null;
  }
}

module.exports = { GazeSystem };
