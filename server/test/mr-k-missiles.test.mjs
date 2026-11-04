import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Match } from '../src/match.mjs';
import { MissileField } from '../src/missile-field.mjs';
import { AsteroidDirector } from '../../src/asteroidDirector.js';
import { BouncingTrajectories } from '../../src/gauntlet/bounceTrajectory.js';
import { activeCannonShots } from '../../src/gauntlet/projectiles.js';
import { perimeterSlots } from '../../src/gauntlet/perimeterLayout.js';
import { wrap } from '../../src/physics.js';

function fixture(room = 'classroom-teams') {
  let time = 18_001_000;
  const match = new Match(room, { clock: () => time });
  const messages = new Map();
  function join(id) {
    const sent = []; messages.set(id, sent);
    match.join({ studentId: id, displayName: id }, { send: value => sent.push(structuredClone(value)), close() {} });
    return sent;
  }
  function state(id, x, y, visible = true, vx = 0, vy = 0) {
    match.receive(id, { type: 'state', state: { x, y, visible, angle: 0, velocityX: vx, velocityY: vy, guns: 1, score: 0 } });
  }
  join('a'); join('b');
  const advance = ms => { time += ms; match.shared.missiles.tick(time); };
  return { match, messages, join, state, advance, now: () => time };
}

function fire(fixture) {
  const { match } = fixture, rock = 'epoch-10-mrk-0';
  for (let i = 0; i < 25; i++)
    assert.equal(match.shared.apply(match.players.get('a'), 'mrkHit',
      { id: rock, batchId: `wave-${String(i).padStart(5, '0')}`, count: 40 }), true);
  assert.equal(match.shared.missiles.active.size, 20);
}

for (const room of ['classroom', 'classroom-teams', 'classroom-1vw']) {
  test(`${room}: one authoritative wave and targets are shared with every client and late joiner`, () => {
    const f = fixture(room); f.state('a', 1200, 500); f.state('b', 1800, 500); fire(f);
    const system = f.match.shared.missiles; system.field.at = () => [];
    const missile = [...system.active.values()][0];
    missile.x = 1000; missile.y = 500; missile.angle = 0; missile.outbound = false;
    f.advance(100);
    const snapshotA = f.messages.get('a').filter(value => value.channel === 'missiles').at(-1);
    const snapshotB = f.messages.get('b').filter(value => value.channel === 'missiles').at(-1);
    assert.deepEqual(snapshotA, snapshotB);
    assert.equal(snapshotA.missiles.find(item => item[0] === missile.id)[5], 'a', 'the server selects the closest ship');
    const late = f.join('c').find(value => value.channel === 'missiles');
    assert.deepEqual(late.missiles, snapshotA.missiles, 'late joiners get the currently active wave');
    const shot = { id: missile.id };
    assert.equal(f.match.shared.apply(f.match.players.get('a'), 'missileShot', shot), true);
    assert.equal(f.match.shared.apply(f.match.players.get('b'), 'missileShot', shot), false);
    assert.equal(f.messages.get('b').filter(value => value.channel === 'missiles').at(-1).missiles.some(item => item[0] === missile.id), false);
  });
}

test('server ship impact is emitted once, replayed on reconnect, and only its owner can acknowledge it', () => {
  const f = fixture(); f.state('a', 1010, 500); f.state('b', 1800, 500); fire(f);
  const system = f.match.shared.missiles; system.field.at = () => [];
  const missile = [...system.active.values()][0]; system.active = new Map([[missile.id, missile]]);
  missile.x = 1000; missile.y = 500; missile.angle = 0; missile.outbound = false;
  f.advance(50);
  const hitsA = f.messages.get('a').filter(value => value.type === 'missileHit');
  const hitsB = f.messages.get('b').filter(value => value.type === 'missileHit');
  assert.equal(hitsA.length, 1); assert.deepEqual(hitsA, hitsB);
  const hit = hitsA[0].hit; assert.equal(hit.playerId, 'a');
  assert.equal(system.active.size, 0);
  f.match.leave('a');
  const rejoined = f.join('a');
  assert.deepEqual(rejoined.find(value => value.type === 'missileHitSnapshot').hits, [hit]);
  assert.equal(f.match.shared.apply(f.match.players.get('b'), 'missileHitAck', { id: hit.id }), false);
  assert.equal(f.match.shared.apply(f.match.players.get('a'), 'missileHitAck', { id: hit.id }), true);
  assert.equal(f.match.shared.apply(f.match.players.get('a'), 'missileHitAck', { id: hit.id }), true, 'lost acknowledgements retry safely');
});

test('a single shared wave can hit several different players independently', () => {
  const f = fixture(); f.join('c');
  f.state('a', 600, 500); f.state('b', 1400, 500); f.state('c', 2200, 500); fire(f);
  const system = f.match.shared.missiles; system.field.at = () => [];
  const missiles = [...system.active.values()].slice(0, 3);
  system.active = new Map(missiles.map(missile => [missile.id, missile]));
  for (let i = 0; i < missiles.length; i++) {
    missiles[i].x = [600, 1400, 2200][i]; missiles[i].y = 500;
    missiles[i].angle = 0; missiles[i].outbound = false;
  }
  f.advance(50);
  assert.deepEqual([...system.pendingHits.values()].map(hit => hit.playerId).sort(), ['a', 'b', 'c']);
  for (const id of ['a', 'b', 'c'])
    assert.deepEqual(f.messages.get(id).filter(value => value.type === 'missileHit').map(value => value.hit.playerId).sort(), ['a', 'b', 'c']);
});

