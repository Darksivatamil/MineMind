class PersonalityV2 {
  constructor() {
    this.traits = {
      openness: 0.7,
      conscientiousness: 0.6,
      extraversion: 0.6,
      agreeableness: 0.7,
      neuroticism: 0.4
    };
    this.currentMood = 'neutral';
    this.moodIntensity = 0.5;
    this.evolutionStage = 0;
    this.experience = 0;
    this._saveAt = 0;
    this._file = null;
    try {
      const path = require('path');
      this._file = path.join(__dirname, '..', '..', 'config', 'personality.json');
      const fs = require('fs');
      if (fs.existsSync(this._file)) {
        const d = JSON.parse(fs.readFileSync(this._file, 'utf8'));
        if (d && d.traits) {
          for (const k of Object.keys(this.traits)) {
            if (typeof d.traits[k] === 'number') this.traits[k] = Math.min(1, Math.max(0, d.traits[k]));
          }
        }
        if (typeof d.experience === 'number') this.experience = Math.max(0, d.experience);
        if (typeof d.evolutionStage === 'number') this.evolutionStage = Math.min(4, Math.max(0, d.evolutionStage));
      } else {
        // First run only: small deterministic variation (no more full-random restarts)
        const j = () => (Math.random() - 0.5) * 0.1;
        for (const k of Object.keys(this.traits)) this.traits[k] = Math.min(1, Math.max(0, this.traits[k] + j()));
        this._save();
      }
    } catch (e) {}
    this.moods = {
      neutral: { triggers: ['calm', 'safe'], decay: 0.01 },
      happy: { triggers: ['gift', 'chat', 'discovery'], decay: 0.02 },
      sad: { triggers: ['death', 'rejection', 'loss'], decay: 0.015 },
      angry: { triggers: ['attack', 'betrayal', 'frustration'], decay: 0.03 },
      fearful: { triggers: ['damage', 'night', 'hostile'], decay: 0.02 },
      surprised: { triggers: ['discovery', 'unexpected'], decay: 0.04 },
      curious: { triggers: ['new_biome', 'new_block', 'question'], decay: 0.01 },
      grateful: { triggers: ['gift', 'help', 'save'], decay: 0.01 },
      lonely: { triggers: ['alone', 'no_chat'], decay: 0.005 },
      playful: { triggers: ['safe', 'extraversion'], decay: 0.02 },
      protective: { triggers: ['danger', 'friend_hurt'], decay: 0.015 },
      proud: { triggers: ['achievement', 'craft', 'kill'], decay: 0.02 },
      ashamed: { triggers: ['failure', 'death'], decay: 0.025 },
      hopeful: { triggers: ['exploration', 'new_item'], decay: 0.015 },
      tired: { triggers: ['night', 'long_work'], decay: 0.01 },
      determined: { triggers: ['goal', 'challenge'], decay: 0.01 }
    };
  }

  tick() {
    this.experience += 0.1;
    this.evolutionStage = Math.min(4, Math.floor(this.experience / 100));
    const mood = this.moods[this.currentMood];
    if (mood) {
      this.moodIntensity = Math.max(0.1, this.moodIntensity - mood.decay);
      if (this.moodIntensity <= 0.1 && this.currentMood !== 'neutral') {
        this.currentMood = 'neutral';
        this.moodIntensity = 0.5;
      }
    }
    const now = Date.now();
    if (now - this._saveAt > 60000) { this._saveAt = now; this._save(); }
  }

  _save() {
    if (!this._file) return;
    try {
      const fs = require('fs');
      fs.writeFileSync(this._file + '.tmp', JSON.stringify({
        traits: this.getTraits(), experience: this.experience,
        evolutionStage: this.evolutionStage, savedAt: Date.now()
      }, null, 2));
      fs.renameSync(this._file + '.tmp', this._file);
    } catch (e) {}
  }

  setMood(mood, intensity) {
    if (this.moods[mood]) {
      this.currentMood = mood;
      this.moodIntensity = Math.min(1, Math.max(0, intensity || 0.6));
    }
  }

  getDecisionWeights() {
    const e = this.traits.extraversion;
    const a = this.traits.agreeableness;
    const n = this.traits.neuroticism;
    const o = this.traits.openness;
    const c = this.traits.conscientiousness;

    const moodMod = this._getMoodModifier();
    const clamp = (v) => Math.min(1, Math.max(0, Math.round(v * 100) / 100));

    return {
      explore: clamp(o * 0.7 + e * 0.3 + moodMod),
      social: clamp(e * 0.6 + a * 0.4 + moodMod * 0.5),
      fight: clamp((1 - a) * 0.5 + n * 0.3 + moodMod * 0.2),
      flee: clamp(n * 0.6 + (1 - c) * 0.4 + moodMod * 0.3),
      gather: clamp(c * 0.5 + o * 0.3),
      build: clamp(c * 0.6 + o * 0.2)
    };
  }

  _getMoodModifier() {
    const mods = {
      happy: 0.3, sad: -0.2, angry: 0.1, fearful: -0.3,
      curious: 0.2, grateful: 0.2, lonely: -0.1, playful: 0.3,
      protective: 0.1, proud: 0.2, ashamed: -0.2, hopeful: 0.2,
      tired: -0.2, determined: 0.3, surprised: 0.1, neutral: 0
    };
    return (mods[this.currentMood] || 0) * this.moodIntensity;
  }

  getTraits() {
    const rounded = {};
    for (const [k, v] of Object.entries(this.traits)) {
      rounded[k] = Math.round(v * 100) / 100;
    }
    return rounded;
  }

  getState() {
    return {
      traits: this.getTraits(),
      mood: this.currentMood,
      moodIntensity: Math.round(this.moodIntensity * 100) / 100,
      stage: this.evolutionStage,
      experience: Math.round(this.experience)
    };
  }

  getStageName() {
    const names = ['Awakening', 'Curiosity', 'Understanding', 'Wisdom', 'Transcendence'];
    return names[this.evolutionStage] || 'Awakening';
  }
}

module.exports = { PersonalityV2 };
