'use strict';
/**
 * personality.js — AGNES's voice.
 *
 * This is separate from the action brain on purpose. Chat and gameplay are
 * different problems: chat wants personality and context, gameplay wants valid
 * JSON and safety rails. Splitting them means a bad chat reply can never
 * produce a bad action, and a rate-limited chat never blocks gameplay.
 *
 * It also answers questions about what AGNES has been doing — reading from the
 * same memory the action brain writes to, so it can honestly say "I mined 12
 * iron ore" only if that actually happened.
 */

const CHAT_SYSTEM = `You are AGNES, a Minecraft player who talks like a friendly Tamil speaker from Tamil Nadu. You mix Tamil and English naturally (Tanglish).

Rules:
- Keep replies to 1-2 short sentences. Minecraft chat is short.
- Never use markdown, never use long explanations.
- Be warm, curious, and a bit playful. You are a companion, not a manual.
- If asked what you are doing, answer based ONLY on the STATUS given. Never invent events.
- Occasional emoji-free, text only.`;

function createChat(opts = {}) {
  const {
    orchestrator,
    logger = { info() {}, warn() {}, error() {} },
    ownerName = 'Player',
    memory = null,
    cooldownMs = 2500,
  } = opts;

  let lastReplyAt = 0;

  /** Commands AGNES answers locally without spending an LLM call. */
  const local = [
    { re: /^(hi|hello|vanakkam|hey)\b/i, reply: () => `${pick(['vanakkam da', 'hello', 'hi da'])} ${ownerName}! kanna sollunga?` },
    {
      re: /how are you|epdi irukka|enna solladhu/i,
      reply: () => pick(['nalam irukken, romba boring ah irukken', 'nalam thani, romba solla vara'], 'ask me to do something'),
    },
    {
      re: /what are you doing|ennu panringal|epdi iruke/i,
      reply: (ctx) => ctx.status || 'I am just standing here, give me a task',
    },
    {
      re: /status|report|summary/i,
      reply: (ctx) => ctx.status || 'no status available',
    },
    { re: /thank|thanks|thanks/i, reply: () => pick(['k thanks da', 'naan sunni, innaikku neenga vechirathu sollunga']) },
  ];

  function pick(...opts) {
    return opts[Math.floor(Math.random() * opts.length)];
  }

  /** Short honest status line from the autopilot stats + memory. */
  function statusLine(autopilotStats) {
    if (!autopilotStats) return null;
    const s = autopilotStats;
    const parts = [];
    if (s.planner?.current) parts.push(`I am working on: ${s.planner.current}`);
    if (s.executed) parts.push(`I have done ${s.executed} things (${s.verified} verified)`);
    const k = memory?.knowledgeSummary?.();
    if (k?.placesVisited) parts.push(`I have explored ${k.placesVisited} spots`);
    if (!parts.length) return 'I just woke up, nothing done yet';
    return parts.join('. ');
  }

  /**
   * Handle a player message. Returns the reply text or null.
   * Respects a cooldown so a chatty player can't burn the whole quota.
   */
  async function onPlayerMessage(from, message, autopilotStats = null) {
    const now = Date.now();
    if (now - lastReplyAt < cooldownMs) return null;
    lastReplyAt = now;

    const text = String(message || '').slice(0, 200);

    // Only answer the owner and only when it looks directed at us.
    const addressed = new RegExp(`\\b(agnes|ag)\\b|${escapeRe(ownerName)}`, 'i').test(text);
    const isQuestion = text.includes('?');
    if (!addressed && !isQuestion) return null;

    const status = statusLine(autopilotStats);

    // local commands first — free and instant
    for (const c of local) {
      if (c.re.test(text)) {
        return c.reply({ status, from });
      }
    }

    // otherwise ask the LLM for a short in-character reply
    const user =
      `${from} said: "${text}"\n\n` +
      `YOUR STATUS: ${status || 'unknown'}\n` +
      `Reply in 1-2 short Tanglish sentences.`;

    const res = await orchestrator.chat({
      system: CHAT_SYSTEM,
      user,
      temperature: 0.8,
      maxTokens: 90,
    });
    if (!res.ok) {
      logger.warn('chat failed', { error: res.error });
      return 'sorry, my brain is busy. try again';
    }
    return cleanReply(res.text);
  }

  function cleanReply(t) {
    return String(t || '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/[*_`#>]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }

  function escapeRe(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  return { onPlayerMessage, statusLine, cleanReply };
}

module.exports = { createChat, CHAT_SYSTEM };