'use strict';
/**
 * providers.js — pluggable LLM backends.
 *
 * Every provider implements:
 *   generate({system, user, temperature, maxTokens, json}) -> {ok, text} | {ok:false, error, code, kind}
 *
 * `kind` classifies the failure so the orchestrator knows whether to RETRY the
 * same provider, ROTATE to the next one, or give up:
 *   'quota' | 'auth' | 'transient' | 'protocol' | 'client' | 'server' | 'network'
 *
 * The whole point: one provider's rate limit must not stop the bot.
 */

const { request, CODE } = require('./http_client');

const noop = { info() {}, warn() {}, error() {}, debug() {} };

/* ------------------------------------------------------------------ Gemini */

function createGeminiProvider(opts = {}) {
  const {
    apiKey = process.env.GEMINI_API_KEY,
    model = process.env.GEMINI_MODEL || 'gemini-3.5-flash',
    base = 'https://generativelanguage.googleapis.com/v1beta/models',
    timeoutMs = 25000,
    retries = 1,
    logger = noop,
    name = 'gemini',
  } = opts;

  if (!apiKey) {
    return { name, available: false, reason: 'no GEMINI_API_KEY', generate: async () => ({ ok: false, error: 'no key', kind: 'auth' }) };
  }

  async function generate({ system, user, temperature = 0.5, maxTokens = 600, json = true }) {
    const url = `${base}/${encodeURIComponent(model)}:generateContent`;
    const payload = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        ...(json ? { responseMimeType: 'application/json' } : {}),
      },
    };
    const res = await request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      timeoutMs,
      retries,
      logger,
      label: name,
    });
    if (!res.ok) {
      return { ok: false, error: res.error, code: res.code, status: res.status, kind: kindOf(res) };
    }
    const parts = res.body?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((p) => p?.text).filter(Boolean).join('') : null;
    if (!text) return { ok: false, error: 'empty response', kind: 'protocol' };
    return { ok: true, text };
  }

  return { name, model, available: true, generate };
}

/* ------------------------------------------- OpenAI-compatible (chat/completions) */

/**
 * Works with: OpenRouter, Groq, Together, NVIDIA NIM, any local Ollama/LM Studio
 * that speaks the OpenAI chat-completions shape.
 */
function createOpenAICompatibleProvider(opts = {}) {
  const {
    apiKey = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY,
    baseUrl = process.env.LLM_BASE_URL || 'https://openrouter.ai/api/v1',
    model = process.env.LLM_MODEL || 'google/gemini-2.5-flash',
    timeoutMs = 25000,
    retries = 1,
    logger = noop,
    name = 'openai-compatible',
    extraHeaders = {},
  } = opts;

  if (!apiKey) {
    return { name, available: false, reason: 'no LLM_API_KEY', generate: async () => ({ ok: false, error: 'no key', kind: 'auth' }) };
  }

  async function generate({ system, user, temperature = 0.5, maxTokens = 600, json = true }) {
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const messages = [];
    if (system) messages.push({ role: 'system', content: system });
    messages.push({ role: 'user', content: user });

    const payload = {
      model,
      messages,
      temperature,
      max_tokens: maxTokens,
    };
    if (json) payload.response_format = { type: 'json_object' };

    const headers = {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
      ...extraHeaders,
    };

    const res = await request(url, { method: 'POST', headers, body: JSON.stringify(payload), timeoutMs, retries, logger, label: name });
    if (!res.ok) {
      return { ok: false, error: res.error, code: res.code, status: res.status, kind: kindOf(res) };
    }
    const text = res.body?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.length) {
      return { ok: false, error: 'empty response', kind: 'protocol' };
    }
    return { ok: true, text };
  }

  return { name, model, available: true, generate };
}

/* -------------------------------------------------------------- Ollama (local) */

function createOllamaProvider(opts = {}) {
  const {
    baseUrl = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434',
    model = process.env.OLLAMA_MODEL || 'llama3.1',
    timeoutMs = 60000,
    retries = 0,
    logger = noop,
    name = 'ollama',
  } = opts;

  async function generate({ system, user, temperature = 0.5, maxTokens = 600, json = true }) {
    const url = `${baseUrl.replace(/\/+$/, '')}/api/generate`;
    const payload = {
      model,
      prompt: `${system ? system + '\n\n' : ''}${user}`,
      stream: false,
      ...(json ? { format: 'json' } : {}),
      options: { temperature, num_predict: maxTokens },
    };
    const res = await request(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), timeoutMs, retries, logger, label: name });
    if (!res.ok) return { ok: false, error: res.error, code: res.code, status: res.status, kind: kindOf(res) };
    const text = res.body?.response;
    if (typeof text !== 'string') return { ok: false, error: 'empty response', kind: 'protocol' };
    return { ok: true, text };
  }

  return { name, model, available: true, generate };
}

/* ------------------------------------------------------------------ Mock */

/**
 * Deterministic offline provider for tests. Scans the snapshot for a cue and
 * returns a scripted decision — never random, so tests are reproducible.
 */
function createMockProvider(opts = {}) {
  const { rules = [], name = 'mock', logger = noop } = opts;
  let calls = 0;

  async function generate({ user }) {
    calls++;
    for (const r of rules) {
      if (!r.when || r.when(user, calls)) {
        return { ok: true, text: JSON.stringify(r.reply) };
      }
    }
    return { ok: true, text: JSON.stringify({ action: 'idle', reason: 'mock default', confidence: 0.9 }) };
  }

  return { name, model: 'mock', available: true, generate, calls: () => calls };
}

/* ------------------------------------------------------------------ utils */

function kindOf(res) {
  if (res.status === 429) return 'quota';
  if (res.status === 401 || res.status === 403) return 'auth';
  if (res.status >= 500) return 'server';
  if (res.status >= 400) return 'client';
  if (res.code === CODE.TIMEOUT || res.code === CODE.NETWORK) return 'transient';
  return 'protocol';
}

module.exports = {
  createGeminiProvider,
  createOpenAICompatibleProvider,
  createOllamaProvider,
  createMockProvider,
  kindOf,
};