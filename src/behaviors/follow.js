const { GoalNear } = require('mineflayer-pathfinder').goals;

class FollowBehavior {
  constructor(bot, systems) {
    this.bot = bot;
    this.systems = systems;
    this.target = null;
    this.following = false;
    this.followDistance = 3;
    this._sprintJumpTimer = 0;
  }

  start(username) {
    this.following = true;
    this.target = username;
  }

  stop() {
    this.following = false;
    this.target = null;
    this._sprintJumpTimer = 0;
    if (this._jumpTimeout) { clearTimeout(this._jumpTimeout); this._jumpTimeout = null; }
    try { this.bot.setControlState('sprint', false); } catch (e) {}
    try { this.bot.setControlState('jump', false); } catch (e) {}
    if (this.bot.pathfinder) { try { this.bot.pathfinder.stop(); } catch (e) {} }
  }

  tick() {
    if (!this.following || !this.target) return;
    const player = this.bot.players[this.target];
    if (!player || !player.entity || !player.entity.position || !this.bot.entity) {
      this.stop();
      return;
    }

    const dist = this.bot.entity.position.distanceTo(player.entity.position);
    if (dist > this.followDistance + 2) {
      try {
        if (!this.bot.pathfinder) return;
        this.bot.pathfinder.setGoal(new GoalNear(
          player.entity.position.x,
          player.entity.position.y,
          player.entity.position.z,
          this.followDistance
        ));
      } catch (e) { console.error('[Follow] setGoal error:', e.message); }
      this.bot.setControlState('sprint', true);
      this._sprintJumpTimer++;
      const vel = this.bot.entity.velocity;
      const stuck = vel && Math.abs(vel.x) < 0.02 && Math.abs(vel.z) < 0.02;
      if (this._sprintJumpTimer % (2 + Math.floor(Math.random() * 3)) === 0 || stuck) {
        this.bot.setControlState('jump', true);
        if (this._jumpTimeout) clearTimeout(this._jumpTimeout);
        this._jumpTimeout = setTimeout(() => { try { this.bot.setControlState('jump', false); } catch (e) {} }, 200);
      }
    } else if (dist < 1.5) {
      try { if (this.bot.pathfinder) this.bot.pathfinder.stop(); } catch (e) { console.error('[Follow] stop error:', e.message); }
      this.bot.setControlState('sprint', false);
      this.bot.setControlState('jump', false);
      this._sprintJumpTimer = 0;
    } else {
      // Dead-zone: walk, don't sprint
      this.bot.setControlState('sprint', false);
    }
  }
}

module.exports = { FollowBehavior };
