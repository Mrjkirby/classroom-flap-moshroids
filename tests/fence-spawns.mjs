import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SafeZones } from '../src/safeZone.js';
import { AsteroidDirector } from '../src/asteroidDirector.js';
import { Match } from '../server/src/match.mjs';

const epoch = 10 * 1800000;
test('both arms of each L identify the same barrier', () => {
  const zones = new SafeZones(2880, 1620);
  const hit = (x, y) => zones.blockShip({ x, y, radius: 12 });
  assert.equal(hit(120, 68), 'top-left');
  assert.equal(hit(68, 120), 'top-left');
  assert.equal(hit(2760, 68), 'top-right');
  assert.equal(hit(1400, 800), false);
});
test('room accepts alternating barriers independently for each player and snapshots them', () => {
  const match = new Match('classroom', { clock: () => epoch + 2000 });
  const a = { id: 'a', visible: true }, b = { id: 'b', visible: true };
  const touch = (player, barrier) => match.shared.apply(player, 'fenceTouch', { barrier });
  assert.equal(touch(a, 'top-left'), true);
  assert.equal(touch(a, 'top-left'), false);
  assert.equal(touch(b, 'top-left'), true);
  assert.equal(touch(a, 'top-right'), true);
  assert.equal(touch(a, 'top-left'), true);
  assert.equal(match.shared.fenceSpawns.size, 4);
  const messages = [];
  match.shared.snapshot({ send: v => messages.push(v) });
  assert.equal(messages.filter(v => v.channel === 'fenceSpawns').flatMap(v => v.entries).length, 4);
  assert.equal(new Match('classroom-teams', { clock: () => epoch }).shared.apply(a, 'fenceTouch', { barrier: 'top-left' }), false);
});
test('spawn events reconstruct deterministically, double per Mr. K level and stay destroyed', () => {
  const now = epoch + 10000;
  const events = new Map([['epoch-10-fence-1', { at: epoch + 1000, generation: 0 }]]);
  const director = new AsteroidDirector();
  const field = director.reconstructField(2880, 1620, now, new Map(), events);
  assert.equal(field.length, 11);
  const id = 'epoch-10-fence-1-asteroid-0';
  assert.ok(field.some(a => a.id === id));
  const destroyed = new Map([[id, { destroyedAt: epoch + 2000 }]]);
  assert.equal(director.reconstructField(2880, 1620, now, destroyed, events).length, 10);
  destroyed.set('epoch-10-mrk-0', { destroyedAt: epoch + 3000 });
  events.set('epoch-10-fence-2', { at: epoch + 4000, generation: 1 });
  const level2 = director.reconstructField(2880, 1620, now, destroyed, events);
  assert.equal(level2.length, 22);
  const second = new AsteroidDirector().reconstructField(2880, 1620, now, destroyed, events);
  assert.deepEqual(level2.map(a => [a.id, a.seed, a.spawnTimestamp]), second.map(a => [a.id, a.seed, a.spawnTimestamp]));
});
