import assert from 'node:assert/strict';
import test from 'node:test';
import { createMoshroidsServer } from '../src/app.mjs';
import { RealtimeConnection } from '../../src/transport/connection.js';

// Real loopback HTTP/WebSocket traffic; synthetic identity, never the live issuer.
for (const offset of [-3_600_000, -2000, 2000, 3_600_000]) {
  test(`browser connector authenticates, resumes and obeys server expiry with ${offset}ms server skew`, async t => {
    let advance = 0;
    let issued = 0;
    const app = createMoshroidsServer({ allowMissingOrigin: true,
      clock: () => Date.now() + offset + advance,
      authenticate: async () => ({ studentId: 'synthetic-clock-test', displayName: 'Clock Test' }) });
    const address = await app.listen();
    const saved = new Map();
    const storage = { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value),
      removeItem: key => saved.delete(key) };
    const clients = [];
    t.after(async () => { for (const client of clients) client.stop(); await app.close(); });
    async function connect() {
      let resolveReady, rejectReady;
      const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      const deadline = setTimeout(() => rejectReady(new Error('Connection did not become ready')), 5000);
      const connection = new RealtimeConnection({
        url: `ws://127.0.0.1:${address.port}/ws`, roomId: 'classroom', storage,
        diagnostic: () => {},
        requestLaunch: async () => {
          issued++;
          return { accessToken: 'ml1_' + 'a'.repeat(64), audience: 'moshroids',
            roomId: 'classroom', expiresAt: new Date(Date.now() + 30_000).toISOString() };
        },
        onStatus: connected => { if (connected) resolveReady(); },
        onMessage: message => {
          if (message.type === 'welcome') assert.equal(message.studentId, 'synthetic-clock-test');
        },
      });
      clients.push(connection);
      try { await connection.start(); await ready; } finally { clearTimeout(deadline); }
      return connection;
    }
    const first = await connect();
    const expiry = first.expiresAt;
    const firstToken = first.resumeToken;
    first.stop();
    const resumed = await connect();
    assert.equal(issued, 1, 'refresh resumes without issuing or replaying a grant');
    assert.notEqual(resumed.resumeToken, firstToken, 'resume credential rotates');
    assert.equal(resumed.expiresAt, expiry, 'reconnect never extends the server lifetime');
    const closed = new Promise(resolve => resumed.socket.addEventListener('close', resolve, { once: true }));
    advance = 300_001;
    resumed.send({ type: 'heartbeat', sentAt: Date.now() });
    assert.equal((await closed).code, 4003, 'server must reject the session at its original expiry');
    assert.equal(resumed.resumeToken, null);
    assert.equal(resumed.retry, undefined);
  });
}
