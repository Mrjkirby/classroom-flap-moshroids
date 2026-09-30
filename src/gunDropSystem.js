import { weaponSystem } from './weaponSystem.js';

import {
  claimGunDrop,
  getGunDrops,
  getLocalIdentity,
  publishGunDrops,
  removeExpiredGunDrop
} from './multiplayer.js';


const MAX_GUNS = 40;


/* =========================================================
   GUN DROP SYSTEM

   Coordinates:
   - weaponSystem local drop state
   - Firebase shared drop state
   - atomic pickup claims
   - gun loss on player death

   Does NOT own:
   - player death
   - rendering
   - Firebase implementation
   - weapon emitter geometry
   - world state
   ========================================================= */

export function createGunDropSystem({
  world,

  isMultiplayerJoined,

  addExplosion,

  publishPlayerState
}) {
  if (!world) {
    throw new Error(
      'GunDropSystem requires world.'
    );
  }

  let pickupInProgress =
    false;


  /* =======================================================
     PLAYER GUN DROP
     ======================================================= */

  async function dropLocalGuns(
    ship
  ) {
    if (!ship) {
      return false;
    }

    const identity =
      getLocalIdentity();

    if (!identity) {
      return false;
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

    /*
     * Death always returns the local player to one gun.
     *
     * This happens immediately. Firebase publication of the
     * dropped guns is allowed to finish asynchronously.
     */
    weaponSystem.setGunCount(
      1
    );

    if (!drops.length) {
      return true;
    }

    const published =
      await publishGunDrops(
        drops
      );

    if (!published) {
      console.warn(
        'Gun drops were created locally but were not confirmed by Firebase.'
      );
    }

    return published;
  }


  /* =======================================================
     FIREBASE DROP → LOCAL DROP
     ======================================================= */

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


  /* =======================================================
     SHARED DROP SYNCHRONIZATION
     ======================================================= */

  function syncGunDrops() {
    if (
      !isMultiplayerJoined()
    ) {
      return;
    }

    const sharedDrops =
      getGunDrops();

    const sharedIds =
      new Set(
        sharedDrops.keys()
      );


    /*
     * Add or update every currently available shared drop.
     */
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

          /*
           * Never extend the lifetime of an existing local
           * drop because of network timing.
           */
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


    /*
     * Remove local drops that Firebase no longer advertises.
     *
     * This includes:
     * - successfully claimed drops
     * - expired drops
     * - externally removed drops
     */
    for (
      const id of
      [
        ...weaponSystem.drops.keys()
      ]
    ) {
      if (
        !sharedIds.has(
          id
        )
      ) {
        weaponSystem.removeDrop(
          id
        );
      }
    }
  }


  /* =======================================================
     ATOMIC PICKUP
     ======================================================= */

  async function checkGunPickup() {
    if (
      !isMultiplayerJoined() ||
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
      MAX_GUNS
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

    /*
     * Save the visual position before awaiting Firebase.
     *
     * The shared listener may remove this drop from the local
     * map while claimGunDrop() is awaiting its transaction.
     */
    const pickupX =
      drop.x;

    const pickupY =
      drop.y;

    const dropId =
      drop.id;

    pickupInProgress =
      true;

    try {
      /*
       * Firebase transaction is authoritative.
       *
       * Only one browser can successfully claim this drop.
       */
      const claimed =
        await claimGunDrop(
          dropId
        );

      if (!claimed) {
        return;
      }

      /*
       * IMPORTANT:
       *
       * confirmPickup() must award the gun even if Firebase
       * synchronization has already removed the local drop.
       */
      const pickup =
        weaponSystem.confirmPickup(
          dropId
        );

      if (!pickup) {
        console.error(
          'Firebase confirmed gun ownership but weaponSystem failed to award it:',
          dropId
        );

        return;
      }

      addExplosion(
        pickupX,
        pickupY,
        '#ff3b30',
        9,
        2
      );

      publishPlayerState(
        true
      );
    } catch (error) {
      console.error(
        'Gun pickup failed:',
        error
      );
    } finally {
      pickupInProgress =
        false;
    }
  }


  /* =======================================================
     EXPIRATION
     ======================================================= */

  function cleanupExpiredDrops() {
    if (
      !isMultiplayerJoined()
    ) {
      return;
    }

    const now =
      Date.now();

    getGunDrops().forEach(
      (
        drop,
        id
      ) => {
        if (
          now <
          drop.expiresAt
        ) {
          return;
        }

        /*
         * Cleanup is intentionally fire-and-forget.
         *
         * Firebase is authoritative and the next listener
         * update reconciles local state.
         */
        removeExpiredGunDrop(
          id
        ).catch(
          (error) => {
            console.error(
              'Expired gun-drop cleanup failed:',
              error
            );
          }
        );
      }
    );
  }


  /* =======================================================
     UPDATE
     ======================================================= */

  function update() {
    if (
      !isMultiplayerJoined()
    ) {
      return;
    }

    syncGunDrops();

    cleanupExpiredDrops();

    /*
     * Do not await this in the frame loop.
     *
     * pickupInProgress prevents overlapping claims.
     */
    checkGunPickup();
  }


  /* =======================================================
     PUBLIC API
     ======================================================= */

  return {
    update,
    dropLocalGuns
  };
}
