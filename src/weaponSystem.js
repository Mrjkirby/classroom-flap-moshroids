const STARTING_GUNS = 1;
const MAX_GUNS = 40;
const DROP_LIFETIME = 10;
const PICKUP_RADIUS = 25;
const DROP_RADIUS = 8;

const FORWARD_END = 10;
const BACK_END = 20;
const RIGHT_END = 30;

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
    this.gunCount = Math.max(STARTING_GUNS, Math.min(MAX_GUNS, Math.floor(count)));
    return this.gunCount;
  }

  addGun(count = 1) {
    const before = this.gunCount;
    this.gunCount = Math.min(MAX_GUNS, this.gunCount + Math.max(0, Math.floor(count)));

    return {
      before,
      after: this.gunCount,
      added: this.gunCount - before,
      bossReady: this.gunCount >= MAX_GUNS
    };
  }

  /*
   * Every owned gun drops individually.
   * The destroyed player returns to one starting gun after respawn.
   */
  createDrops(x, y, ownerUid, gunCount = this.gunCount, now = performance.now()) {
    const count = Math.max(0, Math.floor(gunCount));
    const drops = [];

    for (let index = 0; index < count; index += 1) {
      const angle = (index / Math.max(1, count)) * Math.PI * 2;
      const ring = 22 + (index % 4) * 8;
      const id = `${ownerUid}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`;

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
   * Returns a touched drop but DOES NOT award it.
   *
   * Multiplayer must claim the drop through Firebase first.
   * This prevents two browsers from both receiving the same gun.
   */
  findPickup(ship) {
    if (!ship?.visible) return null;

    for (const drop of this.drops.values()) {
      if (drop.collected) continue;

      const dx = ship.x - drop.x;
      const dy = ship.y - drop.y;
      const distance = Math.hypot(dx, dy);

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
   * Gun direction progression:
   *
   *  1–10  FRONT
   * 11–20  BACK
   * 21–30  RIGHT
   * 31–40  LEFT
   *
   * Each gun produces its OWN emitter.
   */
  getEmitters(ship) {
    const emitters = [];

    for (let gunNumber = 1; gunNumber <= this.gunCount; gunNumber += 1) {
      let directionOffset = 0;
      let sideOffset = 0;
      let forwardOffset = 16;

      if (gunNumber <= FORWARD_END) {
        directionOffset = 0;
        sideOffset = this.spreadOffset(gunNumber, 1);
      } else if (gunNumber <= BACK_END) {
        directionOffset = Math.PI;
        sideOffset = this.spreadOffset(gunNumber, 11);
      } else if (gunNumber <= RIGHT_END) {
        directionOffset = Math.PI / 2;
        sideOffset = this.spreadOffset(gunNumber, 21);
      } else {
        directionOffset = -Math.PI / 2;
        sideOffset = this.spreadOffset(gunNumber, 31);
      }

      const angle = ship.angle + directionOffset;

      /*
       * sideOffset is perpendicular to the firing direction so
       * multiple guns form distinct parallel laser streams.
       */
      const x =
        ship.x +
        Math.cos(angle) * forwardOffset +
        Math.cos(angle + Math.PI / 2) * sideOffset;

      const y =
        ship.y +
        Math.sin(angle) * forwardOffset +
        Math.sin(angle + Math.PI / 2) * sideOffset;

      emitters.push({
        gunNumber,
        x,
        y,
        angle,
        velocityX: ship.velocityX,
        velocityY: ship.velocityY
      });
    }

    return emitters;
  }

  spreadOffset(gunNumber, groupStart) {
    const index = gunNumber - groupStart;

    /*
     * Ten parallel streams centred around the ship:
     * -22.5, -17.5 ... +22.5
     */
    return (index - 4.5) * 5;
  }

  getRemainingSeconds(drop, now = performance.now()) {
    return Math.max(0, Math.ceil((drop.expiresAt - now) / 1000));
  }

  draw(ctx, now = performance.now()) {
    ctx.save();

    for (const drop of this.drops.values()) {
      const remaining = this.getRemainingSeconds(drop, now);
      if (remaining <= 0) continue;

      /*
       * Flash faster during the final three seconds.
       */
      const flashRate = remaining <= 3 ? 120 : 250;
      const visible = Math.floor(now / flashRate) % 2 === 0;

      if (visible) {
        ctx.strokeStyle = '#ff3b30';
        ctx.fillStyle = '#ff3b30';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.arc(drop.x, drop.y, DROP_RADIUS, 0, Math.PI * 2);
        ctx.stroke();

        /*
         * Small laser-gun shape inside the pickup circle.
         */
        ctx.beginPath();
        ctx.moveTo(drop.x - 5, drop.y);
        ctx.lineTo(drop.x + 5, drop.y);
        ctx.moveTo(drop.x + 1, drop.y);
        ctx.lineTo(drop.x + 5, drop.y + 5);
        ctx.stroke();
      }

      /*
       * Countdown remains visible even while the gun itself flashes.
       */
      ctx.fillStyle = '#ff3b30';
      ctx.font = '700 13px Barlow Condensed,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(remaining), drop.x, drop.y - 17);
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
