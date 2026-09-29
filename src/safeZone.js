// Corner safe-zone barriers for Moshroids.
//
// Each L has two equal arms:
//   7 ship lengths horizontal
//   7 ship lengths vertical
//
// These are visual barriers only for now.
// Collision behaviour will be added after the geometry is verified in-game.

const SHIP_LENGTH = 34;
const ARM_LENGTH = SHIP_LENGTH * 7; // 238 world units
const WALL_THICKNESS = 8;

// Distance from the arena's outer wall.
// This creates a protected pocket behind each L.
const WALL_OFFSET = ARM_LENGTH;

export class SafeZones {
  constructor(width, height) {
    this.width = width;
    this.height = height;
  }

  resize(width, height) {
    this.width = width;
    this.height = height;
  }

  draw(ctx) {
    const w = this.width;
    const h = this.height;

    ctx.save();

    ctx.strokeStyle = '#72e6dd';
    ctx.lineWidth = WALL_THICKNESS;
    ctx.lineCap = 'square';
    ctx.lineJoin = 'miter';

    // TOP LEFT
    // Protected pocket is above/left of the L.
    this.drawL(
      ctx,
      WALL_OFFSET,
      WALL_OFFSET,
      -1,
      -1
    );

    // TOP RIGHT
    // Protected pocket is above/right of the L.
    this.drawL(
      ctx,
      w - WALL_OFFSET,
      WALL_OFFSET,
      1,
      -1
    );

    // BOTTOM LEFT
    // Protected pocket is below/left of the L.
    this.drawL(
      ctx,
      WALL_OFFSET,
      h - WALL_OFFSET,
      -1,
      1
    );

    // BOTTOM RIGHT
    // Protected pocket is below/right of the L.
    this.drawL(
      ctx,
      w - WALL_OFFSET,
      h - WALL_OFFSET,
      1,
      1
    );

    ctx.restore();
  }

  drawL(ctx, cornerX, cornerY, horizontalDirection, verticalDirection) {
    ctx.beginPath();

    // Horizontal arm: exactly 7 ship lengths.
    ctx.moveTo(cornerX, cornerY);
    ctx.lineTo(
      cornerX + horizontalDirection * ARM_LENGTH,
      cornerY
    );

    // Return to elbow.
    ctx.moveTo(cornerX, cornerY);

    // Vertical arm: exactly 7 ship lengths.
    ctx.lineTo(
      cornerX,
      cornerY + verticalDirection * ARM_LENGTH
    );

    ctx.stroke();
  }
}

export const SAFE_ZONE_SHIP_LENGTH = SHIP_LENGTH;
export const SAFE_ZONE_ARM_LENGTH = ARM_LENGTH;
export const SAFE_ZONE_WALL_THICKNESS = WALL_THICKNESS;
