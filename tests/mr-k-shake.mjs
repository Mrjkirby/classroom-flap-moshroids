import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Match } from '../server/src/match.mjs';
import { MrKShake, MR_K_SHAKE_AMPLITUDE_PX, MR_K_SHAKE_DURATION_MS } from '../src/mrKShake.js';

test('one shared Mr. K destruction shakes A, B, and C once at the same intensity and duration', () => {
  const clients = ['a', 'b', 'c'].map(() => new MrKShake());
  for (const client of clients) client.activate(1000);
  const event = new Map([['epoch-1-mrk-0', { destroyedAt: 1010, destroyedBy: 'a' }]]);
  for (const client of clients) {
    assert.deepEqual(client.sync(event, 1020), ['epoch-1-mrk-0']);
    assert.deepEqual(client.sync(event, 1021), [], 'listener refresh must not shake twice');
    assert.deepEqual(client.offset(1020), clients[0].offset(1020));
    assert.notDeepEqual(client.offset(1020), { x: 0, y: 0 });
    assert.deepEqual(client.offset(1020 + MR_K_SHAKE_DURATION_MS), { x: 0, y: 0 });
    for (const value of Object.values(client.offset(1100)))
      assert.ok(Math.abs(value) <= MR_K_SHAKE_AMPLITUDE_PX);
  }
});

test('snapshot replay and reconnect do not repeat a shake', () => {
  const record = new Map([['epoch-1-mrk-0', { destroyedAt: 1010 }]]);
  const current = new MrKShake(); current.activate(1000);
  assert.equal(current.sync(record, 1020).length, 1);
  assert.equal(current.sync(new Map(record), 1040).length, 0, 'reconnect snapshot is deduplicated');
  const refreshed = new MrKShake(); refreshed.activate(1030);
  assert.equal(refreshed.sync(record, 1040).length, 0, 'page refresh baselines earlier history');
  assert.deepEqual(refreshed.offset(1040), { x: 0, y: 0 });
});

test('KNAS room records are unique and stay within their room', () => {
  let now = 18_000_000;
  const rooms = ['classroom', 'classroom-teams', 'classroom-1vw'].map(roomId =>
    new Match(roomId, { clock: () => now }));
  for (const room of rooms) room.join({ studentId: 'a', displayName: 'A' }, { send() {}, close() {} });
  const clients = rooms.map(() => new MrKShake());
  for (const client of clients) client.activate(now - 1);
  const id = 'epoch-10-mrk-0';
  assert.equal(rooms[0].shared.apply(rooms[0].players.get('a'), 'asteroidClaim', { id }), true);
  assert.equal(rooms[0].shared.apply(rooms[0].players.get('a'), 'asteroidClaim', { id }), false);
  assert.deepEqual(clients.map((client, index) => client.sync(rooms[index].shared.destroyed, now)), [[id], [], []]);
  assert.equal(rooms[1].shared.destroyed.has(id), false);
  assert.equal(rooms[2].shared.destroyed.has(id), false);
});

test('ordinary asteroid destruction never starts the Mr. K effect', () => {
  const shake = new MrKShake(); shake.activate(1000);
  assert.deepEqual(shake.sync(new Map([['epoch-1-field-0-asteroid-1', { destroyedAt: 1010 }]]), 1020), []);
  assert.deepEqual(shake.offset(1020), { x: 0, y: 0 });
});
