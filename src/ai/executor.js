const { GoalNear, GoalXZ } = require('mineflayer-pathfinder').goals;

class Executor {
  constructor(bot, actionQueue) {
    this.bot = bot;
    this.queue = actionQueue;
    this.mode = 'TOWARD';
    this.wanderTarget = null;
    this.wanderTimer = 0;
  }

  processQueue() {
    if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) return;

    const next = this.queue.dequeue();
    if (!next) return;

    this._execute(next.action);
  }

  _execute(action) {
    if (!action || !action.type) return;

    switch (action.type) {
      case 'move':
        this._move(action);
        break;
      case 'mine':
        this._mine(action);
        break;
      case 'attack':
        this._attack(action);
        break;
      case 'follow':
        this._follow(action);
        break;
      case 'wander':
        this._wander(action);
        break;
      default:
        break;
    }
  }

  _move(action) {
    this.mode = 'TOWARD';
    if (!this.bot.pathfinder) return;
    try {
      this.bot.pathfinder.setGoal(new GoalNear(action.x, action.y, action.z, 1));
    } catch (e) { console.error('[Executor] move setGoal error:', e.message); }
  }

  _mine(action) {
    this.mode = 'TOWARD';
    if (!this.bot.pathfinder || !action.block) return;
    try {
      this.bot.pathfinder.setGoal(new GoalNear(
        action.block.position.x,
        action.block.position.y,
        action.block.position.z,
        2
      ));
    } catch (e) { console.error('[Executor] mine setGoal error:', e.message); }
  }

  _attack(action) {
    if (!action.entity) return;
    if (!this.bot.pvp || typeof this.bot.pvp.attack !== 'function') {
      console.error('[Executor] pvp plugin not loaded, cannot attack');
      return;
    }
    try {
      this.bot.pvp.attack(action.entity);
    } catch (e) { console.error('[Executor] attack error:', e.message); }
  }

  _follow(action) {
    this.mode = 'TOWARD';
    if (!this.bot.pathfinder || !action.target) return;
    try {
      this.bot.pathfinder.setGoal(new GoalNear(
        action.target.position.x,
        action.target.position.y,
        action.target.position.z,
        2
      ));
    } catch (e) { console.error('[Executor] follow setGoal error:', e.message); }
  }

  _wander(action) {
    this.mode = 'WANDER';
    if (!this.bot.entity || !this.bot.pathfinder) return;
    const pos = this.bot.entity.position;
    if (!pos) return;
    const angle = Math.random() * Math.PI * 2;
    const dist = 5 + Math.random() * 15;
    const tx = pos.x + Math.cos(angle) * dist;
    const tz = pos.z + Math.sin(angle) * dist;

    try {
      this.bot.pathfinder.setGoal(new GoalXZ(tx, tz));
    } catch (e) {
      this.bot.setControlState('forward', true);
      this.bot.setControlState('jump', true);
      setTimeout(() => {
        this.bot.setControlState('forward', false);
        this.bot.setControlState('jump', false);
      }, 2000);
    }
  }

  stop() {
    this.queue.clear();
    if (this.bot.pathfinder) {
      try { this.bot.pathfinder.stop(); } catch (e) { console.error('[Executor] stop error:', e.message); }
    }
    this.bot.setControlState('forward', false);
    this.bot.setControlState('jump', false);
  }
}

module.exports = { Executor };
