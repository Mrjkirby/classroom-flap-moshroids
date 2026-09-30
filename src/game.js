import { asteroidDirector, BASE_ASTEROID_COUNT } from './asteroidDirector.js';
import { createAsteroidMultiplayerSystem } from './asteroidMultiplayer.js';
import { Bullet } from './bullet.js';
import { Camera } from './camera.js';
import { createCollisionSystem } from './collisionSystem.js';
import { createGunDropSystem } from './gunDropSystem.js';
import { HomingMissile } from './homingMissile.js';
import { MrKRock } from './mrKRock.js';
import { SafeZones } from './safeZone.js';
import { Ship } from './ship.js';
import { SpellingChallengeController } from './spellingController.js';
import { weaponSystem } from './weaponSystem.js';
import { sharedClock } from './sharedClock.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from './worldConfig.js';
import { destroySharedAsteroid, getDestroyedAsteroids } from './asteroidNetwork.js';

import {
  drawWrapped,
  normalizeDelta,
  random
} from './physics.js';

import {
  bindPilotLogin,
  getRemotePlayers,
  publishLocalState,
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

  worldWidth = WORLD_WIDTH;
  worldHeight = WORLD_HEIGHT;

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
        random(
          1,
          spread
        ),

      velocityY:
        Math.sin(angle) *
        random(
          1,
          spread
        ),

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
   ASTEROID MULTIPLAYER SYSTEM
   ========================================================= */

const asteroidMultiplayer =
  createAsteroidMultiplayerSystem({
    world,

    isMultiplayerJoined:
      () =>
        multiplayerJoined,

    addExplosion
  });

let lastFieldRecords = null;
let lastFieldEpoch = -1;
let lastFieldSlot = -1;


/* =========================================================
   ASTEROID FIELD ORCHESTRATION
   ========================================================= */

function replaceAsteroidField(
  count = asteroidDirector.getCap(),
  now = sharedClock.now()
) {
  world.asteroids =
    asteroidDirector.createField(
      worldWidth,
      worldHeight,
      count,
      now
    );

  asteroidMultiplayer.resetField();
}


function updateAsteroidRespawn(now) {
  const records = getDestroyedAsteroids();
  const epoch = asteroidDirector.getEpochNumber(now);
  const slot = asteroidDirector.getRespawnSlot(now);
  if (records === lastFieldRecords && epoch === lastFieldEpoch &&
    slot === lastFieldSlot) return;

  const previousGeneration = asteroidDirector.fieldGeneration;
  const previousEpoch = asteroidDirector.currentEpoch;
  world.asteroids = asteroidDirector.reconstructField(
    worldWidth, worldHeight, now, records
  ).filter(asteroid => !asteroidMultiplayer.isPending(asteroid.id));

  if (previousEpoch !== asteroidDirector.currentEpoch ||
    previousGeneration !== asteroidDirector.fieldGeneration) {
    asteroidMultiplayer.resetField();
    if (previousEpoch === asteroidDirector.currentEpoch &&
      asteroidDirector.fieldGeneration > previousGeneration) {
      world.mrK = null;
      world.mrKRespawnTimer = Math.max(
        0, 60 - (now - asteroidDirector.fieldSpawnTimestamp) / 1000);
    }
  }
  lastFieldRecords = records;
  lastFieldEpoch = epoch;
  lastFieldSlot = asteroidDirector.getRespawnSlot(now);
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


function advanceAsteroidsFromMrK() {
  const eventId = `epoch-${asteroidDirector.currentEpoch}-mrk-${asteroidDirector.fieldGeneration}`;
  destroySharedAsteroid(eventId).then(won => {
    if (!won) console.warn('MR. K field advance was not confirmed:', eventId);
  });
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

  gunDropSystem
    .dropLocalGuns(
      ship
    )
    .catch(
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
          Math.cos(
            angle
          ) *
          world.mrK.radius,

        world.mrK.y +
          Math.sin(
            angle
          ) *
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

        ship.remote =
          true;

        world.ships.push(
          ship
        );
      }

      ship.remote =
        true;

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
   GUN DROP SYSTEM
   ========================================================= */

const gunDropSystem =
  createGunDropSystem({
    world,

    isMultiplayerJoined:
      () =>
        multiplayerJoined,

    addExplosion,

    publishPlayerState
  });


/* =========================================================
   COLLISION SYSTEM
   ========================================================= */

const collisionSystem =
  createCollisionSystem({
    world,

    getWorldWidth:
      () =>
        worldWidth,

    getWorldHeight:
      () =>
        worldHeight,

    destroyAsteroid:
      asteroidMultiplayer.destroy,

    isAsteroidDestructionPending:
      asteroidMultiplayer.isPending,

    playerDestroyed,

    addExplosion,
    addRockExplosion,

    releaseMissiles,

    advanceAsteroidsFromMrK,

    updateScores,

    publishPlayerState
  });


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

  asteroidDirector.reset(sharedClock.now());
  lastFieldRecords = null;
  lastFieldEpoch = -1;
  lastFieldSlot = -1;

  replaceAsteroidField(
    BASE_ASTEROID_COUNT
  );

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

function updateAsteroids(now) {
  updateAsteroidRespawn(now);

  world.asteroids.forEach(
    (asteroid) =>
      asteroid.update(
        now,
        worldWidth,
        worldHeight
      )
  );

  if (!safeZones) {
    return;
  }

  const safeZoneHits =
    world.asteroids.filter(
      (asteroid) =>
        safeZones.hitsAsteroid(
          asteroid
        )
    );

  safeZoneHits.forEach(
    (asteroid) => {
      asteroidMultiplayer
        .destroy(
          asteroid,
          '#f1f0ea'
        )
        .catch(
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
    world.mrKRespawnTimer <=
    0
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
          missile.life <=
          0
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
          missile.life >
          0
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
        particle.life >
        0
    );
}


/* =========================================================
   UPDATE
   ========================================================= */

function update(dt, sharedNow) {
  syncRemoteShips(
    dt
  );

  asteroidMultiplayer.sync();

  gunDropSystem.update();

  updateShips(
    dt
  );

  updateBullets(
    dt
  );

  updateAsteroids(sharedNow);

  updateMrK(
    dt
  );

  updateMissiles(
    dt
  );

  updateParticles(
    dt
  );

  collisionSystem.resolve();

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
      dt,
      sharedClock.now()
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
        ship?.visible !==
        false,

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

    asteroidMultiplayer.sync();

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
