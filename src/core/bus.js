'use strict';
/**
 * bus.js — tiny synchronous pub/sub used to turn bot events into
 * "salient event" decision-tick triggers (see PLAN.md §1).
 *
 * Contract:
 *   const bus = createBus();
 *   const off = bus.on('threat_near', payload => ...);
 *   bus.emit('threat_near', { name: 'zombie' });
 *   bus.off('threat_near', handler);            // or off() returned by on()
 *
 * A throwing listener is isolated so one bad subscriber cannot break the
 * decision loop. Errors are forwarded to an optional onError handler.
 */

function createBus() {
  const listeners = new Map(); // event -> Set<fn>
  const onError = [];
  let emitCount = 0;

  function on(event, fn) {
    if (typeof fn !== 'function') throw new TypeError('listener must be a function');
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(fn);
    return () => off(event, fn);
  }

  function once(event, fn) {
    const wrapped = (...args) => {
      off(event, wrapped);
      return fn(...args);
    };
    return on(event, wrapped);
  }

  function off(event, fn) {
    const set = listeners.get(event);
    if (!set) return false;
    const had = set.delete(fn);
    if (set.size === 0) listeners.delete(event);
    return had;
  }

  function onErrorListener(fn) {
    onError.push(fn);
    return () => {
      const i = onError.indexOf(fn);
      if (i >= 0) onError.splice(i, 1);
    };
  }

  function emit(event, payload) {
    emitCount++;
    const set = listeners.get(event);
    if (!set || set.size === 0) return 0;
    let delivered = 0;
    for (const fn of Array.from(set)) {
      try {
        fn(payload, event);
        delivered++;
      } catch (err) {
        for (const h of onError) {
          try {
            h(err, event);
          } catch { /* ignore */ }
        }
      }
    }
    return delivered;
  }

  function listenerCount(event) {
    return (listeners.get(event) || new Set()).size;
  }

  function events() {
    return Array.from(listeners.keys());
  }

  function removeAll() {
    listeners.clear();
  }

  return { on, once, off, emit, onError: onErrorListener, listenerCount, events, removeAll, emitCount: () => emitCount };
}

module.exports = { createBus };
