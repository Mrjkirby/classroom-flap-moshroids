import { weaponSystem } from './weaponSystem.js';

import {
  claimGunDrop,
  getGunDrops,
  publishGunDrops,
  removeExpiredGunDrop
} from './gunDropMultiplayer.js';

import {
  getLocalIdentity
} from './multiplayer.js';


const MAX_GUNS = 40;


/* =========================================================
   GUN DROP SYSTEM

   Coordinates:
   - weaponSystem local drop state
   - shared Firebase gun-drop state
   - atomic pickup claims
   - gun loss on player death

   Does NOT own:
   - player death
   - rendering
   - Firebase implementation
   - weapon emitter geometry
   - player authentication
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

  if (
    typeof isMultiplayerJoined !==
    'function'
  ) {
    throw new Error(
      'GunDropSystem requires isMultiplayerJoined.'
    );
  }

  if (
    typeof addExplosion !==
    'function'
  ) {
    throw new Error(
      'GunDropSystem requires addExplosion.'
    );
  }

  if (
    typeof publishPlayerState !==
    'function'
  ) {
    throw new Error(
      'GunDropSystem requires publishPlayerState.'
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
     * Death immediately resets the local player's weapon
     * count to the starting gun.
     *
     * Firebase publication is network persistence only and
     * must not delay the local death sequence.
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

      /*
       * weaponSystem uses the local performance clock.
       * Firebase timestamps use the wall clock.
       *
       * Convert the remaining lifetime rather than mixing
       * the two clock domains.
       */
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
     * Mirror every currently available Firebase drop into
     * weaponSystem's local render/pickup collection.
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
           * Network refreshes must never accidentally extend
           * an already-running local expiration timer.
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
     * Firebase is authoritative for drop availability.
     *
     * A drop disappearing from the shared collection means
     * it was claimed, expired, or otherwise removed.
     */
    for (
      const id of
      [
        ...weaponSystem.drops.keys()
      ]
    ) {
      if (
        sharedIds.has(
          id
        )
      ) {
        continue;
      }

      weaponSystem.removeDrop(
        id
      );
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
     * Preserve everything needed after the await.
     *
     * Firebase's listener can remove the local drop as soon
     * as the transaction marks it claimed.
     */
    const dropId =
      drop.id;

    const pickupX =
      drop.x;

    const pickupY =
      drop.y;


    pickupInProgress =
      true;

    try {
      /*
       * Firebase transaction is authoritative.
       *
       * If two students hit the same dropped gun, exactly
       * one transaction can win.
       */
      const claimed =
        await claimGunDrop(
          dropId
        );

      if (!claimed) {
        return;
      }


      /*
       * CRITICAL RACE FIX
       *
       * The Firebase listener may already have removed this
       * drop from weaponSystem.drops.
       *
       * A successful Firebase claim is nevertheless proof
       * that THIS player owns the gun.
       *
       * weaponSystem.confirmPickup() therefore must award the
       * gun without requiring the local drop object to still
       * exist.
       */
      const pickup =
        weaponSystem.confirmPickup(
          dropId
        );

      if (!pickup) {
        console.error(
          'Firebase awarded gun ownership but weaponSystem failed to increment the gun count:',
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


      /*
       * Immediately publish the new gun count so other
       * browsers see the player's correct weapon state.
       */
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
          Number(
            drop.expiresAt
          )
        ) {
          return;
        }

        /*
         * Cleanup is intentionally asynchronous.
         *
         * The Firebase listener remains authoritative and
         * will reconcile weaponSystem when removal completes.
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
     * Never await a Firebase transaction inside the game
     * frame loop.
     *
     * pickupInProgress prevents overlapping claims while the
     * asynchronous transaction is running.
     */
    checkGunPickup().catch(
      (error) => {
        /*
         * checkGunPickup already handles normal transaction
         * failures. This protects the frame loop from an
         * unexpected rejected promise.
         */
        console.error(
          'Unexpected gun pickup error:',
          error
        );
      }
    );
  }


  /* =======================================================
     PUBLIC API
     ======================================================= */

  return {
    update,
    dropLocalGuns
  };
}
