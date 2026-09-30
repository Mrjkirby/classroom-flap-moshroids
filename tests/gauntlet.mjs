import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { modeForPath } from '../src/gameMode.js';
import { perimeterSlots } from '../src/gauntlet/perimeterLayout.js';
import { selectSurvivor, acceptCannonShot, finishGauntlet, resetGauntletState } from '../src/gauntlet/rules.js';
import { shotMultiplier, createCannonProjectile, activeCannonShots } from '../src/gauntlet/projectiles.js';
import { advanceBouncing, BouncingTrajectories } from '../src/gauntlet/bounceTrajectory.js';
import { Ship } from '../src/ship.js';
import { createCollisionSystem } from '../src/collisionSystem.js';

test('Classic and 1VW routes share the engine but use explicit URLs', () => {
  assert.equal(modeForPath('/classroom-flap-moshroids/'), 'classic');
  assert.equal(modeForPath('/classroom-flap-moshroids/1vw/'), '1vw');
  assert.equal(modeForPath('/classroom-flap-moshroids/1vw/index.html'), '1vw');
  const html = readFileSync(new URL('../1vw/index.html', import.meta.url), 'utf8');
  assert.match(html, /src="\.\.\/src\/game\.js"/);
});

test('one first 40-gun claim wins the survivor slot and Classic is excluded', () => {
  const normal = { mode: '1vw', phase: 'normal', round: 2 };
  const winner = selectSurvivor(normal, { uid: 'a', name: 'A', at: 10000 });
  assert.equal(winner.survivorUid, 'a');
  assert.equal(winner.gauntletStartedAt, 12000);
  assert.equal(selectSurvivor(winner, { uid: 'b', at: 10000 }), undefined);
  assert.equal(selectSurvivor({ mode: 'classic', phase: 'normal' }, { uid: 'a', at: 10000 }), undefined);
  assert.equal(finishGauntlet(winner, { uid: 'b', reason: 'defeated', at: 15000 }), undefined);
  const result = finishGauntlet(winner, { uid: 'a', reason: 'defeated', at: 15000 });
  assert.equal(result.phase, 'result');
  assert.deepEqual(resetGauntletState({ ...result, cannons: { a: { shots: { 1: {} } } } }),
    { mode: '1vw', phase: 'normal', round: 3 });
});

test('perimeter positions are stable, spread over four sides, and face inward', () => {
  const a = perimeterSlots(['d','c','b','a','e','f','g','h'], 1200, 800);
  const b = perimeterSlots(['h','g','f','e','d','c','b','a'], 1200, 800);
  assert.deepEqual([...a], [...b]);
  assert.equal(new Set([...a.values()].map(slot => `${slot.x},${slot.y}`)).size, 8);
  assert.equal([...a.values()].filter(slot => slot.y === 20).length, 2);
  assert.equal([...a.values()].filter(slot => slot.x === 1180).length, 2);
  assert.equal([...a.values()].filter(slot => slot.y === 780).length, 2);
  assert.equal([...a.values()].filter(slot => slot.x === 20).length, 2);
  assert.equal(a.get('a').angle, Math.PI / 2);
});

test('perimeter ship rotates and fires but cannot translate', () => {
  const ship = new Ship('A', 200, 20, { left: 'left', right: 'right', thrust: 'up', brake: 'down', fire: 'fire' });
  ship.perimeterLocked = true;
  const startAngle = ship.angle;
  assert.equal(ship.update(1/60, new Set(['right','up','fire']), 1200, 800), true);
  assert.equal(ship.x, 200);
  assert.equal(ship.y, 20);
  assert.equal(ship.velocityX, 0);
  assert.equal(ship.velocityY, 0);
  assert.notEqual(ship.angle, startAngle);
  assert.equal(ship.thrusting, false);
  const survivor = new Ship('A', 200, 200, ship.controls);
  survivor.update(1/60, new Set(['up']), 1200, 800);
  assert.notEqual(survivor.y, 200);
});

test('asteroids reflect from perimeter ships and separate instead of embedding', () => {
  const obstacle = [{ x: 100, y: 100, radius: 15 }];
  const initial = { x: 20, y: 100, vx: 0.1, vy: 0, radius: 10, at: 0 };
  const atHit = advanceBouncing(initial, 600, obstacle, 1000, 800);
  assert.ok(atHit.vx < 0);
  assert.ok(atHit.x < 75);
  assert.ok(Math.hypot(atHit.x - 100, atHit.y - 100) > 25);
  const live = new BouncingTrajectories();
  const resumed = new BouncingTrajectories();
  live.position('rock', initial, 300, obstacle, 1000, 800, 'roster');
  assert.deepEqual(live.position('rock', initial, 600, obstacle, 1000, 800, 'roster'),
    resumed.position('rock', initial, 600, obstacle, 1000, 800, 'roster'));
  const embedded = advanceBouncing({ ...initial, x: 90 }, 200, obstacle, 1000, 800);
  assert.ok(embedded.vx < 0);
  assert.ok(Math.hypot(embedded.x - 100, embedded.y - 100) > 25);
  const huge = { x: 1000, y: 800, vx: 0.24, vy: 0, radius: 1920, at: 0 };
  const arena = [{ x: 1440, y: 20, radius: 15 }];
  const stepped = advanceBouncing(advanceBouncing(huge, 500, arena, 2880, 1620),
    1000, arena, 2880, 1620);
  assert.deepEqual(stepped, advanceBouncing(huge, 1000, arena, 2880, 1620));
});

