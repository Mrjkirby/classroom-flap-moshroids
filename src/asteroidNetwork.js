/*
 * MOSHROIDS — SHARED ASTEROID NETWORK
 *
 * Firebase transport for ordinary asteroid destruction.
 *
 * Owns:
 * - authoritative asteroid-destruction listener
 * - atomic destruction claims
 * - local cache of shared destruction records
 * - room-wide destruction-history clearing
 * - listener cleanup
 *
 * Does NOT own:
 * - world.asteroids
 * - asteroid construction
 * - asteroid movement
 * - asteroid difficulty
 * - asteroid respawn
 * - collisions
 * - scoring
 * - explosions
 *
 * Flow:
 *
 * asteroidMultiplayer.js
 *          ↓
 * asteroidNetwork.js
 *          ↓
 *       Firebase
 *
 * Authentication remains owned by multiplayer.js.
 * multiplayer.js injects a current-user getter here so this
 * module does not need to import multiplayer.js and create a
 * circular dependency.
 */

import {
  getDatabase,
  ref,
  remove,
  onValue,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js';


/* =========================================================
   ROOM
   ========================================================= */

const ROOM_ID =
  'classroom';

const ROOM_PATH =
  `moshroids/rooms/${ROOM_ID}`;

const DESTROYED_ASTEROIDS_PATH =
  `${ROOM_PATH}/destroyedAsteroids`;


/* =========================================================
   STATE
   ========================================================= */

let destroyedAsteroids =
  new Map();

let unsubscribeDestroyedAsteroids =
  null;


/*
 * Authentication is owned by multiplayer.js.
 *
 * multiplayer.js configures this after Firebase initialization:
 *
 * configureAsteroidNetwork({
 *   currentUser: () => currentUser
 * });
 */

let getCurrentUser =
  () => null;


/* =========================================================
   CONFIGURATION
   ========================================================= */

export function configureAsteroidNetwork({
  currentUser
}) {
  if (
    typeof currentUser !==
    'function'
  ) {
    throw new Error(
      'AsteroidNetwork requires a currentUser getter.'
    );
  }

  getCurrentUser =
    currentUser;
}


/* =========================================================
   DATABASE
   ========================================================= */

/*
 * multiplayer.js initializes the default Firebase application
 * before these functions are called.
 *
 * Therefore getDatabase() resolves that initialized default
 * application without importing multiplayer.js.
 */

function getRoomDatabase() {
  return getDatabase();
}


/* =========================================================
   SHARED DESTRUCTION LISTENER
   ========================================================= */

export function startAsteroidListener() {
  /*
   * Never leave two listeners attached if multiplayer is
   * rejoined in the same browser session.
   */

  if (
    unsubscribeDestroyedAsteroids
  ) {
    unsubscribeDestroyedAsteroids();

    unsubscribeDestroyedAsteroids =
      null;
  }


  const database =
    getRoomDatabase();


  const asteroidRef =
    ref(
      database,
      DESTROYED_ASTEROIDS_PATH
    );


  unsubscribeDestroyedAsteroids =
    onValue(
      asteroidRef,

      (snapshot) => {
        const data =
          snapshot.val() ||
          {};


        const nextDestroyed =
          new Map();


        Object.entries(
          data
        ).forEach(
          (
            [
              asteroidId,
              destruction
            ]
          ) => {
            if (
              !asteroidId ||
              !destruction
            ) {
              return;
            }


            nextDestroyed.set(
              String(
                asteroidId
              ),

              {
                asteroidId:
                  String(
                    asteroidId
                  ),

                destroyedBy:
                  String(
                    destruction.destroyedBy ||
                    ''
                  ),

                destroyedAt:
                  Number(
                    destruction.destroyedAt
                  ) ||
                  0
              }
            );
          }
        );


        destroyedAsteroids =
          nextDestroyed;
      },

      (error) => {
        console.error(
          'Moshroids asteroid listener failed:',
          error
        );
      }
    );
}


/* =========================================================
   AUTHORITATIVE DESTRUCTION CLAIM
   ========================================================= */

/*
 * Attempts to create exactly one destruction record for the
 * supplied asteroid ID.
 *
 * Firebase transaction semantics make the operation atomic.
 *
 * If two browsers shoot the same asteroid:
 *
 * Browser A ─┐
 *            ├── Firebase transaction
 * Browser B ─┘
 *
 * only one browser can create the record.
 *
 * Returns:
 *
 * true
 *   This browser created the authoritative destruction record.
 *
 * false
 *   The asteroid was already destroyed, authentication was
 *   unavailable, the ID was invalid, or Firebase failed.
 */

export async function destroySharedAsteroid(
  asteroidId
) {
  const currentUser =
    getCurrentUser();


  if (
    !currentUser ||
    !asteroidId
  ) {
    return false;
  }


  const normalizedId =
    String(
      asteroidId
    );


  const database =
    getRoomDatabase();


  const asteroidRef =
    ref(
      database,

      `${DESTROYED_ASTEROIDS_PATH}/${normalizedId}`
    );


  try {
    const result =
      await runTransaction(
        asteroidRef,

        (current) => {
          /*
           * Existing value means another browser has already
           * established authoritative destruction ownership.
           */

          if (current) {
            return undefined;
          }


          /*
           * Preserve the exact shared record structure used
           * by the original multiplayer implementation.
           */

          return {
            destroyedBy:
              currentUser.uid,

            destroyedAt:
              Date.now()
          };
        },

        {
          /*
           * Do not temporarily pretend locally that this
           * browser won before Firebase resolves the race.
           */

          applyLocally:
            false
        }
      );


    return (
      result.committed ===
      true
    );

  } catch (error) {
    console.error(
      'Moshroids asteroid destruction failed:',
      error
    );

    return false;
  }
}


/* =========================================================
   SHARED STATE QUERY
   ========================================================= */

export function isAsteroidDestroyed(
  asteroidId
) {
  if (!asteroidId) {
    return false;
  }


  return destroyedAsteroids.has(
    String(
      asteroidId
    )
  );
}


export function getDestroyedAsteroids() {
  return destroyedAsteroids;
}


/* =========================================================
   ROOM-WIDE DESTRUCTION RESET
   ========================================================= */

/*
 * Clears the entire room's authoritative asteroid-destruction
 * history.
 *
 * IMPORTANT:
 *
 * This is NOT a normal asteroid respawn operation.
 *
 * Do not call this when:
 * - one asteroid respawns
 * - MR. K respawns
 * - a local player respawns
 * - a browser joins
 *
 * It is intended only when the entire shared room needs a
 * genuinely fresh destruction history.
 */

export async function clearDestroyedAsteroids() {
  const currentUser =
    getCurrentUser();


  if (!currentUser) {
    return false;
  }


  const database =
    getRoomDatabase();


  try {
    await remove(
      ref(
        database,
        DESTROYED_ASTEROIDS_PATH
      )
    );


    /*
     * The Firebase listener should also receive the removal,
     * but clearing immediately avoids retaining stale local
     * state while that event propagates.
     */

    destroyedAsteroids.clear();


    return true;

  } catch (error) {
    console.error(
      'Moshroids asteroid reset failed:',
      error
    );

    return false;
  }
}


/* =========================================================
   CLEANUP
   ========================================================= */

export function stopAsteroidListener() {
  if (
    unsubscribeDestroyedAsteroids
  ) {
    unsubscribeDestroyedAsteroids();

    unsubscribeDestroyedAsteroids =
      null;
  }


  destroyedAsteroids.clear();
}
