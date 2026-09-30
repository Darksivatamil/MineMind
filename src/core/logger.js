'use strict';
/**
 * logger.js — console + file logger with levels, used by every subsystem.
 *
 * Contract:
 *   const logger = createLogger({ name: 'agent', level: 'info', file: 'logs/events.log' });
 *   logger.info('hello', { action: 'mine' });   -> console + appended file line
 *
 * Never throws: if the log file cannot be written it degrades to console-only.
 */

const fs = require('fs');
const path = require('path');

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const COLORS = {
  debug: '\x1b[90m',
  info: '\x1b[36m',
  warn: '\x1b[33m',
  error: '\x1b[31m',
  reset: '\x1b[0m',
};

function useColor() {
  return process.stdout.isTTY && !process.env.NO_COLOR;
}

function ensureDir(file) {
  const dir = path.dirname(file);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* ignore — console fallback */
  }
}

function createLogger(opts = {}) {
  const {
    name = 'app',
    level = process.env.LOG_LEVEL || 'info',
    file = opts.file === null ? null : opts.file || path.join(process.cwd(), 'logs', 'events.log'),
  } = opts;

  const threshold = LEVELS[level] ?? LEVELS.info;

  if (file) ensureDir(file);

  function write(levelName, msg, meta) {
    if ((LEVELS[levelName] ?? 0) < threshold) return;
    const ts = new Date().toISOString();
    let line = `[${ts}] [${levelName.toUpperCase()}] [${name}] ${msg}`;
    if (meta && Object.keys(meta).length) {
      try {
        line += ' ' + safeStringify(meta);
      } catch {
        line += ' [unserialisable meta]';
      }
    }

    // console
    const prefix = useColor() ? `${COLORS[levelName] || ''}${levelName.toUpperCase().padEnd(5)}${COLORS.reset}` : levelName.toUpperCase().padEnd(5);
    // eslint-disable-next-line no-console
    console.log(`${prefix} [${name}] ${msg}${meta && Object.keys(meta).length ? ' ' + safeStringify(meta) : ''}`);

    // file
    if (file) {
      try {
        fs.appendFileSync(file, line + '\n');
      } catch {
        /* degrade to console-only */
      }
    }
  }

  return {
    level,
    file,
    debug: (m, meta) => write('debug', m, meta),
    info: (m, meta) => write('info', m, meta),
    warn: (m, meta) => write('warn', m, meta),
    error: (m, meta) => write('error', m, meta),
    child(childName) {
      return createLogger({ ...opts, name: `${name}:${childName}`, file });
    },
  };
}

function safeStringify(obj) {
  return JSON.stringify(obj, replacerNoThrow());
}

function replacerNoThrow() {
  const seen = new WeakSet();
  return function (key, value) {
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'function') return '[fn]';
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[circular]';
      seen.add(value);
      if (value && typeof value.pos === 'object' && value.pos && value.x !== undefined) {
        // vec3-like objects -> compact
        return { x: value.x, y: value.y, z: value.z };
      }
    }
    return value;
  };
}

module.exports = { createLogger, LEVELS };
