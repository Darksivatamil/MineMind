const { GoalNear, GoalXZ } = require('mineflayer-pathfinder').goals;

class Executor {
  constructor(bot, actionQueue) {
    this.bot = bot;
    this.queue = actionQueue;
    this.mode = 'TOWARD';
    this.wanderTarget = null;
    this.wanderTimer = 0;
    this.current = null;
    try {
      if (this.bot && typeof this.bot.on === 'function') {
        this.bot.on('goal_reached', () => {
          try { if (this.queue && typeof this.queue.complete === 'function') this.queue.complete(); } catch (e) {}
          this.current = null;
        });
      }
    } catch (e) {}
  }

  processQueue() {
    // Anti-stall: if stuck on the same action too long, drop it (prevents mine/attack starvation)
    if (this.current && this.current.started && (Date.now() - this.current.started) > 15000) {
      try { if (this.queue && typeof this.queue.complete === 'function') this.queue.complete(); } catch (e) {}
      this.current = null;
    }
    if (this.bot.pathfinder && this.bot.pathfinder.isMoving()) return;

    const next = this.queue.dequeue();
    if (!next) return;
    this.current = next;

    try {
      this._execute(next.action);
    } finally {
      // Movement goals are async (pathfinder); instant actions complete immediately
      const t = next.action && next.action.type;
      if (t !== 'move' && t !== 'mine' && t !== 'follow' && t !== 'wander') {
        try { this.queue.complete(); } catch (e) {}
        this.current = null;
      } else if (t === 'attack') {
        try { this.queue.complete(); } catch (e) {}
        this.current = null;
      }
    }
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
      const bp = action.block.position;
      const dist = this.bot.entity ? this.bot.entity.position.distanceTo(bp) : 99;
      if (dist < 4.5) {
        // In range: actually dig (old code only walked to the block and never dug)
        try {
          const tool = this.bot.pathfinder ? null : null;
          void tool;
          this.bot.dig(action.block).then(() => {
            try { this.queue.complete(); } catch (e) {}
            this.current = null;
          }).catch(() => {
            try { this.queue.complete(); } catch (e) {}
            this.current = null;
          });
        } catch (e) {
          try { this.queue.complete(); } catch (e2) {}
          this.current = null;
        }
        return;
      }
      this.bot.pathfinder.setGoal(new GoalNear(
        action.block.position.x,
        action.block.position.y,
        action.block.position.z,
        2
      ));
      // Re-queue so we dig once we arrive (with a bounded retry via anti-stall timer)
      try { this.queue.add({ type: 'mine', block: action.block }, 0); } catch (e) {}
      try { this.queue.complete(); } catch (e) {}
      this.current = null;
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
