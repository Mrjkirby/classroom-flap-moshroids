const STARTING_GUNS = 1;
const MAX_GUNS = 40;

const DROP_LIFETIME = 10;
const PICKUP_RADIUS = 25;
const DROP_RADIUS = 8;

const SHIP_WIDTH = 34;
const GUN_SPACING = SHIP_WIDTH / 2;


/* =========================================================
   WEAPON SYSTEM
   ========================================================= */

export class WeaponSystem {
  constructor() {
    this.gunCount =
      STARTING_GUNS;

    this.drops =
      new Map();
  }


  /* =======================================================
     RESET
     ======================================================= */

  reset() {
    this.gunCount =
      STARTING_GUNS;

    this.drops.clear();
  }


  /* =======================================================
     GUN COUNT
     ======================================================= */

  getGunCount() {
    return this.gunCount;
  }


  setGunCount(count) {
    const normalized =
      Math.floor(
        Number(count)
      );

    this.gunCount =
      Math.max(
        STARTING_GUNS,

        Math.min(
          MAX_GUNS,

          Number.isFinite(normalized)
            ? normalized
            : STARTING_GUNS
        )
      );

    return this.gunCount;
  }


  addGun(count = 1) {
    const requested =
      Math.max(
        0,
        Math.floor(
          Number(count) || 0
        )
      );

    const before =
      this.gunCount;

    this.gunCount =
      Math.min(
        MAX_GUNS,
        this.gunCount +
          requested
      );

    return {
      before,

      after:
        this.gunCount,

      added:
        this.gunCount -
        before,

      bossReady:
        this.gunCount >=
        MAX_GUNS
    };
  }


  /* =======================================================
     GUN DROPS
     ======================================================= */

