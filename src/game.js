import { asteroidDirector } from './asteroidDirector.js';
import { Bullet } from './bullet.js';
import { Camera } from './camera.js';
import { HomingMissile } from './homingMissile.js';
import { MrKRock } from './mrKRock.js';
import { SafeZones } from './safeZone.js';
import { Ship } from './ship.js';
import { SpellingChallengeController } from './spellingController.js';
import { weaponSystem } from './weaponSystem.js';

import {
  drawWrapped,
  normalizeDelta,
  random,
  wrappedDistance
} from './physics.js';

import {
  bindPilotLogin,
  claimGunDrop,
  destroySharedAsteroid,
  getDestroyedAsteroids,
  getGunDrops,
  getLocalIdentity,
  getRemotePlayers,
  publishGunDrops,
  publishLocalState,
  removeExpiredGunDrop,
  updateRemotePlayers
} from './multiplayer.js';


/* =========================================================
   DOM / INPUT
   ========================================================= */

const canvas =
  document.querySelector('#gameCanvas');

const ctx =
  canvas.getContext('2d');

const keys =
  new Set();

const scoreNodes = {
  A: document.querySelector('#scoreA')
};

const startHint =
  document.querySelector('#startHint');

const gameShell =
  document.querySelector('.game-shell');


/* =========================================================
   GAME STATE
   ========================================================= */

let width = 0;
let height = 0;

let worldWidth = 0;
let worldHeight = 0;

let lastTime =
  performance.now();

let hasStarted = false;
let multiplayerJoined = false;
let pickupInProgress = false;


/*
 * These belong to shared multiplayer destruction handling,
 * NOT AsteroidDirector.
 */
const asteroidDestructionPending =
  new Set();

const processedDestroyedAsteroids =
  new Set();


const camera =
  new Camera();

let safeZones =
  null;


