'use strict';
/**
 * provider.js — the ONLY place MINEMIND-DEEP talks to a language model.
 *
 * Everything the model "decides" flows through `decide()`: a strict,
 * JSON-only contract with a fixed action vocabulary. The model never emits
 * free text into the game; it emits a validated decision object.
 *
 * Design rules (from PLAN.md):
 *   - no key hard-coded: read from env / settings
 *   - no silent failure: transport errors, timeouts and malformed JSON are
 *     surfaced as `{ ok:false, error }` and counted, never swallowed
 *   - bounded: hard request timeout, bounded retry, bounded response size
 */

const https = require('https');
const { URL } = require('url');

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 256 * 1024;
/** Thinking models can be slow under load; give them room before we call it dead. */
const GENERATE_TIMEOUT_MS = 30000;
/** Retryable: 429 rate limit, 500/502/503/504 transient server-side. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_RETRIES = 2;
/** Never let a retry block a decision tick longer than this. */
const MAX_RETRY_BACKOFF_MS = 5000;

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';

/** Closed vocabulary. The model may only choose from this list. */
const ACTIONS = Object.freeze([
  'idle',      // stand still / look around
  'explore',   // walk to a new nearby spot
  'follow',    // walk toward the owner
  'flee',      // run away from the nearest hostile
  'attack',    // hit the nearest hostile
  'mine',      // break the best nearby ore/block
  'eat',       // eat food when hungry
  'craft',     // craft an item
  'place',     // place a held block
  'gather',    // pick up nearby dropped items
  'equip',     // equip a better tool/armour
  'sleep',     // sleep at night
  'talk',      // say something in chat
]);

const ACTION_SET = new Set(ACTIONS);

function isKnownAction(a) {
  return typeof a === 'string' && ACTION_SET.has(a);
}

/**
 * POST JSON to the Gemini generateContent endpoint.
 * Resolves {ok, status, body} — never throws.
 */
