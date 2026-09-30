import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { Asteroid } from '../src/asteroid.js';
import { AsteroidDirector, EPOCH_DURATION } from '../src/asteroidDirector.js';
import { sharedClock } from '../src/sharedClock.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../src/worldConfig.js';

const epoch = 994412 * EPOCH_DURATION * 1000;

function client(at = epoch + 2000) {
  const director = new AsteroidDirector();
  director.reset(at);
  const asteroids = director.createField(WORLD_WIDTH, WORLD_HEIGHT, 10, at);
  return { director, asteroids };
}

function position(asteroid, at) {
  asteroid.update(at, WORLD_WIDTH, WORLD_HEIGHT);
  return [asteroid.x, asteroid.y, asteroid.angle];
}

function sameField(left, right, at) {
  assert.deepEqual(left.map(a => a.id), right.map(a => a.id));
  assert.deepEqual(left.map(a => a.seed), right.map(a => a.seed));
  for (let i = 0; i < left.length; i += 1) {
    const a = position(left[i], at);
    const b = position(right[i], at);
    a.forEach((value, axis) => assert.ok(Math.abs(value - b[axis]) < 1e-9));
  }
}

test('two independent clients have the same asteroid state at one time', () => {
  sameField(client().asteroids, client().asteroids, epoch + 30000);
});

test('late join reconstructs the current position from the epoch timestamp', () => {
  const early = client(epoch + 2000).asteroids;
  const late = client(epoch + 27000).asteroids;
  sameField(early, late, epoch + 30000);
});

test('frame rate and dropped frames do not change final positions', () => {
  const worlds = [client().asteroids, client().asteroids, client().asteroids];
  for (let ms = 0; ms <= 30000; ms += 1000 / 60) worlds[0].forEach(a => position(a, epoch + ms));
  for (let ms = 0; ms <= 30000; ms += 1000 / 30) worlds[1].forEach(a => position(a, epoch + ms));
  for (const ms of [0, 17, 63, 280, 1100, 10300, 29900]) worlds[2].forEach(a => position(a, epoch + ms));
  sameField(worlds[0], worlds[1], epoch + 30000);
  sameField(worlds[0], worlds[2], epoch + 30000);
});

test('background resume immediately catches up', () => {
  const active = client().asteroids;
  const paused = client().asteroids;
  for (let ms = 0; ms < 20000; ms += 100) active.forEach(a => position(a, epoch + ms));
  sameField(active, paused, epoch + 20000);
});

test('positive and negative velocities wrap at every edge', () => {
  const at = epoch + 10000;
  for (const [x, y, vx, vy] of [
    [WORLD_WIDTH - 2, 300, 1, 0], [2, 300, -1, 0],
    [300, WORLD_HEIGHT - 2, 0, 1], [300, 2, 0, -1]
  ]) {
    const a = new Asteroid(x, y, 'large', 123, 'wrap', epoch);
    const b = new Asteroid(x, y, 'large', 123, 'wrap', epoch);
    a.velocityX = b.velocityX = vx;
    a.velocityY = b.velocityY = vy;
    assert.deepEqual(position(a, at), position(b, at));
    assert.ok(a.x >= 0 && a.x < WORLD_WIDTH);
    assert.ok(a.y >= 0 && a.y < WORLD_HEIGHT);
    assert.ok(vx > 0 ? a.x < x : vx < 0 ? a.x > x : vy > 0 ? a.y < y : a.y > y);
  }
});

test('shared destruction ID removes only that asteroid', () => {
  const worlds = [client().asteroids, client().asteroids];
  const id = worlds[0][0].id;
  const before = worlds.map(world => position(world[1], epoch + 31000));
  for (const world of worlds) world.splice(world.findIndex(a => a.id === id), 1);
  assert.ok(worlds.every(world => !world.some(a => a.id === id)));
  assert.deepEqual(worlds.map(world => position(world[0], epoch + 31000)), before);
});

