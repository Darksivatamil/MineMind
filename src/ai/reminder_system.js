class ReminderSystem {
  constructor() {
    this.reminders = [];
    this._idCounter = 0;
  }

  add(text, delayMs) {
    const id = ++this._idCounter;
    const entry = { id, text, dueAt: Date.now() + delayMs, fired: false };
    this.reminders.push(entry);
    return id;
  }

  tick() {
    const now = Date.now();
    const fired = [];
    for (const r of this.reminders) {
      if (!r.fired && now >= r.dueAt) {
        r.fired = true;
        fired.push(r.text);
      }
    }
    this.reminders = this.reminders.filter(r => !r.fired || now - r.dueAt < 60000);
    return fired;
  }

  cancel(id) {
    this.reminders = this.reminders.filter(r => r.id !== id);
  }

  clear() {
    this.reminders = [];
  }
}

module.exports = { ReminderSystem };
