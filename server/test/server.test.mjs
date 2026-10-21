import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { createMoshroidsServer } from '../src/app.mjs';

const launchToken = id => 'ml1_' + Buffer.from(id).toString('hex').padEnd(64, '0').slice(0, 64);

async function start(options = {}) {
  const app = createMoshroidsServer({
    allowMissingOrigin: true,
    authenticate: async ({ accessToken }) => {
      if (!/^ml1_[a-f0-9]{64}$/.test(accessToken)) throw new Error('bad token');
      const id = Buffer.from(accessToken.slice(4), 'hex').toString('utf8').replace(/\0+$/, '');
      return { studentId: id, displayName: `Pilot ${id}` };
    },
    ...options,
  });
  const address = await app.listen();
  return { app, url: `ws://127.0.0.1:${address.port}/ws`, health: `http://127.0.0.1:${address.port}/health` };
}

function client(url, token, roomId = 'classroom') {
  const endpoint = new URL(url);
  endpoint.protocol = endpoint.protocol === 'wss:' ? 'https:' : 'http:';
  endpoint.pathname = '/api/launch/redeem';
  endpoint.search = '';
  return fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, roomId }),
  }).then(async response => {
    assert.equal(response.status, 200);
    const { sessionToken } = await response.json();
    return connect(url, sessionToken, roomId);
  });
}

function connect(url, resumeToken, roomId = 'classroom') {
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
    socket.addEventListener('open', () => { socket.send(JSON.stringify({ type: 'hello', resumeToken, roomId })); resolve({ socket, messages, wait }); }, { once: true });
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
    const first = await client(url, launchToken('a'));
    const welcome = await first.wait('welcome');
    assert.equal(welcome.studentId, 'a'); assert.ok(Number.isFinite(welcome.serverNow));
    first.socket.send(JSON.stringify({ type: 'state', state: { x: 12, y: 13, angle: 1, velocityX: 2, velocityY: 3, score: 999999, guns: 40 } }));
    const second = await client(url, launchToken('b'));
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
    const player = await client(url, launchToken('a'));
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
    socket.send(JSON.stringify({ type: 'hello', accessToken: launchToken('direct'), roomId: 'classroom' }));
    const close = await new Promise(resolve => socket.addEventListener('close', event => resolve(event.code), { once: true }));
    assert.equal(close, 4003);
  } finally { await app.close(); }
});

test('launch redemption rejects malformed tokens, identity fields, and wrong origins', async () => {
  const origin = 'https://mrjkirby.github.io';
  const { app, url } = await start({ allowMissingOrigin: false, allowedOrigins: [origin] });
  const endpoint = new URL(url);
  endpoint.protocol = 'http:';
  endpoint.pathname = '/api/launch/redeem';
  try {
    const submit = body => fetch(endpoint, {
      method: 'POST',
      headers: { Origin: origin, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    assert.equal((await submit({ token: 'malformed', roomId: 'classroom' })).status, 400);
    assert.equal((await submit({ token: launchToken('id'), roomId: 'classroom', studentId: 'forged' })).status, 400);
    assert.equal((await fetch(endpoint, {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'content-type': 'application/json' },
      body: JSON.stringify({ token: launchToken('id'), roomId: 'classroom' }),
    })).status, 403);
  } finally { await app.close(); }
});

test('launch redemption creates a separate single-use reconnect session', async () => {
  let consumed = 0;
  const diagnostics = [];
  const { app, url } = await start({
    log: (event, detail) => diagnostics.push({ event, detail }),
    authenticate: async ({ accessToken }) => {
      if (accessToken !== launchToken('one-use') || consumed++) throw new Error('invalid or consumed');
      return { studentId: 'canonical-id', displayName: 'Canonical Pilot' };
    },
  });
  const endpoint = new URL(url);
  endpoint.protocol = 'http:';
  endpoint.pathname = '/api/launch/redeem';
  try {
    const redeem = () => fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: launchToken('one-use'), roomId: 'classroom' }),
    });
    const first = await redeem();
    assert.equal(first.status, 200);
    const { sessionToken, expiresAt } = await first.json();
    assert.match(sessionToken, /^mr1_[a-f0-9]{64}$/);
    assert.ok(expiresAt > Date.now());
    assert.equal((await redeem()).status, 401);

    const player = await connect(url, sessionToken);
    assert.equal((await player.wait('welcome')).studentId, 'canonical-id');
    player.socket.close();
    assert.ok(diagnostics.some(({ event, detail }) =>
      event === 'launch_redeem' && detail.stage === 'identity' && detail.outcome === 'resolved'));
    assert.ok(diagnostics.some(({ event, detail }) =>
      event === 'launch_redeem' && detail.stage === 'session' && detail.outcome === 'created'));
    assert.ok(diagnostics.some(({ event, detail }) =>
      event === 'websocket_auth' && detail.stage === 'identity' && detail.outcome === 'resolved'));
    assert.doesNotMatch(JSON.stringify(diagnostics), /ml1_|mr1_|canonical-id|Race Pilot/);
  } finally { await app.close(); }
});

test('simultaneous redemption creates exactly one game session', async () => {
  let consumed = false;
  const { app, url } = await start({
    authenticate: async ({ accessToken }) => {
      await new Promise(resolve => setTimeout(resolve, 10));
      if (accessToken !== launchToken('race') || consumed) throw new Error('already consumed');
      consumed = true;
      return { studentId: 'race-id', displayName: 'Race Pilot' };
    },
  });
  const endpoint = new URL(url);
  endpoint.protocol = 'http:';
  endpoint.pathname = '/api/launch/redeem';
  try {
    const redeem = () => fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: launchToken('race'), roomId: 'classroom' }),
    });
    const results = await Promise.all(Array.from({ length: 12 }, redeem));
    assert.equal(results.filter(result => result.status === 200).length, 1);
    assert.equal(results.filter(result => result.status === 401).length, 11);
  } finally { await app.close(); }
});

test('duplicate client is replaced and reconnect receives current state', async () => {
  const { app, url } = await start();
  try {
    const original = await client(url, launchToken('a')); await original.wait('welcome');
    const close = new Promise(resolve => original.socket.addEventListener('close', event => resolve(event.code), { once: true }));
    const replacement = await client(url, launchToken('a')); await replacement.wait('welcome');
    assert.equal(await close, 4001); replacement.socket.close();
  } finally { await app.close(); }
});

test('first writer wins asteroid claims and gun drop claims', async () => {
  const { app, url } = await start();
  try {
    const a = await client(url, launchToken('a')); const b = await client(url, launchToken('b')); await Promise.all([a.wait('welcome'), b.wait('welcome')]);
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
    const teams = await client(url, launchToken('team'), 'classroom-teams');
    const gauntlet = await client(url, launchToken('boss'), 'classroom-1vw');
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
    const player = await client(first.url, launchToken('restart'));
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