test('replacement ID, seed, spawn time and trajectory are slot deterministic', () => {
  const worlds = [client(), client()];
  for (const world of worlds) world.asteroids.pop();
  const replacements = worlds.map(world => world.director.createRespawn(9, WORLD_WIDTH, WORLD_HEIGHT, epoch + 61000));
  assert.ok(replacements.every(Boolean));
  for (const key of ['id', 'seed', 'spawnTimestamp', 'startX', 'startY', 'velocityX', 'velocityY']) {
    assert.equal(replacements[0][key], replacements[1][key]);
  }
  assert.equal(replacements[0].spawnTimestamp, epoch + 60000);
  sameField([replacements[0]], [replacements[1]], epoch + 90000);
});

test('late join replays destruction and missed replacement slots', () => {
  const initial = client().asteroids[0];
  const records = new Map([[initial.id, { destroyedAt: epoch + 20000 }]]);
  const at = epoch + 90000;
  const fields = Array.from({ length: 26 }, () => {
    const director = new AsteroidDirector();
    return director.reconstructField(WORLD_WIDTH, WORLD_HEIGHT, at, records);
  });
  assert.equal(fields[0].length, 10);
  assert.ok(!fields[0].some(a => a.id === initial.id));
  const replacement = fields[0].find(a => a.id.endsWith('respawn-1'));
  assert.equal(replacement.spawnTimestamp, epoch + 60000);
  for (const field of fields.slice(1)) sameField(fields[0], field, at);
});

test('a shared MR. K event advances the generation and resets the field', () => {
  const records = new Map([[
    `epoch-${epoch / (EPOCH_DURATION * 1000)}-mrk-0`,
    { destroyedAt: epoch + 90000 }
  ]]);
  const fields = Array.from({ length: 2 }, () => {
    const director = new AsteroidDirector();
    return director.reconstructField(WORLD_WIDTH, WORLD_HEIGHT, epoch + 100000, records);
  });
  assert.ok(fields[0].every(a => a.id.includes('-field-1-')));
  assert.ok(fields[0].every(a => a.spawnTimestamp === epoch + 90000));
  sameField(fields[0], fields[1], epoch + 100000);
});

test('epoch transition makes both clients create the same next field', () => {
  const worlds = [client(), client()];
  for (const world of worlds) {
    assert.equal(world.director.checkEpochChange(epoch + EPOCH_DURATION * 1000), true);
    world.asteroids = world.director.createField(WORLD_WIDTH, WORLD_HEIGHT, 10, epoch + EPOCH_DURATION * 1000);
  }
  sameField(worlds[0].asteroids, worlds[1].asteroids, epoch + EPOCH_DURATION * 1000 + 10000);
});

test('26 clients agree at several authoritative timestamps', () => {
  const worlds = Array.from({ length: 26 }, () => client().asteroids);
  for (const at of [epoch + 3000, epoch + 27000, epoch + 69000, epoch + 600000]) {
    for (const world of worlds.slice(1)) sameField(worlds[0], world, at);
  }
});

test('movement and director require no network writes', () => {
  const sources = ['asteroid.js', 'asteroidDirector.js'].map(name =>
    readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8'));
  for (const source of sources) assert.doesNotMatch(source, /^import[^;]*firebase|runTransaction\(/im);
  const asteroid = client().asteroids[0];
  for (let ms = 0; ms < 60000; ms += 16) asteroid.update(epoch + ms, WORLD_WIDTH, WORLD_HEIGHT);
});

test('clock uses a server offset and safely ignores invalid updates', () => {
  sharedClock.setOffset(1200);
  assert.ok(Math.abs(sharedClock.now() - Date.now() - 1200) < 20);
  sharedClock.setOffset(NaN);
  assert.ok(Math.abs(sharedClock.now() - Date.now() - 1200) < 20);
  sharedClock.setOffset(0);
});
