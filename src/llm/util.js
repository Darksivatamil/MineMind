'use strict';
/**
 * util.js — response parsing helpers shared by the LLM layer.
 */

/**
 * Extract the first balanced JSON object from a model reply.
 * Models wrap JSON in prose or ``` fences, so scan for the outermost {...}
 * rather than demanding a clean body.
 */
function extractJson(text) {
  if (typeof text !== 'string') return null;
  let s = text.trim();

  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();

  try {
    return JSON.parse(s);
  } catch {
    /* fall through to brace scan */
  }

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

/** Clamp a number into [lo, hi], with a default. */
function clampNumber(n, lo, hi, dflt) {
  const x = Number(n);
  if (!Number.isFinite(x)) return dflt;
  return Math.min(hi, Math.max(lo, x));
}

module.exports = { extractJson, clampNumber };