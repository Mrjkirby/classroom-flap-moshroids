import { Asteroid } from './asteroid.js';
import { Camera } from './camera.js';
import { HomingMissile } from './homingMissile.js';
import { MrKRock } from './mrKRock.js';
import { SafeZones } from './safeZone.js';
import { Ship } from './ship.js';
import { SpellingChallengeController } from './spellingController.js';
import { drawWrapped, normalizeDelta, random, wrappedDistance } from './physics.js';
import {
  bindPilotLogin,
  getRemotePlayers,
  publishLocalState,
  updateRemotePlayers
} from './multiplayer.js';

const canvas = document.querySelector('#gameCanvas');
const ctx = canvas.getContext('2d');
const keys = new Set();
const scoreNodes = { A: document.querySelector('#scoreA') };
const startHint = document.querySelector('#startHint');
const gameShell = document.querySelector('.game-shell');

const spelling = new SpellingChallengeController({
  overlay: document.querySelector('#wormholeOverlay'),
  onComplete: respawnPlayer
});

let width = 0;
let height = 0;
let worldWidth = 0;
let worldHeight = 0;
let lastTime = performance.now();
let hasStarted = false;
let multiplayerJoined = false;

const camera = new Camera();
let safeZones = null;

const world = {
  ships: [],
  bullets: [],
  asteroids: [],
  missiles: [],
  particles: [],
  mrK: null,
  mrKRespawnTimer: 0,
  scores: { A: 0, B: 0 }
};

const controls = {
  A: {
    left: 'ArrowLeft',
    right: 'ArrowRight',
    thrust: 'ArrowUp',
    brake: 'ArrowDown',
    fire: 'Space'
  }
};

function resize() {
  const frame = canvas.parentElement;
  const ratio = Math.min(window.devicePixelRatio || 1, 2);

  width = frame.clientWidth;
  height = frame.clientHeight;
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  worldWidth = width * 2.4;
  worldHeight = height * 2.4;

  if (!safeZones) safeZones = new SafeZones(worldWidth, worldHeight);
  else safeZones.resize(worldWidth, worldHeight);
}

function spawnAsteroids() {
  world.asteroids = [];

  for (let index = 0; index < 7; index += 1) {
    let x;
    let y;

    do {
      x = random(40, worldWidth - 40);
      y = random(40, worldHeight - 40);
    } while (Math.hypot(x - worldWidth / 2, y - worldHeight / 2) < 180);

    world.asteroids.push(new Asteroid(x, y, 'large'));
  }
}

function spawnMrK() {
  world.mrK = new MrKRock(worldWidth * 0.5, worldHeight * 0.5);
}

function addExplosion(x, y, color, count = 10, spread = 4) {
  for (let index = 0; index < count; index += 1) {
    const angle = random(0, Math.PI * 2);

    world.particles.push({
      x,
      y,
      velocityX: Math.cos(angle) * random(1, spread),
      velocityY: Math.sin(angle) * random(1, spread),
      life: random(0.25, 0.65),
      color,
      length: random(3, 10)
    });
  }
}

function addRockExplosion(x, y) {
  addExplosion(x, y, '#ff875f', 70, 7);
  addExplosion(x, y, '#f1f0ea', 45, 11);

  for (let index = 0; index < 8; index += 1) {
    addExplosion(x + random(-50, 50), y + random(-50, 50), '#ffdb69', 5, 4);
  }
}

function findClosestShip(missile) {
  return world.ships
    .filter((ship) => ship.visible)
    .sort(
      (a, b) =>
        wrappedDistance(missile, a, worldWidth, worldHeight) -
        wrappedDistance(missile, b, worldWidth, worldHeight)
    )[0] || null;
}

function reset() {
  world.ships = [
    new Ship('A', worldWidth * 0.5, worldHeight * 0.5, controls.A)
  ];

  world.bullets = [];
  world.missiles = [];
  world.particles = [];
  world.mrKRespawnTimer = 0;
  world.scores = { A: 0 };

  spawnAsteroids();
  spawnMrK();

  camera.x = worldWidth * 0.5;
  camera.y = worldHeight * 0.5;
  camera.update(world.ships, width, height, worldWidth, worldHeight);
  updateScores();
}

