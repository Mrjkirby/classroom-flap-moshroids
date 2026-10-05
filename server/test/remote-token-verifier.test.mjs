import assert from 'node:assert/strict';
import test from 'node:test';
import { createRemoteTokenVerifier } from '../src/auth/remote-token-verifier.mjs';

function successfulResponse({ expiresAt = '2030-01-01T00:00:00.000Z' } = {}) {
  return new Response(JSON.stringify({
    ok: true, consumed: true, audience: 'moshroids', tokenId: 'once-1', expiresAt,
    student: { id: 'student-1', loginName: 'Pilot One', active: true },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('accepts only an active, one-time, non-expired classroom identity response', async () => {
  let now = Date.parse('2029-01-01T00:00:00.000Z');
  const calls = [];
  const verify = createRemoteTokenVerifier({
    endpoint: 'https://identity.example.test/moshroids/verify', clock: () => now,
    fetcher: async (_url, request) => { calls.push(JSON.parse(request.body)); return successfulResponse(); },
  });
  assert.deepEqual(await verify({ accessToken: 'issued-once', roomId: 'classroom' }), {
    studentId: 'student-1', displayName: 'Pilot One',
  });
  assert.deepEqual(calls[0], {
    action: 'moshroidsVerifySession', accessToken: 'issued-once', audience: 'moshroids', roomId: 'classroom',
  });
  await assert.rejects(() => verify({ accessToken: 'issued-once', roomId: 'classroom' }), /already used/);
  now += 1;
});

test('rejects forged, expired, inactive, malformed, and non-HTTPS verification paths', async () => {
  const rejects = async body => {
    const verify = createRemoteTokenVerifier({
      endpoint: 'https://identity.example.test/moshroids/verify',
      fetcher: async () => new Response(JSON.stringify(body), { status: body.status || 401 }),
    });
    await assert.rejects(() => verify({ accessToken: 'forged', roomId: 'classroom' }));
  };
  await rejects({ ok: false });
  await rejects({ ok: true, consumed: false, audience: 'moshroids' });
  await rejects({
    ok: true, consumed: true, audience: 'moshroids', tokenId: 'once-1', expiresAt: '2030-01-01T00:00:00.000Z',
    student: { id: 'student-1', loginName: 'Inactive', active: false },
  });
  const expired = createRemoteTokenVerifier({
    endpoint: 'https://identity.example.test/moshroids/verify',
    clock: () => Date.parse('2030-01-01T00:00:00.000Z'),
    fetcher: async () => successfulResponse({ expiresAt: '2029-12-31T23:59:00.000Z' }),
  });
  await assert.rejects(() => expired({ accessToken: 'expired', roomId: 'classroom' }), /not valid/);
  assert.throws(() => createRemoteTokenVerifier({ endpoint: 'http://identity.example.test/verify' }), /HTTPS/);
});
