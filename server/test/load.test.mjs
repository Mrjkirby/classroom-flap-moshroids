import assert from 'node:assert/strict';
import test from 'node:test';
import { createMoshroidsServer } from '../src/app.mjs';

test('26 concurrent authenticated clients join, exchange state, and clean up', async () => {
  let messageCount = 0;
  const app = createMoshroidsServer({
    allowMissingOrigin: true,
    authenticate: async ({ accessToken }) => ({ studentId: accessToken.slice(5), displayName: accessToken.slice(5) }),
    log: () => {},
  });
  const address = await app.listen();
  const url = `ws://127.0.0.1:${address.port}/ws`;
  const clients = await Promise.all([...Array(26)].map((_, index) => new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.addEventListener('open', () => socket.send(JSON.stringify({ type: 'hello', accessToken: `test:p${index}`, roomId: 'classroom' })), { once: true });
    socket.addEventListener('message', event => { messageCount += 1; const message = JSON.parse(event.data); if (message.type === 'welcome') resolve(socket); });
    socket.addEventListener('error', reject, { once: true });
  })));
  try {
    await Promise.all(clients.map((socket, index) => { socket.send(JSON.stringify({ type: 'state', state: { x: index, y: index, guns: index % 5 } })); return Promise.resolve(); }));
    await new Promise(resolve => setTimeout(resolve, 150));
    const status = await (await fetch(`http://127.0.0.1:${address.port}/health`)).json();
    assert.equal(status.connections, 26);
    assert.ok(messageCount >= 26, `expected messages from all concurrent clients, got ${messageCount}`);
  } finally {
    clients.forEach(socket => socket.close());
    await new Promise(resolve => setTimeout(resolve, 30));
    await app.close();
  }
});
