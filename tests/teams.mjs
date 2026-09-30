import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { modeForPath } from '../src/gameMode.js';
import { teamBases, teamAtBase, drawTeamBases, TEAM_ARM_LENGTH,
  TEAM_OFFSET, TEAM_WALL_THICKNESS, TEAM_COLORS } from '../src/teams/teamBases.js';
import { SAFE_ZONE_ARM_LENGTH, SAFE_ZONE_WALL_THICKNESS,
  SAFE_ZONE_SHIP_LENGTH } from '../src/safeZone.js';
import { canTeamBulletDamage } from '../src/teams/teamRules.js';
import { bulletsFromVolley } from '../src/teams/teamProjectiles.js';
import { createTeamDirector } from '../src/teams/teamDirector.js';
import { Bullet } from '../src/bullet.js';
import { Ship } from '../src/ship.js';
import { createCollisionSystem } from '../src/collisionSystem.js';

test('Teams, Classic and 1VW routes load the shared engine in isolated rooms', () => {
  assert.equal(modeForPath('/classroom-flap-moshroids/'), 'classic');
  assert.equal(modeForPath('/classroom-flap-moshroids/teams/'), 'teams');
  assert.equal(modeForPath('/classroom-flap-moshroids/teams/index.html'), 'teams');
  assert.equal(modeForPath('/classroom-flap-moshroids/1vw/'), '1vw');
  const html = readFileSync(new URL('../teams/index.html', import.meta.url), 'utf8');
  assert.match(html, /src="\.\.\/src\/game\.js"/);
  assert.match(html, /href="\.\.\/style\.css"/);
});

test('four colored L bases use exactly half the reference geometry', () => {
  assert.equal(TEAM_ARM_LENGTH, SAFE_ZONE_ARM_LENGTH / 2);
  assert.equal(TEAM_WALL_THICKNESS, SAFE_ZONE_WALL_THICKNESS / 2);
  assert.equal(TEAM_OFFSET, SAFE_ZONE_SHIP_LENGTH);
  const bases = teamBases(1200, 800);
  assert.deepEqual(bases.map(base => base.team), ['blue', 'red', 'red', 'blue']);
  assert.equal(bases.length, 4);
  for (const base of bases) {
    assert.equal(base.segments.length, 2);
    for (const line of base.segments)
      assert.equal(Math.hypot(line.x2 - line.x1, line.y2 - line.y1), TEAM_ARM_LENGTH);
  }
  const strokes = [];
  const ctx = { save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {},
    stroke() { strokes.push(this.strokeStyle); } };
  drawTeamBases(ctx, 1200, 800);
  assert.deepEqual(strokes, ['blue','blue','red','red','red','red','blue','blue']
    .map(team => TEAM_COLORS[team]));
});

test('contact uses the L arms rather than a whole corner', () => {
  assert.equal(teamAtBase(80, 34, 15, 1200, 800), 'blue');
  assert.equal(teamAtBase(1120, 34, 15, 1200, 800), 'red');
  assert.equal(teamAtBase(80, 766, 15, 1200, 800), 'red');
  assert.equal(teamAtBase(1120, 766, 15, 1200, 800), 'blue');
  assert.equal(teamAtBase(150, 150, 15, 1200, 800), null);
});

test('all team transitions remain available and death returns neutral', () => {
  const ship = new Ship('A', 600, 400, {});
  ship.team = 'neutral';
  for (const [x, y, expected] of [[80,34,'blue'],[1120,34,'red'],
    [1120,766,'blue'],[80,766,'red']]) {
    ship.x = x; ship.y = y;
    ship.team = teamAtBase(x, y, ship.radius, 1200, 800);
    assert.equal(ship.team, expected);
  }
  assert.equal(ship.destroy(), true);
  ship.team = 'neutral';
  ship.respawn();
  assert.equal(ship.team, 'neutral');
});

