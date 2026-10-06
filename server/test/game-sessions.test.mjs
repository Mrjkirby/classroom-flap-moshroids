import assert from 'node:assert/strict';
import test from 'node:test';
import { createGameSessions, GAME_SESSION_TTL_MS } from '../src/auth/game-sessions.mjs';

const identity = { studentId: 'learner', displayName: 'Learner', testerAuthorized: false };
const room = 'classroom', origin = 'https://mrjkirby.github.io';

test('reconnect rotates its credential and does not extend expiry or accept a launch token', () => {
  let now = 100;
  const sessions = createGameSessions({ clock: () => now });
  const first = sessions.create(identity, room, origin);
  assert.throws(() => sessions.resume(first.resumeToken, 'classroom-teams', origin));
  assert.throws(() => sessions.resume(first.resumeToken, room, 'https://evil.invalid'));
  assert.throws(() => sessions.resume('ml1_' + 'a'.repeat(64), room, origin));
  now += 1000;
  const resumed = sessions.resume(first.resumeToken, room, origin);
  assert.deepEqual(resumed.identity, identity);
  assert.notEqual(resumed.resumeToken, first.resumeToken);
  assert.equal(resumed.expiresAt, first.expiresAt);
  assert.throws(() => sessions.resume(first.resumeToken, room, origin));
  now = first.expiresAt;
  assert.throws(() => sessions.resume(resumed.resumeToken, room, origin));
});

test('new launch replaces previous resume credential; restart and bounded capacity fail closed', () => {
  let now = 100;
  const sessions = createGameSessions({ clock: () => now, limit: 1 });
  const first = sessions.create(identity, room, origin);
  const second = sessions.create(identity, room, origin);
  assert.throws(() => sessions.resume(first.resumeToken, room, origin));
  assert.throws(() => sessions.create({ ...identity, studentId: 'another' }, room, origin));
  assert.throws(() => createGameSessions().resume(second.resumeToken, room, origin));
  now += GAME_SESSION_TTL_MS;
  assert.doesNotThrow(() => sessions.create(identity, room, origin));
  sessions.clear();
  assert.throws(() => sessions.resume(second.resumeToken, room, origin));
});