test('one shot per second and immutable 1x, 2x, 4x, 8x, 16x projectile sizes', () => {
  let cannon = acceptCannonShot(null, { at: 0, angle: 0, round: 1 });
  assert.equal(acceptCannonShot(cannon, { at: 999, angle: 0, round: 1 }), undefined);
  cannon = acceptCannonShot(cannon, { at: 1000, angle: 0, round: 1 });
  assert.equal(cannon.sequence, 2);
  const multipliers = [0,60000,120000,180000,240000].map(at => shotMultiplier(at, 0));
  assert.deepEqual(multipliers, [1,2,4,8,16]);
  const early = createCannonProjectile('uid', 1, { firedAt: 0, angle: Math.PI/2, round: 1, x: 300, y: 20 }, 0, 1200, 800);
  const late = createCannonProjectile('uid', 2, { firedAt: 60000, angle: Math.PI/2, round: 1, x: 300, y: 20 }, 0, 1200, 800);
  assert.equal(early.radius, 30);
  assert.equal(late.radius, 60);
  assert.equal(early.radius, 30);
});

test('late join reconstructs cannon events; movement needs no Firebase position writes', () => {
  const state = { phase: 'gauntlet', round: 1, gauntletStartedAt: 0,
    cannons: { uid: { shots: { 1: { firedAt: 5000, angle: 1, round: 1, x: 300, y: 20 } } } } };
  const a = activeCannonShots(state, 6000, new Map(), 1200, 800);
  const b = activeCannonShots(state, 6000, new Map(), 1200, 800);
  assert.deepEqual(a.map(rock => [rock.id, rock.startX, rock.startY, rock.radius]),
    b.map(rock => [rock.id, rock.startX, rock.startY, rock.radius]));
  assert.equal(activeCannonShots(state, 126000, new Map(), 1200, 800).length, 0);
  for (const name of ['bounceTrajectory.js','projectiles.js']) {
    const source = readFileSync(new URL(`../src/gauntlet/${name}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"]https:[^'"]*firebase|runTransaction\(/i);
  }
});

test('collision system keeps perimeter ship invincible while survivor stays vulnerable', () => {
  const perimeter = new Ship('A', 100, 100, {}, 'TURRET');
  const rock = { x: 100, y: 100, radius: 20, id: 'shot', cannonShot: true };
  const world = { ships: [perimeter], asteroids: [], gauntletProjectiles: [rock], bullets: [], missiles: [], mrK: null, scores: { A: 0 } };
  let deaths = 0;
  const collision = createCollisionSystem({ world, getWorldWidth: () => 1200, getWorldHeight: () => 800,
    destroyAsteroid: () => false, isAsteroidDestructionPending: () => false,
    getProjectileAsteroids: () => world.gauntletProjectiles, isPerimeterShip: ship => ship.perimeterLocked,
    playerDestroyed: () => { deaths += 1; return true; }, addExplosion() {}, addRockExplosion() {},
    releaseMissiles() {}, advanceAsteroidsFromMrK() {}, updateScores() {}, publishPlayerState() {} });
  perimeter.perimeterLocked = true;
  collision.resolveLocalShipRockCollisions();
  assert.equal(deaths, 0);
  perimeter.perimeterLocked = false;
  collision.resolveLocalShipRockCollisions();
  assert.equal(deaths, 1);
});

test('survivor bullets destroy cannon asteroids through the shared destruction hook', async () => {
  const shot = { id: '1vw-shot-1-u-1', x: 100, y: 100, radius: 30, points: 50, cannonShot: true };
  const world = { ships: [], asteroids: [], gauntletProjectiles: [shot],
    bullets: [{ x: 100, y: 100, previousX: 100, previousY: 100, radius: 3, owner: 'A' }],
    missiles: [], mrK: null, scores: { A: 0 } };
  let projectileClaims = 0;
  let normalClaims = 0;
  const collision = createCollisionSystem({ world, getWorldWidth: () => 1200, getWorldHeight: () => 800,
    destroyAsteroid: () => { normalClaims += 1; return true; },
    destroyProjectile: () => { projectileClaims += 1; return true; },
    getProjectileAsteroids: () => world.gauntletProjectiles,
    isAsteroidDestructionPending: () => false, playerDestroyed: () => false,
    addExplosion() {}, addRockExplosion() {}, releaseMissiles() {}, advanceAsteroidsFromMrK() {},
    updateScores() {}, publishPlayerState() {} });
  collision.resolveBulletRockCollisions();
  await Promise.resolve();
  assert.equal(projectileClaims, 1);
  assert.equal(normalClaims, 0);
  assert.equal(world.bullets.length, 0);
});
