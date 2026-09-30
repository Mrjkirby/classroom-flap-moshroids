/*
 * MOSHROIDS — SHARED ASTEROID NETWORK
 *
 * Firebase responsibilities:
 * - listen for authoritative asteroid destruction records
 * - atomically claim asteroid destruction
 * - expose destruction history
 * - clear destruction history for a completely new round
 *
 * This module does NOT:
 * - own world.asteroids
 * - move asteroids
 * - create asteroids
 * - award points
 * - create explosions
 *
 * asteroidMultiplayer.js coordinates this network layer
 * with the local game world.
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
 * Authentication remains owned by multiplayer.js.
 *
 * We inject a getter rather than importing multiplayer.js,
 * avoiding a circular dependency.
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
   LISTENER
   ========================================================= */

export function startAsteroidListener() {
  if (
    unsubscribeDestroyedAsteroids
  ) {
    unsubscribeDestroyedAsteroids();
  }

  const database =
    getDatabase();

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
            if (!destruction) {
              return;
            }

            nextDestroyed.set(
              asteroidId,
              {
                asteroidId,

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
   DESTROY ASTEROID
   ========================================================= */

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

  const database =
    getDatabase();

  const asteroidRef =
    ref(
      database,
      `${DESTROYED_ASTEROIDS_PATH}/${asteroidId}`
    );

  try {
    const result =
      await runTransaction(
        asteroidRef,

        (current) => {
          /*
           * Another browser already won destruction
           * ownership.
           */
          if (current) {
            return undefined;
          }

          return {
            destroyedBy:
              currentUser.uid,

            destroyedAt:
              Date.now()
          };
        },

        {
          applyLocally:
            false
        }
      );

    return result.committed;
  } catch (error) {
    console.error(
      'Moshroids asteroid destruction failed:',
      error
    );

    return false;
  }
}


/* =========================================================
   QUERY
   ========================================================= */

export function isAsteroidDestroyed(
  asteroidId
) {
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
   RESET SHARED HISTORY
   ========================================================= */

export async function clearDestroyedAsteroids() {
  const currentUser =
    getCurrentUser();

  if (!currentUser) {
    return false;
  }

  const database =
    getDatabase();

  try {
    await remove(
      ref(
        database,
        DESTROYED_ASTEROIDS_PATH
      )
    );

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