test('team director emits one write per contact transition and resets on death', async () => {
  const changes = [];
  const director = createTeamDirector({ enabled: true, isJoined: () => true,
    publishChange: async (team, ship) => { changes.push([team, ship.x, ship.y]); return true; },
    getWorldWidth: () => 1200, getWorldHeight: () => 800 });
  const ship = new Ship('A', 600, 400, {});
  ship.team = 'neutral';
  director.update(ship);
  assert.equal(changes.length, 0);
  ship.x = 80; ship.y = 34;
  director.update(ship);
  await new Promise(resolve => setImmediate(resolve));
  director.update(ship);
  assert.deepEqual(changes, [['blue', 80, 34]]);
  ship.x = 1120; ship.y = 34;
  director.update(ship);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ship.team, 'red');
  assert.equal(changes.length, 2);
  ship.visible = false;
  director.reset(ship);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ship.team, 'neutral');
  assert.equal(changes.length, 3);
});

test('only same-team player weapon damage is disabled', () => {
  for (const attack of ['blue','red','neutral'])
    for (const defense of ['blue','red','neutral'])
      assert.equal(canTeamBulletDamage({ teamAtFire: attack }, { team: defense }),
        attack === 'neutral' || attack !== defense);
});

test('projectiles snapshot team and reconstruct the original gun count', () => {
  const ship = new Ship('A', 100, 100, {});
  ship.team = 'blue';
  const bullet = new Bullet(100, 100, 0, 0, 0, 'A', ship.team);
  ship.team = 'red';
  assert.equal(bullet.teamAtFire, 'blue');
  const shot = { id: 1, at: 1000, x: 100, y: 100, angle: 0,
    velocityX: 0, velocityY: 0, guns: 4, team: 'blue' };
  const replay = bulletsFromVolley(shot, 'remote', 1200, 1200, 800);
  assert.equal(replay.length, 4);
  assert.ok(replay.every(item => item.teamAtFire === 'blue'));
  assert.deepEqual(replay.map(item => [item.x, item.y]),
    bulletsFromVolley(shot, 'remote', 1200, 1200, 800).map(item => [item.x, item.y]));
  assert.equal(bulletsFromVolley(shot, 'remote', 2000, 1200, 800).length, 0);
});

test('collision callback protects teammates but preserves enemy and neutral damage', () => {
  for (const [attacker, defender, expected] of [
    ['blue','blue',0], ['red','red',0], ['blue','red',1],
    ['red','blue',1], ['blue','neutral',1], ['neutral','red',1],
    ['neutral','neutral',1]
  ]) {
    const ship = new Ship('A', 100, 100, {});
    ship.team = defender;
    const world = { ships: [ship], bullets: [new Bullet(100, 100, 0, 0, 0,
      'remote', attacker)], asteroids: [], gauntletProjectiles: [], missiles: [], mrK: null };
    let deaths = 0;
    const collision = createCollisionSystem({ world, getWorldWidth: () => 1200,
      getWorldHeight: () => 800, destroyAsteroid() {}, isAsteroidDestructionPending: () => false,
      playerDestroyed() { deaths++; return true; }, addExplosion() {}, addRockExplosion() {},
      releaseMissiles() {}, advanceAsteroidsFromMrK() {}, updateScores() {},
      publishPlayerState() {}, canPlayerWeaponDamage: canTeamBulletDamage });
    collision.resolveBulletPlayerCollisions();
    assert.equal(deaths, expected, `${attacker} versus ${defender}`);
  }
});

test('asteroids and MR. K collide with every team through unchanged shared collision path', () => {
  for (const team of ['neutral','blue','red'])
    for (const hazard of ['asteroid','mr-k-collision']) {
      const ship = new Ship('A', 100, 100, {});
      ship.team = team;
      const world = { ships: [ship], bullets: [], asteroids: hazard === 'asteroid' ?
        [{ x: 100, y: 100, radius: 20 }] : [], gauntletProjectiles: [], missiles: [],
        mrK: hazard === 'mr-k-collision' ? { x: 100, y: 100, radius: 20 } : null };
      let reason;
      const collision = createCollisionSystem({ world, getWorldWidth: () => 1200,
        getWorldHeight: () => 800, destroyAsteroid() {}, isAsteroidDestructionPending: () => false,
        playerDestroyed(_id, why) { reason = why; return true; }, addExplosion() {},
        addRockExplosion() {}, releaseMissiles() {}, advanceAsteroidsFromMrK() {},
        updateScores() {}, publishPlayerState() {}, canPlayerWeaponDamage: canTeamBulletDamage });
      collision.resolveLocalShipRockCollisions();
      assert.equal(reason, hazard);
    }
});
