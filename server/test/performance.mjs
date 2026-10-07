import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const modes = ['classroom', 'classroom-teams', 'classroom-1vw'];
const grants = modes.flatMap(roomId => Array.from({ length: 26 }, (_, i) =>
  ({ roomId, id: `fixture-${i}`, token: randomBytes(32).toString('hex') })));
const host = fork(new URL('./benchmark-host.mjs', import.meta.url), { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
host.send({ grants });
const [{ port }] = await once(host, 'message');
let bytesIn = 0, bytesOut = 0, received = 0, sent = 0, unexpectedCloses = 0;
const latencies = [], reports = [], sockets = new Set();
const start = performance.now();
async function client(grant, resumeToken) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`); sockets.add(socket);
  const data = { socket, messages: [], pending: new Map(), sequence: 0, players: new Map(), shared: new Map(), intentional: false };
  data.send = value => { const text = JSON.stringify(value); bytesOut += Buffer.byteLength(text); sent++; socket.send(text); };
  data.request = (action, body = {}) => new Promise((resolve, reject) => {
    const requestId = String(++data.sequence), at = performance.now();
    const timer = setTimeout(() => reject(new Error(`Timeout ${action}`)), 5000);
    data.pending.set(requestId, result => { clearTimeout(timer); latencies.push(performance.now() - at); resolve(result); });
    data.send({ type: 'action', action, data: body, requestId });
  });
  socket.addEventListener('message', event => {
    bytesIn += Buffer.byteLength(event.data); received++;
    const message = JSON.parse(event.data); data.messages.push(message);
    if (data.messages.length > 300) data.messages.shift();
    if (message.type === 'authenticated') data.resumeToken = message.resumeToken;
    if (message.type === 'welcome') { data.id = message.studentId; data.players = new Map(message.players.map(p => [p.id, p])); }
    if (message.type === 'playerState' || message.type === 'playerJoined')
      data.players.set(message.player.id, { ...data.players.get(message.player.id), ...message.player });
    if (message.type === 'playerLeft') data.players.delete(message.studentId);
    if (message.type === 'shared') {
      if (message.channel === 'boss') data.boss = message.state;
      if (message.channel === 'cannon') data.cannon = message;
      if (message.reset) data.shared.set(message.channel, new Map());
      for (const [id, value] of message.entries || []) { const map = data.shared.get(message.channel) || new Map();
        value ? map.set(id, value) : map.delete(id); data.shared.set(message.channel, map); }
    }
    if (message.type === 'result') { data.pending.get(message.requestId)?.(message.ok); data.pending.delete(message.requestId); }
    if (message.type === 'ready') data.ready = true;
  });
  socket.addEventListener('close', () => { sockets.delete(socket); if (!data.intentional) unexpectedCloses++; });
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  data.send({ type: 'hello', roomId: grant.roomId, ...(resumeToken ? { resumeToken } : { accessToken: grant.token }) });
  for (let i = 0; !data.ready && i < 500; i++) await delay(10);
  assert.equal(data.ready, true); assert.equal(data.id, grant.id);
  data.close = async () => { data.intentional = true; socket.close(); for (let i = 0; socket.readyState !== 3 && i < 100; i++) await delay(5); };
  return data;
}
try {
  for (const roomId of modes) {
    const roomGrants = grants.filter(g => g.roomId === roomId);
    const clients = await Promise.all(roomGrants.map(grant => client(grant)));
    const movement = setInterval(() => clients.forEach((c, i) => {
      if (c.socket.readyState === 1) c.send({ type: 'state', studentId: 'forged', state: {
        x: roomId === 'classroom-teams' ? 34 : 100 + i, y: 34, angle: 0.5, velocityX: 1, velocityY: 2,
        visible: true, guns: roomId === 'classroom-1vw' ? 40 : 4, name: 'forged', testerAuthorized: true } });
    }), 90);
    try {
      await delay(200);
      const asteroid = `epoch-${Math.floor(Date.now() / 1800000)}-field-0-asteroid-1`;
      assert.equal((await Promise.all(clients.map(c => c.request('asteroidClaim', { id: asteroid })))).filter(Boolean).length, 1);
      assert.equal(await clients[0].request('dropPublish', { drops: [{ id: 'atomic-gun', x: 100, y: 34 }] }), true);
      assert.equal((await Promise.all(clients.map(c => c.request('dropClaim', { id: 'atomic-gun' })))).filter(Boolean).length, 1);
      if (roomId === 'classroom-teams') {
        assert.ok((await Promise.all(clients.map(c => c.request('teamChange', { team: 'blue' })))).every(Boolean));
      }
      if (roomId === 'classroom-1vw') {
        assert.equal(await clients[0].request('survivorClaim'), true); await delay(2050);
        assert.equal(await clients[1].request('gauntletActivate'), true);
      }
      for (let cycle = 0; cycle < 5; cycle++) {
        await Promise.all(clients.map((c, i) => roomId === 'classroom-teams' ? c.request('teamVolley') :
          roomId === 'classroom-1vw' && i > 0 ? c.request('cannonFire', { angle: i / 26 }) :
          c.request('asteroidClaim', { id: `epoch-${Math.floor(Date.now() / 1800000)}-field-0-asteroid-${100 + cycle * 26 + i}` })));
        await delay(1050);
      }
    } finally { clearInterval(movement); }
    await delay(100);
    for (const c of clients) {
      assert.equal(c.players.size, 26);
      assert.ok([...c.players.values()].every(p => p.id === p.name && !p.testerAuthorized));
      assert.equal(c.shared.get('drops').size, 0);
      assert.deepEqual([...c.shared.get('asteroids')], [...clients[0].shared.get('asteroids')]);
    }
    const before = clients[3].resumeToken; await clients[3].close();
    clients[3] = await client(roomGrants[3], before);
    assert.notEqual(clients[3].resumeToken, before);
    assert.deepEqual([...clients[3].shared.get('asteroids')], [...clients[0].shared.get('asteroids')]);
    const at = Date.now(); clients.forEach(c => c.send({ type: 'heartbeat', sentAt: at })); await delay(100);
    const clocks = clients.map(c => c.messages.findLast(m => m.type === 'heartbeat').serverNow);
    reports.push({ roomId, connections: 26, identityCrossover: 0, duplicateAsteroidClaims: 0, duplicateGunClaims: 0,
      stateDivergence: 0, clockSpreadMs: Math.max(...clocks) - Math.min(...clocks), reconnect: 'pass' });
    await Promise.all(clients.map(c => c.close()));
  }
  const seconds = (performance.now() - start) / 1000;
  host.send({ stop: true }); const [metrics] = await once(host, 'message'); await once(host, 'exit');
  latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({ environment: process.env.BENCHMARK_LABEL || 'local synthetic identities; real WebSocket clients',
    reports, seconds, unexpectedCloses, cpuPercentOneCore: (metrics.cpuMicros.user + metrics.cpuMicros.system) / (seconds * 10000),
    peakServerRssMiB: metrics.peakRss / 1048576, serverHeapMiB: metrics.heapUsed / 1048576,
    receivedPerSecond: received / seconds, sentPerSecond: sent / seconds, serverEgressBytesPerSecond: bytesIn / seconds,
    serverIngressBytesPerSecond: bytesOut / seconds, actionP95Ms: latencies[Math.floor(latencies.length * .95)] }, null, 2));
  assert.equal(unexpectedCloses, 0);
} finally { for (const s of sockets) s.close(); if (host.connected) host.kill(); }
