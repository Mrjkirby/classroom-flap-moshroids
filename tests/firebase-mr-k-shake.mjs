import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule } from 'node:vm';
import { MrKShake } from '../src/mrKShake.js';

test('Firebase room destruction claim produces one shared shake event', async () => {
  const records = new Map();
  let listener;
  let now = 18_000_010;
  let user = { uid: 'a' };
  const notify = () => listener?.({ val: () => Object.fromEntries(records) });
  const sdk = {
    getDatabase: () => ({}),
    ref: (_database, path) => path,
    remove: async path => { records.delete(path.split('/').at(-1)); notify(); },
    onValue: (_path, callback) => { listener = callback; notify(); return () => { listener = null; }; },
    runTransaction: async (path, update) => {
      const id = path.split('/').at(-1);
      const next = update(records.get(id));
      if (next === undefined) return { committed: false };
      records.set(id, next); notify();
      return { committed: true };
    },
  };
  const modules = new Map([
    ['firebase', new SyntheticModule(Object.keys(sdk), function () {
      for (const [name, value] of Object.entries(sdk)) this.setExport(name, value);
    })],
    ['clock', new SyntheticModule(['sharedClock'], function () {
      this.setExport('sharedClock', { now: () => now });
    })],
    ['mode', new SyntheticModule(['ROOM_PATH'], function () {
      this.setExport('ROOM_PATH', 'moshroids/rooms/classroom');
    })],
  ]);
  const source = readFileSync(new URL('../src/transport/firebase-asteroids.js', import.meta.url), 'utf8');
  const adapter = new SourceTextModule(source);
  await adapter.link(specifier => specifier.startsWith('https:') ? modules.get('firebase') :
    specifier === '../sharedClock.js' ? modules.get('clock') : modules.get('mode'));
  await adapter.evaluate();
  const api = adapter.namespace;
  api.configureAsteroidNetwork({ currentUser: () => user });
  api.startAsteroidListener();
  const clients = Array.from({ length: 3 }, () => {
    const shake = new MrKShake(); shake.activate(now - 1); return shake;
  });
  const id = 'epoch-10-mrk-0';
  assert.equal(await api.destroySharedAsteroid(id), true);
  assert.equal(api.getDestroyedAsteroids().get(id).destroyedBy, 'a');
  user = { uid: 'b' };
  assert.equal(await api.destroySharedAsteroid(id), false);
  assert.deepEqual(clients.map(shake => shake.sync(api.getDestroyedAsteroids(), now)), [[id], [id], [id]]);
  assert.deepEqual(clients.map(shake => shake.sync(api.getDestroyedAsteroids(), now + 1)), [[], [], []]);
  api.stopAsteroidListener();
});
