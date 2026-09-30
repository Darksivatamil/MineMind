'use strict';
/**
 * diagnose.js — work out *why* AGNES cannot join, and what to do about it.
 *
 * The goal is that a human never has to stare at a raw mineflayer stack trace
 * again. Every failure mode below is classified into one of a small number of
 * actionable causes, each with a concrete fix the user can actually perform.
 *
 * Design rule: this module NEVER guesses. It reports what it measured, what it
 * could not measure, and the exact next step.
 */

const net = require('net');
const os = require('os');
const { tcpCheck } = require('./preflight');

/** Is this a private / loopback / link-local address that can never work from a remote host? */
function classifyHost(host) {
  const h = String(host || '').trim().toLowerCase();

  if (h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '0.0.0.0') {
    return {
      kind: 'loopback',
      reachableFromHere: false,
      reason: 'loopback addresses only ever point at the machine running the bot',
    };
  }
  if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) {
    return {
      kind: 'private',
      reachableFromHere: false,
      reason: 'RFC1918 private address — only routable inside the LAN that owns it',
    };
  }
  if (/^169\.254\./.test(h)) {
    return { kind: 'link-local', reachableFromHere: false, reason: 'link-local address, not routable off-subnet' };
  }
  if (/^f[cd][0-9a-f]{2}:/.test(h)) {
    return { kind: 'unique-local', reachableFromHere: false, reason: 'IPv6 unique-local (ULA) address, not publicly routable' };
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) {
    return { kind: 'public', reachableFromHere: true, reason: 'public IPv4 address' };
  }
  return { kind: 'hostname', reachableFromHere: true, reason: 'DNS name — resolution will be attempted' };
}

/**
 * A full diagnosis of one connection attempt.
 * @returns {Promise<{canConnect:boolean, classification:object, tcp:object, causes:string[], fixes:string[]}>}
 */
async function diagnose(target, opts = {}) {
  const classification = classifyHost(target.host);
  const tcp = await tcpCheck(target, opts);

  const causes = [];
  const fixes = [];

  if (!classification.reachableFromHere) {
    causes.push(
      `${target.host} is a ${classification.kind} address (${classification.reason}). ` +
        `This bot runs on a remote machine (${os.hostname()}), not on your phone.`
    );
    fixes.push(
      'You need a network path from this machine to your phone. Pick ONE:',
      '  A) Run AGNES on the same device as the server (Termux on the phone) — then localhost:3344 works.',
      '  B) Expose the phone to the internet with a VPN overlay (Tailscale) and give me the VPN IP.',
      '  C) Port-forward TCP 3344 on your Wi-Fi router to the phone, then set MC_HOST to your public IP.',
      '  D) Forward the port through a machine you control and point MC_HOST at it.',
      'See docs/CONNECT.md for the exact steps of each route.'
    );
  } else if (!tcp.ok) {
    causes.push(`TCP to ${target.host}:${target.port} failed: ${tcp.error}`);
    if (tcp.hint) causes.push(`hint: ${tcp.hint}`);
    fixes.push(
      'The address is routable but nothing answered. Check:',
      '  - the Minecraft server is actually started and shows "Local game hosted on port N"',
      '  - MC_PORT matches that port exactly',
      '  - the port is open in the phone firewall / any router ACL',
      '  - you are not behind CGNAT (mobile carriers commonly are — a VPN is then required)'
    );
  } else {
    causes.push(`${target.host}:${target.port} accepted a TCP connection.`);
    fixes.push('Network path is fine. Any remaining failure is a protocol/login problem, not a routing one.');
  }

  return {
    canConnect: tcp.ok,
    classification,
    tcp,
    causes,
    fixes,
  };
}

module.exports = { diagnose, classifyHost };
