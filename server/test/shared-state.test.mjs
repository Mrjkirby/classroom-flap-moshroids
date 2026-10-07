import test from 'node:test';
import assert from 'node:assert/strict';
import { Match } from '../src/match.mjs';

function fixture(room = 'classroom') {
  let time = 18000000;
  const match = new Match(room, { clock: () => time });
  const messages = new Map();
  for (const id of ['a', 'b']) {
    const list = []; messages.set(id, list);
    match.join({ studentId: id, displayName: id }, { send: v => list.push(structuredClone(v)), close() {} });
  }
  const action = (id, name, data = {}) => match.shared.apply(match.players.get(id), name, data);
  return { match, messages, action, tick: ms => { time += ms; } };
}
test('shared claims are atomic, immutable, bounded and late-join replayable including MR K', () => {
  const { match, action, tick } = fixture();
  const id = 'epoch-10-mrk-0';
  assert.equal(action('a', 'asteroidClaim', { id, destroyedBy: 'b' }), true);
  assert.equal(action('b', 'asteroidClaim', { id }), false);
  assert.equal(match.shared.destroyed.get(id).destroyedBy, 'a');
  assert.equal(action('a', 'asteroidClear'), false);
  assert.equal(action('a', 'asteroidClaim', { id: 'epoch-1-mrk-0' }), false);
  const sent = []; match.shared.snapshot({ send: v => sent.push(v) });
  assert.ok(sent.some(v => v.entries?.some(([key]) => key === id)));
  tick(3600000); match.shared.cleanup(); assert.equal(match.shared.destroyed.size, 0);
});
test('gun claims resolve once, cannot overwrite or resurrect a claimed drop, expire server-side', () => {
  const { match, action, tick } = fixture();
  assert.equal(action('a', 'dropPublish', { drops: [{ id: 'g', x: 1, y: 2, ownerUid: 'b', expiresAt: Infinity }] }), true);
  assert.equal(match.shared.drops.get('g').ownerUid, 'a');
  assert.equal(action('b', 'dropPublish', { drops: [{ id: 'g' }] }), false);
  assert.equal(action('a', 'dropExpire', { id: 'g' }), false);
  assert.equal(action('b', 'dropClaim', { id: 'g' }), true);
  assert.equal(action('a', 'dropClaim', { id: 'g' }), false);
  assert.equal(action('a', 'dropPublish', { drops: [{ id: 'g' }] }), false);
  action('a', 'dropPublish', { drops: [{ id: 'h' }] }); tick(10001);
  assert.equal(action('b', 'dropClaim', { id: 'h' }), false);
  match.shared.cleanup(); assert.equal(match.shared.drops.size, 0);
});
test('Teams uses server player ownership, base contact and stamped volleys', () => {
  const { match, action } = fixture('classroom-teams');
  assert.equal(action('a', 'teamChange', { team: 'blue', x: 34, y: 34 }), false);
  match.receive('a', { type: 'state', studentId: 'b', state: { x: 34, y: 34, guns: 4, team: 'red', name: 'forged' } });
  assert.equal(action('a', 'teamChange', { team: 'blue' }), true);
  assert.equal(action('a', 'teamVolley', { guns: 40, by: 'b', at: 1 }), true);
  const shot = match.players.get('a').teamShots[0];
  assert.equal(shot.guns, 4); assert.equal(shot.team, 'blue'); assert.equal(shot.at, 18000000);
  assert.equal(match.players.get('b').x, 0); assert.equal(match.players.get('a').name, 'a');
});
test('1vWorld reuses survivor/cannon rules and allows claims for actual cannon projectiles', () => {
  const { match, action, tick } = fixture('classroom-1vw');
  assert.equal(action('a', 'survivorClaim'), false);
  match.receive('a', { type: 'state', state: { guns: 40 } });
  assert.equal(action('a', 'survivorClaim'), true); assert.equal(action('b', 'survivorClaim'), false);
  assert.equal(action('b', 'gauntletActivate'), false); tick(2000);
  assert.equal(action('b', 'gauntletActivate'), true);
  assert.equal(action('a', 'cannonFire', { angle: 0 }), false);
  assert.equal(action('b', 'cannonFire', { angle: 0 }), true);
  assert.equal(action('b', 'cannonFire', { angle: 0 }), false);
  assert.equal(action('a', 'asteroidClaim', { id: '1vw-shot-0-b-1' }), true);
  assert.equal(action('b', 'gauntletEnd', { reason: 'forged' }), false);
  assert.equal(action('a', 'gauntletEnd', { reason: 'asteroid' }), true);
  assert.equal(action('a', 'gauntletReset'), false); tick(3000);
  assert.equal(action('a', 'gauntletReset'), true); assert.equal(match.shared.boss.round, 1);
});
test('explicit server-authorized tester alone can clear shared history', () => {
  const { match, action } = fixture();
  match.receive('a', { type: 'state', state: { testerAuthorized: true } });
  assert.equal(action('a', 'asteroidClear'), false);
  match.clients.get('a').testerAuthorized = true;
  assert.equal(action('a', 'asteroidClear'), true);
});
