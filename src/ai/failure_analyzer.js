class FailureAnalyzer {
  constructor() {
    this.history = [];
    this.maxHistory = 50;
  }

  record(action, result, context) {
    this.history.push({
      action,
      result,
      context,
      time: Date.now()
    });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  getRecentFailures(count) {
    return this.history.filter(h => h.result === 'failure').slice(-(count || 5));
  }

  getFailureRate(type) {
    const relevant = this.history.filter(h => h.action && h.action.type === type);
    if (relevant.length === 0) return 0;
    const failures = relevant.filter(h => h.result === 'failure').length;
    return failures / relevant.length;
  }

  getPatterns() {
    const patterns = {};
    for (const h of this.history) {
      if (h.result === 'failure') {
        const key = h.action ? h.action.type : 'unknown';
        patterns[key] = (patterns[key] || 0) + 1;
      }
    }
    return patterns;
  }
}

module.exports = { FailureAnalyzer };
