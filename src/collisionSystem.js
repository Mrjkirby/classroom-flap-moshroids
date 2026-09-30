import {
  wrappedDelta,
  wrappedDistance
} from './physics.js';


/* =========================================================
   COLLISION SYSTEM

   Owns collision detection and collision resolution.

   Does NOT own:
   - world state
   - asteroid construction
   - asteroid multiplayer state
   - Firebase
   - player respawning
   - rendering
   - weapon firing

   Those dependencies are injected by game.js.
   ========================================================= */


/* =========================================================
   SWEPT CIRCLE COLLISION
   ========================================================= */

/*
 * Tests a moving object's path during the current frame
 * against a circular target.
 *
 * This prevents fast bullets from tunnelling through
 * targets between frames.
 *
 * moving.previousX / previousY:
 * position before its most recent update.
 *
 * moving.x / y:
 * position after its most recent update.
 */
function sweptCircleHit(
  moving,
  target,
  worldWidth,
  worldHeight
) {
  const combinedRadius =
    (moving.radius || 0) +
    (target.radius || 0);

  /*
   * If previous position is unavailable, fall back to
   * normal wrapped-circle collision.
   */
  if (
    !Number.isFinite(
      moving.previousX
    ) ||
    !Number.isFinite(
      moving.previousY
    )
  ) {
    return (
      wrappedDistance(
        moving,
        target,
        worldWidth,
        worldHeight
      ) <= combinedRadius
    );
  }

  const previous = {
    x: moving.previousX,
    y: moving.previousY
  };

  /*
   * Movement taken by the projectile during this frame,
   * expressed using the shortest wrapped displacement.
   */
  const movement =
    wrappedDelta(
      previous,
      moving,
      worldWidth,
      worldHeight
    );

  /*
   * Target position relative to the projectile's previous
   * position, also using wrapped world geometry.
   */
  const targetDelta =
    wrappedDelta(
      previous,
      target,
      worldWidth,
      worldHeight
    );

  const segmentLengthSquared =
    movement.x *
      movement.x +
    movement.y *
      movement.y;

  /*
   * Projectile did not meaningfully move this frame.
   */
  if (
    segmentLengthSquared <=
    Number.EPSILON
  ) {
    return (
      Math.hypot(
        targetDelta.x,
        targetDelta.y
      ) <= combinedRadius
    );
  }

  /*
   * Project the target onto the projectile's movement
   * segment and clamp the result to the frame path.
   */
  let t =
    (
      targetDelta.x *
        movement.x +
      targetDelta.y *
        movement.y
    ) /
    segmentLengthSquared;

  t =
    Math.max(
      0,
      Math.min(
        1,
        t
      )
    );

  const closestX =
    movement.x *
    t;

  const closestY =
    movement.y *
    t;

  const dx =
    targetDelta.x -
    closestX;

  const dy =
    targetDelta.y -
    closestY;

  return (
    dx * dx +
    dy * dy <=
    combinedRadius *
      combinedRadius
  );
}


/* =========================================================
   FACTORY
   ========================================================= */

