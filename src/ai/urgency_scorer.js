class UrgencyScorer {
  constructor() {
    this.weights = {
      immediate: 1.0,
      high: 0.7,
      medium: 0.4,
      low: 0.1
    };
  }

  score(action, context) {
    let base = this.weights[action.urgency] || 0.3;

    if (action.type === 'eat' && context.food < 6) base += 0.5;
    if (action.type === 'flee' && context.health < 6) base += 0.6;
    if (action.type === 'attack' && context.threat) base += 0.4;
    if (action.type === 'sleep' && context.phase === 'night') base += 0.3;
    if (action.type === 'mine' && context.desiredMaterial) base += 0.2;

    return Math.min(1, base);
  }

  getUrgencyLabel(score) {
    if (score >= 0.8) return 'critical';
    if (score >= 0.5) return 'high';
    if (score >= 0.3) return 'medium';
    return 'low';
  }
}

module.exports = { UrgencyScorer };