test('safe walls, asteroids and respawn protection still stop or prevent missile hits', () => {
  const f = fixture('classroom'); f.state('a', 1010, 500); f.state('b', 1800, 500); fire(f);
  const system = f.match.shared.missiles; const missile = [...system.active.values()][0];
  system.active = new Map([[missile.id, missile]]); system.field.at = () => [];
  missile.x = 68; missile.y = 68; missile.angle = 0; missile.outbound = false;
  f.advance(50); assert.equal(system.active.size, 0, 'safe-zone wall removes the missile');
  system.active.set(missile.id, missile); missile.x = 500; missile.y = 500;
  system.field.at = () => [{ x: 500, y: 500, radius: 30 }];
  f.advance(50); assert.equal(system.active.size, 0, 'a rock removes the missile');
  system.active.set(missile.id, missile); missile.x = 1000; missile.y = 500; system.field.at = () => [];
  f.state('a', 1010, 500, false); f.state('a', 1010, 500, true);
  assert.equal(f.match.invulnerableUntil.get('a'), f.now() + 1500);
  f.advance(50); assert.equal(system.active.size, 1); assert.equal(system.pendingHits.size, 0);
});

test('server missile field uses the same deterministic asteroid IDs and positions', () => {
  const f = fixture(), field = new MissileField(f.match), now = f.now();
  const director = new AsteroidDirector();
  const expected = director.reconstructField(2880, 1620, now, f.match.shared.destroyed);
  expected.forEach(rock => rock.update(now, 2880, 1620));
  const actual = field.at(now);
  for (const rock of expected) {
    const same = actual.find(item => item.id === rock.id);
    assert.deepEqual({ x: same.x, y: same.y, radius: same.radius }, { x: rock.x, y: rock.y, radius: rock.radius });
  }
});

test('1VW missile field follows the existing bouncing cannon-projectile rules', () => {
  const f = fixture('classroom-1vw'), now = f.now(), slots = perimeterSlots(['b'], 2880, 1620);
  const position = slots.get('b');
  const shot = { firedAt: now - 500, angle: 0.7, round: 0, x: position.x, y: position.y };
  const boss = { mode: '1vw', phase: 'gauntlet', survivorUid: 'a', round: 0,
    gauntletStartedAt: now - 1000, cannons: { b: { shots: { 1: shot } } } };
  f.match.shared.boss = boss;
  const projectile = activeCannonShots(boss, now, f.match.shared.destroyed, 2880, 1620)[0];
  const initial = { x: wrap(projectile.startX, 2880), y: wrap(projectile.startY, 1620),
    vx: projectile.velocityX * 60 / 1000, vy: projectile.velocityY * 60 / 1000,
    radius: projectile.radius, at: shot.firedAt };
  const obstacles = [...slots.values()].map(slot => ({ ...slot, radius: 15 }));
  const expected = new BouncingTrajectories().position(projectile.id, initial, now,
    obstacles, 2880, 1620, `0:${JSON.stringify([...slots])}`);
  const actual = new MissileField(f.match).at(now).find(rock => rock.id === projectile.id);
  assert.ok(actual); assert.equal(actual.x, expected.x); assert.equal(actual.y, expected.y);
});

test('1VW perimeter players remain protected while the survivor can be hit', () => {
  const f = fixture('classroom-1vw'); f.state('a', 1800, 500); f.state('b', 1010, 500); fire(f);
  f.match.shared.boss = { mode: '1vw', phase: 'gauntlet', survivorUid: 'a', round: 0, gauntletStartedAt: f.now() };
  const system = f.match.shared.missiles; system.field.at = () => [];
  const missile = [...system.active.values()][0]; system.active = new Map([[missile.id, missile]]);
  missile.x = 1000; missile.y = 500; missile.angle = 0; missile.outbound = false;
  f.advance(50);
  assert.equal(system.active.size, 1); assert.equal(system.pendingHits.size, 0);
  f.state('a', missile.x + 5, missile.y); f.advance(50);
  assert.equal([...system.pendingHits.values()][0]?.playerId, 'a');
});

test('fast ship crossings and arena wrapping are checked between server ticks', () => {
  const f = fixture(); f.state('a', 2880 - 10, 500, true, 8, 0); f.state('b', 1000, 1000); fire(f);
  const system = f.match.shared.missiles; system.field.at = () => [];
  const missile = [...system.active.values()][0]; system.active = new Map([[missile.id, missile]]);
  missile.x = 15; missile.y = 500; missile.angle = Math.PI; missile.outbound = false;
  f.advance(50);
  assert.equal([...system.pendingHits.values()][0]?.playerId, 'a');
});
