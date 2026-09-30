'use strict';
/**
 * preflight.js — verify a Minecraft server is reachable *before* mineflayer
 * tries to log in, so failures are clear instead of a wall of protocol stack.
 *
 * Provides:
 *   tcpCheck(target, opts) -> Promise<{ok, error}>   raw TCP connect test
 *   preflight(target, opts) -> Promise<Result>       alias with nicer naming
 *
 * Never throws: every path resolves to a Result. Errors carry an `hint` so
 * main.js can print actionable guidance (PLAN.md S7: "clear error").
 */

const net = require('net');

const DEFAULT_TIMEOUT_MS = 4000;

/**
 * Attempt a TCP connection to host:port.
 * @returns {Promise<{ok:boolean, error?:string, code?:string, hint?:string}>}
 */
function tcpCheck(target, opts = {}) {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  const host = target.host;
  const port = Number(target.port);

  return new Promise((resolve) => {
    if (!host) {
      return resolve({ ok: false, error: 'no host given', hint: 'set MC_HOST or config host' });
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return resolve({ ok: false, error: `invalid port ${target.port}`, hint: 'set MC_PORT to 1-65535' });
    }

    let settled = false;
    const socket = new net.Socket();
    const finish = (result) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch { /* ignore */ }
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish({ ok: true }));
    socket.once('timeout', () =>
      finish({
        ok: false,
        error: `connection to ${host}:${port} timed out after ${timeoutMs}ms`,
        hint: 'is the server up? check MC_HOST/MC_PORT and firewall',
      })
    );
    socket.once('error', (err) => {
      const code = err && err.code;
      let hint = 'is the Minecraft server running and listening on this port?';
      if (code === 'ECONNREFUSED') hint = 'connection refused — nothing is listening on that port (is the server started?)';
      else if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') hint = 'host not found — check the hostname / DNS';
      else if (code === 'ETIMEDOUT') hint = 'host unreachable — network or firewall issue';
      finish({ ok: false, error: err.message, code, hint });
    });

    socket.connect(port, host);
  });
}

/** Convenience alias. */
async function preflight(target, opts = {}) {
  return tcpCheck(target, opts);
}

module.exports = { tcpCheck, preflight, DEFAULT_TIMEOUT_MS };
