import assert from 'node:assert/strict';
import test from 'node:test';
import { RealtimeConnection } from '../src/transport/connection.js';
import { createMoshroidsServer } from '../server/src/app.mjs';

const token = (prefix, number) => prefix + number.toString(16).padStart(64, '0');
const grant = (number, roomId = 'classroom') => ({
  accessToken: token('ml1_', number), audience: 'moshroids', roomId,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
});

class Socket extends EventTarget {
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  send(value) { this.sent.push(JSON.parse(value)); }
  open() { this.dispatchEvent(new Event('open')); }
  message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  close(code = 1000) {
    this.readyState = 3;
    this.dispatchEvent(Object.assign(new Event('close'), { code }));
  }
}

async function harness(t, options = {}) {
  let issued = 0, redeemed = 0;
  const statuses = [], received = [], saved = new Map();
  const connection = new RealtimeConnection({
    url: 'wss://example.test/ws', roomId: 'classroom', WebSocketClass: Socket,
    storage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value),
      removeItem: key => saved.delete(key) },
    requestLaunch: () => { issued++; return options.issue?.(issued) ?? Promise.resolve(grant(issued)); },
    fetcher: async (_url, request) => {
      redeemed++;
      assert.equal(JSON.parse(request.body).token, token('ml1_', redeemed));
      return Response.json({ ok: true, sessionToken: token('mr1_', redeemed),
        serverNow: 1000, expiresAt: 301000 });
    },
    onStatus: (connected, detail) => statuses.push({ connected, detail }),
    onMessage: value => received.push(value), diagnostic: () => {},
  });
  t.after(() => connection.stop());
  const authenticate = socket => {
    socket.open();
    socket.message({ type: 'authenticated', resumeToken: token('mr1_', 100 + redeemed),
      serverNow: 1000, expiresAt: 301000 });
    socket.message({ type: 'ready' });
  };
  await connection.start();
  authenticate(connection.socket);
  return { connection, authenticate, statuses, received, saved,
    counts: () => ({ issued, redeemed }) };
}

test('fresh portal grant renews before expiry; old socket events cannot affect its replacement', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const h = await harness(t);
  const original = h.connection.socket;
  t.mock.timers.tick(209_999);
  assert.deepEqual(h.counts(), { issued: 1, redeemed: 1 });
  const pending = h.connection.request('dropClaim', { id: 'pending-drop' });
  t.mock.timers.tick(1);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.counts(), { issued: 2, redeemed: 2 });
  assert.notEqual(h.connection.socket, original);
  assert.equal(await pending, false, 'ambiguous mutations must not be replayed');
  const replacement = h.connection.socket;
  h.authenticate(replacement);
  assert.equal(replacement.sent[0].resumeToken, token('mr1_', 2));
  const activeToken = h.connection.resumeToken;
  const count = h.received.length;
  original.message({ type: 'authenticated', resumeToken: token('mr1_', 999), serverNow: 1000, expiresAt: 301000 });
  original.message({ type: 'shared', channel: 'drops', entries: [['stale', {}]] });
  original.close(4003);
  original.dispatchEvent(new Event('error'));
  assert.equal(h.connection.ready, true);
  assert.equal(h.connection.resumeToken, activeToken);
  assert.equal(h.received.length, count);
  assert.equal(h.statuses.at(-1).connected, true);
});

for (const reason of ['closed portal', 'wrong room']) {
  test(`renewal fails closed for ${reason} and does not extend the existing lease`, async t => {
    const h = await harness(t, { issue: count => {
      if (count === 1) return Promise.resolve(grant(1));
      return reason === 'closed portal' ? Promise.reject(new Error('Portal unavailable'))
        : Promise.resolve(grant(2, 'classroom-teams'));
    } });
    const socket = h.connection.socket, originalExpiry = h.connection.expiresAt;
    await h.connection.renewSession();
    assert.deepEqual(h.counts(), { issued: 2, redeemed: 1 });
    assert.equal(h.connection.socket, socket);
    assert.equal(h.connection.ready, true, 'current valid lease remains usable');
    assert.equal(h.connection.expiresAt, originalExpiry);
    socket.close(4003);
    assert.equal(h.connection.resumeToken, null);
    assert.equal(h.connection.ready, false);
    assert.ok(h.connection.retry, 'an established game tries a fresh authorized launch');
    assert.equal(h.saved.size, 0);
  });
}

test('an expired established session obtains a fresh grant and rejoins the same room', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const h = await harness(t);
  const previous = h.connection.socket;
  previous.close(4003);
  assert.equal(h.connection.ready, false);
  assert.equal(h.connection.resumeToken, null);
  t.mock.timers.tick(1000);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.counts(), { issued: 2, redeemed: 2 });
  assert.notEqual(h.connection.socket, previous);
  h.authenticate(h.connection.socket);
  assert.equal(h.connection.ready, true);
  assert.equal(h.connection.socket.sent[0].roomId, 'classroom');
});