  /*
   * Every gun owned by a destroyed player becomes one
   * independent pickup.
   */
  createDrops(
    x,
    y,
    ownerUid,
    gunCount = this.gunCount,
    now = performance.now()
  ) {
    const count =
      Math.max(
        0,
        Math.floor(
          Number(gunCount) || 0
        )
      );

    const drops = [];

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      const angle =
        (
          index /
          Math.max(
            1,
            count
          )
        ) *
        Math.PI *
        2;

      const ring =
        22 +
        (
          index % 4
        ) *
        8;

      const id =
        `${ownerUid}-${Date.now()}-${index}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;

      const drop = {
        id,

        ownerUid,

        x:
          x +
          Math.cos(angle) *
          ring,

        y:
          y +
          Math.sin(angle) *
          ring,

        radius:
          DROP_RADIUS,

        createdAt:
          now,

        expiresAt:
          now +
          DROP_LIFETIME *
          1000,

        collected:
          false
      };

      this.drops.set(
        id,
        drop
      );

      drops.push(
        drop
      );
    }

    return drops;
  }


  addDrop(drop) {
    if (
      !drop?.id ||
      this.drops.has(
        drop.id
      )
    ) {
      return false;
    }

    this.drops.set(
      drop.id,

      {
        ...drop,

        radius:
          drop.radius ??
          DROP_RADIUS,

        collected:
          false
      }
    );

    return true;
  }


  removeDrop(dropId) {
    return this.drops.delete(
      dropId
    );
  }


  clearDrops() {
    this.drops.clear();
  }


  update(
    now = performance.now()
  ) {
    for (
      const [id, drop]
      of this.drops
    ) {
      if (
        drop.collected ||
        now >= drop.expiresAt
      ) {
        this.drops.delete(
          id
        );
      }
    }
  }


  /* =======================================================
     PICKUP DETECTION
     ======================================================= */

  findPickup(ship) {
    if (!ship?.visible) {
      return null;
    }

    for (
      const drop
      of this.drops.values()
    ) {
      if (
        drop.collected
      ) {
        continue;
      }

      const distance =
        Math.hypot(
          ship.x -
            drop.x,

          ship.y -
            drop.y
        );

      if (
        distance <=
        (
          ship.radius ??
          15
        ) +
        PICKUP_RADIUS
      ) {
        return drop;
      }
    }

    return null;
  }


  /*
   * Firebase is authoritative for ownership.
   *
   * IMPORTANT:
   *
   * game.js calls this ONLY AFTER claimGunDrop(dropId)
   * has returned true.
   *
   * Therefore the local drop is NOT required to still exist.
   *
   * The Firebase listener may already have removed the claimed
   * drop from this.drops before this function executes.
   */
  confirmPickup(dropId) {
    if (!dropId) {
      return null;
    }

    /*
     * Remove it locally if it still exists.
     *
     * This is cleanup only.
     * It is NOT the authority for whether the gun was won.
     */
    this.drops.delete(
      dropId
    );

    const result =
      this.addGun(1);

    console.log(
      'GUN PICKUP CONFIRMED:',
      dropId,
      'GUNS:',
      result.before,
      '→',
      result.after
    );

    return {
      dropId,

      gunCount:
        result.after,

      added:
        result.added,

      bossReady:
        result.bossReady
    };
  }


  /* =======================================================
     FIRING BANK GEOMETRY
     ======================================================= */

  /*
   * Creates one centered set of parallel gun positions.
   *
   * 1 gun:
   *
   *             |
   *
   * 2 guns:
   *
   *         |       |
   *
   * 3 guns:
   *
   *     |       |       |
   *
   * All guns in one bank fire parallel.
   */
  getBankOffsets(count) {
    if (
      count <= 1
    ) {
      return [0];
    }

    const centre =
      (
        count - 1
      ) /
      2;

    const offsets = [];

    for (
      let index = 0;
      index < count;
      index += 1
    ) {
      offsets.push(
        (
          index -
          centre
        ) *
        GUN_SPACING
      );
    }

    return offsets;
  }


  /* =======================================================
     EMITTERS
     ======================================================= */

  /*
   * Gun progression:
   *
   *  1–10  FRONT
   * 11–20  BACK
   * 21–30  RIGHT
   * 31–40  LEFT
   *
   * Every owned gun creates exactly ONE emitter.
   *
   * Therefore:
   *
   * gunCount 1  => 1 bullet
   * gunCount 2  => 2 bullets
   * gunCount 10 => 10 bullets
   * gunCount 11 => 11 bullets
   * gunCount 40 => 40 bullets
   */
  getEmitters(ship) {
    if (!ship) {
      return [];
    }

    const emitters = [];

    const frontCount =
      Math.min(
        this.gunCount,
        10
      );

    const backCount =
      Math.min(
        Math.max(
          this.gunCount -
          10,
          0
        ),
        10
      );

    const rightCount =
      Math.min(
        Math.max(
          this.gunCount -
          20,
          0
        ),
        10
      );

    const leftCount =
      Math.min(
        Math.max(
          this.gunCount -
          30,
          0
        ),
        10
      );

    this.addBank(
      emitters,
      ship,
      frontCount,
      0,
      1
    );

    this.addBank(
      emitters,
      ship,
      backCount,
      Math.PI,
      11
    );

    this.addBank(
      emitters,
      ship,
      rightCount,
      Math.PI / 2,
      21
    );

    this.addBank(
      emitters,
      ship,
      leftCount,
      -Math.PI / 2,
      31
    );

    /*
     * Safety invariant:
     *
     * There must be one emitter for every gun.
     */
    if (
      emitters.length !==
      this.gunCount
    ) {
      console.error(
        'WEAPON EMITTER COUNT ERROR:',
        {
          gunCount:
            this.gunCount,

          emitterCount:
            emitters.length
        }
      );
    }

    return emitters;
  }


  /*
   * All emitters in one bank have exactly the same firing angle.
   *
   * Only their perpendicular starting positions differ.
   */
  addBank(
    emitters,
    ship,
    count,
    directionOffset,
    firstGunNumber
  ) {
    if (
      count <= 0
    ) {
      return;
    }

    const angle =
      ship.angle +
      directionOffset;

    const offsets =
      this.getBankOffsets(
        count
      );

    const forwardOffset =
      18;

    offsets.forEach(
      (
        sideOffset,
        index
      ) => {
        const perpendicularAngle =
          angle +
          Math.PI / 2;

        const x =
          ship.x +
          Math.cos(angle) *
          forwardOffset +
          Math.cos(
            perpendicularAngle
          ) *
          sideOffset;

        const y =
          ship.y +
          Math.sin(angle) *
          forwardOffset +
          Math.sin(
            perpendicularAngle
          ) *
          sideOffset;

        emitters.push({
          gunNumber:
            firstGunNumber +
            index,

          x,
          y,

          angle,

          velocityX:
            ship.velocityX,

          velocityY:
            ship.velocityY
        });
      }
    );
  }


  /* =======================================================
     DROP TIMER
     ======================================================= */

  getRemainingSeconds(
    drop,
    now = performance.now()
  ) {
    return Math.max(
      0,

      Math.ceil(
        (
          drop.expiresAt -
          now
        ) /
        1000
      )
    );
  }


  /* =======================================================
     DRAW DROPS
     ======================================================= */

  draw(
    ctx,
    now = performance.now()
  ) {
    ctx.save();

    for (
      const drop
      of this.drops.values()
    ) {
      const remaining =
        this.getRemainingSeconds(
          drop,
          now
        );

      if (
        remaining <= 0
      ) {
        continue;
      }

      const flashRate =
        remaining <= 3
          ? 120
          : 250;

      const visible =
        Math.floor(
          now /
          flashRate
        ) %
        2 ===
        0;

      if (visible) {
        ctx.strokeStyle =
          '#ff3b30';

        ctx.fillStyle =
          '#ff3b30';

        ctx.lineWidth =
          2;

        ctx.beginPath();

        ctx.arc(
          drop.x,
          drop.y,
          DROP_RADIUS,
          0,
          Math.PI * 2
        );

        ctx.stroke();

        /*
         * Small laser-gun symbol.
         */
        ctx.beginPath();

        ctx.moveTo(
          drop.x - 5,
          drop.y
        );

        ctx.lineTo(
          drop.x + 5,
          drop.y
        );

        ctx.moveTo(
          drop.x + 1,
          drop.y
        );

        ctx.lineTo(
          drop.x + 5,
          drop.y + 5
        );

        ctx.stroke();
      }

      ctx.fillStyle =
        '#ff3b30';

      ctx.font =
        '700 13px Barlow Condensed,sans-serif';

      ctx.textAlign =
        'center';

      ctx.textBaseline =
        'middle';

      ctx.fillText(
        String(
          remaining
        ),
        drop.x,
        drop.y - 17
      );
    }

    ctx.restore();
  }
}


/* =========================================================
   SINGLETON
   ========================================================= */

export const weaponSystem =
  new WeaponSystem();


export {
  STARTING_GUNS,
  MAX_GUNS,
  DROP_LIFETIME
};
