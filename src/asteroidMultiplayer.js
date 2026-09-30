/*
 * MOSHROIDS — ASTEROID MULTIPLAYER SYSTEM
 *
 * Coordinates shared asteroid destruction between:
 *
 *   game.js
 *      ↓
 *   asteroidMultiplayer.js
 *      ↓
 *   asteroidNetwork.js
 *      ↓
 *   Firebase
 *
 * Owns:
 * - pending local destruction claims
 * - processed shared destruction records
 * - applying remote destruction to the local asteroid field
 * - requesting authoritative shared destruction
 *
 * Does NOT own:
 * - Firebase transport
 * - asteroid construction
 * - asteroid movement
 * - asteroid difficulty
 * - asteroid respawn timing
 * - scoring
 * - world ownership
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
  if (
    !world ||
    !Array.isArray(world.asteroids)
  ) {
    throw new Error(
      'AsteroidMultiplayerSystem requires world.asteroids.'
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
   * IDs currently being submitted for authoritative
   * destruction.
   *
   * Prevents duplicate destruction attempts from the same
   * browser while Firebase resolves the transaction.
   */
  const pending =
    new Set();


  /*
   * Shared destruction records already consumed by this
   * browser.
   *
   * Firebase retains destruction history, so this prevents
   * processing the same record every frame.
   */
  const processed =
    new Set();


  /* =======================================================
     HELPERS
     ======================================================= */

  function findAsteroidIndex(
    asteroidId
  ) {
    return world.asteroids.findIndex(
      (asteroid) =>
        asteroid.id ===
        asteroidId
    );
  }


  function removeLocalAsteroid(
    asteroidId
  ) {
    const asteroidIndex =
      findAsteroidIndex(
        asteroidId
      );

    if (
      asteroidIndex <
      0
    ) {
      return null;
    }

    const [
      asteroid
    ] =
      world.asteroids.splice(
        asteroidIndex,
        1
      );

    return (
      asteroid ||
      null
    );
  }


  /* =======================================================
     FIELD RESET
     ======================================================= */

  /*
   * Called whenever asteroidDirector replaces the complete
   * deterministic asteroid field.
   *
   * This resets only browser-local synchronization state.
   * It does NOT delete Firebase destruction history.
   */
  function resetField() {
    pending.clear();
    processed.clear();
  }


  /* =======================================================
     PENDING QUERY
     ======================================================= */

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
     SHARED DESTRUCTION SYNCHRONIZATION
     ======================================================= */

  /*
   * Apply authoritative Firebase destruction records to this
   * browser's local asteroid field.
   *
   * A locally initiated destruction has normally removed its
   * asteroid before the Firebase listener receives the record.
   * In that case no second explosion is created.
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
        if (
          processed.has(
            asteroidId
          )
        ) {
          return;
        }


        const asteroid =
          removeLocalAsteroid(
            asteroidId
          );


        /*
         * The asteroid still existed locally, so this browser
         * is learning about a destruction performed elsewhere.
         */
        if (asteroid) {
          addExplosion(
            asteroid.x,
            asteroid.y,
            '#f1f0ea',
            16,
            4
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

  /*
   * Attempt to destroy one asteroid.
   *
   * The asteroid disappears locally immediately so gameplay
   * does not wait on network latency.
   *
   * Firebase then atomically decides which browser owns the
   * authoritative destruction.
   *
   * Returns:
   *
   * true
   *   This browser won the authoritative destruction claim.
   *
   * false
   *   The asteroid was already destroyed, already pending,
   *   another browser won the claim, or Firebase could not
   *   confirm the destruction.
   *
   * CollisionSystem uses TRUE when deciding whether this
   * browser receives asteroid-destruction score.
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
     * Do not submit duplicate local claims.
     */
    if (
      pending.has(
        asteroidId
      )
    ) {
      return false;
    }


    /*
     * Firebase has already told us this asteroid was
     * destroyed.
     *
     * Remove any stale local copy but do not attempt another
     * transaction and do not award destruction ownership.
     */
    const sharedBeforeClaim =
      getDestroyedAsteroids();

    if (
      sharedBeforeClaim.has(
        asteroidId
      )
    ) {
      removeLocalAsteroid(
        asteroidId
      );

      processed.add(
        asteroidId
      );

      return false;
    }


    pending.add(
      asteroidId
    );


    /*
     * Optimistic local removal.
     *
     * This prevents bullets or ships from interacting with
     * the same asteroid while the Firebase transaction is
     * outstanding.
     */
    const removedAsteroid =
      removeLocalAsteroid(
        asteroidId
      );


    /*
     * Only produce the local explosion if this asteroid was
     * actually present in the local field.
     *
     * Normally removedAsteroid is the same object supplied
     * to destroy().
     */
    if (removedAsteroid) {
      addExplosion(
        removedAsteroid.x,
        removedAsteroid.y,
        color,
        16,
        4
      );
    }


    try {
      const wonDestruction =
        await destroySharedAsteroid(
          asteroidId
        );


      /*
       * A FALSE transaction result is valid when another
       * browser won the race.
       *
       * The Firebase listener can arrive slightly after the
       * transaction result, so absence from the local cache
       * here does not automatically mean an error.
       */
      if (
        !wonDestruction
      ) {
        const sharedAfterClaim =
          getDestroyedAsteroids();

        if (
          !sharedAfterClaim.has(
            asteroidId
          )
        ) {
          console.warn(
            `Asteroid destruction was not confirmed locally yet: ${asteroidId}`
          );
        }
      }


      /*
       * The asteroid has already been removed from this
       * browser. Mark the eventual shared record as consumed
       * so sync() cannot create a duplicate explosion.
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
