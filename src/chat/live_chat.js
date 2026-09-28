class LiveChat {
  constructor(bot, llm, memory, personality, social, socialMemory, knowledge) {
    this.bot = bot;
    this.llm = llm;
    this.memory = memory;
    this.personality = personality;
    this.social = social;
    this.socialMemory = socialMemory;
    this.knowledge = knowledge || null;
    this.conversations = {};
    this.lastMessageTime = {};
    this.rateLimitMs = 800;
    this.joinedPlayer = null;
    this.onAction = null;
    this.maxPlayers = 50;
    this._lastBotSend = 0;
    this._botSendCooldownMs = 2500;
    this._maxChatLen = 140;
  }

  setJoinedPlayer(username) {
    this.joinedPlayer = username;
  }

  _sendChat(msg) {
    if (!msg) return;
    const now = Date.now();
    // Global anti-spam: never send more often than _botSendCooldownMs
    if (now - this._lastBotSend < this._botSendCooldownMs) return;
    this._lastBotSend = now;
    try { if (this.bot && this.bot.chat) this.bot.chat(msg); }
    catch (e) { console.warn('chat send err:', e.message); }
  }

  _mcFact(userText) {
    try {
      if (!userText || !this.knowledge) return null;
      const words = String(userText).toLowerCase().replace(/[^a-z0-9_ ]/g, ' ').split(/\s+/).filter(w => w.length > 3);
      if (words.length === 0) return null;
      // Prefer recipe/mob/item lookups for the longest keyword (most specific)
      const keywords = [...new Set(words)].sort((a, b) => b.length - a.length).slice(0, 3);
      for (const kw of keywords) {
        let hits = [];
        try { hits = this.knowledge.search(kw) || []; } catch (e) { hits = []; }
        if (!hits || hits.length === 0) continue;
        const h = hits[0];
        let s = '';
        try {
          if (h.category === 'recipes') s = `${h.key}: ${(typeof h.value === 'string' ? h.value : JSON.stringify(h.value)).slice(0, 90)}`;
          else if (h.category === 'mobs') s = `${h.key} mob: ${(typeof h.value === 'string' ? h.value : JSON.stringify(h.value)).slice(0, 90)}`;
          else s = `${h.key}: ${(typeof h.value === 'string' ? h.value : JSON.stringify(h.value)).slice(0, 90)}`;
        } catch (e) { continue; }
        return s.replace(/\s+/g, ' ').trim().slice(0, 110);
      }
    } catch (e) {}
    return null;
  }

  _clampTunglish(text) {    if (!text) return '';
    // Single short line only: strip newlines, collapse spaces, hard-cap length
    let s = String(text).replace(/\s+/g, ' ').trim();
    // Remove any leaked action tags (case-insensitive) left over
    s = s.replace(/\[ACTION:\s*\w+\]/gi, '').trim();
    // Never lengthy: 1 line, <= _maxChatLen chars, no spammy repeats
    if (s.length > this._maxChatLen) s = s.slice(0, this._maxChatLen).trim();
    return s;
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
    const actionMatch = clean.match(/\[ACTION:\s*(\w+)\]/i);
    const actionTag = actionMatch ? actionMatch[0] : null;
    const actionName = actionMatch ? actionMatch[1].toUpperCase() : null;
    const chatMsg = this._clampTunglish(actionTag ? clean.replace(actionTag, '').trim() : clean);
    return { actionName, chatMsg };
  }

  _buildTunglishPrompt(username) {
    let ctx = 'You are AGNES, a rude silly Tamil girl. Speak ONLY pure Tunglish (Tamil written in English letters + a little English). Max 1 SHORT line, under 20 words. Natural words: da, dai, seri da, mm, hmm, ohh, poda, vaa, sollu, enna, eppa, epdi, inga, anga. Playful, annoying, tease, aattractive. Never sound polite or formal. No AI phrases. No pure-English sentences. Keep it fun, never hateful or explicit. If I tell you to fight or attack, append [ACTION:FIGHT] at end of your reply.';
    // Knowledge assist: last user message may ask about a recipe/mob/item — add 1 short fact
    try {
      const convo = this.conversations[username];
      const lastUser = convo && convo.length > 0 ? [...convo].reverse().find(m => m.role === 'user') : null;
      if (lastUser && this.knowledge && typeof this.knowledge.search === 'function') {
        const fact = this._mcFact(lastUser.content);
        if (fact) ctx += ` MC fact (use only if asked, keep Tunglish, 1 line): ${fact}`;
      }
    } catch (e) {}
    try {
      const mood = (this.personality && this.personality.currentMood) || (this.personality && this.personality.getState && this.personality.getState().mood);
      if (mood && mood !== 'neutral') {
        const tones = {
          playful: 'Mood: playful — extra teasing and silly.', happy: 'Mood: happy — bright and cheeky.',
          angry: 'Mood: angry — extra rude and snappy.', sad: 'Mood: sad — a little soft but still teasing.',
          fearful: 'Mood: nervous — jumpy and clingy.', tired: 'Mood: sleepy — slow and yawning.',
          proud: 'Mood: proud — show off a little.', curious: 'Mood: curious — ask a short question.'
        };
        if (tones[mood]) ctx += ' ' + tones[mood];
      }
    } catch (e) {}
    if (this.memory) {
      const mems = this.memory.getRecent(3);
      if (mems.length > 0) ctx += `\nMemories: ${mems.map(m => m.content).join(', ')}`;
    }
    return ctx;
  }

  async _tryChat(messages, attempt) {
    // Use the configured provider order so openrouter/gemini/nvidia/openai/deepseek all work
    const order = (this.llm && this.llm.modelOrder && this.llm.modelOrder.length > 0)
      ? this.llm.modelOrder
      : ['openrouter', 'nvidia', 'gemini', 'openai', 'deepseek'];
    for (const name of order) {
      if (this.llm.providers && this.llm.providers[name] && this.llm.providers[name].isAvailable()) {
        try { return await this.llm.sendTo(name, messages, { maxTokens: 60 }); }
        catch (e) { /* fall through to next provider */ }
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
