/*
 * MOSHROIDS — SHARED GUN DROPS
 *
 * Firebase responsibilities:
 * - listen for available gun drops
 * - publish dropped guns
 * - atomically award pickup ownership
 * - remove expired drops
 *
 * This module does NOT:
 * - change the local player's gun count
 * - detect ship/drop collision
 * - draw drops
 * - create weapon emitters
 *
 * gunDropSystem.js coordinates this network layer with weaponSystem.js.
 */

import {
  getDatabase,
  ref,
  update,
  remove,
  onValue,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js';


const ROOM_ID = 'classroom';
const ROOM_PATH =
  `moshroids/rooms/${ROOM_ID}`;

const GUN_DROPS_PATH =
  `${ROOM_PATH}/gunDrops`;

const GUN_DROP_LIFETIME =
  10000;


let remoteGunDrops =
  new Map();

let unsubscribeGunDrops =
  null;

let getCurrentUser =
  () => null;


/* =========================================================
   INITIALIZATION
   ========================================================= */

export function configureGunDropMultiplayer({
  currentUser
}) {
  if (
    typeof currentUser !==
    'function'
  ) {
    throw new Error(
      'GunDropMultiplayer requires a currentUser getter.'
    );
  }

  getCurrentUser =
    currentUser;
}


/* =========================================================
   LISTENER
   ========================================================= */

export function startGunDropListener() {
  if (
    unsubscribeGunDrops
  ) {
    unsubscribeGunDrops();
  }

  const database =
    getDatabase();

  const dropsRef =
    ref(
      database,
      GUN_DROPS_PATH
    );

  unsubscribeGunDrops =
    onValue(
      dropsRef,

      (snapshot) => {
        const data =
          snapshot.val() ||
          {};

        const nextDrops =
          new Map();

        Object.entries(
          data
        ).forEach(
          ([id, drop]) => {
            if (
              !drop ||
              typeof drop.x !==
                'number' ||
              typeof drop.y !==
                'number'
            ) {
              return;
            }

            /*
             * A claimed drop is immediately unavailable,
             * even if Firebase cleanup has not removed its
             * node yet.
             */
            if (
              drop.claimedBy
            ) {
              return;
            }

            const createdAt =
              Number(
                drop.createdAt
              ) ||
              Date.now();

            const expiresAt =
              Number(
                drop.expiresAt
              ) ||
              createdAt +
                GUN_DROP_LIFETIME;

            nextDrops.set(
              id,
              {
                id,

                ownerUid:
                  String(
                    drop.ownerUid ||
                    ''
                  ),

                x:
                  drop.x,

                y:
                  drop.y,

                radius:
                  Number(
                    drop.radius
                  ) ||
                  8,

                createdAt,
                expiresAt
              }
            );
          }
        );

        remoteGunDrops =
          nextDrops;
      },

      (error) => {
        console.error(
          'Moshroids gun-drop listener failed:',
          error
        );
      }
    );
}


/* =========================================================
   PUBLISH DROPS
   ========================================================= */

export async function publishGunDrops(
  drops
) {
  const currentUser =
    getCurrentUser();

  if (
    !currentUser ||
    !Array.isArray(
      drops
    ) ||
    !drops.length
  ) {
    return false;
  }

  const database =
    getDatabase();

  const writes = {};

  const now =
    Date.now();

  drops.forEach(
    (drop) => {
      if (
        !drop?.id
      ) {
        return;
      }

      writes[
        `${GUN_DROPS_PATH}/${drop.id}`
      ] = {
        ownerUid:
          currentUser.uid,

        x:
          Number(
            drop.x
          ) ||
          0,

        y:
          Number(
            drop.y
          ) ||
          0,

        radius:
          Number(
            drop.radius
          ) ||
          8,

        createdAt:
          now,

        expiresAt:
          now +
          GUN_DROP_LIFETIME,

        claimedBy:
          null
      };
    }
  );

  if (
    !Object.keys(
      writes
    ).length
  ) {
    return false;
  }

  try {
    await update(
      ref(
        database
      ),
      writes
    );

    return true;
  } catch (error) {
    console.error(
      'Moshroids gun-drop publish failed:',
      error
    );

    return false;
  }
}


/* =========================================================
   ATOMIC PICKUP CLAIM
   ========================================================= */

export async function claimGunDrop(
  dropId
) {
  const currentUser =
    getCurrentUser();

  if (
    !currentUser ||
    !dropId
  ) {
    return false;
  }

  const database =
    getDatabase();

  const dropRef =
    ref(
      database,
      `${GUN_DROPS_PATH}/${dropId}`
    );

  try {
    const result =
      await runTransaction(
        dropRef,

        (drop) => {
          if (!drop) {
            return undefined;
          }

          if (
            drop.claimedBy
          ) {
            return undefined;
          }

          const expiresAt =
            Number(
              drop.expiresAt
            ) ||
            0;

          if (
            expiresAt > 0 &&
            Date.now() >=
              expiresAt
          ) {
            return undefined;
          }

          return {
            ...drop,

            claimedBy:
              currentUser.uid,

            claimedAt:
              Date.now()
          };
        },

        {
          applyLocally:
            false
        }
      );

    if (
      !result.committed
    ) {
      return false;
    }

    const claimedDrop =
      result.snapshot.val();

    if (
      !claimedDrop ||
      claimedDrop.claimedBy !==
        currentUser.uid
    ) {
      return false;
    }

    /*
     * Ownership has already been atomically established.
     *
     * Removal is cleanup only. A cleanup failure must NOT
     * revoke the successful pickup.
     */
    try {
      await remove(
        dropRef
      );
    } catch (error) {
      console.warn(
        'Gun was claimed but Firebase cleanup was delayed:',
        error
      );
    }

    return true;
  } catch (error) {
    console.error(
      'Moshroids gun pickup failed:',
      error
    );

    return false;
  }
}


/* =========================================================
   EXPIRED DROP CLEANUP
   ========================================================= */

export async function removeExpiredGunDrop(
  dropId
) {
  const currentUser =
    getCurrentUser();

  if (
    !currentUser ||
    !dropId
  ) {
    return false;
  }

  const drop =
    remoteGunDrops.get(
      dropId
    );

  if (
    !drop ||
    Date.now() <
      drop.expiresAt
  ) {
    return false;
  }

  const database =
    getDatabase();

  try {
    await remove(
      ref(
        database,
        `${GUN_DROPS_PATH}/${dropId}`
      )
    );

    return true;
  } catch (error) {
    console.error(
      'Moshroids expired gun cleanup failed:',
      error
    );

    return false;
  }
}


/* =========================================================
   READ
   ========================================================= */

export function getGunDrops() {
  return remoteGunDrops;
}


/* =========================================================
   CLEANUP
   ========================================================= */

export function stopGunDropListener() {
  if (
    unsubscribeGunDrops
  ) {
    unsubscribeGunDrops();

    unsubscribeGunDrops =
      null;
  }

  remoteGunDrops.clear();
}
