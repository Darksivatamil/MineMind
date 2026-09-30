// Raw protocol-level status probe.
// Handshakes directly against the socket and reports exactly what comes back,
// distinguishing "server replies with status" from "connection accepted but silent".
// Usage: node tools/raw_probe.js [host] [port]

const net = require('net');

const host = process.argv[2] || 'AGNES333.aternos.me';
const port = Number(process.argv[3] || 25565);

function varint(value) {
  const bytes = [];
  let v = value >>> 0;
  do {
    let b = v & 0x7f;
    v >>>= 7;
    if (v !== 0) b |= 0x80;
    bytes.push(b);
  } while (v !== 0);
  return Buffer.from(bytes);
}

function mcString(str) {
  const b = Buffer.from(str, 'utf8');
  return Buffer.concat([varint(b.length), b]);
}

// Handshake: nextState=1 (status)
const handshake = Buffer.concat([
  varint(0), // packet id
  varint(-1 & 0xffff), // protocol version (-1 = auto)
  mcString(host),
  varint(port),
  varint(1), // next state: status
]);

// Status request
const statusRequest = Buffer.concat([varint(0x00), varint(0)]);

const payload = Buffer.concat([varint(handshake.length), handshake, varint(statusRequest.length), statusRequest]);

const sock = net.connect({ host, port });
let got = Buffer.alloc(0);
let done = false;

const finish = (code) => {
  if (done) return;
  done = true;
  process.exit(code);
};

sock.setTimeout(10000);

sock.on('connect', () => {
  console.log(`TCP connect OK -> ${sock.remoteAddress}:${sock.remotePort}`);
  sock.write(payload);
});

sock.on('data', (d) => {
  got = Buffer.concat([got, d]);
  // Status response begins with varint length, then varint packet id (0x00), then JSON
  if (got.length >= 3 && got[1] === 0x00) {
    const jsonStart = got.indexOf(0x7b); // first '{'
    if (jsonStart > 0) {
      const json = got.slice(jsonStart).toString('utf8');
      console.log('STATUS RESPONSE RECEIVED');
      try {
        const parsed = JSON.parse(json);
        console.log('  version    :', JSON.stringify(parsed.version));
        console.log('  players    :', JSON.stringify(parsed.players));
        console.log('  secureChat :', parsed.preventsChatReports ? 'SERVER REQUIRES SECURE CHAT' : 'not required');
        console.log('  desc       :', JSON.stringify(parsed.description).slice(0, 200));
      } catch (e) {
        console.log('  (raw)       :', json.slice(0, 300));
      }
      sock.end();
      return finish(0);
    }
  }
  if (got.length > 200000) {
    console.log('Too much data, aborting');
    sock.end();
    return finish(1);
  }
});

sock.on('timeout', () => {
  console.log('TIMEOUT: connection established but server sent NO status data.');
  console.log('  -> A front-end/proxy accepted the socket, but no Minecraft server is answering.');
  sock.destroy();
  finish(1);
});

sock.on('error', (e) => {
  console.log('SOCKET ERROR:', e.message);
  finish(1);
});

sock.on('close', () => {
  if (!done) {
    console.log('CLOSED by server before sending status data.');
    finish(1);
  }
});
