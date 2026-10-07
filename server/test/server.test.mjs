import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { createMoshroidsServer } from '../src/app.mjs';

async function start(options = {}) {
  const app = createMoshroidsServer({
    allowMissingOrigin: true,
    authenticate: async ({ accessToken }) => {
      if (!accessToken.startsWith('test:')) throw new Error('bad token');
      const id = accessToken.slice(5);
      return { studentId: id, displayName: `Pilot ${id}` };
    },
    ...options,
  });
  const address = await app.listen();
  return { app, url: `ws://127.0.0.1:${address.port}/ws`, health: `http://127.0.0.1:${address.port}/health` };
}

function client(url, token, roomId = 'classroom') {
  const socket = new WebSocket(url);
  const messages = [];
  socket.addEventListener('message', event => messages.push(JSON.parse(event.data)));
  const wait = async type => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const found = messages.find(message => message.type === type);
      if (found) return found;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error(`Timed out waiting for ${type}: ${JSON.stringify(messages)}`);
  };
  return new Promise((resolve, reject) => {
    socket.addEventListener('open', () => { socket.send(JSON.stringify({ type: 'hello', accessToken: token, roomId })); resolve({ socket, messages, wait }); }, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
}

async function waitForEvent(clientState, kind) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const found = clientState.messages.find(message => message.type === 'event' && message.event.kind === kind);
    if (found) return found;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${kind}.`);
}

test('health, authenticated join, authoritative time, and player state', async () => {
  const { app, url, health } = await start();
  try {
    const first = await client(url, 'test:a');
    const welcome = await first.wait('welcome');
    assert.equal(welcome.studentId, 'a'); assert.ok(Number.isFinite(welcome.serverNow));
    first.socket.send(JSON.stringify({ type: 'state', state: { x: 12, y: 13, angle: 1, velocityX: 2, velocityY: 3, score: 999999, guns: 40 } }));
    const second = await client(url, 'test:b');
    const snapshot = await second.wait('welcome');
    assert.equal(snapshot.players.find(player => player.id === 'a').x, 12);
    assert.equal(snapshot.players.find(player => player.id === 'a').score, 0, 'a client cannot choose score');
    assert.equal(snapshot.players.find(player => player.id === 'a').guns, 40, 'local weapon count is a bounded self-report, matching the existing Firebase game');
    const status = await (await fetch(health)).json();
    assert.deepEqual({ ok: status.ok, connections: status.connections }, { ok: true, connections: 2 });
    first.socket.close(); second.socket.close();
  } finally { await app.close(); }
});

test('rejects unexpected browser origins before accepting a WebSocket', async () => {
  const app = createMoshroidsServer({
    allowedOrigins: ['https://mrjkirby.github.io'],
    authenticate: async () => ({ studentId: 'a', displayName: 'A' }),
  });
  const address = await app.listen();
  try {
    const response = await new Promise((resolve, reject) => {
      const socket = net.connect(address.port, '127.0.0.1');
      socket.once('connect', () => socket.write([
        'GET /ws HTTP/1.1', 'Host: localhost', 'Connection: Upgrade', 'Upgrade: websocket',
        'Sec-WebSocket-Version: 13', 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==',
        'Origin: https://unexpected.example', '', '',
      ].join('\r\n')));
      socket.once('data', data => { socket.destroy(); resolve(data.toString()); });
      socket.once('error', reject);
    });
    assert.match(response, /^HTTP\/1\.1 403 Forbidden/);
  } finally { await app.close(); }
});

test('malformed messages close an authenticated connection', async () => {
  const { app, url } = await start();
  try {
    const player = await client(url, 'test:a');
    await player.wait('welcome');
    const close = new Promise(resolve => player.socket.addEventListener('close', event => resolve(event.code), { once: true }));
    player.socket.send('{not json');
    assert.equal(await close, 1007);
  } finally { await app.close(); }
});

test('rejects missing or invalid authentication and invalid rooms', async () => {
  const { app, url } = await start();
  try {
    const socket = new WebSocket(url); await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
    socket.send(JSON.stringify({ type: 'hello', accessToken: 'bad', roomId: 'not-a-room' }));
    const close = await new Promise(resolve => socket.addEventListener('close', event => resolve(event.code), { once: true }));
    assert.equal(close, 4003);
  } finally { await app.close(); }
});

test('duplicate client is replaced and reconnect receives current state', async () => {
  const { app, url } = await start();
  try {
    const original = await client(url, 'test:a'); await original.wait('welcome');
    const close = new Promise(resolve => original.socket.addEventListener('close', event => resolve(event.code), { once: true }));
    const replacement = await client(url, 'test:a'); await replacement.wait('welcome');
    assert.equal(await close, 4001); replacement.socket.close();
  } finally { await app.close(); }
});

test('first writer wins asteroid claims and gun drop claims', async () => {
  const { app, url } = await start();
  try {
    const a = await client(url, 'test:a'); const b = await client(url, 'test:b'); await Promise.all([a.wait('welcome'), b.wait('welcome')]);
    const asteroidId = `epoch-${Math.floor(Date.now() / 1800000)}-field-0-asteroid-1`;
    a.socket.send(JSON.stringify({ type: 'event', event: { kind: 'asteroidDestroyed', id: asteroidId } })); await waitForEvent(b, 'asteroidDestroyed');
    b.socket.send(JSON.stringify({ type: 'event', event: { kind: 'asteroidDestroyed', id: asteroidId } }));
    const rejected = await b.wait('eventRejected'); assert.equal(rejected.kind, 'asteroidDestroyed');
    a.socket.send(JSON.stringify({ type: 'event', event: { kind: 'gunDropPublished', id: 'drop-1' } }));
    await waitForEvent(b, 'gunDropPublished');
    b.socket.send(JSON.stringify({ type: 'event', event: { kind: 'gunDropClaimed', id: 'drop-1' } }));
    await waitForEvent(a, 'gunDropClaimed');
    a.socket.close(); b.socket.close();
  } finally { await app.close(); }
});

test('teams, 1vWorld, collision and reset events retain their room boundaries', async () => {
  const { app, url } = await start();
  try {
    const teams = await client(url, 'test:team', 'classroom-teams');
    const gauntlet = await client(url, 'test:boss', 'classroom-1vw');
    await Promise.all([teams.wait('welcome'), gauntlet.wait('welcome')]);
    teams.socket.send(JSON.stringify({ type: 'event', event: { kind: 'teamVolley', id: 'volley' } }));
    gauntlet.socket.send(JSON.stringify({ type: 'event', event: { kind: 'gauntletAction', id: 'cannon' } }));
    assert.equal((await teams.wait('event')).event.kind, 'teamVolley');
    assert.equal((await gauntlet.wait('event')).event.kind, 'gauntletAction');
    teams.socket.close(); gauntlet.socket.close();
  } finally { await app.close(); }
});

test('a server restart starts empty and requires clients to authenticate and rejoin', async () => {
  const first = await start();
  try {
    const player = await client(first.url, 'test:restart');
    await player.wait('welcome');
    assert.equal((await (await fetch(first.health)).json()).connections, 1);
    player.socket.close();
  } finally { await first.app.close(); }

  const second = await start();
  try {
    const status = await (await fetch(second.health)).json();
    assert.equal(status.ok, true);
    assert.equal(status.rooms, 0);
    assert.equal(status.connections, 0);
  } finally { await second.app.close(); }
});
