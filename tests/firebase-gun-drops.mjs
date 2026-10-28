import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { SourceTextModule, SyntheticModule } from 'node:vm';

test('Firebase publishes and claims drops on shared time despite a slow device clock', async t => {
  const wallNow = Date.now();
  let serverNow = wallNow + 60_000;
  const records = new Map();
  let listener;
  const notify = () => listener?.({ val: () => Object.fromEntries(records) });
  const database = {};
  const firebase = {
    getDatabase: () => database,
    ref: (_database, path = '') => path,
    update: async (_root, writes) => {
      for (const [path, value] of Object.entries(writes)) records.set(path.split('/').at(-1), value);
      notify();
    },
    remove: async path => { records.delete(path.split('/').at(-1)); notify(); },
    onValue: (_path, callback) => { listener = callback; notify(); return () => { listener = null; }; },
    runTransaction: async (path, transform) => {
      const id = path.split('/').at(-1);
      const next = transform(records.get(id));
      if (next === undefined) return { committed: false };
      records.set(id, next); notify();
      return { committed: true, snapshot: { val: () => next } };
    },
  };
  const modules = new Map([
    ['firebase', new SyntheticModule(Object.keys(firebase), function () {
      for (const [key, value] of Object.entries(firebase)) this.setExport(key, value);
    })],
    ['mode', new SyntheticModule(['ROOM_PATH'], function () { this.setExport('ROOM_PATH', 'moshroids/rooms/classroom'); })],
    ['clock', new SyntheticModule(['sharedClock'], function () {
      this.setExport('sharedClock', { now: () => serverNow });
    })],
  ]);
  const source = readFileSync(new URL('../src/transport/firebase-drops.js', import.meta.url), 'utf8');
  const adapter = new SourceTextModule(source);
  await adapter.link(specifier => specifier.startsWith('https:') ? modules.get('firebase') :
    specifier === '../gameMode.js' ? modules.get('mode') : modules.get('clock'));
  await adapter.evaluate();
  const api = adapter.namespace;
  let user = { uid: 'a' };
  api.configureGunDropMultiplayer({ currentUser: () => user });
  api.startGunDropListener();
  t.after(() => api.stopGunDropListener());
  assert.equal(await api.publishGunDrops([{ id: 'g', x: 50, y: 60 }]), true);
  assert.equal(records.get('g').createdAt, serverNow);
  assert.equal(records.get('g').expiresAt, serverNow + 10_000);
  assert.equal(api.getGunDrops().has('g'), true, 'another client sees the active drop');
  user = { uid: 'b' };
  assert.equal(await api.claimGunDrop('g'), true);
  assert.equal(records.has('g'), false);
  assert.equal(api.getGunDrops().has('g'), false);
  user = { uid: 'c' };
  assert.equal(await api.claimGunDrop('g'), false, 'a second claimant cannot collect it');
  assert.ok(serverNow > wallNow + 10_000, 'fixture covers clock skew beyond the drop lifetime');
});
