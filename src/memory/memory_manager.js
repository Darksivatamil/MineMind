// MemoryManager with SQLite backend (data/agnes_memory.db).
// Same public API as before, so agnes.js / live_chat.js need zero changes.
// If SQLite is unavailable, falls back to the old in-memory arrays.
const { SqliteStore } = require('./sqlite_store');

class MemoryManager {
  constructor(dbPath) {
    this.maxShort = 30;
    this.maxMedium = 60;
    this.maxLong = 120;
    this.maxChat = 50;
    this.lastConsolidation = 0;
    this._idCounter = 0;

    this.store = new SqliteStore(dbPath);
    this.useDb = this.store.available;

    // In-memory fallback (old behavior) only if SQLite failed
    this.layers = { short: [], medium: [], long: [], core: [] };
    this.chatHistory = [];
    this.summaries = [];
  }

  add(category, content, importance) {
    if (content == null) return null;
    if (typeof content !== 'string') { try { content = JSON.stringify(content); } catch (e) { return null; } }
    const imp = Math.min(1, importance || 0.5);
    const now = Date.now();
    if (this.useDb) {
      const id = this.store.addMemory('short', category || 'general', content, imp, 1.0, now);
      this.store.trimLayer('short', this.maxShort);
      return { id, category: category || 'general', content, importance: imp, strength: 1.0, timestamp: now };
    }
    const memory = {
      id: `${now}-${++this._idCounter}`,
      category: category || 'general',
      content,
      importance: imp,
      strength: 1.0,
      timestamp: now
    };
    this.layers.short.push(memory);
    if (this.layers.short.length > this.maxShort) this.layers.short.shift();
    return memory;
  }

  addChat(username, message, response) {
    const now = Date.now();
    if (this.useDb) {
      const id = this.store.addChat(username, message, response || null, now);
      const removed = this.store.popOldChats(this.maxChat);
      if (removed.length > 0) this._summarizeChats(removed);
      this.add('chat', `${username}: ${message}`, 0.3);
      return { id, username, message, response, timestamp: now };
    }
    const entry = { username, message, response, timestamp: now };
    this.chatHistory.push(entry);
    if (this.chatHistory.length > this.maxChat) {
      const removed = this.chatHistory.splice(0, this.chatHistory.length - this.maxChat);
      this._summarizeChats(removed);
    }
    this.add('chat', `${username}: ${message}`, 0.3);
    return entry;
  }

  // Update the response field of the latest chat from this user (used by live_chat)
  setLastChatResponse(username, response) {
    if (!this.useDb) {
      const chats = this.chatHistory.filter(c => c.username === username);
      if (chats.length > 0) chats[chats.length - 1].response = response;
      return;
    }
    const chats = this.store.getAllChats(username);
    if (chats.length > 0) this.store.updateChatResponse(chats[chats.length - 1].id, response);
  }

  _summarizeChats(chats) {
    if (!chats || chats.length < 3) return;
    const texts = chats.map(c => `${c.username}: ${c.message}${c.response ? ` (reply: ${c.response})` : ''}`);
    const summary = `Chat summary: ${texts.slice(-5).join('; ')}`;
    if (this.useDb) {
      this.store.addSummary(summary, Date.now());
      return;
    }
    this.summaries.push({ content: summary, timestamp: Date.now() });
    if (this.summaries.length > 10) this.summaries.shift();
  }

  getChatHistory(username, count) {
    const n = count || 10;
    if (this.useDb) {
      const rows = this.store.getChats(username, n);
      return rows.reverse(); // oldest-first, same as before
    }
    const filtered = this.chatHistory.filter(c => c.username === username);
    return filtered.slice(-n);
  }

  getChatContext(username, count) {
    const recent = this.getChatHistory(username, count || 4);
    if (recent.length === 0) return '';
    const lines = recent.map(c =>
      `${c.username}: ${c.message}${c.response ? `\nAGNES: ${c.response}` : ''}`
    );
    const summaries = this.useDb ? this.store.getSummaries(2) : this.summaries.slice(-2);
    if (summaries.length > 0) {
      lines.unshift(summaries.map(s => s.content).join('\n'));
    }
    return lines.join('\n');
  }

