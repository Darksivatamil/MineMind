class ExplorationSystem {
  constructor(bot) {
    this.bot = bot;
    this.sectors = {};
    this.gridSize = 32;
    this.currentTarget = null;
    this.visitedCount = 0;
    this.maxSectors = 500;
  }

  tick() {
    if (!this.bot.entity || !this._shouldExplore()) return;
    const sector = this._getCurrentSector();
    this._markVisited(sector);
    this._pruneSectors();
    if (!this.currentTarget || this._reachedTarget()) {
      this.currentTarget = this._findUnexploredSector();
      if (this.currentTarget) {
        this._moveTo(this.currentTarget);
      }
    }
  }

  tickFast() {
    // Do not double-count visits here; tick() already marks visited. Only update target reach check.
    if (!this.bot.entity) return;
  }

  _shouldExplore() {
    return this.bot.health > 6 && this.bot.food > 6;
  }

  _getCurrentSector() {
    const pos = this.bot.entity.position;
    return {
      x: Math.floor(pos.x / this.gridSize),
      z: Math.floor(pos.z / this.gridSize)
    };
  }

  _getSectorKey(sector) {
    return `${sector.x},${sector.z}`;
  }

  _markVisited(sector) {
    const key = this._getSectorKey(sector);
    if (!this.sectors[key]) {
      this.sectors[key] = { visited: 0, lastVisit: 0 };
      this.visitedCount++;
    }
    this.sectors[key].visited++;
    this.sectors[key].lastVisit = Date.now();
  }

  _pruneSectors() {
    const keys = Object.keys(this.sectors);
    if (keys.length <= this.maxSectors) return;
    // Drop oldest by lastVisit
    keys.sort((a, b) => this.sectors[a].lastVisit - this.sectors[b].lastVisit);
    for (let i = 0; i < keys.length - this.maxSectors; i++) delete this.sectors[keys[i]];
  }

  _findUnexploredSector() {
    const current = this._getCurrentSector();
    let best = null;
    let bestScore = -Infinity;

    for (let dx = -5; dx <= 5; dx++) {
      for (let dz = -5; dz <= 5; dz++) {
        if (dx === 0 && dz === 0) continue;
        const sx = current.x + dx;
        const sz = current.z + dz;
        const key = this._getSectorKey({ x: sx, z: sz });
        const s = this.sectors[key];
        const visits = s ? s.visited : 0;
        if (visits > 3) continue;
        const dist = Math.abs(dx) + Math.abs(dz);
        const score = dist - visits * 3;
        if (score > bestScore) {
          bestScore = score;
          best = { x: sx, z: sz };
        }
      }
    }
    return best;
  }

  _reachedTarget() {
    if (!this.currentTarget || !this.bot.entity) return true;
    const pos = this.bot.entity.position;
    const cx = this.currentTarget.x * this.gridSize + this.gridSize / 2;
    const cz = this.currentTarget.z * this.gridSize + this.gridSize / 2;
    return Math.abs(pos.x - cx) < 4 && Math.abs(pos.z - cz) < 4;
  }

  _moveTo(sector) {
    const x = sector.x * this.gridSize + this.gridSize / 2;
    const z = sector.z * this.gridSize + this.gridSize / 2;
    const y = this.bot.entity.position.y;
    try {
      this.bot.pathfinder.setGoal(new (require('mineflayer-pathfinder').goals.GoalXZ)(x, z));
    } catch (e) { console.error('[Exploration] setGoal error:', e.message); }
  }
}

module.exports = { ExplorationSystem };
