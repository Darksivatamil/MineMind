'use strict';
/**
 * deps.js — dependency preflight.
 *
 * Problem this solves: on a fresh phone install, if `npm install` did not run
 * (or failed halfway), `node main.js` dies with a raw stack trace like:
 *
 *     Error: Cannot find module 'dotenv'
 *
 * That error tells the user nothing actionable. This module checks every
 * *required* runtime dependency up front and, if any is missing, prints a clear
 * "run npm install" message and exits. It also distinguishes OPTIONAL deps
 * (nice to have, never fatal) from REQUIRED ones.
 *
 * Uses only Node built-ins so it can run even when node_modules is empty.
 */

const path = require('path');

/** Modules the app cannot run without. */
const REQUIRED = [
  'mineflayer',
  'vec3',
];

/** Modules that improve behaviour but whose absence must not crash the app. */
const OPTIONAL = [
  'mineflayer-pathfinder',
  'dotenv',
];

/**
 * Try to require a module. Returns { name, ok, error }.
 */
function probe(name) {
  try {
    require(name);
    return { name, ok: true, error: null };
  } catch (err) {
    return { name, ok: false, error: err && err.code === 'MODULE_NOT_FOUND' ? 'not installed' : String(err && err.message) };
  }
}

/**
 * Check dependencies and report.
 *
 * @returns {{ ok: boolean, missing: string[], missingOptional: string[] }}
 *   `ok` is true only when no REQUIRED dep is missing.
 */
function check() {
  const missing = [];
  const missingOptional = [];

  for (const name of REQUIRED) {
    const r = probe(name);
    if (!r.ok) missing.push(name);
  }
  for (const name of OPTIONAL) {
    const r = probe(name);
    if (!r.ok) missingOptional.push(name);
  }

  return { ok: missing.length === 0, missing, missingOptional };
}

/**
 * If required deps are missing, print a friendly, actionable report and exit(1).
 * Otherwise return silently. Safe to call at the very top of an entry point.
 */
function assertInstalled(logger) {
  const { ok, missing, missingOptional } = check();
  if (ok) {
    // Non-fatal notice for optional deps so the user isn't surprised later.
    if (missingOptional.length && logger && logger.warn) {
      logger.warn('optional dependency(ies) not installed', { missingOptional });
    }
    return { ok: true, missingOptional };
  }

  const line = '='.repeat(58);
  console.error('');
  console.error(line);
  console.error('  MINEMIND-DEEP — missing dependencies');
  console.error(line);
  console.error('');
  console.error('  The following required package(s) are not installed:');
  for (const m of missing) console.error(`    - ${m}`);
  console.error('');
  console.error('  This almost always means `npm install` did not finish.');
  console.error('');
  console.error('  Fix — run this in the project folder:');
  console.error('');
  console.error('      npm install');
  console.error('');
  if (missingOptional.length) {
    console.error('  (also missing, optional, but recommended):');
    for (const m of missingOptional) console.error(`    - ${m}`);
    console.error('');
  }
  console.error('  If `npm install` fails on a phone, it is usually the network.');
  console.error('  Try again with a longer timeout:');
  console.error('');
  console.error('      npm install --fetch-timeout=600000');
  console.error('');
  console.error(line);
  console.error('');

  process.exit(1);
}

module.exports = { check, assertInstalled, REQUIRED, OPTIONAL };
