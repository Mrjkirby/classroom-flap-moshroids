import { drawWrapped, TAU } from './physics.js';

const SIZES = {
  large: { radius: 30, points: 50, next: 'medium' },
  medium: { radius: 18, points: 100, next: 'small' },
  small: { radius: 10, points: 150, next: null }
};

function seededRandom(seed) {
  let value = Math.sin(seed * 9999.91) * 43758.5453;
  return value - Math.floor(value);
}

export class Asteroid {
  constructor(x, y, size = 'large', seed = 1) {
    const config = SIZES[size];

    this.x = x;
    this.y = y;
    this.size = size;
    this.seed = seed;

    this.radius = config.radius;
    this.points = config.points;

    // Ordinary asteroids stay fixed in space.
    this.velocityX = 0;
    this.velocityY = 0;
    this.rotation = 0;

    this.angle = seededRandom(seed + 100) * TAU;

    this.vertices = Array.from({ length: 10 }, (_, index) => ({
      angle: index / 10 * TAU,
      radius: this.radius * (0.72 + seededRandom(seed + index + 200) * 0.46)
    }));
  }

  update() {
    // Intentionally stationary.
  }

  split() {
    const nextSize = SIZES[this.size].next;
    if (!nextSize) return [];

    const offset = this.radius * 0.45;

    return [
      new Asteroid(this.x - offset, this.y, nextSize, this.seed * 2 + 1),
      new Asteroid(this.x + offset, this.y, nextSize, this.seed * 2 + 2)
    ];
  }

  draw(ctx, width, height) {
    drawWrapped(ctx, this, width, height, (drawCtx) => {
      drawCtx.rotate(this.angle);
      drawCtx.strokeStyle = '#d9ddd7';
      drawCtx.lineWidth = 1.25;
      drawCtx.beginPath();

      this.vertices.forEach((vertex, index) => {
        const x = Math.cos(vertex.angle) * vertex.radius;
        const y = Math.sin(vertex.angle) * vertex.radius;

        if (index === 0) drawCtx.moveTo(x, y);
        else drawCtx.lineTo(x, y);
      });

      drawCtx.closePath();
      drawCtx.stroke();
    });
  }
}

export const sizeConfig = SIZES;
