class SocialSystem {
  constructor(bot, socialMemory) {
    this.bot = bot;
    this.memory = socialMemory;
    this.relationships = {};
    this.gossipLog = [];
    this.groupMood = 'neutral';
    this.interactionTypes = [
      'chat', 'gift', 'combat_assist', 'rescue',
      'trade', 'build_together', 'explore_together',
      'teach', 'learn', 'protect'
    ];
  }

  tick() {
    this._updateGroupMood();
  }

  getOverallSocialScore() {
    const players = this.memory.getAllPlayers();
    if (players.length === 0) return 0.5;
    let total = 0;
    for (const p of players) {
      total += this.memory.getRelationshipScore(p);
    }
    return total / players.length;
  }

  _updateGroupMood() {
    const avg = this.getOverallSocialScore();
    if (avg > 0.7) this.groupMood = 'harmonious';
    else if (avg > 0.4) this.groupMood = 'friendly';
    else if (avg > 0.2) this.groupMood = 'neutral';
    else this.groupMood = 'tense';
  }

  getRelationship(username) {
    if (!this.relationships[username]) {
      this.relationships[username] = {
        trust: 0.3,
        respect: 0.3,
        affection: 0.2,
        loyalty: 0.3,
        dependence: 0.1,
        fear: 0.1,
        rivalry: 0.1,
        indebtedness: 0.1,
        familiarity: 0.2
      };
    }
    return this.relationships[username];
  }

  modifyRelationship(username, metric, delta) {
    const VALID = ['trust', 'respect', 'affection', 'loyalty', 'dependence', 'fear', 'rivalry', 'indebtedness', 'familiarity'];
    if (!VALID.includes(metric)) { console.warn(`[Social] unknown metric: ${metric}`); return; }
    const rel = this.getRelationship(username);
    rel[metric] = Math.min(1, Math.max(0, (rel[metric] ?? 0) + delta));
  }

  recordInteraction(username, type) {
    if (!this.interactionTypes.includes(type)) return;
    if (type === 'chat') this.memory.recordChat(username, `[${type}]`);
    else this.memory.getPlayer(username).interactionCount++;
    const delta = this._getInteractionDelta(type);
    for (const [metric, change] of Object.entries(delta)) {
      this.modifyRelationship(username, metric, change);
    }
  }

  _getInteractionDelta(type) {
    const deltas = {
      chat: { familiarity: 0.02, trust: 0.01 },
      gift: { affection: 0.05, trust: 0.03, indebtedness: 0.04 },
      combat_assist: { loyalty: 0.04, respect: 0.03, trust: 0.02 },
      rescue: { loyalty: 0.08, dependence: 0.04, indebtedness: 0.06 },
      trade: { trust: 0.02, respect: 0.02 },
      build_together: { familiarity: 0.03, respect: 0.02 },
      explore_together: { familiarity: 0.03, trust: 0.02 },
      teach: { respect: 0.04, dependence: 0.03 },
      learn: { respect: 0.03, trust: 0.02 },
      protect: { loyalty: 0.05, dependence: 0.03, indebtedness: 0.02 }
    };
    return deltas[type] || { familiarity: 0.01 };
  }

  addGossip(topic, source, target) {
    this.gossipLog.push({ topic, source, target, time: Date.now() });
    if (this.gossipLog.length > 100) this.gossipLog.shift();
  }

  getOverallSocialScore() {
    const players = this.memory.getAllPlayers();
    if (players.length === 0) return 0.5;
    let total = 0;
    for (const p of players) {
      total += this.memory.getRelationshipScore(p);
    }
    return total / players.length;
  }

  onPlayerJoined(player) {
    const username = (player && player.username) || (typeof player === 'string' ? player : null);
    if (!username) return;
    this.memory.getPlayer(username);
  }

  onPlayerLeft(player) {
    const username = (player && player.username) || (typeof player === 'string' ? player : null);
    if (!username) return;
    const p = this.memory.players[username];
    if (p) p.lastSeen = Date.now();
  }
}

module.exports = { SocialSystem };
