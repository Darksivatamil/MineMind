'use strict';
/**
 * store.js — tiny flat JSON / JSONL helpers used by memory persistence.
 *
 * Deliberately separate from jsonl.js (which is the *auditable decision log*
 * factory). These are best-effort persistence helpers: they never throw, so a
 * filesystem hiccup can never crash the decision loop.
 */

const fs = require('fs');
const path = require('path');

/** Append one object as a JSON line. Returns true on success. */
function appendJsonl(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(obj) + '\n');
    return true;
  } catch {
    return false;
  }
}

/** Read all JSONL records. Missing/corrupt lines are skipped. Returns array. */
function readJsonl(file) {
  try {
    if (!fs.existsSync(file)) return [];
    const raw = fs.readFileSync(file, 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        out.push(JSON.parse(t));
      } catch {
        /* skip corrupt line */
      }
    }
    return out;
  } catch {
    return [];
  }
}

/** Write JSON (pretty). Returns true on success. */
function writeJson(file, obj) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(obj, null, 2));
    return true;
  } catch {
    return false;
  }
}

/** Read JSON. Returns parsed value, or `dflt` on any failure. */
function readJson(file, dflt = null) {
  try {
    if (!fs.existsSync(file)) return dflt;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return dflt;
  }
}

module.exports = { appendJsonl, readJsonl, writeJson, readJson };