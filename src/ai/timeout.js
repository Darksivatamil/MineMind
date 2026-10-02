'use strict';
/**
 * timeout.js — shared hard-timeout helper.
 *
 * Every external operation (LLM call, mineflayer action) must be bounded or a
 * single hung socket can wedge the whole decision loop forever.
 */

/**
 * Race a promise against a timer.
 * @param promise the work to bound
 * @param ms how long to wait before giving up
 * @param label included in the rejection message for readable logs
 */
function withTimeout(promise, ms, label = 'operation') {
  let timer;
  return new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    Promise.resolve(promise).then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      }
    );
  });
}

/** Promise-based sleep. */
function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

module.exports = { withTimeout, sleep };