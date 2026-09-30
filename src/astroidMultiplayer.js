import {
  destroySharedAsteroid,
  getDestroyedAsteroids
} from './multiplayer.js';


/* =========================================================
   ASTEROID MULTIPLAYER SYSTEM

   Owns:
   - pending asteroid destruction IDs
   - processed destruction IDs
   - applying remote destruction events to local world
   - requesting authoritative shared destruction

   Does NOT own:
   - asteroid construction
   - asteroid difficulty
   - asteroid respawn timing
   - asteroid movement
   - Firebase implementation
   ========================================================= */

export function createAsteroidMultiplayerSystem({
  world,
  isMultiplayerJoined,
  addExplosion
}) {
  if (!world) {
    throw new Error(
      'AsteroidMultiplayerSystem requires world.'
    );
  }

  if (
    typeof isMultiplayerJoined !==
    'function'
  ) {
    throw new Error(
      'AsteroidMultiplayerSystem requires isMultiplayerJoined.'
    );
  }

  if (
    typeof addExplosion !==
    'function'
  ) {
    throw new Error(
      'AsteroidMultiplayerSystem requires addExplosion.'
    );
  }


  const pending =
    new Set();

  const processed =
    new Set();


  /* =======================================================
     FIELD RESET
     ======================================================= */

  function resetField() {
    pending.clear();
    processed.clear();
  }


  /* =======================================================
     STATE
     ======================================================= */

  function isPending(
    asteroidId
  ) {
    return pending.has(
      asteroidId
    );
  }


  /* =======================================================
     REMOTE DESTRUCTION SYNCHRONIZATION
     ======================================================= */

  function sync() {
    if (
      !isMultiplayerJoined()
    ) {
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
          processed.has(
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

        processed.add(
          asteroidId
        );

        pending.delete(
          asteroidId
        );
      }
    );
  }


  /* =======================================================
     LOCAL DESTRUCTION
     ======================================================= */

  async function destroy(
    asteroid,
    color = '#f1f0ea'
  ) {
    if (
      !asteroid ||
      !asteroid.id ||
      pending.has(
        asteroid.id
      )
    ) {
      return false;
    }

    const asteroidId =
      asteroid.id;

    pending.add(
      asteroidId
    );

    const asteroidIndex =
      world.asteroids.findIndex(
        (candidate) =>
          candidate.id ===
          asteroidId
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
      const wonDestruction =
        await destroySharedAsteroid(
          asteroidId
        );

      if (
        !wonDestruction
      ) {
        const shared =
          getDestroyedAsteroids();

        /*
         * A false transaction result is valid when another
         * player already destroyed the same asteroid.
         */
        if (
          !shared.has(
            asteroidId
          )
        ) {
          console.warn(
            `Asteroid destruction was not confirmed: ${asteroidId}`
          );
        }
      }

      processed.add(
        asteroidId
      );

      return wonDestruction;
    } catch (error) {
      console.error(
        'Shared asteroid destruction failed:',
        error
      );

      return false;
    } finally {
      pending.delete(
        asteroidId
      );
    }
  }


  return {
    destroy,
    isPending,
    resetField,
    sync
  };
}
