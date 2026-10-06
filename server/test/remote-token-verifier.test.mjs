import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteTokenVerifier } from '../src/auth/remote-token-verifier.mjs';
import { configuredAuthenticator } from '../src/auth/config.mjs';

const clock = () => Date.parse('2026-10-05T12:00:00Z');
const serviceSecret = 'a'.repeat(64); // Synthetic fixture.
const accessToken = 'ml1_' + 'b'.repeat(64);
const options = { endpoint: 'https://identity.invalid/api/moshroids', serviceSecret, clock };
const body = () => ({ ok: true, consumed: true, audience: 'moshroids', roomId: 'classroom',
  tokenId: 'nonce-1', issuedAt: new Date(clock()).toISOString(),
  expiresAt: new Date(clock() + 60000).toISOString(), testerAuthorized: false,
  student: { id: 'learner-1', loginName: 'Learner', active: true } });

test('service credential stays in server header and response supplies all identity', async () => {
  let call;
  const verify = createRemoteTokenVerifier({ ...options, fetcher: async (_url, request) => {
    call = request; return Response.json(body());
  } });
  assert.deepEqual(await verify({ accessToken, roomId: 'classroom', studentId: 'forged' }),
    { studentId: 'learner-1', displayName: 'Learner', testerAuthorized: false });
  assert.equal(call.headers.authorization, 'Bearer ' + serviceSecret);
  assert.equal(call.redirect, 'error');
  assert.deepEqual(JSON.parse(call.body), { action: 'moshroidsVerifySession', accessToken, audience: 'moshroids', roomId: 'classroom' });
});

test('rejects missing configuration, credentials, malformed tokens and wrong rooms', async () => {
  assert.throws(() => configuredAuthenticator({}));
  assert.throws(() => createRemoteTokenVerifier({ endpoint: options.endpoint }), /secret/);
  assert.throws(() => createRemoteTokenVerifier({ ...options, endpoint: 'http://identity.invalid' }), /HTTPS/);
  let called = false;
  const verify = createRemoteTokenVerifier({ ...options, fetcher: async () => { called = true; } });
  for (const token of [undefined, '', 'forged', accessToken + 'x']) {
    await assert.rejects(() => verify({ accessToken: token, roomId: 'classroom' }));
  }
  await assert.rejects(() => verify({ accessToken, roomId: 'wrong' }));
  assert.equal(called, false);
});

test('rejects replay rejection, expired, inactive, forged tester and incomplete responses', async () => {
  const invalid = [
    { ok: false }, { consumed: false }, { audience: 'timez' }, { roomId: 'classroom-teams' },
    { expiresAt: new Date(clock() - 1).toISOString() }, { issuedAt: undefined },
    { tokenId: '' }, { student: { id: 'learner-1', loginName: 'Learner', active: false } },
    { testerAuthorized: true }, { testerAuthorized: undefined }, { student: undefined },
    { student: { id: '', loginName: 'Learner', active: true } },
  ];
  for (const change of invalid) {
    const verify = createRemoteTokenVerifier({ ...options, fetcher: async () => Response.json({ ...body(), ...change }) });
    await assert.rejects(() => verify({ accessToken, roomId: 'classroom' }));
  }
  const verify = createRemoteTokenVerifier({ ...options, fetcher: async () => Response.json({
    ...body(), testerAuthorized: true, student: { id: 'supermrkirby-test-player', loginName: 'SUPERMRKIRBY', active: true },
  }) });
  assert.equal((await verify({ accessToken, roomId: 'classroom' })).testerAuthorized, true);
});

test('network and response failures fail closed without retrying', async () => {
  for (const fetcher of [async () => { throw new Error('offline'); }, async () => new Response('not json')]) {
    const verify = createRemoteTokenVerifier({ ...options, fetcher });
    await assert.rejects(() => verify({ accessToken, roomId: 'classroom' }), /unavailable/);
  }
});
