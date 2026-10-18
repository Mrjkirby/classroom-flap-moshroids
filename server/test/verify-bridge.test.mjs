import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyBridge } from '../edge-staging/verify-bridge.mjs';
import { connectPrivate, runGameplayProbe } from '../edge-staging/gameplay-probe.mjs';
import { createMoshroidsServer } from '../src/app.mjs';
const secret = 'a'.repeat(64); // Synthetic fixture only.
const grant = token => ({ accessToken: 'ml1_' + token.repeat(64), audience: 'moshroids',
  expiresAt: new Date(Date.now() + 60000).toISOString() });
const input = () => ({ active: grant('b'), expiring: grant('c'), expectedId: 'fixture' });
const request = (headers = {}, body = input()) => new Request('https://edge.invalid/verify', {
  method: 'POST', headers: { authorization: 'Bearer ' + secret, ...headers }, body: JSON.stringify(body),
});
test('bridge rejects browser Origin/cookies and missing/wrong service credentials', async () => {
  const env = { MOSHROIDS_SERVICE_SECRET: secret, MOSHROIDS_VPC: {} };
  for (const headers of [{origin:'https://snake.invalid'}, {cookie:'fixture'}, {authorization:''}, {authorization:'forged'}])
    assert.equal((await verifyBridge(request(headers), env)).status, 403);
});
test('bridge is target-pinned and rejects extra identity/target/command fields', async () => {
  const env = { MOSHROIDS_SERVICE_SECRET: secret, MOSHROIDS_VPC: {} };
  for (const key of ['target', 'studentId', 'command'])
    assert.equal((await verifyBridge(request({}, { ...input(), [key]: 'forged' }), env)).status, 400);
  assert.equal((await verifyBridge(request(), env, async () => ({ checks: { consume: true } }))).status, 200);
});
test('probe diagnostics report only a fixed stage and upgrade status, never private details', async () => {
  let upstreamRequest;
  const rejected = await runGameplayProbe(input(), hello => connectPrivate({
    fetch: async request => {
      upstreamRequest = request;
      return new Response('private upstream body', { status: 400 });
    },
  }, hello));
  assert.deepEqual(rejected.failure, { stage: 'substitution', upgradeStatus: 400 });
  assert.equal(upstreamRequest.url, 'http://172.22.0.4:8794/ws');
  assert.equal(upstreamRequest.headers.get('Origin'), 'https://mrjkirby.github.io');
  assert.equal(upstreamRequest.headers.get('Upgrade'), 'websocket');
  const thrown = await runGameplayProbe(input(), async () => { throw Error('secret exception detail'); });
  assert.deepEqual(thrown.failure, { stage: 'substitution' });
  const vpc = await runGameplayProbe(input(), async () => { throw Error('ProxyError: http_upgrade_failed secret'); });
  assert.deepEqual(vpc.failure, { stage: 'substitution', vpcError: 'http_upgrade_failed' });
  assert.ok(!JSON.stringify([rejected, thrown]).includes('private upstream'));
  assert.ok(!JSON.stringify([rejected, thrown]).includes('secret exception'));
});
test('probe exercises real loopback protocol including replay, expiry, shared claims and resume', async () => {
  const data = input(); let now = Date.now(); const used = new Set();
  const app = createMoshroidsServer({ allowMissingOrigin: true, clock: () => now,
    authenticate: async ({accessToken, roomId}) => {
      if (roomId !== 'classroom' || used.has(accessToken) || now >= Date.parse(data.active.expiresAt) ||
        ![data.active.accessToken, data.expiring.accessToken].includes(accessToken)) throw Error('denied');
      used.add(accessToken);
      return { studentId: 'fixture', displayName: 'Fixture', testerAuthorized: true };
    } });
  const address = await app.listen();
  const sockets = [];
  async function connect(hello) {
    const socket = new WebSocket('ws://127.0.0.1:' + address.port + '/ws'); sockets.push(socket);
    const client = { messages: [], closed: undefined,
      send: value => socket.send(JSON.stringify(value)),
      close: () => socket.close(),
      async wait(predicate) {
        const until = Date.now() + 2000;
        while (!predicate()) { if (Date.now() > until) throw Error('timeout'); await new Promise(r => setTimeout(r, 5)); }
      } };
    socket.addEventListener('message', e => client.messages.push(JSON.parse(e.data)));
    socket.addEventListener('close', e => { client.closed = e.code; });
    await new Promise((resolve, reject) => { socket.addEventListener('open', resolve); socket.addEventListener('error', reject); });
    client.send(hello); return client;
  }
  try {
    const result = await runGameplayProbe(data, connect, { clock: () => now, sleep: async ms => { now += ms; } });
    assert.equal(result.clientCount, 1);
    assert.ok(Object.values(result.checks).every(Boolean), JSON.stringify(result.checks));
    assert.equal(used.size, 1);
  } finally { sockets.forEach(s => s.close()); await app.close(); }
});
