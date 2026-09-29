const STARTING_GUNS = 1;
const MAX_GUNS = 40;
const DROP_LIFETIME = 10;
const PICKUP_RADIUS = 25;
const DROP_RADIUS = 8;

/*
 * Ship is approximately 34 px long/wide in the current game.
 *
 * For two guns:
 *   <---- 17 px ---->
 *      |         |
 *         SHIP
 *
 * As guns are added, the bank grows outward while remaining centred.
 */
const SHIP_WIDTH = 34;
const TWIN_GUN_SPACING = SHIP_WIDTH / 2; // 17 px
const GUN_SPACING = TWIN_GUN_SPACING;

export class WeaponSystem {
  constructor() {
    this.gunCount = STARTING_GUNS;
    this.drops = new Map();
  }

  reset() {
    this.gunCount = STARTING_GUNS;
    this.drops.clear();
  }

  getGunCount() {
    return this.gunCount;
  }

  setGunCount(count) {
    this.gunCount = Math.max(
      STARTING_GUNS,
      Math.min(MAX_GUNS, Math.floor(Number(count) || STARTING_GUNS))
    );

    return this.gunCount;
  }

  addGun(count = 1) {
    const before = this.gunCount;

    this.gunCount = Math.min(
      MAX_GUNS,
      this.gunCount + Math.max(0, Math.floor(Number(count) || 0))
    );

    return {
      before,
      after: this.gunCount,
      added: this.gunCount - before,
      bossReady: this.gunCount >= MAX_GUNS
    };
  }

