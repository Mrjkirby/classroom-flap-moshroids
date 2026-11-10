import assert from 'node:assert/strict';
import { test } from 'node:test';
import { WeaponSystem } from '../src/weaponSystem.js';
import { Match } from '../server/src/match.mjs';
import { parseMessage } from '../server/src/protocol.mjs';
import { readFile } from 'node:fs/promises';
import { SourceTextModule, SyntheticModule } from 'node:vm';

test('actual KNAS publication fits the server limit at maximum guns and identity length', async () => {
  const wires = [];
  const storeModule = new SyntheticModule(['store', 'request'], function () {
    this.setExport('store', {});
    this.setExport('request', (action, data) => {
      wires.push(JSON.stringify({ type: 'action', action, data, requestId: '123456789' }));
      return Promise.resolve(true);
    });
  });
  const adapter = new SourceTextModule(await readFile(new URL('../src/transport/knas-shared.js', import.meta.url), 'utf8'));
  await adapter.link(() => storeModule);
  await adapter.evaluate();
  const weapons = new WeaponSystem();
  weapons.setGunCount(40);
  const drops = weapons.createDrops(1200, 1200, '界'.repeat(96));
  assert.equal(drops.length, 40);
  assert.equal(await adapter.namespace.publishGunDrops(drops), true);
  const match = new Match('classroom');
  match.join({ studentId: 'owner', displayName: 'Owner' }, { send() {}, close() {} });
  assert.equal(wires.length, 4);
  for (const wire of wires) {
    const parsed = parseMessage(wire);
    assert.equal(parsed.ok, true, `KNAS rejected ${Buffer.byteLength(wire)} bytes`);
    assert.equal(match.shared.apply(match.players.get('owner'), parsed.value.action, parsed.value.data), true);
  }
  assert.equal(match.shared.drops.size, 40);
});

test('death drops every equipped gun near the ship, and respawn keeps its starter', () => {
  const owner = new WeaponSystem();
  owner.setGunCount(11);
  const drops = owner.createDrops(100, 200, 'a');
  assert.equal(drops.length, 11);
  assert.equal(new Set(drops.map(drop => drop.id)).size, 11);
  assert.ok(drops.every(drop => drop.ownerUid === 'a' &&
    Math.hypot(drop.x - 100, drop.y - 200) <= 50));
  owner.setGunCount(1);
  assert.equal(owner.getGunCount(), 1, 'respawn starts with only the base gun');
  const starterDrop = owner.createDrops(100, 200, 'a', 1, 1000);
  assert.equal(starterDrop.length, 1, 'a ship with only its starting gun still drops one');
  assert.equal(starterDrop[0].expiresAt, 13000);
  owner.setGunCount(39);
  assert.equal(owner.confirmPickup(starterDrop[0].id).gunCount, 40);
  assert.equal(owner.addGun().after, 40, 'gun count remains capped at forty');
});