function updateScores() {
  scoreNodes.A.textContent = String(world.scores.A).padStart(5, '0');
}

function suspendPlayerControls(playerId) {
  if (!controls[playerId]) return;
  Object.values(controls[playerId]).forEach((control) => keys.delete(control));
}

function playerDestroyed(playerId, reason) {
  /*
   * Only this browser owns the local A ship.
   * Remote deaths will eventually be synchronized as multiplayer events.
   * Do not open this browser's spelling screen for somebody else's ship.
   */
  if (playerId !== 'A') return false;

  const ship = world.ships.find((candidate) => candidate.owner === playerId);
  if (!ship || !ship.destroy()) return false;

  suspendPlayerControls(playerId);
  spelling.begin({ playerId, reason });
  return true;
}

function respawnPlayer(playerId) {
  const ship = world.ships.find((candidate) => candidate.owner === playerId);
  if (ship) ship.respawn();
}

function releaseMissiles() {
  for (let index = 0; index < 20; index += 1) {
    const angle = (index / 20) * Math.PI * 2;

    world.missiles.push(
      new HomingMissile(
        world.mrK.x + Math.cos(angle) * world.mrK.radius,
        world.mrK.y + Math.sin(angle) * world.mrK.radius,
        angle,
        world.mrK.radius
      )
    );
  }
}

/*
 * REMOTE SHIPS
 *
 * Firebase contains compact target positions. multiplayer.js interpolates
 * them smoothly. These Ship instances are render/collision representations
 * only; they never process this browser's keyboard.
 */
function syncRemoteShips(dt) {
  if (!multiplayerJoined) return;

  updateRemotePlayers(dt, worldWidth, worldHeight);
  const remotePlayers = getRemotePlayers();
  const remoteIds = new Set(remotePlayers.keys());

  world.ships = world.ships.filter(
    (ship) => ship.owner === 'A' || remoteIds.has(ship.owner)
  );

  remotePlayers.forEach((remote, uid) => {
    let ship = world.ships.find((candidate) => candidate.owner === uid);

    if (!ship) {
      ship = new Ship(uid, remote.renderX, remote.renderY, {}, remote.name);
      ship.remote = true;
      world.ships.push(ship);
    }

    ship.remote = true;
    ship.displayName = remote.name;
    ship.x = remote.renderX;
    ship.y = remote.renderY;
    ship.angle = remote.renderAngle;
    ship.velocityX = remote.velocityX;
    ship.velocityY = remote.velocityY;
    ship.visible = remote.visible;
    ship.state = remote.visible ? 'ACTIVE' : 'SPELLING';
  });
}

function publishPlayerState() {
  if (!multiplayerJoined) return;

  const ship = world.ships.find((candidate) => candidate.owner === 'A');
  if (!ship) return;

  publishLocalState({
    x: ship.x,
    y: ship.y,
    angle: ship.angle,
    velocityX: ship.velocityX,
    velocityY: ship.velocityY,
    visible: ship.visible,
    score: world.scores.A
  });
}

