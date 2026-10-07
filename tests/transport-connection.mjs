import assert from 'node:assert/strict';
import test from 'node:test';
import { RealtimeConnection } from '../src/transport/connection.js';
class FakeSocket extends EventTarget {
  static instances = [];
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  constructor(url) { super(); this.url = url; FakeSocket.instances.push(this); }
  send(text) { this.sent.push(JSON.parse(text)); }
  message(value) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(value) })); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
}
test('KNAS connector refuses plaintext public endpoints and URL credentials', () => {
  for (const url of ['ws://public.example/ws', 'wss://user:password@example.test/ws', 'wss://example.test/ws?token=bad'])
    assert.throws(() => new RealtimeConnection({ url }));
});
test('one-time grant is hello-only; mutations wait for explicit server acknowledgement', async () => {
  let issued = 0;
  const connection = new RealtimeConnection({ url: 'wss://example.test/ws', roomId: 'classroom',
    WebSocketClass: FakeSocket, requestLaunch: async () => { issued++; return { accessToken: 'one-time-fixture' }; } });
  await connection.start(); const socket = FakeSocket.instances.at(-1);
  socket.dispatchEvent(new Event('open'));
  assert.deepEqual(socket.sent[0], { type: 'hello', roomId: 'classroom', accessToken: 'one-time-fixture' });
  assert.equal(await connection.request('dropClaim', { id: 'g' }), false);
  socket.message({ type: 'authenticated', resumeToken: 'fixture-resume', expiresAt: Date.now() + 30000 });
  socket.message({ type: 'ready' });
  const promise = connection.request('dropClaim', { id: 'g' });
  const request = socket.sent.at(-1);
  socket.message({ type: 'result', requestId: request.requestId, ok: true });
  assert.equal(await promise, true); assert.equal(issued, 1);
  assert.ok(!JSON.stringify(request).includes('one-time-fixture'));
  const interrupted = connection.request('asteroidClaim', { id: 'a' });
  connection.stop(); assert.equal(await interrupted, false);
});
test('missing classroom session fails closed without anonymous fallback', async () => {
  const count = FakeSocket.instances.length; let message;
  const connection = new RealtimeConnection({ url: 'wss://example.test/ws', WebSocketClass: FakeSocket,
    onStatus: (_ok, text) => { message = text; } });
  await connection.start(); assert.equal(FakeSocket.instances.length, count);
  assert.match(message, /Classroom launch unavailable/); connection.stop();
});
