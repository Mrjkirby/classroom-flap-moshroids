import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../edge-staging/worker.mjs';

const origin = 'https://mrjkirby.github.io';
function fixture() {
  const calls = [];
  const response = new Response('origin');
  return { calls, response, env: {
    MOSHROIDS: { fetch: async request => { calls.push(request); return response; } },
    MOSHROIDS_VPC: { fetch: async request => { calls.push(request); return response; } },
  } };
}
test('only exact GET paths are exposed, with no query-based credentials/targets', async () => {
  const { calls, env } = fixture();
  for (const path of ['/', '/metrics', '/ws/extra', '/health?target=http://other', '/ws?token=synthetic']) {
    assert.equal((await worker.fetch(new Request(`https://example.workers.dev${path}`), env)).status, 404);
  }
  assert.equal((await worker.fetch(new Request('https://example.workers.dev/health', { method: 'POST' }), env)).status, 405);
  assert.equal(calls.length, 0);
});
test('health reaches only pinned service, strips credentials, preserves response', async () => {
  const { calls, env, response } = fixture();
  assert.equal(await worker.fetch(new Request('https://example.workers.dev/health', {
    headers: { Cookie: 'synthetic', Authorization: 'synthetic', 'X-Target': 'http://other' },
  }), env), response);
  assert.equal(calls[0].url, 'http://moshroids-realtime:8794/health');
  assert.equal([...calls[0].headers].length, 0);
  assert.equal(calls[0].redirect, 'manual');
});
test('WebSocket missing/wrong Origin and non-upgrade are denied before VPC', async () => {
  const { calls, env } = fixture();
  for (const headers of [{ Upgrade: 'websocket' }, { Origin: 'https://evil.example', Upgrade: 'websocket' }]) {
    assert.equal((await worker.fetch(new Request('https://example.workers.dev/ws', { headers }), env)).status, 403);
  }
  assert.equal((await worker.fetch(new Request('https://example.workers.dev/ws', { headers: { Origin: origin } }), env)).status, 426);
  assert.equal(calls.length, 0);
});
test('WebSocket upgrade uses native VPC fetch to the fixed private staging address', async () => {
  const calls = [];
  const response = { status: 101, webSocket: {} };
  const env = { MOSHROIDS_VPC: { fetch: async request => { calls.push(request); return response; } } };
  assert.equal(await worker.fetch(new Request('https://example.workers.dev/ws', {
    headers: { Origin: origin, Upgrade: 'websocket', Connection: 'Upgrade',
      'Sec-WebSocket-Key': 'synthetic-key', 'Sec-WebSocket-Version': '13',
      Cookie: 'synthetic', Authorization: 'synthetic' },
  }), env), response);
  assert.equal(calls[0].url, 'http://172.22.0.4:8794/ws');
  assert.equal(calls[0].headers.get('Origin'), origin);
  assert.equal(calls[0].headers.get('Upgrade'), 'websocket');
  assert.equal(calls[0].headers.get('Connection'), 'Upgrade');
  assert.equal(calls[0].headers.has('Sec-WebSocket-Key'), true);
  assert.equal(calls[0].headers.has('Sec-WebSocket-Version'), true);
  assert.equal(calls[0].headers.has('Cookie'), false);
  assert.equal(calls[0].headers.has('Authorization'), false);
  assert.equal(calls[0].redirect, 'manual');
});
test('VPC errors fail closed without exposing network details', async () => {
  const response = await worker.fetch(new Request('https://example.workers.dev/health'), {
    MOSHROIDS: { fetch: async () => { throw new Error('private details'); } },
  });
  assert.equal(response.status, 502);
  assert.equal(await response.text(), 'MOSHROIDS staging origin unavailable');
});
