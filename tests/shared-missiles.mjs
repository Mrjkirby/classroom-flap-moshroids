import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSharedMissiles } from '../src/sharedMissiles.js';
import { createCollisionSystem } from '../src/collisionSystem.js';

test('clients display the authoritative wave, process a hit once, and retry its acknowledgement', async () => {
  let clock = 0, acknowledgements = 0, deaths = 0, removed = 0;
  const hits = new Map([['m-hit', { id: 'm-hit', x: 100, y: 200 }]]);
  const renderer = createSharedMissiles({ now: () => clock, shoot: async () => true,
    acknowledge: async id => { acknowledgements++; if (acknowledgements === 2) { hits.delete(id); return true; } return false; },
    onHit: () => deaths++, onRemoved: () => removed++ });
  const first = { missiles: [['m', 100, 200, 0, true, 'a']] };
  assert.equal(renderer.update(first, hits, 0.016, 2880, 1620).length, 1);
  await new Promise(resolve => setImmediate(resolve));
  renderer.update(first, hits, 0.016, 2880, 1620);
  assert.equal(deaths, 1); assert.equal(acknowledgements, 1);
  clock = 501; renderer.update(first, hits, 0.016, 2880, 1620);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(deaths, 1); assert.equal(acknowledgements, 2);
  assert.equal(renderer.update({ missiles: [] }, hits, 0.016, 2880, 1620).length, 0);
  assert.equal(removed, 1);
});

test('only a local bullet claims a shared missile, and local contact cannot override server hits', () => {
  const missile = { id: 'm', x: 100, y: 100, radius: 7, outbound: false };
  const bullet = owner => ({ owner, x: 100, y: 100, previousX: 99, previousY: 100, radius: 3 });
  const ship = { owner: 'A', visible: true, x: 100, y: 100, radius: 15 };
  const world = { ships: [ship], missiles: [missile], bullets: [bullet('remote')], asteroids: [], scores: { A: 0 } };
  const claimed = []; let deaths = 0;
  const collision = createCollisionSystem({ world, getWorldWidth: () => 2880, getWorldHeight: () => 1620,
    destroyAsteroid: () => false, isAsteroidDestructionPending: () => false,
    playerDestroyed: () => { deaths++; return true; }, addExplosion() {}, addRockExplosion() {},
    releaseMissiles() {}, advanceAsteroidsFromMrK() {}, updateScores() {}, publishPlayerState() {},
    shootSharedMissile: id => claimed.push(id), serverMissileImpacts: true });
  collision.resolveBulletRockCollisions();
  assert.equal(world.missiles.length, 1); assert.deepEqual(claimed, []);
  collision.resolveMissileCollisions(); assert.equal(deaths, 0);
  world.bullets.push(bullet('A')); collision.resolveBulletRockCollisions();
  assert.deepEqual(claimed, ['m']); assert.equal(world.missiles.length, 0);
});
