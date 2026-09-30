// Server-list ping probe. Does a status ping (no login, no auth) and prints
// version, protocol, player sample, and whether secure chat is enforced.
// Usage: node tools/ping_server.js [host] [port]

const mc = require('minecraft-protocol');

const host = process.argv[2] || 'AGNES333.aternos.me';
const port = Number(process.argv[3] || 25565);

const timer = setTimeout(() => {
  console.log('PING TIMEOUT (no serverlistping within 12s)');
  process.exit(1);
}, 12000);

console.log(`Pinging ${host}:${port} ...`);

mc.createClient({
  host,
  port,
  username: 'PingProbe',
  version: false, // auto-detect server version
  connectTimeout: 12000,
})
  .once('serverlistping', (p) => {
    clearTimeout(timer);
    console.log('PING OK');
    console.log('  version    :', JSON.stringify(p.version));
    console.log('  players    :', JSON.stringify(p.players));
    console.log('  secureChat :', p.preventsChatReports ? 'SERVER REQUIRES SECURE CHAT' : 'not required');
    console.log('  desc       :', JSON.stringify(p.description).slice(0, 200));
    process.exit(0);
  })
  .once('error', (e) => {
    clearTimeout(timer);
    console.log('PING ERROR:', e.message);
    process.exit(1);
  });
