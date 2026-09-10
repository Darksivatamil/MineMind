class EmotionSystem {
  constructor() {
    this.current = 'neutral';
    this.intensity = 0.5;
    this.history = [];
    this.states = {
      neutral: { decay: 0.01 },
      happy: { decay: 0.02 },
      sad: { decay: 0.015 },
      angry: { decay: 0.03 },
      fearful: { decay: 0.02 },
      surprised: { decay: 0.04 },
      curious: { decay: 0.01 },
      grateful: { decay: 0.01 },
      lonely: { decay: 0.005 }
    };
  }

  set(mood, intensity) {
    this.history.push({ mood, intensity, time: Date.now() });
    if (this.history.length > 50) this.history.shift();
    this.current = mood;
    this.intensity = Math.min(1, Math.max(0, intensity || 0.5));
  }

  tick() {
    const state = this.states[this.current];
    if (state) {
      this.intensity = Math.max(0.1, this.intensity - state.decay);
      if (this.intensity <= 0.1 && this.current !== 'neutral') {
        this.current = 'neutral';
        this.intensity = 0.5;
      }
    }
  }

  getState() {
    return { mood: this.current, intensity: Math.round(this.intensity * 100) / 100 };
  }

  getRecent() {
    return this.history.slice(-5);
  }
}

module.exports = { EmotionSystem };