function update(dt) {
  syncRemoteShips(dt);

  /*
   * SHIPS
   * Local physics remain exactly in Ship.update().
   * Remote ships are display-only and Ship.update() ignores them.
   */
  world.ships.forEach((ship) => {
    const bullet = ship.update(dt, keys, worldWidth, worldHeight);

    if (safeZones && ship.visible && !ship.remote) safeZones.blockShip(ship);
    if (bullet) world.bullets.push(bullet);
  });

  publishPlayerState();

  /*
   * BULLETS
   */
  world.bullets.forEach((bullet) => bullet.update(dt, worldWidth, worldHeight));
  world.bullets = world.bullets.filter((bullet) => bullet.life > 0);

  /* BULLET → SAFE-ZONE WALL */
  if (safeZones) {
    world.bullets = world.bullets.filter((bullet) => {
      if (!safeZones.hitsBullet(bullet)) return true;

      addExplosion(
        bullet.x,
        bullet.y,
        bullet.owner === 'A' ? '#ff875f' : '#72e6dd',
        5,
        2
      );

      return false;
    });
  }

  /*
   * ASTEROIDS
   */
  world.asteroids.forEach((asteroid) =>
    asteroid.update(dt, worldWidth, worldHeight)
  );

  /* ASTEROID → SAFE-ZONE WALL */
  if (safeZones) {
    const survivingAsteroids = [];
    const splitAsteroids = [];

    world.asteroids.forEach((asteroid) => {
      if (!safeZones.hitsAsteroid(asteroid)) {
        survivingAsteroids.push(asteroid);
        return;
      }

      addExplosion(
        asteroid.x,
        asteroid.y,
        '#f1f0ea',
        asteroid.size === 'small' ? 10 : 16,
        4
      );

      splitAsteroids.push(...asteroid.split());
    });

    world.asteroids = [...survivingAsteroids, ...splitAsteroids];
  }

  /*
   * MR. K ROCK
   */
  if (world.mrK) world.mrK.update(dt, worldWidth, worldHeight);

  /*
   * MISSILES
   */
  world.missiles.forEach((missile) =>
    missile.update(dt, world.ships, worldWidth, worldHeight)
  );

  world.missiles = world.missiles.filter((missile) => {
    if (missile.life <= 0) {
      addExplosion(missile.x, missile.y, '#ffdb69', 3, 2);
    }

    return missile.life > 0;
  });

  /* MISSILE → SAFE-ZONE WALL */
  if (safeZones) {
    world.missiles = world.missiles.filter((missile) => {
      if (!safeZones.hitsMissile(missile)) return true;

      addExplosion(missile.x, missile.y, '#ffdb69', 7, 3);
      return false;
    });
  }

  /*
   * PARTICLES
   */
  world.particles.forEach((particle) => {
    const frameScale = dt * 60;

    particle.x += particle.velocityX * frameScale;
    particle.y += particle.velocityY * frameScale;
    particle.life -= dt;
  });

  world.particles = world.particles.filter((particle) => particle.life > 0);

  /*
   * BULLET → MISSILE
   * BULLET → ASTEROID
   */
  for (let bulletIndex = world.bullets.length - 1; bulletIndex >= 0; bulletIndex -= 1) {
    const bullet = world.bullets[bulletIndex];

    const missileIndex = world.missiles.findIndex(
      (missile) =>
        wrappedDistance(bullet, missile, worldWidth, worldHeight) <
        missile.radius + bullet.radius
    );

    if (missileIndex >= 0) {
      world.bullets.splice(bulletIndex, 1);
      const missile = world.missiles.splice(missileIndex, 1)[0];
      addExplosion(missile.x, missile.y, '#ffdb69', 7, 3);
      continue;
    }

    const asteroidIndex = world.asteroids.findIndex(
      (asteroid) =>
        wrappedDistance(bullet, asteroid, worldWidth, worldHeight) <
        asteroid.radius + bullet.radius
    );

    if (asteroidIndex < 0) continue;

    const asteroid = world.asteroids[asteroidIndex];

    world.bullets.splice(bulletIndex, 1);
    world.asteroids.splice(asteroidIndex, 1);

    /*
     * Only locally-created bullets have a local score bucket right now.
     */
    if (world.scores[bullet.owner] !== undefined) {
      world.scores[bullet.owner] += asteroid.points;
      updateScores();
    }

    addExplosion(
      asteroid.x,
      asteroid.y,
      bullet.owner === 'A' ? '#ff875f' : '#72e6dd',
      asteroid.size === 'small' ? 14 : 9
    );

    world.asteroids.push(...asteroid.split());
  }

  /*
   * BULLET → MR. K ROCK
   */
  if (world.mrK) {
    for (let bulletIndex = world.bullets.length - 1; bulletIndex >= 0; bulletIndex -= 1) {
      const bullet = world.bullets[bulletIndex];

      if (
        wrappedDistance(bullet, world.mrK, worldWidth, worldHeight) >=
        world.mrK.radius + bullet.radius
      ) {
        continue;
      }

      world.bullets.splice(bulletIndex, 1);
      world.mrK.damage(1);

      if (world.scores[bullet.owner] !== undefined) {
        world.scores[bullet.owner] += 1;
        updateScores();
      }

      addExplosion(
        bullet.x,
        bullet.y,
        bullet.owner === 'A' ? '#ff875f' : '#72e6dd',
        2,
        2
      );

      if (world.mrK.health === 0) {
        addRockExplosion(world.mrK.x, world.mrK.y);
        releaseMissiles();
        world.mrK = null;
        world.mrKRespawnTimer = 60;
      }
    }
  }

  /*
   * BULLET → OTHER PLAYER
   *
   * At this stage local bullets can visually collide with remote ships,
   * but a remote player's death must be handled by that player's browser.
   * We do not trigger our own spelling screen for a remote ship.
   */
  for (let bulletIndex = world.bullets.length - 1; bulletIndex >= 0; bulletIndex -= 1) {
    const bullet = world.bullets[bulletIndex];

    const target = world.ships.find(
      (ship) =>
        ship.owner !== bullet.owner &&
        ship.visible &&
        wrappedDistance(bullet, ship, worldWidth, worldHeight) <
          ship.radius + bullet.radius
    );

    if (!target) continue;

    world.bullets.splice(bulletIndex, 1);

    if (target.owner === 'A' && playerDestroyed('A', 'enemy-bullet')) {
      addExplosion(target.x, target.y, '#ff875f', 22);
    }
  }

  /*
   * MISSILE COLLISIONS
   */
  for (let missileIndex = world.missiles.length - 1; missileIndex >= 0; missileIndex -= 1) {
    const missile = world.missiles[missileIndex];

    const rockHit =
      !missile.outbound &&
      (
        world.asteroids.some(
          (asteroid) =>
            wrappedDistance(missile, asteroid, worldWidth, worldHeight) <
            asteroid.radius + missile.radius
        ) ||
        (
          world.mrK &&
          wrappedDistance(missile, world.mrK, worldWidth, worldHeight) <
            world.mrK.radius + missile.radius
        )
      );

    if (rockHit) {
      world.missiles.splice(missileIndex, 1);
      addExplosion(missile.x, missile.y, '#ffdb69', 7, 3);
      continue;
    }

    /*
     * Environmental missile death is local-authoritative for now.
     * Only kill A in this browser.
     */
    const target = world.ships.find(
      (ship) =>
        ship.owner === 'A' &&
        ship.visible &&
        wrappedDistance(missile, ship, worldWidth, worldHeight) <
          ship.radius + missile.radius
    );

    if (!target) continue;

    world.missiles.splice(missileIndex, 1);

    if (playerDestroyed('A', 'mr-k-missile')) {
      addExplosion(target.x, target.y, '#ff875f', 22);
    }
  }

  /*
   * LOCAL SHIP → ASTEROID
   */
  const localShip = world.ships.find((ship) => ship.owner === 'A');

  if (localShip && localShip.visible) {
    const asteroidIndex = world.asteroids.findIndex(
      (asteroid) =>
        wrappedDistance(localShip, asteroid, worldWidth, worldHeight) <
        asteroid.radius + 11
    );

    if (asteroidIndex >= 0 && playerDestroyed('A', 'asteroid')) {
      const asteroid = world.asteroids.splice(asteroidIndex, 1)[0];

      addExplosion(localShip.x, localShip.y, '#ff875f', 22);
      addExplosion(asteroid.x, asteroid.y, '#f1f0ea', 14);
    }
  }

  /*
   * RESPAWNS
   */
  if (!world.asteroids.length) spawnAsteroids();

  if (!world.mrK) {
    world.mrKRespawnTimer -= dt;
    if (world.mrKRespawnTimer <= 0) spawnMrK();
  }

  camera.update(world.ships, width, height, worldWidth, worldHeight);
}