test('expiry during a failed renewal still retries from the existing classroom portal', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  let rejectRenewal;
  const h = await harness(t, { issue: count => count === 1 ? Promise.resolve(grant(1)) :
    count === 2 ? new Promise((_resolve, reject) => { rejectRenewal = reject; }) : Promise.resolve(grant(2)) });
  const renewal = h.connection.renewSession();
  h.connection.socket.close(4003);
  assert.equal(h.connection.retry, undefined, 'the in-flight renewal finishes first');
  rejectRenewal(new Error('temporary issuer failure'));
  await renewal;
  assert.ok(h.connection.retry);
  t.mock.timers.tick(1000);
  await new Promise(resolve => setImmediate(resolve));
  h.authenticate(h.connection.socket);
  assert.equal(h.connection.ready, true);
  assert.deepEqual(h.counts(), { issued: 3, redeemed: 2 });
});

test('stopping during portal renewal does not redeem or reopen a socket', async t => {
  let resolveGrant;
  const h = await harness(t, { issue: count => count === 1 ? Promise.resolve(grant(1))
    : new Promise(resolve => { resolveGrant = resolve; }) });
  const socket = h.connection.socket;
  const renewal = h.connection.renewSession();
  h.connection.stop();
  resolveGrant(grant(2));
  await renewal;
  assert.deepEqual(h.counts(), { issued: 2, redeemed: 1 });
  assert.equal(h.connection.socket, socket);
  assert.equal(h.connection.resumeToken, null);
});

test('a disconnect during renewal uses the new lease once without replaying the launch', async t => {
  let resolveGrant;
  const h = await harness(t, { issue: count => count === 1 ? Promise.resolve(grant(1))
    : new Promise(resolve => { resolveGrant = resolve; }) });
  const original = h.connection.socket;
  const renewal = h.connection.renewSession();
  original.close(1006);
  assert.equal(h.connection.retry, undefined);
  resolveGrant(grant(2));
  await renewal;
  h.authenticate(h.connection.socket);
  assert.deepEqual(h.counts(), { issued: 2, redeemed: 2 });
  assert.notEqual(h.connection.socket, original);
  assert.equal(h.connection.ready, true);
});

test('a newer launch cancels pending renewal instead of reclaiming the other tab', async t => {
  let resolveGrant;
  const h = await harness(t, { issue: count => count === 1 ? Promise.resolve(grant(1))
    : new Promise(resolve => { resolveGrant = resolve; }) });
  const renewal = h.connection.renewSession();
  h.connection.socket.close(4001);
  resolveGrant(grant(2));
  await renewal;
  assert.deepEqual(h.counts(), { issued: 2, redeemed: 1 });
  assert.equal(h.connection.socket, null);
  assert.equal(h.connection.ready, false);
  assert.equal(h.connection.retry, undefined);
});

test('real server accepts fresh renewal beyond the original expiry and keeps room claims', async t => {
  let advance = 0, issued = 0, readyResolve;
  const grants = new Set();
  const app = createMoshroidsServer({ allowMissingOrigin: true, clock: () => Date.now() + advance,
    authenticate: async ({ accessToken }) => {
      assert.equal(grants.delete(accessToken), true, 'each portal grant is consumed once');
      return { studentId: 'renewal-fixture', displayName: 'Renewal fixture' };
    } });
  const address = await app.listen();
  const snapshots = [];
  const connection = new RealtimeConnection({ url: `ws://127.0.0.1:${address.port}/ws`,
    roomId: 'classroom', storage: null, diagnostic: () => {},
    requestLaunch: async () => {
      const next = grant(++issued); grants.add(next.accessToken); return next;
    },
    onStatus: connected => { if (connected) readyResolve?.(); },
    onMessage: message => { if (message.type === 'shared') snapshots.push(message); },
  });
  t.after(async () => { connection.stop(); await app.close(); });
  async function ready(action) {
    let rejectReady;
    const result = new Promise((resolve, reject) => { readyResolve = resolve; rejectReady = reject; });
    const deadline = setTimeout(() => rejectReady(new Error('Connection did not become ready')), 5000);
    try { await action(); await result; } finally { clearTimeout(deadline); }
  }
  await ready(() => connection.start());
  const firstExpiry = connection.expiresAt;
  const id = `epoch-${Math.floor((Date.now() + advance) / 1800000)}-renewal-fixture`;
  assert.equal(await connection.request('asteroidClaim', { id }), true);
  advance = 210_000;
  snapshots.length = 0;
  await ready(() => connection.renewSession());
  assert.equal(issued, 2);
  assert.ok(connection.expiresAt > firstExpiry + 200_000);
  assert.ok(snapshots.some(message => message.channel === 'asteroids' && message.entries.some(([key]) => key === id)));
  advance = 300_001;
  assert.equal(await connection.request('asteroidClaim', { id }), false, 'previous claims remain authoritative after renewal');
  assert.equal(connection.ready, true, 'fresh lease works after the first lease expires');
  assert.equal(app.registry.status().connections, 1);
});
