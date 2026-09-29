import { drawWrapped, TAU, wrapPosition } from './physics.js';

const SIZES = {
  large: { radius: 30, points: 50 },
  medium: { radius: 18, points: 100 },
  small: { radius: 10, points: 150 }
};

function seededRandom(seed) {
  const value = Math.sin(seed * 9999.91) * 43758.5453;
  return value - Math.floor(value);
}

export class Asteroid {
  constructor(x, y, size = 'large', seed = 1, id = `asteroid-${seed}`) {
    const config = SIZES[size] || SIZES.large;

    this.id = id;
    this.seed = seed;
    this.size = size;

    this.x = x;
    this.y = y;

    this.radius = config.radius;
    this.points = config.points;

    /*
     * DETERMINISTIC MOVEMENT
     *
     * The seed determines the asteroid's direction and speed.
     * Every browser given the same seed gets exactly the same values.
     *
     * No Firebase position updates are required.
     */
    const travelAngle = seededRandom(seed + 10) * TAU;
    const speed = 0.22 + seededRandom(seed + 20) * 0.28;

    this.velocityX = Math.cos(travelAngle) * speed;
    this.velocityY = Math.sin(travelAngle) * speed;

    /*
     * Slow deterministic rotation.
     */
    this.rotation =
      (seededRandom(seed + 30) - 0.5) * 0.35;

    this.angle =
      seededRandom(seed + 100) * TAU;

    /*
     * Deterministic rock shape.
     * Same asteroid looks identical on every browser.
     */
    this.vertices = Array.from(
      { length: 10 },
      (_, index) => ({
        angle: index / 10 * TAU,
        radius:
          this.radius *
          (0.72 +
            seededRandom(seed + index + 200) * 0.46)
      })
    );
  }

  update(dt, width, height) {
    const frameScale = dt * 60;

    this.x += this.velocityX * frameScale;
    this.y += this.velocityY * frameScale;

    this.angle += this.rotation * frameScale;

    /*
     * Asteroids travel continuously through the arena.
     * Leaving one edge brings the same asteroid through
     * the opposite edge.
     */
    wrapPosition(this, width, height);
  }

  /*
   * MULTIPLAYER RULE:
   *
   * Ordinary asteroids DO NOT split.
   *
   * One asteroid hit:
   * asteroid explodes -> asteroid disappears.
   *
   * game.js/Firebase will synchronize that destruction
   * using this asteroid's stable ID.
   */
  split() {
    return [];
  }

  draw(ctx, width, height) {
    drawWrapped(
      ctx,
      this,
      width,
      height,
      (drawCtx) => {
        drawCtx.rotate(this.angle);

        drawCtx.strokeStyle = '#d9ddd7';
        drawCtx.lineWidth = 1.25;

        drawCtx.beginPath();

        this.vertices.forEach(
          (vertex, index) => {
            const x =
              Math.cos(vertex.angle) *
              vertex.radius;

            const y =
              Math.sin(vertex.angle) *
              vertex.radius;

            if (index === 0) {
              drawCtx.moveTo(x, y);
            } else {
              drawCtx.lineTo(x, y);
            }
          }
        );

        drawCtx.closePath();
        drawCtx.stroke();
      }
    );
  }
}

export const sizeConfig = SIZES;
