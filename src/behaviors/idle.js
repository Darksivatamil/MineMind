const { goals } = require('mineflayer-pathfinder');
class IdleBehavior {
  constructor(bot, systems) {
    this.bot = bot;
    this.systems = systems;
    this.idleTimer = 0;
    this.idleActions = ['look_around', 'check_inventory', 'small_move', 'emote'];
  }

  tick() {
    this.idleTimer++;
    if (this.idleTimer < 20) return;
    this.idleTimer = 0;

    if (this._shouldIdle()) {
      this._performIdleAction();
    }
  }

  _shouldIdle() {
    const exec = this.systems.executor;
    if (exec && exec.queue && typeof exec.queue.size === 'function' && exec.queue.size() > 0) return false;
    return this.bot.health > 6;
  }

  _performIdleAction() {
    const action = this.idleActions[Math.floor(Math.random() * this.idleActions.length)];

    switch (action) {
      case 'look_around':
        this._lookAround();
        break;
      case 'check_inventory':
        break;
      case 'small_move':
        this._smallMove();
        break;
      case 'emote':
        break;
    }
  }

  _lookAround() {
    if (!this.bot.entity) return;
    const yaw = Math.random() * Math.PI * 2;
    const pitch = (Math.random() - 0.5) * 0.5;
    try {
      this.bot.look(yaw, pitch, true);
    } catch (e) { console.error('[IdleBehavior] look error:', e.message); }
  }

  _smallMove() {
    if (!this.bot.entity) return;
    if (!this.bot.pathfinder) return;
    const pos = this.bot.entity.position;
    const angle = Math.random() * Math.PI * 2;
    try {
      this.bot.pathfinder.setGoal(new goals.GoalNear(
        pos.x + Math.cos(angle) * 2,
        pos.y,
        pos.z + Math.sin(angle) * 2,
        1
      ));
    } catch (e) { console.error('[IdleBehavior] smallMove error:', e.message); }
  }
}

module.exports = { IdleBehavior };