  /*
   * Every gun owned by the destroyed player drops separately.
   */
  createDrops(x, y, ownerUid, gunCount = this.gunCount, now = performance.now()) {
    const count = Math.max(0, Math.floor(Number(gunCount) || 0));
    const drops = [];

    for (let index = 0; index < count; index += 1) {
      const angle = (index / Math.max(1, count)) * Math.PI * 2;
      const ring = 22 + (index % 4) * 8;
      const id =
        `${ownerUid}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;

      const drop = {
        id,
        ownerUid,
        x: x + Math.cos(angle) * ring,
        y: y + Math.sin(angle) * ring,
        radius: DROP_RADIUS,
        createdAt: now,
        expiresAt: now + DROP_LIFETIME * 1000,
        collected: false
      };

      this.drops.set(id, drop);
      drops.push(drop);
    }

    return drops;
  }

  addDrop(drop) {
    if (!drop?.id || this.drops.has(drop.id)) return false;

    this.drops.set(drop.id, {
      ...drop,
      radius: drop.radius ?? DROP_RADIUS,
      collected: false
    });

    return true;
  }

  removeDrop(dropId) {
    return this.drops.delete(dropId);
  }

  clearDrops() {
    this.drops.clear();
  }

  update(now = performance.now()) {
    for (const [id, drop] of this.drops) {
      if (drop.collected || now >= drop.expiresAt) {
        this.drops.delete(id);
      }
    }
  }

  /*
   * Find a gun touched by the local ship.
   * Firebase still decides which player actually wins the pickup.
   */
  findPickup(ship) {
    if (!ship?.visible) return null;

    for (const drop of this.drops.values()) {
      if (drop.collected) continue;

      const distance = Math.hypot(
        ship.x - drop.x,
        ship.y - drop.y
      );

      if (distance <= (ship.radius ?? 15) + PICKUP_RADIUS) {
        return drop;
      }
    }

    return null;
  }

  confirmPickup(dropId) {
    const drop = this.drops.get(dropId);

    if (!drop || drop.collected) return null;

    drop.collected = true;
    this.drops.delete(dropId);

    const result = this.addGun(1);

    return {
      dropId,
      gunCount: result.after,
      bossReady: result.bossReady
    };
  }

  /*
   * Creates one centred parallel firing bank.
   *
   * Examples:
   *
   * 1 gun:
   *             |
   *
   * 2 guns:
   *         |       |
   *
   * 3 guns:
   *     |       |       |
   *
   * 4 guns:
   * |       |       |       |
   *
   * Even-numbered banks straddle the ship centreline.
   * Odd-numbered banks include one centre gun.
   */
  getBankOffsets(count) {
    if (count <= 1) return [0];

    const centre = (count - 1) / 2;
    const offsets = [];

    for (let index = 0; index < count; index += 1) {
      offsets.push((index - centre) * GUN_SPACING);
    }

    return offsets;
  }

  /*
   * Gun progression:
   *
   *  1–10  FRONT
   * 11–20  BACK
   * 21–30  RIGHT
   * 31–40  LEFT
   *
   * Every gun is a real emitter.
   *
   * Therefore:
   *
   *  2 guns = 2 simultaneous forward bullets
   *  5 guns = 5 simultaneous forward bullets
   * 10 guns = 10 simultaneous forward bullets
   *
   * At 11 guns:
   * 10 fire forward + 1 backward.
   *
   * At 40 guns:
   * 10 forward + 10 backward + 10 right + 10 left.
   */
  getEmitters(ship) {
    const emitters = [];

    const frontCount = Math.min(this.gunCount, 10);
    const backCount = Math.min(Math.max(this.gunCount - 10, 0), 10);
    const rightCount = Math.min(Math.max(this.gunCount - 20, 0), 10);
    const leftCount = Math.min(Math.max(this.gunCount - 30, 0), 10);

    this.addBank(emitters, ship, frontCount, 0, 1);
    this.addBank(emitters, ship, backCount, Math.PI, 11);
    this.addBank(emitters, ship, rightCount, Math.PI / 2, 21);
    this.addBank(emitters, ship, leftCount, -Math.PI / 2, 31);

    return emitters;
  }

  /*
   * All emitters in a bank fire at EXACTLY the same angle.
   * Only their sideways starting positions differ.
   *
   * This produces parallel laser streams instead of a fan.
   */
  addBank(emitters, ship, count, directionOffset, firstGunNumber) {
    if (count <= 0) return;

    const angle = ship.angle + directionOffset;
    const offsets = this.getBankOffsets(count);

    /*
     * Spawn just beyond the ship body.
     */
    const forwardOffset = 18;

    offsets.forEach((sideOffset, index) => {
      const x =
        ship.x +
        Math.cos(angle) * forwardOffset +
        Math.cos(angle + Math.PI / 2) * sideOffset;

      const y =
        ship.y +
        Math.sin(angle) * forwardOffset +
        Math.sin(angle + Math.PI / 2) * sideOffset;

      emitters.push({
        gunNumber: firstGunNumber + index,
        x,
        y,
        angle,
        velocityX: ship.velocityX,
        velocityY: ship.velocityY
      });
    });
  }

  getRemainingSeconds(drop, now = performance.now()) {
    return Math.max(
      0,
      Math.ceil((drop.expiresAt - now) / 1000)
    );
  }

  draw(ctx, now = performance.now()) {
    ctx.save();

    for (const drop of this.drops.values()) {
      const remaining = this.getRemainingSeconds(drop, now);

      if (remaining <= 0) continue;

      const flashRate = remaining <= 3 ? 120 : 250;
      const visible = Math.floor(now / flashRate) % 2 === 0;

      if (visible) {
        ctx.strokeStyle = '#ff3b30';
        ctx.fillStyle = '#ff3b30';
        ctx.lineWidth = 2;

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
        ctx.moveTo(drop.x - 5, drop.y);
        ctx.lineTo(drop.x + 5, drop.y);

        ctx.moveTo(drop.x + 1, drop.y);
        ctx.lineTo(drop.x + 5, drop.y + 5);
        ctx.stroke();
      }

      /*
       * Countdown stays visible while the pickup flashes.
       */
      ctx.fillStyle = '#ff3b30';
      ctx.font = '700 13px Barlow Condensed,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      ctx.fillText(
        String(remaining),
        drop.x,
        drop.y - 17
      );
    }

    ctx.restore();
  }
}

export const weaponSystem = new WeaponSystem();

export {
  STARTING_GUNS,
  MAX_GUNS,
  DROP_LIFETIME
};
