class GazeSystem {
  constructor(bot) {
    this.bot = bot;
    this.target = null;
  }

  lookAt(position) {
    if (!position) return;
    this.target = position;
    try {
      this.bot.lookAt(position, true);
    } catch (e) { console.error('[Gaze] lookAt error:', e.message); }
  }

  lookAtEntity(entity) {
    if (!entity || !entity.position) return;
    this.lookAt(entity.position);
  }

  update() {
    if (this.target && this.bot.entity) {
      const dist = this.bot.entity.position.distanceTo(this.target);
      if (dist > 32) {
        this.target = null;
      }
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
