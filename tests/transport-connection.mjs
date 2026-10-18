import assert from 'node:assert/strict';
import test from 'node:test';
import { isLaunchGrant, RealtimeConnection } from '../src/transport/connection.js';
class FakeSocket extends EventTarget {
  static instances = [];
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  constructor(url) { super(); this.url = url; FakeSocket.instances.push(this); }
  send(text) { this.sent.push(JSON.parse(text)); }
  message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  close(code = 1000) {
    this.readyState = 3;
    const event = new Event('close');
    Object.defineProperty(event, 'code', { value: code });
    this.dispatchEvent(event);
  }
}
const grant = roomId => ({ accessToken: 'ml1_' + 'a'.repeat(64), audience: 'moshroids',
  expiresAt: new Date(Date.now() + 30000).toISOString(), roomId });

test('KNAS connector refuses plaintext public endpoints and URL credentials', () => {
  for (const url of ['ws://public.example/ws', 'wss://user:password@example.test/ws', 'wss://example.test/ws?token=bad'])
    assert.throws(() => new RealtimeConnection({ url }));
});
test('launch grants are short-lived, audience-scoped and optionally room-bound', () => {
  const now = Date.now();
  assert.equal(isLaunchGrant(grant('classroom'), 'classroom', now), true);
  assert.equal(isLaunchGrant({ ...grant('classroom'), roomId: 'classroom-teams' }, 'classroom', now), false);
  assert.equal(isLaunchGrant({ ...grant('classroom'), expiresAt: new Date(now - 1).toISOString() }, 'classroom', now), false);
  assert.equal(isLaunchGrant({ ...grant('classroom'), expiresAt: new Date(now + 121000).toISOString() }, 'classroom', now), false);
  assert.equal(isLaunchGrant({ ...grant('classroom'), audience: 'other' }, 'classroom', now), false);
});
test('one-time grant is hello-only; mutations wait for explicit server acknowledgement', async () => {
  let issued = 0;
  const connection = new RealtimeConnection({ url: 'wss://example.test/ws', roomId: 'classroom',
    WebSocketClass: FakeSocket, requestLaunch: async roomId => { issued++; return grant(roomId); } });
  await connection.start(); const socket = FakeSocket.instances.at(-1);
  socket.dispatchEvent(new Event('open'));
  assert.deepEqual(socket.sent[0], { type: 'hello', roomId: 'classroom', accessToken: grant('classroom').accessToken });
  assert.equal(await connection.request('dropClaim', { id: 'g' }), false);
  socket.message({ type: 'authenticated', resumeToken: 'fixture-resume', expiresAt: Date.now() + 30000 });
  socket.message({ type: 'ready' });
  const promise = connection.request('dropClaim', { id: 'g' });
  const request = socket.sent.at(-1);
  socket.message({ type: 'result', requestId: request.requestId, ok: true });
  assert.equal(await promise, true); assert.equal(issued, 1);
  assert.ok(!JSON.stringify(request).includes('ml1_'));
  const interrupted = connection.request('asteroidClaim', { id: 'a' });
  connection.stop(); assert.equal(await interrupted, false);
});
test('invalid grants and explicit authentication rejection fail closed without grant retries', async () => {
  const count = FakeSocket.instances.length;
  const rejected = new RealtimeConnection({
    url: 'wss://example.test/ws',
    roomId: 'classroom',
    WebSocketClass: FakeSocket,
    requestLaunch: async () => ({ ...grant('classroom'), audience: 'wrong' }),
  });
  await rejected.start();
  assert.equal(FakeSocket.instances.length, count);
  rejected.stop();

  let issued = 0;
  const connection = new RealtimeConnection({
    url: 'wss://example.test/ws',
    roomId: 'classroom',
    WebSocketClass: FakeSocket,
    requestLaunch: async roomId => { issued++; return grant(roomId); },
  });
  await connection.start();
  const socket = FakeSocket.instances.at(-1);
  socket.dispatchEvent(new Event('open'));
  socket.close(4003);
  assert.equal(issued, 1);
  assert.equal(connection.retry, undefined);
  connection.stop();
});

test('transient disconnect reconnects with the in-memory KNAS resume credential', async () => {
  const connection = new RealtimeConnection({
    url: 'wss://example.test/ws',
    roomId: 'classroom',
    WebSocketClass: FakeSocket,
    requestLaunch: async roomId => grant(roomId),
  });
  await connection.start();
  const first = FakeSocket.instances.at(-1);
  first.dispatchEvent(new Event('open'));
  first.message({ type: 'authenticated', resumeToken: 'resume-fixture', expiresAt: Date.now() + 30000 });
  first.message({ type: 'ready' });
  first.close(1006);
  await new Promise(resolve => setTimeout(resolve, 1050));
  const resumed = FakeSocket.instances.at(-1);
  assert.notEqual(resumed, first);
  resumed.dispatchEvent(new Event('open'));
  assert.deepEqual(resumed.sent[0], {
    type: 'hello',
    roomId: 'classroom',
    resumeToken: 'resume-fixture',
  });
  connection.stop();
});

test('missing classroom session fails closed without anonymous fallback', async () => {
  const count = FakeSocket.instances.length; let message;
  const connection = new RealtimeConnection({ url: 'wss://example.test/ws', WebSocketClass: FakeSocket,
    onStatus: (_ok, text) => { message = text; } });
  await connection.start(); assert.equal(FakeSocket.instances.length, count);
  assert.match(message, /Classroom launch unavailable/); connection.stop();
});
