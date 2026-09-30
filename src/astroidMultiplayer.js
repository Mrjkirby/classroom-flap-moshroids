/*
 * MOSHROIDS — ASTEROID MULTIPLAYER SYSTEM
 *
 * Coordinates shared asteroid destruction between:
 *
 *   local game world
 *        ↓
 *   asteroidMultiplayer.js
 *        ↓
 *   asteroidNetwork.js
 *        ↓
 *      Firebase
 *
 * Owns:
 * - pending asteroid destruction IDs
 * - processed asteroid destruction IDs
 * - applying remote destruction events to the local world
 * - requesting authoritative shared destruction
 *
 * Does NOT own:
 * - Firebase implementation
 * - asteroid construction
 * - asteroid difficulty
 * - asteroid respawn timing
 * - asteroid movement
 * - scoring
 */

import {
  destroySharedAsteroid,
  getDestroyedAsteroids
} from './asteroidNetwork.js';


/* =========================================================
   FACTORY
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


  /* =======================================================
     LOCAL SYNCHRONIZATION STATE
     ======================================================= */

  /*
   * pending:
   *
   * An asteroid has already been removed locally and an
   * authoritative Firebase destruction claim is currently
   * in flight.
   *
   * This prevents multiple bullets in the same browser from
   * attempting to destroy the same asteroid.
   */
  const pending =
    new Set();


  /*
   * processed:
   *
   * Destruction records already applied to this browser.
   *
   * Firebase retains destruction history, so without this
   * set the same record would be processed every frame.
   */
  const processed =
    new Set();


  /* =======================================================
     FIELD RESET
     ======================================================= */

  /*
   * Called whenever asteroidDirector replaces the entire
   * deterministic asteroid field.
   *
   * The Firebase destruction history itself is NOT cleared
   * here. That is a separate room-wide network operation.
   */
  function resetField() {
    pending.clear();
    processed.clear();
  }


  /* =======================================================
     PENDING QUERY
     ======================================================= */

  /*
   * CollisionSystem uses this instead of receiving direct
   * access to the pending Set.
   */
  function isPending(
    asteroidId
  ) {
    if (!asteroidId) {
      return false;
    }

    return pending.has(
      asteroidId
    );
  }


  /* =======================================================
     REMOTE DESTRUCTION SYNCHRONIZATION
     ======================================================= */

  /*
   * Applies authoritative destruction records received from
   * asteroidNetwork.js to this browser's local asteroid
   * world.
   */
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
        /*
         * This destruction record has already been applied
         * locally.
         */
        if (
          processed.has(
            asteroidId
          )
        ) {
          return;
        }


        /*
         * Every browser deterministically creates the same
         * asteroid IDs, so the authoritative destruction ID
         * is sufficient to locate the local asteroid.
         */
        const asteroidIndex =
          world.asteroids.findIndex(
            (asteroid) =>
              asteroid.id ===
              asteroidId
          );


        /*
         * The asteroid may already be absent locally because
         * this browser initiated the destruction.
         *
         * Only create the remote destruction explosion when
         * the asteroid still exists in this world.
         */
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


        /*
         * Whether the asteroid was present or already gone,
         * this authoritative record has now been consumed.
         */
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
     LOCAL ASTEROID DESTRUCTION
     ======================================================= */

  /*
   * Removes an asteroid optimistically from the local world
   * and then asks asteroidNetwork.js to atomically establish
   * authoritative destruction ownership.
   *
   * Returns:
   *
   * true
   *   This browser won the Firebase destruction transaction.
   *
   * false
   *   Another browser already destroyed the asteroid, the
   *   asteroid was already pending locally, or the network
   *   operation could not be confirmed.
   *
   * CollisionSystem uses the true result to determine which
   * browser receives destruction score.
   */
  async function destroy(
    asteroid,
    color = '#f1f0ea'
  ) {
    if (
      !asteroid ||
      !asteroid.id
    ) {
      return false;
    }

    const asteroidId =
      asteroid.id;


    /*
     * Prevent duplicate local destruction requests while an
     * authoritative claim for this asteroid is in flight.
     */
    if (
      pending.has(
        asteroidId
      )
    ) {
      return false;
    }


    /*
     * If Firebase has already told us this asteroid was
     * destroyed, there is nothing left to claim.
     */
    const alreadyDestroyed =
      getDestroyedAsteroids();

    if (
      alreadyDestroyed.has(
        asteroidId
      )
    ) {
      processed.add(
        asteroidId
      );

      const existingIndex =
        world.asteroids.findIndex(
          (candidate) =>
            candidate.id ===
            asteroidId
        );

      if (
        existingIndex >= 0
      ) {
        world.asteroids.splice(
          existingIndex,
          1
        );
      }

      return false;
    }


    pending.add(
      asteroidId
    );


    /*
     * Remove immediately from the local simulation.
     *
     * This prevents another bullet or ship collision from
     * interacting with the same asteroid while Firebase
     * resolves the authoritative transaction.
     */
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


    /*
     * Local visual feedback happens immediately rather than
     * waiting for network round-trip latency.
     */
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


      /*
       * A false transaction result is normal when another
       * browser won the race for the same asteroid.
       */
      if (
        !wonDestruction
      ) {
        const shared =
          getDestroyedAsteroids();

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


      /*
       * The asteroid has already been removed locally, so
       * prevent the later Firebase listener record from
       * generating a duplicate explosion.
       */
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


  /* =======================================================
     PUBLIC API
     ======================================================= */

  return {
    destroy,
    isPending,
    resetField,
    sync
  };
}