function drawGrid() {
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.strokeStyle = '#28302f';
  ctx.lineWidth = 1;

  for (let x = 0; x < worldWidth; x += 48) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, worldHeight);
    ctx.stroke();
  }

  for (let y = 0; y < worldHeight; y += 48) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(worldWidth, y);
    ctx.stroke();
  }

  ctx.restore();
}

function drawWorld() {
  drawGrid();

  /* Four functional corner safe-zone L barriers. */
  if (safeZones) safeZones.draw(ctx);

  world.asteroids.forEach((asteroid) =>
    asteroid.draw(ctx, worldWidth, worldHeight)
  );

  if (world.mrK) world.mrK.draw(ctx, worldWidth, worldHeight);

  world.bullets.forEach((bullet) =>
    drawWrapped(
      ctx,
      bullet,
      worldWidth,
      worldHeight,
      (drawCtx) => bullet.draw(drawCtx)
    )
  );

  world.missiles.forEach((missile) =>
    missile.draw(ctx, worldWidth, worldHeight)
  );

  world.ships.forEach((ship) =>
    ship.draw(ctx, worldWidth, worldHeight)
  );

  world.particles.forEach((particle) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0, particle.life * 2);
    ctx.strokeStyle = particle.color;
    ctx.lineWidth = 1;

    ctx.beginPath();
    ctx.moveTo(particle.x, particle.y);
    ctx.lineTo(
      particle.x - particle.velocityX * particle.length,
      particle.y - particle.velocityY * particle.length
    );
    ctx.stroke();

    ctx.restore();
  });
}

