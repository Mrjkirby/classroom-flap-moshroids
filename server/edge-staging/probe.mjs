// External TLS transport/security probe. No real credentials or student data.
// Standby is deliberately NOT bypassed. This cannot certify gameplay capacity.
import https from 'node:https';
import { randomBytes, createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const base = 'https://moshroids-staging.mrjkirby.workers.dev';
const origin = 'https://mrjkirby.github.io';
function frame(opcode, text) {
  const body = Buffer.from(text), mask = randomBytes(4);
  assert.ok(body.length < 126);
  return Buffer.concat([Buffer.from([0x80 | opcode, 0x80 | body.length]), mask,
    Buffer.from(body.map((byte, index) => byte ^ mask[index % 4]))]);
}
function connect(browserOrigin = origin) {
  return new Promise((resolve, reject) => {
    const start = performance.now(), key = randomBytes(16).toString('base64');
    const req = https.get(`${base}/ws`, { headers: {
      Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Key': key,
      'Sec-WebSocket-Version': '13', ...(browserOrigin ? { Origin: browserOrigin } : {}),
    } });
    req.setTimeout(10000, () => req.destroy(new Error('Upgrade timeout')));
    req.on('error', reject);
    req.on('response', response => { response.resume(); resolve({ status: response.statusCode }); });
    req.on('upgrade', (response, socket, head) => {
      const expected = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
      if (response.headers['sec-websocket-accept'] !== expected) { socket.destroy(); return reject(new Error('Invalid WS handshake')); }
      const frames = []; let pending = head;
      const parse = chunk => {
        pending = Buffer.concat([pending, chunk]);
        while (pending.length >= 2) {
          const opcode = pending[0] & 15;
          let length = pending[1] & 127, offset = 2;
          if (length === 126) { if (pending.length < 4) return; length = pending.readUInt16BE(2); offset = 4; }
          if (length === 127 || (pending[1] & 128)) { socket.destroy(); return; }
          if (pending.length < offset + length) return;
          frames.push({ opcode, body: pending.subarray(offset, offset + length) });
          pending = pending.subarray(offset + length);
        }
      };
      socket.on('data', parse); socket.on('error', () => {});
      socket.setTimeout(10000, () => socket.destroy()); parse(Buffer.alloc(0));
      resolve({ status: 101, ms: performance.now() - start, socket, frames,
        send: (opcode, text) => socket.write(frame(opcode, text)),
        async wait(opcode) {
          const deadline = Date.now() + 8000;
          while (Date.now() < deadline) {
            const found = frames.find(value => value.opcode === opcode);
            if (found) return found.body;
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          throw new Error(`Frame ${opcode} timeout`);
        },
      });
    });
  });
}

const healthStart = performance.now();
const health = await fetch(`${base}/health`);
console.log(JSON.stringify({ healthStatus: health.status, healthMs: Math.round(performance.now() - healthStart) }));
assert.equal(health.status, 200, 'Stop: VPC origin not reachable');
const before = await health.json();
console.log(JSON.stringify({ classroomReady: before.classroomReady, rooms: before.rooms, connections: before.connections }));
assert.equal((await fetch(`${base}/not-allowed`)).status, 404);
for (const rejectedOrigin of [undefined, 'https://unexpected.example']) {
  assert.equal((await connect(rejectedOrigin === undefined ? '' : rejectedOrigin)).status, 403);
}
const clients = [];
try {
  const settled = await Promise.allSettled(Array.from({ length: 26 }, () => connect()));
  for (const result of settled) if (result.status === 'fulfilled' && result.value.socket) clients.push(result.value);
  assert.equal(clients.length, 26, 'All 26 sockets must upgrade');
  await Promise.all(clients.map(async client => {
    client.send(9, 'staging-ping');
    assert.equal((await client.wait(10)).toString(), 'staging-ping');
    client.send(1, JSON.stringify({ type: 'hello', accessToken: 'invalid-staging-token', roomId: 'classroom' }));
    assert.equal((await client.wait(8)).readUInt16BE(0), 4003);
  }));
  console.log(JSON.stringify({ upgrades: 26, pingPong: 26, invalidTokensRejected: 26,
    minUpgradeMs: Math.round(Math.min(...clients.map(c => c.ms))), maxUpgradeMs: Math.round(Math.max(...clients.map(c => c.ms))),
    authenticatedGameplayTested: false }));
} finally { clients.forEach(client => client.socket.destroy()); }
const again = await connect();
assert.equal(again.status, 101);
again.socket.destroy();
console.log(JSON.stringify({ freshReconnection: true, authenticatedResumeTested: false }));
