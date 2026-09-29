// Functional corner safe-zone barriers for Moshroids.
//
// Each L has two equal 7-ship-length arms.
// Drawing and collision detection use exactly the same geometry.
//
// The elbow sits two ship lengths from the nearby arena edges.
// Both arms extend INTO the arena, leaving the outer corner protected
// while still allowing ships to fly around the ends of the barriers.

const SHIP_LENGTH = 34;
const ARM_LENGTH = SHIP_LENGTH * 7; // 238 world units
const WALL_THICKNESS = 8;
const ENTRY_GAP = SHIP_LENGTH * 2; // 68 world units
const WALL_OFFSET = ENTRY_GAP;

export class SafeZones {
  constructor(width, height) {
    this.width = width;
    this.height = height;
    this.rebuild();
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
    this.rebuild();
  }

  // Build 8 solid segments: 2 arms for each corner L.
  rebuild() {
    const w = this.width;
    const h = this.height;
    this.segments = [];

    // TOP LEFT ┌ — RIGHT + DOWN
    this.addL(WALL_OFFSET, WALL_OFFSET, 1, 1);

    // TOP RIGHT ┐ — LEFT + DOWN
    this.addL(w - WALL_OFFSET, WALL_OFFSET, -1, 1);

    // BOTTOM LEFT └ — RIGHT + UP
    this.addL(WALL_OFFSET, h - WALL_OFFSET, 1, -1);

    // BOTTOM RIGHT ┘ — LEFT + UP
    this.addL(w - WALL_OFFSET, h - WALL_OFFSET, -1, -1);
  }

  addL(cornerX, cornerY, horizontalDirection, verticalDirection) {
    this.segments.push({
      x1: cornerX,
      y1: cornerY,
      x2: cornerX + horizontalDirection * ARM_LENGTH,
      y2: cornerY
    });

    this.segments.push({
      x1: cornerX,
      y1: cornerY,
      x2: cornerX,
      y2: cornerY + verticalDirection * ARM_LENGTH
    });
  }

  // Generic circular collision used by ships, lasers, asteroids and missiles.
  hits(objectOrX, y, radius = 0) {
    let x;

    if (typeof objectOrX === 'object') {
      x = objectOrX.x;
      y = objectOrX.y;
      radius = objectOrX.radius ?? radius;
    } else {
      x = objectOrX;
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;

    const collisionRadius = Math.max(0, radius) + WALL_THICKNESS / 2;

    return this.segments.some((segment) =>
      this.circleHitsSegment(x, y, collisionRadius, segment)
    );
  }

  hitsShip(ship) {
    return this.hits(ship.x, ship.y, ship.radius ?? SHIP_LENGTH * 0.35);
  }

  hitsBullet(bullet) {
    return this.hits(bullet.x, bullet.y, bullet.radius ?? 3);
  }

  hitsAsteroid(asteroid) {
    return this.hits(asteroid.x, asteroid.y, asteroid.radius ?? 0);
  }

  hitsMissile(missile) {
    return this.hits(missile.x, missile.y, missile.radius ?? 0);
  }

  // Find nearest barrier collision so ships can be pushed out without dying.
  getCollision(objectOrX, y, radius = 0) {
    let x;

    if (typeof objectOrX === 'object') {
      x = objectOrX.x;
      y = objectOrX.y;
      radius = objectOrX.radius ?? radius;
    } else {
      x = objectOrX;
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    const collisionRadius = Math.max(0, radius) + WALL_THICKNESS / 2;
    let closestCollision = null;

    for (const segment of this.segments) {
      const closest = this.closestPointOnSegment(x, y, segment);
      const dx = x - closest.x;
      const dy = y - closest.y;
      const distance = Math.hypot(dx, dy);

      if (distance >= collisionRadius) continue;
      if (closestCollision && distance >= closestCollision.distance) continue;

      let normalX;
      let normalY;

      if (distance > 0.0001) {
        normalX = dx / distance;
        normalY = dy / distance;
      } else {
        const segmentDX = segment.x2 - segment.x1;
        const segmentDY = segment.y2 - segment.y1;
        const segmentLength = Math.hypot(segmentDX, segmentDY) || 1;

        normalX = -segmentDY / segmentLength;
        normalY = segmentDX / segmentLength;
      }

      closestCollision = {
        segment,
        closestX: closest.x,
        closestY: closest.y,
        normalX,
        normalY,
        distance,
        penetration: collisionRadius - distance
      };
    }

    return closestCollision;
  }

  // Push ship outside the barrier and remove only velocity into the wall.
  blockShip(ship) {
    const radius = ship.radius ?? SHIP_LENGTH * 0.35;
    const collision = this.getCollision(ship.x, ship.y, radius);

    if (!collision) return false;

    const pushDistance = collision.penetration + 0.5;
    ship.x += collision.normalX * pushDistance;
    ship.y += collision.normalY * pushDistance;

    if (Number.isFinite(ship.velocityX) && Number.isFinite(ship.velocityY)) {
      const velocityIntoWall =
        ship.velocityX * collision.normalX +
        ship.velocityY * collision.normalY;

      if (velocityIntoWall < 0) {
        ship.velocityX -= velocityIntoWall * collision.normalX;
        ship.velocityY -= velocityIntoWall * collision.normalY;
      }
    }

    return true;
  }

  circleHitsSegment(x, y, radius, segment) {
    const closest = this.closestPointOnSegment(x, y, segment);
    const dx = x - closest.x;
    const dy = y - closest.y;

    return dx * dx + dy * dy <= radius * radius;
  }

  closestPointOnSegment(x, y, segment) {
    const dx = segment.x2 - segment.x1;
    const dy = segment.y2 - segment.y1;
    const lengthSquared = dx * dx + dy * dy;

    if (lengthSquared === 0) {
      return { x: segment.x1, y: segment.y1 };
    }

    let t =
      ((x - segment.x1) * dx + (y - segment.y1) * dy) /
      lengthSquared;

    t = Math.max(0, Math.min(1, t));

    return {
      x: segment.x1 + t * dx,
      y: segment.y1 + t * dy
    };
  }

  draw(ctx) {
    ctx.save();
    ctx.strokeStyle = '#72e6dd';
    ctx.lineWidth = WALL_THICKNESS;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    for (const segment of this.segments) {
      ctx.beginPath();
      ctx.moveTo(segment.x1, segment.y1);
      ctx.lineTo(segment.x2, segment.y2);
      ctx.stroke();
    }

    ctx.restore();
  }
}

export const SAFE_ZONE_SHIP_LENGTH = SHIP_LENGTH;
export const SAFE_ZONE_ARM_LENGTH = ARM_LENGTH;
export const SAFE_ZONE_WALL_THICKNESS = WALL_THICKNESS;
