'use strict';
/**
 * http_client.js — one hardened HTTP JSON client for every LLM provider.
 *
 * Why this exists: the original provider.js had the transport inlined, which
 * meant every provider would re-implement retry/timeout/parse. Quota failures
 * (429) were fatal to gameplay because there was nowhere to fall back to.
 *
 * This module centralises:
 *   - hard request timeout
 *   - bounded retry with exponential backoff + jitter
 *   - honour of "retry in Ns" hints, CAPPED so a decision tick never wedges
 *   - response size cap
 *   - never throws: always resolves {ok, body|error, code, status}
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

const MAX_RESPONSE_BYTES = 512 * 1024;
const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);
const MAX_BACKOFF_MS = 4000;

/** Classify a transport/HTTP failure so the caller can decide: retry, rotate, or give up. */
const CODE = Object.freeze({
  OK: 'OK',
  TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK',
  BAD_BODY: 'BAD_BODY',
  TOO_LARGE: 'TOO_LARGE',
  BAD_URL: 'BAD_URL',
  QUOTA: 'QUOTA',
  SERVER: 'SERVER',
  CLIENT: 'CLIENT',
});

function classify(res) {
  if (res.code === CODE.TIMEOUT) return { retryable: true, kind: 'transient' };
  if (res.code === CODE.NETWORK) return { retryable: true, kind: 'transient' };
  if (res.code === CODE.BAD_BODY || res.code === CODE.TOO_LARGE) return { retryable: false, kind: 'protocol' };
  if (res.status === 429) return { retryable: false, kind: 'quota' };
  if (res.status === 403 || res.status === 401) return { retryable: false, kind: 'auth' };
  if (res.status && res.status >= 500) return { retryable: true, kind: 'server' };
  if (res.status && res.status >= 400) return { retryable: false, kind: 'client' };
  return { retryable: false, kind: 'unknown' };
}

/** One raw request. Never rejects. */
function requestOnce(urlStr, { method = 'POST', headers = {}, body = null, timeoutMs = 20000 }) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(urlStr);
    } catch (err) {
      return resolve({ ok: false, code: CODE.BAD_URL, error: `bad url: ${err.message}` });
    }
    const mod = url.protocol === 'http:' ? http : https;
    const payload = body == null ? null : Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');

    const opts = {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'http:' ? 80 : 443),
      path: `${url.pathname}${url.search}`,
      method,
      headers: { ...headers },
      timeout: timeoutMs,
    };
    if (payload) {
      opts.headers['content-length'] = payload.length;
    }

    let settled = false;
    const done = (r) => {
      if (settled) return;
      settled = true;
      resolve(r);
    };

    const req = mod.request(opts, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > MAX_RESPONSE_BYTES) {
          req.destroy();
          done({ ok: false, code: CODE.TOO_LARGE, error: 'response exceeded max size' });
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try {
          parsed = text.length ? JSON.parse(text) : {};
        } catch {
          return done({
            ok: false,
            code: CODE.BAD_BODY,
            status: res.statusCode,
            error: 'provider returned non-JSON',
            raw: text.slice(0, 400),
          });
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          return done({
            ok: false,
            code: CODE.HTTP || (res.statusCode >= 500 ? CODE.SERVER : CODE.CLIENT),
            status: res.statusCode,
            error: parsed?.error?.message || `HTTP ${res.statusCode}`,
            body: parsed,
          });
        }
        done({ ok: true, status: res.statusCode, body: parsed });
      });
    });

    req.on('timeout', () => {
      req.destroy();
      done({ ok: false, code: CODE.TIMEOUT, error: `request timed out after ${timeoutMs}ms` });
    });
    req.on('error', (err) => done({ ok: false, code: CODE.NETWORK, error: err.message }));

    if (payload) req.write(payload);
    req.end();
  });
}

/** Extract a "retry in 2.3s" hint, if present. */
function retryHintMs(errText) {
  const m = /retry in ([\d.]+)s/i.exec(errText || '');
  if (!m) return null;
  return Math.min(MAX_BACKOFF_MS, Math.ceil(Number(m[1]) * 1000));
}

/**
 * Request with bounded retry.
 * `shouldRetry(res, attempt)` lets the caller veto retries (e.g. quota = rotate
 * to another provider instead of hammering the same one).
 */
async function request(urlStr, opts = {}) {
  const {
    method = 'POST',
    headers = {},
    body = null,
    timeoutMs = 20000,
    retries = 2,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    logger = { warn() {} },
    label = 'llm',
    shouldRetry = null,
  } = opts;

  const attempts = Math.max(1, retries) + 1;
  let res = { ok: false, code: 'NO_ATTEMPT', error: 'no attempt made' };

  for (let attempt = 1; attempt <= attempts; attempt++) {
    res = await requestOnce(urlStr, { method, headers, body, timeoutMs });
    if (res.ok) return res;

    const c = classify(res);
    const allowed = shouldRetry ? shouldRetry(res, attempt) : c.retryable;
    if (!allowed || attempt === attempts) return res;

    // Quota: waiting out the full window blocks the whole decision tick, so
    // take at most one short breath then give up and let the caller rotate.
    if (c.kind === 'quota' && attempt >= 2) return res;

    const hint = retryHintMs(res.error);
    const backoff = hint != null ? hint : Math.min(MAX_BACKOFF_MS, 500 * 2 ** (attempt - 1)) + Math.floor(Math.random() * 250);
    logger.warn(`${label} retrying`, {
      attempt,
      of: attempts,
      code: res.code,
      status: res.status,
      kind: c.kind,
      error: res.error,
      backoffMs: backoff,
    });
    await sleep(backoff);
  }
  return res;
}

module.exports = { request, requestOnce, classify, retryHintMs, CODE, RETRYABLE, MAX_BACKOFF_MS };