test('death and pickup run through the game coordinator and shared room authority', async () => {
  const match = new Match('classroom', { clock: Date.now });
  for (const id of ['a', 'b', 'c'])
    match.join({ studentId: id, displayName: id }, { send() {}, close() {} });
  let player = 'a';
  const weapons = new WeaponSystem();
  const shared = {
    getGunDrops: () => match.shared.drops,
    publishGunDrops: async drops => match.shared.apply(match.players.get(player), 'dropPublish', { drops }),
    claimGunDrop: async id => match.shared.apply(match.players.get(player), 'dropClaim', { id }),
    removeExpiredGunDrop: async id => match.shared.apply(match.players.get(player), 'dropExpire', { id }),
  };
  const module = (values) => new SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  });
  const imports = {
    './weaponSystem.js': module({ weaponSystem: weapons }),
    './gunDropMultiplayer.js': module(shared),
    './transport/index.js': module({ getLocalIdentity: () => ({ uid: player }) }),
    './sharedClock.js': module({ sharedClock: { now: Date.now } }),
  };
  const coordinator = new SourceTextModule(await readFile(new URL('../src/gunDropSystem.js', import.meta.url), 'utf8'));
  await coordinator.link(specifier => imports[specifier]);
  await coordinator.evaluate();
  const ship = { owner: 'A', x: 100, y: 200, visible: false, state: 'DEAD', radius: 15 };
  let published = 0;
  const system = coordinator.namespace.createGunDropSystem({ world: { ships: [ship] },
    isMultiplayerJoined: () => true, addExplosion() {}, publishPlayerState: async () => { published++; return true; } });
  assert.equal(await system.dropLocalGuns(ship), true);
  assert.equal(weapons.getGunCount(), 1);
  assert.equal(match.shared.drops.size, 1, 'starter gun is shared on death');
  const id = [...match.shared.drops.keys()][0];
  player = 'b'; weapons.setGunCount(39); ship.visible = true; ship.state = 'ACTIVE';
  system.update();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(weapons.getGunCount(), 40);
  assert.equal(published, 1);
  assert.equal(match.shared.drops.has(id), false);
  assert.equal(match.shared.apply(match.players.get('c'), 'dropClaim', { id }), false);
});

for (const roomId of ['classroom', 'classroom-teams', 'classroom-1vw']) {
  test(`${roomId}: other survivors receive, collect, and remove one shared drop`, () => {
    let now = 18_000_000;
    const match = new Match(roomId, { clock: () => now });
    const messages = new Map();
    const join = id => {
      const received = [];
      messages.set(id, received);
      match.join({ studentId: id, displayName: id }, {
        send: value => received.push(structuredClone(value)), close() {},
      });
      return received;
    };
    const action = (id, name, data) => match.shared.apply(match.players.get(id), name, data);
    join('a'); join('b'); join('c');
    match.receive('a', { type: 'state', state: { x: 100, y: 200, visible: false, guns: 1 } });
    match.receive('b', { type: 'state', state: { x: 120, y: 200, visible: true, guns: 2 } });
    match.receive('c', { type: 'state', state: { x: 120, y: 200, visible: true, guns: 2 } });
    assert.equal(action('a', 'dropPublish', { drops: [
      { id: 'a-death-1', x: 100, y: 200 }, { id: 'a-death-2', x: 105, y: 200 },
    ] }), true);
    for (const id of ['a', 'b', 'c']) assert.ok(messages.get(id).some(message =>
      message.channel === 'drops' && message.entries?.some(([key]) => key === 'a-death-1')));
    const late = join('late');
    assert.ok(late.some(message => message.channel === 'drops' && message.entries?.some(([key]) => key === 'a-death-1')));
    const claims = [
      action('b', 'dropClaim', { id: 'a-death-1' }),
      action('c', 'dropClaim', { id: 'a-death-1' }),
    ];
    assert.deepEqual(claims, [true, false], 'simultaneous room claims have one winner');
    const collector = new WeaponSystem(); collector.setGunCount(2);
    assert.equal(collector.confirmPickup('a-death-1').gunCount, 3);
    for (const id of ['a', 'b', 'c', 'late']) assert.ok(messages.get(id).some(message =>
      message.channel === 'drops' && message.entries?.some(([key, value]) => key === 'a-death-1' && value === null)));
    assert.equal(match.shared.drops.has('a-death-1'), false);
    assert.equal(match.shared.drops.has('a-death-2'), true);
    assert.equal(action('c', 'dropPublish', { drops: [{ id: 'c-death-1', x: 106, y: 200 }] }), true,
      'a nearby second death creates a distinct drop');
    assert.equal(match.shared.drops.has('c-death-1'), true);
    assert.equal(action('c', 'dropClaim', { id: 'a-death-2' }), true, 'nearby deaths remain independent');
    now += 10001;
    assert.equal(action('a', 'dropPublish', { drops: [{ id: 'a-death-1', x: 100, y: 200 }] }), false);
  });
}
