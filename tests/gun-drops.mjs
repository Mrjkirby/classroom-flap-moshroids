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
  assert.equal(drops.length, 39);
  assert.equal(await adapter.namespace.publishGunDrops(drops), true);
  const match = new Match('classroom');
  match.join({ studentId: 'owner', displayName: 'Owner' }, { send() {}, close() {} });
  assert.equal(wires.length, 4);
  for (const wire of wires) {
    const parsed = parseMessage(wire);
    assert.equal(parsed.ok, true, `KNAS rejected ${Buffer.byteLength(wire)} bytes`);
    assert.equal(match.shared.apply(match.players.get('owner'), parsed.value.action, parsed.value.data), true);
  }
  assert.equal(match.shared.drops.size, 39);
});

test('death drops earned guns near the ship, not the respawn starter', () => {
  const owner = new WeaponSystem();
  owner.setGunCount(11);
  const drops = owner.createDrops(100, 200, 'a');
  assert.equal(drops.length, 10);
  assert.equal(new Set(drops.map(drop => drop.id)).size, 10);
  assert.ok(drops.every(drop => drop.ownerUid === 'a' &&
    Math.hypot(drop.x - 100, drop.y - 200) <= 50));
  owner.setGunCount(1);
  assert.equal(owner.getGunCount(), 1, 'respawn starts with only the base gun');
  assert.equal(owner.createDrops(100, 200, 'a').length, 0);
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