  getAllChats(username) {
    if (this.useDb) return this.store.getAllChats(username);
    return this.chatHistory.filter(c => c.username === username);
  }

  consolidate() {
    const now = Date.now();
    if (now - this.lastConsolidation < 60000) return;
    this.lastConsolidation = now;

    if (this.useDb) {
      // 1 SQL UPDATE for decay + 1 DELETE for prune (was O(n) loop)
      this.store.decayAndPrune(now, 0.1, 0.3);
      this._promoteMemories();
      return;
    }
    for (const layer of ['short', 'medium', 'long']) {
      this.layers[layer] = this.layers[layer].filter(m => {
        const age = (now - m.timestamp) / 3600000;
        const decay = Math.min(1, age / 24);
        m.strength = Math.max(0, m.strength - decay * 0.1);
        if (m.strength < 0.1 && m.importance < 0.3) return false;
        return true;
      });
    }
    if (this.chatHistory.length > this.maxChat) {
      const removed = this.chatHistory.splice(0, this.chatHistory.length - this.maxChat);
      this._summarizeChats(removed);
    }
    this._promoteMemories();
  }

  _promoteMemories() {
    if (this.useDb) {
      // short -> medium
      const toMedium = this.store.getPromotionCandidates('short', 0.7, 0.5, 50);
      for (const m of toMedium) this.store.updateMemoryLayer(m.id, 'medium');
      this.store.trimLayer('medium', this.maxMedium);
      // medium -> long
      const toLong = this.store.getPromotionCandidates('medium', 0.8, 0.6, 50);
      for (const m of toLong) this.store.updateMemoryLayer(m.id, 'long');
      this.store.trimLayer('long', this.maxLong);
      return;
    }
    for (let i = this.layers.short.length - 1; i >= 0; i--) {
      const m = this.layers.short[i];
      if (m.importance > 0.7 && m.strength > 0.5) {
        this.layers.medium.push(m);
        if (this.layers.medium.length > this.maxMedium) this.layers.medium.shift();
        this.layers.short.splice(i, 1);
      }
    }
    for (let i = this.layers.medium.length - 1; i >= 0; i--) {
      const m = this.layers.medium[i];
      if (m.importance > 0.8 && m.strength > 0.6) {
        this.layers.long.push(m);
        if (this.layers.long.length > this.maxLong) this.layers.long.shift();
        this.layers.medium.splice(i, 1);
      }
    }
  }

  getRecent(count) {
    const n = count || 10;
    if (this.useDb) return this.store.getRecent(n);
    const all = [...this.layers.short, ...this.layers.medium, ...this.layers.long];
    all.sort((a, b) => b.timestamp - a.timestamp);
    return all.slice(0, n);
  }

  recall(query, maxResults) {
    if (!query || typeof query !== 'string') return [];
    const n = maxResults || 5;
    if (this.useDb) return this.store.searchMemories(query, n);
    const results = [];
    const q = query.toLowerCase();
    for (const layer of [this.layers.short, this.layers.medium, this.layers.long]) {
      for (const m of layer) {
        if (typeof m.content !== 'string') continue;
        if (m.content.toLowerCase().includes(q)) results.push(m);
      }
    }
    results.sort((a, b) => b.strength - a.strength);
    return results.slice(0, n);
  }

  summarize() {
    if (this.useDb) {
      const short = this.store.countByLayer('short');
      const medium = this.store.countByLayer('medium');
      const long = this.store.countByLayer('long');
      const core = this.store.countByLayer('core');
      const chat = this.store.countChats();
      const summaries = this.store.countSummaries();
      return { short, medium, long, core, chat, summaries, total: short + medium + long + core };
    }
    return {
      short: this.layers.short.length,
      medium: this.layers.medium.length,
      long: this.layers.long.length,
      core: this.layers.core.length,
      chat: this.chatHistory.length,
      summaries: this.summaries.length,
      total: this.layers.short.length + this.layers.medium.length + this.layers.long.length + this.layers.core.length
    };
  }
}

module.exports = { MemoryManager };