export function createCollisionSystem({
  world,

  getWorldWidth,
  getWorldHeight,

  destroyAsteroid,
  isAsteroidDestructionPending,

  playerDestroyed,

  addExplosion,
  addRockExplosion,

  releaseMissiles,
  advanceAsteroidsFromMrK,

  updateScores,
  publishPlayerState
}) {
  if (!world) {
    throw new Error(
      'CollisionSystem requires world.'
    );
  }

  if (
    typeof getWorldWidth !==
    'function'
  ) {
    throw new Error(
      'CollisionSystem requires getWorldWidth.'
    );
  }

  if (
    typeof getWorldHeight !==
    'function'
  ) {
    throw new Error(
      'CollisionSystem requires getWorldHeight.'
    );
  }

  if (
    typeof destroyAsteroid !==
    'function'
  ) {
    throw new Error(
      'CollisionSystem requires destroyAsteroid.'
    );
  }

  if (
    typeof isAsteroidDestructionPending !==
    'function'
  ) {
    throw new Error(
      'CollisionSystem requires isAsteroidDestructionPending.'
    );
  }

  if (
    typeof playerDestroyed !==
    'function'
  ) {
    throw new Error(
      'CollisionSystem requires playerDestroyed.'
    );
  }

  if (
    typeof addExplosion !==
    'function'
  ) {
    throw new Error(
      'CollisionSystem requires addExplosion.'
    );
  }

  if (
    typeof addRockExplosion !==
    'function'
  ) {
    throw new Error(
      'CollisionSystem requires addRockExplosion.'
    );
  }

  if (
    typeof releaseMissiles !==
    'function'
  ) {
    throw new Error(
      'CollisionSystem requires releaseMissiles.'
    );
  }

  if (
    typeof advanceAsteroidsFromMrK !==
    'function'
  ) {
    throw new Error(
      'CollisionSystem requires advanceAsteroidsFromMrK.'
    );
  }

  if (
    typeof updateScores !==
    'function'
  ) {
    throw new Error(
      'CollisionSystem requires updateScores.'
    );
  }

  if (
    typeof publishPlayerState !==
    'function'
  ) {
    throw new Error(
      'CollisionSystem requires publishPlayerState.'
    );
  }


  /* =======================================================
     HELPERS
     ======================================================= */

  function worldWidth() {
    return getWorldWidth();
  }


  function worldHeight() {
    return getWorldHeight();
  }


  function circleHit(
    a,
    b
  ) {
    return (
      wrappedDistance(
        a,
        b,
        worldWidth(),
        worldHeight()
      ) <
      (a.radius || 0) +
        (b.radius || 0)
    );
  }


  function projectileHit(
    projectile,
    target
  ) {
    return sweptCircleHit(
      projectile,
      target,
      worldWidth(),
      worldHeight()
    );
  }


  /* =======================================================
     BULLET → MISSILE / ASTEROID
     ======================================================= */

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


      /* ---------------------------------------------------
         BULLET → MISSILE
         --------------------------------------------------- */

      const missileIndex =
        world.missiles.findIndex(
          (missile) =>
            projectileHit(
              bullet,
              missile
            )
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


      /* ---------------------------------------------------
         BULLET → ASTEROID
         --------------------------------------------------- */

      const asteroidIndex =
        world.asteroids.findIndex(
          (asteroid) =>
            !isAsteroidDestructionPending(
              asteroid.id
            ) &&
            projectileHit(
              bullet,
              asteroid
            )
        );

      if (
        asteroidIndex <
        0
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

      /*
       * Shared asteroid destruction is asynchronous.
       *
       * Scoring is awarded only to the browser that wins
       * authoritative destruction ownership.
       */
      Promise.resolve(
        destroyAsteroid(
          asteroid,

          bullet.owner === 'A'
            ? '#ff875f'
            : '#72e6dd'
        )
      )
        .then(
          (
            wonDestruction
          ) => {
            if (
              !wonDestruction ||
              bullet.owner !==
                'A'
            ) {
              return;
            }

            world.scores.A +=
              asteroidPoints;

            updateScores();

            publishPlayerState(
              true
            );
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


  /* =======================================================
     BULLET → MR. K
     ======================================================= */

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
        !projectileHit(
          bullet,
          world.mrK
        )
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
        world.mrK.health !==
        0
      ) {
        continue;
      }

      const mrKX =
        world.mrK.x;

      const mrKY =
        world.mrK.y;

      /*
       * MR. K must remain alive until his missiles are
       * created because releaseMissiles() reads world.mrK.
       */
      releaseMissiles();

      addRockExplosion(
        mrKX,
        mrKY
      );

      advanceAsteroidsFromMrK();

      world.mrK =
        null;

      world.mrKRespawnTimer =
        60;

      /*
       * MR. K no longer exists.
       * Remaining bullets cannot hit him this frame.
       */
      break;
    }
  }


  /* =======================================================
     BULLET → PLAYER
     ======================================================= */

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
            projectileHit(
              bullet,
              ship
            )
        );

      if (!target) {
        continue;
      }

      world.bullets.splice(
        bulletIndex,
        1
      );

      /*
       * Each browser remains authoritative for its own
       * local player's death.
       */
      if (
        target.owner ===
          'A' &&
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


  /* =======================================================
     MISSILE COLLISIONS
     ======================================================= */

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


      /* ---------------------------------------------------
         MISSILE → ROCK

         During outbound flight, missiles are intentionally
         allowed to escape MR. K before rock collision is
         activated.
         --------------------------------------------------- */

      const rockHit =
        !missile.outbound &&
        (
          world.asteroids.some(
            (asteroid) =>
              circleHit(
                missile,
                asteroid
              )
          ) ||

          (
            world.mrK &&
            circleHit(
              missile,
              world.mrK
            )
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


      /* ---------------------------------------------------
         MISSILE → LOCAL PLAYER
         --------------------------------------------------- */

      const target =
        world.ships.find(
          (ship) =>
            ship.owner ===
              'A' &&
            ship.visible &&
            circleHit(
              missile,
              ship
            )
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


  /* =======================================================
     LOCAL SHIP → ASTEROID / MR. K
     ======================================================= */

  function resolveLocalShipRockCollisions() {
    const localShip =
      world.ships.find(
        (ship) =>
          ship.owner ===
          'A'
      );

    if (
      !localShip ||
      !localShip.visible ||
      localShip.state !==
        'ACTIVE'
    ) {
      return;
    }


    /* ---------------------------------------------------
       SHIP → ASTEROID

       Ship dies.
       Asteroid survives.
       --------------------------------------------------- */

    const asteroid =
      world.asteroids.find(
        (candidate) =>
          circleHit(
            localShip,
            candidate
          )
      );

    if (asteroid) {
      if (
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
      }

      /*
       * Do not process MR. K against the same ship during
       * this collision pass.
       */
      return;
    }


    /* ---------------------------------------------------
       SHIP → MR. K
       --------------------------------------------------- */

    if (
      !world.mrK ||
      !localShip.visible
    ) {
      return;
    }

    if (
      !circleHit(
        localShip,
        world.mrK
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


  /* =======================================================
     RESOLVE ALL
     ======================================================= */

  function resolve() {
    resolveBulletRockCollisions();

    resolveBulletMrKCollisions();

    resolveBulletPlayerCollisions();

    resolveMissileCollisions();

    resolveLocalShipRockCollisions();
  }


  /* =======================================================
     PUBLIC API
     ======================================================= */

  return {
    resolve,

    resolveBulletRockCollisions,
    resolveBulletMrKCollisions,
    resolveBulletPlayerCollisions,
    resolveMissileCollisions,
    resolveLocalShipRockCollisions
  };
}


/* =========================================================
   TESTABLE GEOMETRY EXPORT
   ========================================================= */

export {
  sweptCircleHit
};