function draw() {
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.scale(camera.zoom, camera.zoom);
  ctx.translate(-camera.x, -camera.y);
  drawWorld();
  ctx.restore();
}

function frame(now) {
  const dt = normalizeDelta(now - lastTime);
  lastTime = now;

  if (hasStarted) update(dt);

  spelling.update(now);
  draw();
  requestAnimationFrame(frame);
}

function keyName(event) {
  if (
    event.code === 'ArrowLeft' ||
    event.code === 'ArrowRight' ||
    event.code === 'ArrowUp' ||
    event.code === 'ArrowDown' ||
    event.code === 'Space'
  ) {
    return event.code;
  }

  return event.key.toLowerCase();
}

/*
 * PILOT LOGIN
 *
 * The ship already exists locally before login. We simply give Firebase
 * its current state when the student presses ENTER MOSH.
 */
bindPilotLogin(
  () => {
    const ship = world.ships.find((candidate) => candidate.owner === 'A');

    return {
      x: ship?.x ?? worldWidth * 0.5,
      y: ship?.y ?? worldHeight * 0.5,
      angle: ship?.angle ?? -Math.PI / 2,
      velocityX: ship?.velocityX ?? 0,
      velocityY: ship?.velocityY ?? 0,
      visible: ship?.visible !== false,
      score: world.scores.A
    };
  },
  (identity) => {
    const ship = world.ships.find((candidate) => candidate.owner === 'A');

    if (ship) ship.displayName = identity.name;

    multiplayerJoined = true;
    hasStarted = true;
    startHint.classList.add('hidden');
    canvas.focus();
  }
);

gameShell.style.setProperty('--ui-scale', '1');

gameShell.addEventListener('input', (event) => {
  if (event.target.id !== 'zoomControl') return;

  gameShell.style.setProperty('--ui-scale', event.target.value);

  event.target
    .closest('.zoom-control')
    .querySelector('output')
    .textContent = `${Math.round(Number(event.target.value) * 100)}%`;
});

document.addEventListener(
  'keydown',
  (event) => {
    /*
     * Do not let gameplay controls fire while typing a pilot name
     * or completing the spelling challenge.
     */
    if (
      event.target.closest('.wormhole-overlay') ||
      event.target.closest('.pilot-login-overlay')
    ) {
      return;
    }

    const key = keyName(event);

    if (
      Object.values(controls).some(
        (set) => Object.values(set).includes(key)
      )
    ) {
      event.preventDefault();
    }

    keys.add(key);
    hasStarted = true;
    startHint.classList.add('hidden');
    canvas.focus();
  },
  true
);

document.addEventListener(
  'keyup',
  (event) => {
    if (
      event.target.closest('.wormhole-overlay') ||
      event.target.closest('.pilot-login-overlay')
    ) {
      return;
    }

    keys.delete(keyName(event));
  },
  true
);

window.addEventListener('blur', () => keys.clear());

window.addEventListener('resize', () => {
  resize();

  /*
   * Preserve the original resize/reset behaviour for now.
   * Multiplayer state will republish the new local spawn afterward.
   */
  reset();
});

resize();
reset();
requestAnimationFrame(frame);
