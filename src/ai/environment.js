class EnvironmentAnalyzer {
  constructor(bot) {
    this.bot = bot;
  }

  getContext() {
    if (!this.bot.entity || !this.bot.game) return {};
    return {
      time: this._getTimePhase(),
      weather: this.bot.isRaining ? 'rain' : 'clear',
      dimension: this.bot.game.dimension || 'overworld',
      light: this._getLightLevel(),
      biome: this._getBiome(),
      danger: this._assessDanger()
    };
  }

  _getTimePhase() {
    if (!this.bot.time) return 'unknown';
    const t = this.bot.time.timeOfDay;
    if (t < 12000) return 'day';
    if (t < 13000) return 'sunset';
    if (t < 23000) return 'night';
    return 'sunrise';
  }

  _getLightLevel() {
    if (!this.bot.entity) return 15;
    try {
      const block = this.bot.blockAt(this.bot.entity.position);
      return block ? block.light : 15;
    } catch (e) {
      return 15;
    }
  }

  _getBiome() {
    if (!this.bot.entity) return 'plains';
    try {
      const block = this.bot.blockAt(this.bot.entity.position);
      return block ? block.biome : 'plains';
    } catch (e) {
      return 'plains';
    }
  }

  _assessDanger() {
    let danger = 0;
    if (!this.bot.entity) return 0;
    const pos = this.bot.entity.position;
    if (!pos) return 0;
    for (const id in this.bot.entities) {
      const e = this.bot.entities[id];
      if (!e || !e.position) continue;
      if (e === this.bot.entity || e.type !== 'mob') continue;
      const dist = pos.distanceTo(e.position);
      if (dist < 10) danger += 0.2;
      if (dist < 5) danger += 0.3;
    }
    return Math.min(1, danger);
  }
}

module.exports = { EnvironmentAnalyzer };
