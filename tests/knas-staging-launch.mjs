import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenerLaunchAdapter, LLP_LAUNCHER_ORIGIN } from '../knas-staging/launch-adapter.js';

function fakeWindow({ respond } = {}) {
  const listeners = new Set();
  const sent = [];
  const windowRef = {
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
  const opener = {
    postMessage(message, targetOrigin) {
      sent.push({ message, targetOrigin });
      respond?.({ message, opener, listeners });
    },
  };
  windowRef.opener = opener;
  return { windowRef, opener, sent, listeners };
}

function dispatch(listeners, { source, origin, data }) {
  const event = new Event('message');
  Object.assign(event, { source, origin, data });
  for (const listener of [...listeners]) listener(event);
}

const grant = roomId => ({
  accessToken: 'ml1_' + 'b'.repeat(64),
  audience: 'moshroids',
  expiresAt: new Date(Date.now() + 30000).toISOString(),
  roomId,
});

test('staging requests a one-time grant from only its authorized same-origin opener', async () => {
  let harness;
  harness = fakeWindow({ respond: ({ message, opener, listeners }) => {
    dispatch(listeners, { source: {}, origin: LLP_LAUNCHER_ORIGIN, data: {
      type: 'moshroids:launch-grant', requestId: message.requestId, grant: grant('classroom'),
    } });
    dispatch(listeners, { source: opener, origin: 'https://attacker.example', data: {
      type: 'moshroids:launch-grant', requestId: message.requestId, grant: grant('classroom'),
    } });
    dispatch(listeners, { source: opener, origin: LLP_LAUNCHER_ORIGIN, data: {
      type: 'moshroids:launch-grant', requestId: message.requestId, grant: grant('classroom'),
    } });
  } });
  const adapter = createOpenerLaunchAdapter({ windowRef: harness.windowRef });
  assert.equal(adapter.requestLaunch.hasNewLaunch, false);
  const actual = await adapter.requestLaunch('classroom');
  assert.equal(actual.accessToken, grant('classroom').accessToken);
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].targetOrigin, LLP_LAUNCHER_ORIGIN);
  assert.deepEqual(Object.keys(harness.sent[0].message).sort(), ['requestId', 'roomId', 'type']);
  assert.equal(harness.listeners.size, 0);
});

test('staging rejects direct navigation without an LLP opener and rejects wrong-room grants', async () => {
  const direct = createOpenerLaunchAdapter({ windowRef: { opener: null } });
  await assert.rejects(direct.requestLaunch('classroom'), /authorized LLP launch/);

  const harness = fakeWindow({ respond: ({ message, opener, listeners }) => {
    dispatch(listeners, { source: opener, origin: LLP_LAUNCHER_ORIGIN, data: {
      type: 'moshroids:launch-grant', requestId: message.requestId, grant: grant('classroom-teams'),
    } });
  } });
  const adapter = createOpenerLaunchAdapter({ windowRef: harness.windowRef });
  await assert.rejects(adapter.requestLaunch('classroom'), /valid grant/);
  assert.equal(harness.listeners.size, 0);
});

test('staging does not accept a grant from a mismatched request id', async () => {
  const harness = fakeWindow({ respond: ({ message, opener, listeners }) => {
    dispatch(listeners, { source: opener, origin: LLP_LAUNCHER_ORIGIN, data: {
      type: 'moshroids:launch-grant', requestId: `${message.requestId}-other`, grant: grant('classroom'),
    } });
  } });
  const adapter = createOpenerLaunchAdapter({ windowRef: harness.windowRef, timeoutMs: 5 });
  await assert.rejects(adapter.requestLaunch('classroom'), /did not respond/);
  assert.equal(harness.listeners.size, 0);
});

test('one-time launch fragment is removed immediately and accepted only once', async () => {
  const accessToken = grant('classroom').accessToken;
  const expiresAt = new Date(Date.now() + 30000).toISOString();
  const locationRef = {
    pathname: '/classroom-flap-moshroids/knas-staging/',
    search: '?mode=classic',
    hash: `#t=${accessToken}&roomId=classroom&expiresAt=${encodeURIComponent(expiresAt)}`,
  };
  const replacements = [];
  const adapter = createOpenerLaunchAdapter({
    windowRef: { opener: null },
    locationRef,
    historyRef: { replaceState: (...args) => replacements.push(args) },
  });
  assert.deepEqual(replacements, [[null, '', `${locationRef.pathname}${locationRef.search}`]]);
  assert.equal(adapter.requestLaunch.hasNewLaunch, true);
  assert.equal((await adapter.requestLaunch('classroom')).accessToken, accessToken);
  await assert.rejects(adapter.requestLaunch('classroom'), /authorized LLP launch/);
});
