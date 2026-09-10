class LiveChat {
  constructor(bot, llm, memory, personality, social, socialMemory) {
    this.bot = bot;
    this.llm = llm;
    this.memory = memory;
    this.personality = personality;
    this.social = social;
    this.socialMemory = socialMemory;
    this.conversations = {};
    this.lastMessageTime = {};
    this.rateLimitMs = 800;
    this.joinedPlayer = null;
    this.onAction = null;
    this.maxPlayers = 50;
  }

  setJoinedPlayer(username) {
    this.joinedPlayer = username;
  }

  _sendChat(msg) {
    try { if (this.bot && this.bot.chat) this.bot.chat(msg); }
    catch (e) { console.warn('chat send err:', e.message); }
  }

  onMessage(username, message) {
    if (!this.llm || !this.llm.isAvailable()) return;
    const now = Date.now();
    const last = this.lastMessageTime[username] || 0;
    if (now - last < this.rateLimitMs) return;
    this.lastMessageTime[username] = now;
    this._ensureConversation(username);
    this.conversations[username].push({ role: 'user', content: message });
    if (this.memory) this.memory.addChat(username, message, null);
    this._generateResponse(username);
  }

  tunglishMessage(username, message) {
    if (!this.llm || !this.llm.isAvailable()) return;
    const now = Date.now();
    const last = this.lastMessageTime[username] || 0;
    if (now - last < this.rateLimitMs) return;
    this.lastMessageTime[username] = now;
    this._ensureConversation(username);
    this.conversations[username].push({ role: 'user', content: message });
    if (this.memory) this.memory.addChat(username, message, null);
    this._generateTunglishResponse(username);
  }

  _ensureConversation(username) {
    if (!this.conversations[username]) {
      // Evict oldest player if over cap (prevents unbounded growth)
      const keys = Object.keys(this.conversations);
      if (keys.length >= this.maxPlayers) {
        let oldest = keys[0], oldestT = Infinity;
        for (const k of keys) { const t = this.lastMessageTime[k] || 0; if (t < oldestT) { oldestT = t; oldest = k; } }
        delete this.conversations[oldest];
        delete this.lastMessageTime[oldest];
      }
      this.conversations[username] = [];
    }
    if (this.conversations[username].length > 8) {
      this.conversations[username] = this.conversations[username].slice(-6);
    }
  }

  _handleAction(actionName, ctx) {
    if (!actionName || !this.onAction) return;
    try { this.onAction(actionName, ctx); } catch (e) { console.warn('onAction err:', e.message); }
  }

  _processReply(clean) {
    const actionMatch = clean.match(/\[ACTION:\s*(\w+)\]/);
    const actionTag = actionMatch ? actionMatch[0] : null;
    const actionName = actionMatch ? actionMatch[1] : null;
    const chatMsg = actionTag ? clean.replace(actionTag, '').trim() : clean;
    return { actionName, chatMsg };
  }

  _buildTunglishPrompt(username) {
    let ctx = 'You are AGNES, a rude silly Tamil girl. Speak ONLY pure Tunglish (Tamil+English mix). Max 1 short line. Natural words: da, dai, seri da, mm, hmm, ohh, poda, vaa, sollu, enna, eppa, epdi, inga, anga. Playful, annoying, tease. Never sound polite or formal. No AI phrases. No English sentences. If I tell you to fight or attack, append [ACTION: FIGHT] at end of your reply.';
    if (this.memory) {
      const mems = this.memory.getRecent(3);
      if (mems.length > 0) ctx += `\nMemories: ${mems.map(m => m.content).join(', ')}`;
    }
    return ctx;
  }

  async _tryChat(messages, attempt) {
    const providers = ['nvidia', 'gemini'];
    for (const name of providers) {
      if (this.llm.providers && this.llm.providers[name] && this.llm.providers[name].isAvailable()) {
        try { return await this.llm.sendTo(name, messages, { maxTokens: 40 }); }
        catch (e) { /* fall through */ }
      }
    }
    if (attempt < 1) {
      await new Promise(r => setTimeout(r, 1000));
      return this._tryChat(messages, attempt + 1);
    }
    throw new Error('All providers failed after retry');
  }

  async _generateTunglishResponse(username) {
    try {
      const convo = this.conversations[username];
      const system = this._buildTunglishPrompt(username);
      const messages = [{ role: 'system', content: system }, ...convo];

      let response = await this._tryChat(messages, 0);
      const clean = response.replace(/^AGNES:\s*/i, '').trim();
      if (!clean) return;

      const { actionName, chatMsg } = this._processReply(clean);

      this._handleAction(actionName, { username });

      convo.push({ role: 'assistant', content: chatMsg });
      if (this.memory) {
        this.memory.add('chat_response', `${username}: ${chatMsg}`, 0.3);
      }
      this._sendChat(chatMsg);
    } catch (e) {
      console.warn(`Tunglish chat failed for ${username}: ${e.message}`);
    }
  }

  async _generateResponse(username) {
    try {
      const convo = this.conversations[username];
      let system = 'You are AGNES, a real Tamil girl. Chat naturally in Tunglish with your friend. Be real, short (1 line).';
      if (this.memory) {
        const mems = this.memory.getRecent(3);
        if (mems.length > 0) system += `\nMemories: ${mems.map(m => m.content).join(', ')}`;
      }
      const messages = [{ role: 'system', content: system }, ...convo];

      let response = await this._tryChat(messages, 0);
      const clean = response.replace(/^AGNES:\s*/i, '').trim();
      if (!clean) return;

      const { actionName, chatMsg } = this._processReply(clean);

      this._handleAction(actionName, { username });

      convo.push({ role: 'assistant', content: chatMsg });
      this._sendChat(chatMsg);
      if (this.memory) this.memory.add('response', `To ${username}: ${chatMsg}`, 0.3);
    } catch (e) {
      console.warn(`Chat API failed for ${username}: ${e.message}`);
    }
  }

  shouldThink() { return this.llm && this.llm.isAvailable(); }

  async think(state) {
    if (this.memory) this.memory.add('thought', `State at ${state.dimension}`, 0.2);
  }
}

module.exports = { LiveChat };
