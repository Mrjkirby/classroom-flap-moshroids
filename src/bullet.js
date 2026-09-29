import {
  wrapPosition
} from './physics.js';


export class Bullet {
  constructor(
    x,
    y,
    angle,
    velocityX,
    velocityY,
    owner
  ) {
    this.x = x;
    this.y = y;

    this.previousX = x;
    this.previousY = y;

    this.angle = angle;

    this.velocityX =
      Math.cos(angle) *
        10 +
      velocityX;

    this.velocityY =
      Math.sin(angle) *
        10 +
      velocityY;

    this.owner =
      owner;

    this.life =
      0.9;

    this.radius =
      3;
  }


  update(
    dt,
    width,
    height
  ) {
    /*
     * Preserve the beginning of this frame's movement.
     *
     * collisionSystem uses previous → current position
     * for swept collision detection.
     */
    this.previousX =
      this.x;

    this.previousY =
      this.y;

    const frameScale =
      dt * 60;

    this.x +=
      this.velocityX *
      frameScale;

    this.y +=
      this.velocityY *
      frameScale;

    this.life -=
      dt;

    wrapPosition(
      this,
      width,
      height
    );
  }


  draw(ctx) {
    ctx.save();

    ctx.rotate(
      this.angle
    );

    ctx.strokeStyle =
      this.owner === 'A'
        ? '#ffb09a'
        : '#b0fff8';

    ctx.lineWidth =
      1.5;

    ctx.beginPath();

    ctx.moveTo(
      -4,
      0
    );

    ctx.lineTo(
      4,
      0
    );

    ctx.stroke();

    ctx.restore();
  }
}
