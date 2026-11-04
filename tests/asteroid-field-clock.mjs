import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AsteroidDirector } from '../src/asteroidDirector.js';
import { createAsteroidFieldCache } from '../src/asteroidFieldCache.js';

test('a server event slightly ahead of the local clock is reconsidered as soon as it becomes due', () => {
  const now = 18_000_016, director = new AsteroidDirector(), cache = createAsteroidFieldCache();
  const epoch = director.getEpochNumber(now), slot = director.getRespawnSlot(now);
  const initial = director.reconstructField(2880, 1620, now, new Map());
  const asteroid = initial[0];
  const records = new Map([
    [asteroid.id, { destroyedAt: now + 50 }],
    ['epoch-10-mrk-0', { destroyedAt: now + 50 }]
  ]);
  assert.equal(cache.needsUpdate(records, epoch, slot, now), true);
  const visible = director.reconstructField(2880, 1620, now, records).filter(item => !records.has(item.id));
  assert.equal(visible.some(item => item.id === asteroid.id), false, 'a confirmed rock never reappears');
  assert.equal(director.fieldGeneration, 0);
  cache.remember(records, epoch, slot, now);
  assert.equal(cache.needsUpdate(records, epoch, slot, now + 49), false);
  assert.equal(cache.needsUpdate(records, epoch, slot, now + 50), true);
  director.reconstructField(2880, 1620, now + 50, records);
  assert.equal(director.fieldGeneration, 1, 'the Mr. K field advances without waiting for another message');
});
