class SocialMemory {
  constructor() {
    this.players = {};
  }

  getPlayer(username) {
    if (!this.players[username]) {
      this.players[username] = {
        username,
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        interactionCount: 0,
        giftsGiven: 0,
        giftsReceived: 0,
        chats: [],
        combatAssists: 0,
        timesDied: 0
      };
    }
    return this.players[username];
  }

  recordChat(username, message) {
    const p = this.getPlayer(username);
    p.interactionCount++;
    p.lastSeen = Date.now();
    p.chats.push({ message, time: Date.now() });
    if (p.chats.length > 100) p.chats.shift();
  }

  recordGift(from, to) {
    this.getPlayer(from).giftsGiven++;
    this.getPlayer(to).giftsReceived++;
  }

  recordCombatAssist(username) {
    this.getPlayer(username).combatAssists++;
  }

  recordDeath(username) {
    this.getPlayer(username).timesDied++;
  }

  getRelationshipScore(username) {
    const p = this.players[username];
    if (!p) return 0;
    const recency = Math.max(0, 1 - (Date.now() - p.lastSeen) / 86400000);
    const chatScore = Math.min(1, p.interactionCount / 50);
    const giftScore = Math.min(1, (p.giftsGiven + p.giftsReceived) / 20);
    return Math.round((recency * 0.3 + chatScore * 0.4 + giftScore * 0.3) * 100) / 100;
  }

  getAllPlayers() {
    return Object.keys(this.players);
  }

  getPlayerSummary(username) {
    const p = this.players[username];
    if (!p) return null;
    return {
      username: p.username,
      relationship: this.getRelationshipScore(username),
      interactions: p.interactionCount,
      lastSeen: p.lastSeen
    };
  }
}

module.exports = { SocialMemory };
