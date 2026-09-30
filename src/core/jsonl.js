'use strict';
/**
 * jsonl.js — append-only JSON Lines writer for `logs/decisions.jsonl`.
 *
 * Contract (CONTRACTS.md §5): one JSON object per line, always carrying
 *   { t, source: "llm"|"reflex", action, target, thought, confidence, urgency, result }
 *
 * `readTail()` is used by tools/tests to inspect recent decisions without
 * loading the whole file. Never throws: on write failure it counts errors and
 * surfaces them via `errors()` so tests can assert honestly.
 */

const fs = require('fs');
const path = require('path');

function createJsonl(opts = {}) {
  const {
    file = opts.file === null ? null : opts.file || path.join(process.cwd(), 'logs', 'decisions.jsonl'),
  } = opts;

  let writeErrors = 0;
  let count = 0;

  if (file) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
    } catch {
      /* ignore */
    }
  }

  function write(obj) {
    const record = { t: obj.t ?? Date.now(), ...obj };
    if (!file) {
      writeErrors++;
      return false;
    }
    try {
      fs.appendFileSync(file, JSON.stringify(record) + '\n');
      count++;
      return true;
    } catch {
      writeErrors++;
      return false;
    }
  }

  function readTail(n = 20) {
    if (!file) return [];
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      return lines.slice(-n).map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { _unparsed: l };
        }
      });
    } catch {
      return [];
    }
  }

  function clear() {
    try {
      if (file) fs.writeFileSync(file, '');
    } catch {
      /* ignore */
    }
  }

  return {
    file,
    write,
    readTail,
    clear,
    count: () => count,
    errors: () => writeErrors,
  };
}

module.exports = { createJsonl };