const world = {
  ships: [],
  bullets: [],
  asteroids: [],
  missiles: [],
  particles: [],

  mrK: null,
  mrKRespawnTimer: 0,

  scores: {
    A: 0
  }
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


/* =========================================================
   SPELLING
   ========================================================= */

const spelling =
  new SpellingChallengeController({
    overlay:
      document.querySelector(
        '#wormholeOverlay'
      ),

    onComplete:
      respawnPlayer
  });


/* =========================================================
   WORLD SIZE
   ========================================================= */

function resize() {
  const frame =
    canvas.parentElement;

  const ratio =
    Math.min(
      window.devicePixelRatio || 1,
      2
    );

  width =
    frame.clientWidth;

  height =
    frame.clientHeight;

  canvas.width =
    Math.floor(
      width * ratio
    );

  canvas.height =
    Math.floor(
      height * ratio
    );

  ctx.setTransform(
    ratio,
    0,
    0,
    ratio,
    0,
    0
  );

  worldWidth =
    width * 2.4;

  worldHeight =
    height * 2.4;

  if (!safeZones) {
    safeZones =
      new SafeZones(
        worldWidth,
        worldHeight
      );
  } else {
    safeZones.resize(
      worldWidth,
      worldHeight
    );
  }
}


/* =========================================================
   ASTEROID FIELD ORCHESTRATION
   ========================================================= */

/*
 * game.js owns world.asteroids.
 *
 * AsteroidDirector owns:
 *
 * - asteroid construction
 * - deterministic IDs
 * - deterministic seeds
 * - deterministic spawn positions
 * - field creation
 * - respawn timing
 * - difficulty
 */
function replaceAsteroidField(
  count = asteroidDirector.getCap()
) {
  world.asteroids =
    asteroidDirector.createField(
      worldWidth,
      worldHeight,
      count
    );

  /*
   * A complete field replacement invalidates the local
   * destruction bookkeeping belonging to the old field.
   */
  asteroidDestructionPending.clear();
  processedDestroyedAsteroids.clear();
}


/*
 * Normal asteroid replenishment.
 *
 * AsteroidDirector decides whether exactly ONE asteroid
 * should be created.
 */
function updateAsteroidRespawn() {
  const asteroid =
    asteroidDirector.createRespawn(
      world.asteroids.length,
      worldWidth,
      worldHeight
    );

  if (!asteroid) {
    return;
  }

  world.asteroids.push(
    asteroid
  );
}


/* =========================================================
   MR. K
   ========================================================= */

function spawnMrK() {
  world.mrK =
    new MrKRock(
      worldWidth * 0.5,
      -105
    );
}


/*
 * Destroying MR. K advances the asteroid director one
 * effective tier and starts a completely new field generation.
 */
function advanceAsteroidsFromMrK() {
  const result =
    asteroidDirector.mrKDestroyed();

  replaceAsteroidField(
    result.cap
  );

  console.log(
    'MR. K DESTROYED — ASTEROID TIER:',
    result.tierNumber,
    'CAP:',
    result.cap,
    'RESPAWN:',
    `${result.respawnSeconds}s`
  );
}


/* =========================================================
   PARTICLES / EXPLOSIONS
   ========================================================= */

function addExplosion(
  x,
  y,
  color,
  count = 10,
  spread = 4
) {
  for (
    let index = 0;
    index < count;
    index += 1
  ) {
    const angle =
      random(
        0,
        Math.PI * 2
      );

    world.particles.push({
      x,
      y,

      velocityX:
        Math.cos(angle) *
        random(1, spread),

      velocityY:
        Math.sin(angle) *
        random(1, spread),

      life:
        random(
          0.25,
          0.65
        ),

      color,

      length:
        random(
          3,
          10
        )
    });
  }
}


function addRockExplosion(
  x,
  y
) {
  addExplosion(
    x,
    y,
    '#ff875f',
    70,
    7
  );

  addExplosion(
    x,
    y,
    '#f1f0ea',
    45,
    11
  );

  for (
    let index = 0;
    index < 8;
    index += 1
  ) {
    addExplosion(
      x +
        random(
          -50,
          50
        ),

      y +
        random(
          -50,
          50
        ),

      '#ffdb69',
      5,
      4
    );
  }
}


/* =========================================================
   RESET
   ========================================================= */

function reset() {
  world.ships = [
    new Ship(
      'A',
      worldWidth * 0.5,
      worldHeight * 0.5,
      controls.A
    )
  ];

  world.bullets = [];
  world.missiles = [];
  world.particles = [];

  world.mrK = null;
  world.mrKRespawnTimer = 0;

  world.scores = {
    A: 0
  };

  weaponSystem.reset();

  /*
   * Starts a new synchronized asteroid-director session.
   */
  asteroidDirector.reset();

  /*
   * MOSHROIDS always begins with exactly 10 ordinary asteroids.
   */
  replaceAsteroidField(10);

  spawnMrK();

  camera.x =
    worldWidth * 0.5;

  camera.y =
    worldHeight * 0.5;

  camera.update(
    world.ships,
    width,
    height,
    worldWidth,
    worldHeight
  );

  updateScores();
}


/* =========================================================
   SCORE
   ========================================================= */

function updateScores() {
  scoreNodes.A.textContent =
    String(
      world.scores.A
    ).padStart(
      5,
      '0'
    );
}


/* =========================================================
   PLAYER CONTROL
   ========================================================= */

function suspendPlayerControls(
  playerId
) {
  if (!controls[playerId]) {
    return;
  }

  Object.values(
    controls[playerId]
  ).forEach(
    (control) =>
      keys.delete(
        control
      )
  );
}


/* =========================================================
   SHARED ASTEROID DESTRUCTION
   ========================================================= */

function syncDestroyedAsteroids() {
  if (!multiplayerJoined) {
    return;
  }

  const destroyed =
    getDestroyedAsteroids();

  destroyed.forEach(
    (
      _record,
      asteroidId
    ) => {
      if (
        processedDestroyedAsteroids.has(
          asteroidId
        )
      ) {
        return;
      }

      const asteroidIndex =
        world.asteroids.findIndex(
          (asteroid) =>
            asteroid.id ===
            asteroidId
        );

      if (
        asteroidIndex >= 0
      ) {
        const asteroid =
          world.asteroids[
            asteroidIndex
          ];

        addExplosion(
          asteroid.x,
          asteroid.y,
          '#f1f0ea',
          16,
          4
        );

        world.asteroids.splice(
          asteroidIndex,
          1
        );
      }

      processedDestroyedAsteroids.add(
        asteroidId
      );

      asteroidDestructionPending.delete(
        asteroidId
      );
    }
  );
}


async function destroyAsteroid(
  asteroid,
  color = '#f1f0ea'
) {
  if (
    !asteroid ||
    !asteroid.id ||
    asteroidDestructionPending.has(
      asteroid.id
    )
  ) {
    return false;
  }

  asteroidDestructionPending.add(
    asteroid.id
  );

  const asteroidIndex =
    world.asteroids.findIndex(
      (candidate) =>
        candidate.id ===
        asteroid.id
    );

  if (
    asteroidIndex >= 0
  ) {
    world.asteroids.splice(
      asteroidIndex,
      1
    );
  }

  addExplosion(
    asteroid.x,
    asteroid.y,
    color,
    16,
    4
  );

  try {
    const destroyed =
      await destroySharedAsteroid(
        asteroid.id
      );

    if (!destroyed) {
      const shared =
        getDestroyedAsteroids();

      if (
        !shared.has(
          asteroid.id
        )
      ) {
        console.warn(
          `Asteroid destruction was not confirmed: ${asteroid.id}`
        );
      }
    }

    processedDestroyedAsteroids.add(
      asteroid.id
    );

    return destroyed;
  } catch (error) {
    console.error(
      'Shared asteroid destruction failed:',
      error
    );

    return false;
  } finally {
    asteroidDestructionPending.delete(
      asteroid.id
    );
  }
}


/* =========================================================
   GUN DROPS
   ========================================================= */

async function dropLocalGuns(
  ship
) {
  const identity =
    getLocalIdentity();

  if (!identity) {
    return;
  }

  const gunCount =
    weaponSystem.getGunCount();

  const drops =
    weaponSystem.createDrops(
      ship.x,
      ship.y,
      identity.uid,
      gunCount
    );

  weaponSystem.setGunCount(
    1
  );

  if (drops.length) {
    await publishGunDrops(
      drops
    );
  }
}


function firebaseDropToLocal(
  drop
) {
  const remainingMs =
    Math.max(
      0,
      Number(
        drop.expiresAt
      ) -
        Date.now()
    );

  const localNow =
    performance.now();

  return {
    ...drop,

    createdAt:
      localNow,

    expiresAt:
      localNow +
      remainingMs
  };
}


function syncGunDrops() {
  if (!multiplayerJoined) {
    return;
  }

  const sharedDrops =
    getGunDrops();

  const sharedIds =
    new Set(
      sharedDrops.keys()
    );

  sharedDrops.forEach(
    (
      drop,
      id
    ) => {
      const existing =
        weaponSystem.drops.get(
          id
        );

      const localDrop =
        firebaseDropToLocal(
          drop
        );

      if (existing) {
        existing.x =
          localDrop.x;

        existing.y =
          localDrop.y;

        existing.radius =
          localDrop.radius;

        existing.expiresAt =
          Math.min(
            existing.expiresAt,
            localDrop.expiresAt
          );

        return;
      }

      weaponSystem.addDrop(
        localDrop
      );
    }
  );

  for (
    const id of
    [
      ...weaponSystem.drops.keys()
    ]
  ) {
    if (
      !sharedIds.has(id)
    ) {
      weaponSystem.removeDrop(
        id
      );
    }
  }
}


async function checkGunPickup() {
  if (
    !multiplayerJoined ||
    pickupInProgress
  ) {
    return;
  }

  const ship =
    world.ships.find(
      (candidate) =>
        candidate.owner === 'A'
    );

  if (
    !ship ||
    !ship.visible ||
    ship.state !== 'ACTIVE'
  ) {
    return;
  }

  if (
    weaponSystem.getGunCount() >=
    40
  ) {
    return;
  }

  const drop =
    weaponSystem.findPickup(
      ship
    );

  if (!drop) {
    return;
  }

  pickupInProgress = true;

  try {
    const claimed =
      await claimGunDrop(
        drop.id
      );

    if (!claimed) {
      return;
    }

    const pickup =
      weaponSystem.confirmPickup(
        drop.id
      );

    if (pickup) {
      addExplosion(
        drop.x,
        drop.y,
        '#ff3b30',
        9,
        2
      );

      publishPlayerState(
        true
      );
    }
  } catch (error) {
    console.error(
      'Gun pickup failed:',
      error
    );
  } finally {
    pickupInProgress = false;
  }
}


function updateGunDrops() {
  if (!multiplayerJoined) {
    return;
  }

  syncGunDrops();

  const now =
    Date.now();

  getGunDrops().forEach(
    (
      drop,
      id
    ) => {
      if (
        now >=
        drop.expiresAt
      ) {
        removeExpiredGunDrop(
          id
        );
      }
    }
  );

  checkGunPickup();
}


/* =========================================================
   PLAYER DEATH / RESPAWN
   ========================================================= */

function playerDestroyed(
  playerId,
  reason
) {
  if (
    playerId !== 'A'
  ) {
    return false;
  }

  const ship =
    world.ships.find(
      (candidate) =>
        candidate.owner ===
        playerId
    );

  if (
    !ship ||
    !ship.destroy()
  ) {
    return false;
  }

  /*
   * Gun dropping is asynchronous.
   * Player death itself remains synchronous.
   */
  dropLocalGuns(
    ship
  ).catch(
    (error) => {
      console.error(
        'Gun drop failed:',
        error
      );
    }
  );

  suspendPlayerControls(
    playerId
  );

  spelling.begin({
    playerId,
    reason
  });

  publishPlayerState(
    true
  );

  return true;
}


function respawnPlayer(
  playerId
) {
  const ship =
    world.ships.find(
      (candidate) =>
        candidate.owner ===
        playerId
    );

  if (!ship) {
    return;
  }

  weaponSystem.setGunCount(
    1
  );

  ship.respawn();

  publishPlayerState(
    true
  );
}


/* =========================================================
   MR. K MISSILES
   ========================================================= */

function releaseMissiles() {
  if (!world.mrK) {
    return;
  }

  for (
    let index = 0;
    index < 20;
    index += 1
  ) {
    const angle =
      (
        index /
        20
      ) *
      Math.PI *
      2;

    world.missiles.push(
      new HomingMissile(
        world.mrK.x +
          Math.cos(angle) *
          world.mrK.radius,

        world.mrK.y +
          Math.sin(angle) *
          world.mrK.radius,

        angle,
        world.mrK.radius
      )
    );
  }
}


/* =========================================================
   MULTIPLAYER SHIPS
   ========================================================= */

function syncRemoteShips(
  dt
) {
  if (!multiplayerJoined) {
    return;
  }

  updateRemotePlayers(
    dt,
    worldWidth,
    worldHeight
  );

  const remotePlayers =
    getRemotePlayers();

  const remoteIds =
    new Set(
      remotePlayers.keys()
    );

  world.ships =
    world.ships.filter(
      (ship) =>
        ship.owner === 'A' ||
        remoteIds.has(
          ship.owner
        )
    );

  remotePlayers.forEach(
    (
      remote,
      uid
    ) => {
      let ship =
        world.ships.find(
          (candidate) =>
            candidate.owner ===
            uid
        );

      if (!ship) {
        ship =
          new Ship(
            uid,
            remote.renderX,
            remote.renderY,
            {},
            remote.name
          );

        ship.remote = true;

        world.ships.push(
          ship
        );
      }

      ship.remote = true;

      ship.displayName =
        remote.name;

      ship.x =
        remote.renderX;

      ship.y =
        remote.renderY;

      ship.angle =
        remote.renderAngle;

      ship.velocityX =
        remote.velocityX;

      ship.velocityY =
        remote.velocityY;

      ship.visible =
        remote.visible;

      ship.state =
        remote.visible
          ? 'ACTIVE'
          : 'SPELLING';

      ship.guns =
        remote.guns;
    }
  );
}


function publishPlayerState(
  force = false
) {
  if (!multiplayerJoined) {
    return;
  }

  const ship =
    world.ships.find(
      (candidate) =>
        candidate.owner === 'A'
    );

  if (!ship) {
    return;
  }

  publishLocalState(
    {
      x:
        ship.x,

      y:
        ship.y,

      angle:
        ship.angle,

      velocityX:
        ship.velocityX,

      velocityY:
        ship.velocityY,

      visible:
        ship.visible,

      score:
        world.scores.A,

      guns:
        weaponSystem.getGunCount()
    },

    force
  );
}


/* =========================================================
   MULTI-GUN FIRING
   ========================================================= */

function fireWeapons(
  ship
) {
  const emitters =
    weaponSystem.getEmitters(
      ship
    );

  /*
   * Temporary diagnostic retained until the firing bug
   * is handled in its own pass.
   */
  console.log(
    'FIRING:',
    weaponSystem.getGunCount(),
    'guns /',
    emitters.length,
    'bullets'
  );

  emitters.forEach(
    (emitter) => {
      world.bullets.push(
        new Bullet(
          emitter.x,
          emitter.y,
          emitter.angle,
          emitter.velocityX,
          emitter.velocityY,
          ship.owner
        )
      );
    }
  );
}


/* =========================================================
   UPDATE — SHIPS
   ========================================================= */

function updateShips(
  dt
) {
  world.ships.forEach(
    (ship) => {
      const fireTrigger =
        ship.update(
          dt,
          keys,
          worldWidth,
          worldHeight
        );

      if (
        safeZones &&
        ship.visible &&
        !ship.remote
      ) {
        safeZones.blockShip(
          ship
        );
      }

      if (
        fireTrigger &&
        !ship.remote
      ) {
        fireWeapons(
          ship
        );
      }
    }
  );

  publishPlayerState();
}


/* =========================================================
   UPDATE — BULLETS
   ========================================================= */

function updateBullets(
  dt
) {
  world.bullets.forEach(
    (bullet) =>
      bullet.update(
        dt,
        worldWidth,
        worldHeight
      )
  );

  world.bullets =
    world.bullets.filter(
      (bullet) =>
        bullet.life > 0
    );

  if (!safeZones) {
    return;
  }

  world.bullets =
    world.bullets.filter(
      (bullet) => {
        if (
          !safeZones.hitsBullet(
            bullet
          )
        ) {
          return true;
        }

        addExplosion(
          bullet.x,
          bullet.y,

          bullet.owner === 'A'
            ? '#ff875f'
            : '#72e6dd',

          5,
          2
        );

        return false;
      }
    );
}


/* =========================================================
   UPDATE — ASTEROIDS
   ========================================================= */

function updateAsteroids(
  dt
) {
  world.asteroids.forEach(
    (asteroid) =>
      asteroid.update(
        dt,
        worldWidth,
        worldHeight
      )
  );

  updateAsteroidRespawn();

  if (!safeZones) {
    return;
  }

  /*
   * Snapshot the collisions before asynchronous shared
   * destruction begins modifying world.asteroids.
   */
  const safeZoneHits =
    world.asteroids.filter(
      (asteroid) =>
        safeZones.hitsAsteroid(
          asteroid
        )
    );

  safeZoneHits.forEach(
    (asteroid) => {
      destroyAsteroid(
        asteroid,
        '#f1f0ea'
      ).catch(
        (error) => {
          console.error(
            'Safe-zone asteroid destruction failed:',
            error
          );
        }
      );
    }
  );
}


/* =========================================================
   UPDATE — MR. K
   ========================================================= */

function updateMrK(
  dt
) {
  if (world.mrK) {
    world.mrK.update(
      dt,
      worldWidth,
      worldHeight
    );

    return;
  }

  world.mrKRespawnTimer -=
    dt;

  if (
    world.mrKRespawnTimer <= 0
  ) {
    spawnMrK();
  }
}


/* =========================================================
   UPDATE — MISSILES
   ========================================================= */

function updateMissiles(
  dt
) {
  world.missiles.forEach(
    (missile) =>
      missile.update(
        dt,
        world.ships,
        worldWidth,
        worldHeight
      )
  );

  world.missiles =
    world.missiles.filter(
      (missile) => {
        if (
          missile.life <= 0
        ) {
          addExplosion(
            missile.x,
            missile.y,
            '#ffdb69',
            3,
            2
          );
        }

        return (
          missile.life > 0
        );
      }
    );

  if (!safeZones) {
    return;
  }

  world.missiles =
    world.missiles.filter(
      (missile) => {
        if (
          !safeZones.hitsMissile(
            missile
          )
        ) {
          return true;
        }

        addExplosion(
          missile.x,
          missile.y,
          '#ffdb69',
          7,
          3
        );

        return false;
      }
    );
}


/* =========================================================
   UPDATE — PARTICLES
   ========================================================= */

function updateParticles(
  dt
) {
  world.particles.forEach(
    (particle) => {
      const frameScale =
        dt * 60;

      particle.x +=
        particle.velocityX *
        frameScale;

      particle.y +=
        particle.velocityY *
        frameScale;

      particle.life -=
        dt;
    }
  );

  world.particles =
    world.particles.filter(
      (particle) =>
        particle.life > 0
    );
}


/* =========================================================
   COLLISION — BULLET → MISSILE / ASTEROID
   ========================================================= */

function resolveBulletRockCollisions() {
  for (
    let bulletIndex =
      world.bullets.length - 1;

    bulletIndex >= 0;

    bulletIndex -= 1
  ) {
    const bullet =
      world.bullets[
        bulletIndex
      ];

    const missileIndex =
      world.missiles.findIndex(
        (missile) =>
          wrappedDistance(
            bullet,
            missile,
            worldWidth,
            worldHeight
          ) <
          missile.radius +
          bullet.radius
      );

    if (
      missileIndex >= 0
    ) {
      world.bullets.splice(
        bulletIndex,
        1
      );

      const missile =
        world.missiles.splice(
          missileIndex,
          1
        )[0];

      addExplosion(
        missile.x,
        missile.y,
        '#ffdb69',
        7,
        3
      );

      continue;
    }

    const asteroidIndex =
      world.asteroids.findIndex(
        (asteroid) =>
          !asteroidDestructionPending.has(
            asteroid.id
          ) &&

          wrappedDistance(
            bullet,
            asteroid,
            worldWidth,
            worldHeight
          ) <
          asteroid.radius +
          bullet.radius
      );

    if (
      asteroidIndex < 0
    ) {
      continue;
    }

    const asteroid =
      world.asteroids[
        asteroidIndex
      ];

    world.bullets.splice(
      bulletIndex,
      1
    );

    const asteroidId =
      asteroid.id;

    const asteroidPoints =
      asteroid.points;

    destroyAsteroid(
      asteroid,

      bullet.owner === 'A'
        ? '#ff875f'
        : '#72e6dd'
    )
      .then(
        (
          wonDestruction
        ) => {
          if (
            wonDestruction &&
            bullet.owner === 'A'
          ) {
            world.scores.A +=
              asteroidPoints;

            updateScores();

            publishPlayerState(
              true
            );
          }
        }
      )
      .catch(
        (error) => {
          console.error(
            `Failed to destroy ${asteroidId}:`,
            error
          );
        }
      );
  }
}


/* =========================================================
   COLLISION — BULLET → MR. K
   ========================================================= */

function resolveBulletMrKCollisions() {
  if (!world.mrK) {
    return;
  }

  for (
    let bulletIndex =
      world.bullets.length - 1;

    bulletIndex >= 0;

    bulletIndex -= 1
  ) {
    const bullet =
      world.bullets[
        bulletIndex
      ];

    if (
      wrappedDistance(
        bullet,
        world.mrK,
        worldWidth,
        worldHeight
      ) >=
      world.mrK.radius +
      bullet.radius
    ) {
      continue;
    }

    world.bullets.splice(
      bulletIndex,
      1
    );

    world.mrK.damage(
      1
    );

    if (
      world.scores[
        bullet.owner
      ] !== undefined
    ) {
      world.scores[
        bullet.owner
      ] += 1;

      updateScores();
    }

    addExplosion(
      bullet.x,
      bullet.y,

      bullet.owner === 'A'
        ? '#ff875f'
        : '#72e6dd',

      2,
      2
    );

    if (
      world.mrK.health !== 0
    ) {
      continue;
    }

    const mrKX =
      world.mrK.x;

    const mrKY =
      world.mrK.y;

    /*
     * releaseMissiles() needs the live MR. K object.
     */
    releaseMissiles();

    addRockExplosion(
      mrKX,
      mrKY
    );

    advanceAsteroidsFromMrK();

    world.mrK = null;

    world.mrKRespawnTimer =
      60;

    /*
     * MR. K no longer exists.
     * Stop testing remaining bullets against it this frame.
     */
    break;
  }
}


/* =========================================================
   COLLISION — BULLET → PLAYER
   ========================================================= */

function resolveBulletPlayerCollisions() {
  for (
    let bulletIndex =
      world.bullets.length - 1;

    bulletIndex >= 0;

    bulletIndex -= 1
  ) {
    const bullet =
      world.bullets[
        bulletIndex
      ];

    const target =
      world.ships.find(
        (ship) =>
          ship.owner !==
            bullet.owner &&

          ship.visible &&

          wrappedDistance(
            bullet,
            ship,
            worldWidth,
            worldHeight
          ) <
          ship.radius +
          bullet.radius
      );

    if (!target) {
      continue;
    }

    world.bullets.splice(
      bulletIndex,
      1
    );

    if (
      target.owner === 'A' &&
      playerDestroyed(
        'A',
        'enemy-bullet'
      )
    ) {
      addExplosion(
        target.x,
        target.y,
        '#ff875f',
        22
      );
    }
  }
}


/* =========================================================
   COLLISION — MISSILES
   ========================================================= */

function resolveMissileCollisions() {
  for (
    let missileIndex =
      world.missiles.length - 1;

    missileIndex >= 0;

    missileIndex -= 1
  ) {
    const missile =
      world.missiles[
        missileIndex
      ];

    const rockHit =
      !missile.outbound &&
      (
        world.asteroids.some(
          (asteroid) =>
            wrappedDistance(
              missile,
              asteroid,
              worldWidth,
              worldHeight
            ) <
            asteroid.radius +
            missile.radius
        ) ||

        (
          world.mrK &&

          wrappedDistance(
            missile,
            world.mrK,
            worldWidth,
            worldHeight
          ) <
          world.mrK.radius +
          missile.radius
        )
      );

    if (rockHit) {
      world.missiles.splice(
        missileIndex,
        1
      );

      addExplosion(
        missile.x,
        missile.y,
        '#ffdb69',
        7,
        3
      );

      continue;
    }

    const target =
      world.ships.find(
        (ship) =>
          ship.owner === 'A' &&
          ship.visible &&

          wrappedDistance(
            missile,
            ship,
            worldWidth,
            worldHeight
          ) <
          ship.radius +
          missile.radius
      );

    if (!target) {
      continue;
    }

    world.missiles.splice(
      missileIndex,
      1
    );

    if (
      playerDestroyed(
        'A',
        'mr-k-missile'
      )
    ) {
      addExplosion(
        target.x,
        target.y,
        '#ff875f',
        22
      );
    }
  }
}


/* =========================================================
   COLLISION — LOCAL SHIP → ROCKS
   ========================================================= */

function resolveLocalShipRockCollisions() {
  const localShip =
    world.ships.find(
      (ship) =>
        ship.owner === 'A'
    );

  if (
    !localShip ||
    !localShip.visible
  ) {
    return;
  }

  const asteroid =
    world.asteroids.find(
      (candidate) =>
        wrappedDistance(
          localShip,
          candidate,
          worldWidth,
          worldHeight
        ) <
        candidate.radius +
        (
          localShip.radius ??
          11
        )
    );

  /*
   * Ordinary asteroid collision:
   *
   * ship dies
   * asteroid survives
   */
  if (
    asteroid &&
    playerDestroyed(
      'A',
      'asteroid'
    )
  ) {
    addExplosion(
      localShip.x,
      localShip.y,
      '#ff875f',
      22
    );

    /*
     * playerDestroyed() makes the local ship non-active.
     * Do not then process MR. K against the same death.
     */
    return;
  }

  if (
    !world.mrK ||
    !localShip.visible
  ) {
    return;
  }

  /*
   * MR. K is solid and lethal.
   *
   * Flying into MR. K destroys the ship.
   * MR. K itself takes no collision damage.
   */
  if (
    wrappedDistance(
      localShip,
      world.mrK,
      worldWidth,
      worldHeight
    ) >=
    world.mrK.radius +
    (
      localShip.radius ??
      11
    )
  ) {
    return;
  }

  if (
    playerDestroyed(
      'A',
      'mr-k-collision'
    )
  ) {
    addExplosion(
      localShip.x,
      localShip.y,
      '#ff875f',
      22
    );
  }
}


/* =========================================================
   UPDATE
   ========================================================= */

function update(
  dt
) {
  syncRemoteShips(
    dt
  );

  syncDestroyedAsteroids();

  updateGunDrops();

  updateShips(
    dt
  );

  updateBullets(
    dt
  );

  updateAsteroids(
    dt
  );

  updateMrK(
    dt
  );

  updateMissiles(
    dt
  );

  updateParticles(
    dt
  );

  resolveBulletRockCollisions();

  resolveBulletMrKCollisions();

  resolveBulletPlayerCollisions();

  resolveMissileCollisions();

  resolveLocalShipRockCollisions();

  camera.update(
    world.ships,
    width,
    height,
    worldWidth,
    worldHeight
  );
}


/* =========================================================
   DRAW — GRID
   ========================================================= */

function drawGrid() {
  ctx.save();

  ctx.globalAlpha =
    0.16;

  ctx.strokeStyle =
    '#28302f';

  ctx.lineWidth =
    1;

  for (
    let x = 0;
    x < worldWidth;
    x += 48
  ) {
    ctx.beginPath();

    ctx.moveTo(
      x,
      0
    );

    ctx.lineTo(
      x,
      worldHeight
    );

    ctx.stroke();
  }

  for (
    let y = 0;
    y < worldHeight;
    y += 48
  ) {
    ctx.beginPath();

    ctx.moveTo(
      0,
      y
    );

    ctx.lineTo(
      worldWidth,
      y
    );

    ctx.stroke();
  }

  ctx.restore();
}


/* =========================================================
   DRAW — WORLD
   ========================================================= */

function drawWorld() {
  drawGrid();

  if (safeZones) {
    safeZones.draw(
      ctx
    );
  }

  world.asteroids.forEach(
    (asteroid) =>
      asteroid.draw(
        ctx,
        worldWidth,
        worldHeight
      )
  );

  if (world.mrK) {
    world.mrK.draw(
      ctx,
      worldWidth,
      worldHeight
    );
  }

  world.bullets.forEach(
    (bullet) =>
      drawWrapped(
        ctx,
        bullet,
        worldWidth,
        worldHeight,

        (drawCtx) =>
          bullet.draw(
            drawCtx
          )
      )
  );

  world.missiles.forEach(
    (missile) =>
      missile.draw(
        ctx,
        worldWidth,
        worldHeight
      )
  );

  world.ships.forEach(
    (ship) =>
      ship.draw(
        ctx,
        worldWidth,
        worldHeight
      )
  );

  weaponSystem.draw(
    ctx
  );

  world.particles.forEach(
    (particle) => {
      ctx.save();

      ctx.globalAlpha =
        Math.max(
          0,
          particle.life * 2
        );

      ctx.strokeStyle =
        particle.color;

      ctx.lineWidth =
        1;

      ctx.beginPath();

      ctx.moveTo(
        particle.x,
        particle.y
      );

      ctx.lineTo(
        particle.x -
          particle.velocityX *
          particle.length,

        particle.y -
          particle.velocityY *
          particle.length
      );

      ctx.stroke();

      ctx.restore();
    }
  );
}


/* =========================================================
   DRAW — CAMERA
   ========================================================= */

function draw() {
  ctx.clearRect(
    0,
    0,
    width,
    height
  );

  ctx.fillStyle =
    '#000';

  ctx.fillRect(
    0,
    0,
    width,
    height
  );

  ctx.save();

  ctx.translate(
    width / 2,
    height / 2
  );

  ctx.scale(
    camera.zoom,
    camera.zoom
  );

  ctx.translate(
    -camera.x,
    -camera.y
  );

  drawWorld();

  ctx.restore();
}


/* =========================================================
   FRAME LOOP
   ========================================================= */

function frame(
  now
) {
  const dt =
    normalizeDelta(
      now -
      lastTime
    );

  lastTime =
    now;

  if (hasStarted) {
    update(
      dt
    );
  }

  spelling.update(
    now
  );

  draw();

  requestAnimationFrame(
    frame
  );
}


/* =========================================================
   INPUT HELPERS
   ========================================================= */

function keyName(
  event
) {
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


/* =========================================================
   PILOT LOGIN
   ========================================================= */

bindPilotLogin(
  () => {
    const ship =
      world.ships.find(
        (candidate) =>
          candidate.owner === 'A'
      );

    return {
      x:
        ship?.x ??
        worldWidth * 0.5,

      y:
        ship?.y ??
        worldHeight * 0.5,

      angle:
        ship?.angle ??
        -Math.PI / 2,

      velocityX:
        ship?.velocityX ??
        0,

      velocityY:
        ship?.velocityY ??
        0,

      visible:
        ship?.visible !== false,

      score:
        world.scores.A,

      guns:
        weaponSystem.getGunCount()
    };
  },

  (identity) => {
    const ship =
      world.ships.find(
        (candidate) =>
          candidate.owner === 'A'
      );

    if (ship) {
      ship.displayName =
        identity.name;
    }

    multiplayerJoined =
      true;

    syncDestroyedAsteroids();

    hasStarted =
      true;

    startHint.classList.add(
      'hidden'
    );

    canvas.focus();
  }
);


/* =========================================================
   UI
   ========================================================= */

gameShell.style.setProperty(
  '--ui-scale',
  '1'
);


gameShell.addEventListener(
  'input',

  (event) => {
    if (
      event.target.id !==
      'zoomControl'
    ) {
      return;
    }

    gameShell.style.setProperty(
      '--ui-scale',
      event.target.value
    );

    const zoomControl =
      event.target.closest(
        '.zoom-control'
      );

    const output =
      zoomControl?.querySelector(
        'output'
      );

    if (output) {
      output.textContent =
        `${Math.round(
          Number(
            event.target.value
          ) *
          100
        )}%`;
    }
  }
);


/* =========================================================
   KEYBOARD
   ========================================================= */

document.addEventListener(
  'keydown',

  (event) => {
    if (
      event.target.closest(
        '.wormhole-overlay'
      ) ||

      event.target.closest(
        '.pilot-login-overlay'
      )
    ) {
      return;
    }

    const key =
      keyName(
        event
      );

    const isControl =
      Object.values(
        controls
      ).some(
        (set) =>
          Object.values(
            set
          ).includes(
            key
          )
      );

    if (isControl) {
      event.preventDefault();
    }

    keys.add(
      key
    );

    hasStarted =
      true;

    startHint.classList.add(
      'hidden'
    );

    canvas.focus();
  },

  true
);


document.addEventListener(
  'keyup',

  (event) => {
    if (
      event.target.closest(
        '.wormhole-overlay'
      ) ||

      event.target.closest(
        '.pilot-login-overlay'
      )
    ) {
      return;
    }

    keys.delete(
      keyName(
        event
      )
    );
  },

  true
);


window.addEventListener(
  'blur',

  () => {
    keys.clear();
  }
);


/* =========================================================
   RESIZE
   ========================================================= */

/*
 * Resize the current world without resetting the game.
 *
 * IMPORTANT:
 *
 * Do NOT call reset() here.
 *
 * reset() intentionally starts a new game and resets the
 * synchronized asteroid director.
 */
window.addEventListener(
  'resize',

  () => {
    resize();

    camera.update(
      world.ships,
      width,
      height,
      worldWidth,
      worldHeight
    );
  }
);


/* =========================================================
   START
   ========================================================= */

resize();

reset();

requestAnimationFrame(
  frame
);