function postJson(urlStr, payload, { apiKey, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch (err) {
      return resolve({ ok: false, error: `bad endpoint URL: ${err.message}` });
    }
    if (!apiKey) {
      return resolve({ ok: false, error: 'missing GEMINI_API_KEY', code: 'NO_KEY' });
    }

    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const req = https.request(
      {
        hostname: url.hostname,
        path: `${url.pathname}?key=${encodeURIComponent(apiKey)}`,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'content-length': data.length,
        },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on('data', (c) => {
          size += c.length;
          if (size > MAX_RESPONSE_BYTES) {
            req.destroy();
            done({ ok: false, error: 'response exceeded max size', code: 'TOO_LARGE' });
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let body;
          try {
            body = JSON.parse(text);
          } catch {
            return done({
              ok: false,
              error: 'provider returned non-JSON',
              code: 'BAD_BODY',
              status: res.statusCode,
              raw: text.slice(0, 500),
            });
          }
          if (res.statusCode < 200 || res.statusCode >= 300) {
            const msg =
              body?.error?.message || `HTTP ${res.statusCode}`;
            return done({ ok: false, error: msg, code: 'HTTP', status: res.statusCode });
          }
          done({ ok: true, status: res.statusCode, body });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      done({ ok: false, error: `request timed out after ${timeoutMs}ms`, code: 'TIMEOUT' });
    });
    req.on('error', (err) => {
      done({ ok: false, error: err.message, code: err.code || 'NETWORK' });
    });
    req.write(data);
    req.end();
  });
}

/** Pull the first text block out of a Gemini response. */
function extractText(body) {
  const candidates = body?.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = candidates[0]?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const texts = parts.map((p) => p?.text).filter((t) => typeof t === 'string');
  return texts.length ? texts.join('') : null;
}

/**
 * Extract the first balanced JSON object from a model reply.
 * Models often wrap JSON in prose or ``` fences, so we scan for the outermost
 * {...} rather than demanding a clean body.
 */
function extractJson(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  try {
    return JSON.parse(s);
  } catch { /* fall through to brace scan */ }

  const start = s.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const SYSTEM_PROMPT = `You are AGNES, an autonomous Minecraft player.
You are given a JSON snapshot of the world and you must choose ONE next action.

Reply with ONLY a JSON object, no prose, no markdown fence:
{"action":"<action>","target":"<short string or null>","reason":"<max 15 words>","confidence":<number 0..1>}

Allowed actions: ${ACTIONS.join(', ')}

Rules:
- "target" is a block name, item name, or mob name depending on the action (null for idle/explore).
- "confidence" is your honest certainty between 0 and 1.
- Choose the action that best serves survival and exploration right now.
- Never invent a block or mob that is not in the snapshot.`;

function createProvider(opts = {}) {
  const {
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    temperature = 0.6,
    maxTokens = 400,
    timeoutMs = GENERATE_TIMEOUT_MS,
    retries = DEFAULT_RETRIES,
    logger = { info() {}, warn() {}, error() {}, debug() {} },
  } = opts;

  const stats = { calls: 0, ok: 0, failed: 0, invalidJson: 0, unknownAction: 0 };

  const missingKey = !apiKey;

  /**
   * Ask the model for a decision. Resolves a decision envelope:
   *   { ok:true,  decision:{action,target,reason,confidence}, raw }
   *   { ok:false, error, code }
   */
  async function decide(state, callOpts = {}) {
    if (missingKey) {
      stats.failed++;
      return { ok: false, error: 'missing GEMINI_API_KEY (set it in .env)', code: 'NO_KEY' };
    }

    const useModel = callOpts.model || model;
    const url = `${ENDPOINT}/${encodeURIComponent(useModel)}:generateContent`;

    const payload = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [
        {
          role: 'user',
          parts: [{ text: `World snapshot:\n${JSON.stringify(state, null, 1)}` }],
        },
      ],
      generationConfig: {
        temperature: callOpts.temperature ?? temperature,
        maxOutputTokens: callOpts.maxTokens ?? maxTokens,
        responseMimeType: 'application/json',
        // keep deliberation short: this must return within a decision tick
        thinkingConfig: { thinkingBudget: 0 },
      },
    };

    stats.calls++;

    // Bounded retry with backoff for transient provider failures (503/429/5xx).
    const attempts = Math.max(1, callOpts.retries ?? retries) + 1;
    let res = { ok: false, error: 'no attempt made', code: 'NO_ATTEMPT' };
    for (let attempt = 1; attempt <= attempts; attempt++) {
      res = await postJson(url, payload, { apiKey, timeoutMs });
      if (res.ok) break;
      const retryable = res.code === 'TIMEOUT' || (res.code === 'HTTP' && RETRYABLE_STATUS.has(res.status));
      if (!retryable || attempt === attempts) break;

      // A quota/rate-limit (429) is a "come back later" signal, not a transient
      // glitch: waiting out the full window here would block the whole decision
      // tick. Give it one short pause, then let the next tick try instead.
      const isQuota = res.status === 429;
      if (isQuota && attempt >= 2) break;

      // Otherwise honour the server's "retry in Ns" hint, but never block a
      // decision tick for longer than the loop can tolerate.
      const hintMatch = /retry in ([\d.]+)s/i.exec(res.error || '');
      const backoff = hintMatch
        ? Math.min(MAX_RETRY_BACKOFF_MS, Math.ceil(Number(hintMatch[1]) * 1000))
        : 800 * Math.pow(2, attempt - 1);
      logger.warn('llm retrying', {
        attempt,
        of: attempts,
        code: res.code,
        status: res.status,
        error: res.error,
        backoffMs: backoff,
      });
      await new Promise((r) => setTimeout(r, backoff));
    }

    if (!res.ok) {
      stats.failed++;
      logger.warn('llm call failed', { error: res.error, code: res.code });
      return { ok: false, error: res.error, code: res.code };
    }

    const text = extractText(res.body);
    if (!text) {
      stats.failed++;
      return { ok: false, error: 'empty model response', code: 'EMPTY' };
    }

    const parsed = extractJson(text);
    if (!parsed || typeof parsed !== 'object') {
      stats.invalidJson++;
      stats.failed++;
      logger.warn('model reply was not valid JSON', { raw: text.slice(0, 200) });
      return { ok: false, error: 'model reply was not valid JSON', code: 'BAD_JSON', raw: text };
    }

    if (!isKnownAction(parsed.action)) {
      stats.unknownAction++;
      stats.failed++;
      logger.warn('model chose an action outside the vocabulary', { action: parsed.action });
      return { ok: false, error: `unknown action "${parsed.action}"`, code: 'BAD_ACTION', raw: text };
    }

    const conf = Number(parsed.confidence);
    const decision = {
      action: parsed.action,
      target: typeof parsed.target === 'string' ? parsed.target : null,
      reason: typeof parsed.reason === 'string' ? parsed.reason.slice(0, 200) : '',
      confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5,
    };

    stats.ok++;
    return { ok: true, decision, raw: text };
  }

  return {
    decide,
    model,
    hasKey: !missingKey,
    stats: () => ({ ...stats }),
    ACTIONS,
  };
}

module.exports = {
  createProvider,
  extractJson,
  extractText,
  isKnownAction,
  ACTIONS,
};
