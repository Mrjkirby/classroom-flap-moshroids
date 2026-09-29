import {
  drawWrapped,
  wrapPosition
} from './physics.js';


export class Ship {
  constructor(
    owner,
    x,
    y,
    controls,
    displayName = owner
  ) {
    this.owner =
      owner;

    this.displayName =
      displayName;

    this.x =
      x;

    this.y =
      y;

    this.velocityX =
      0;

    this.velocityY =
      0;

    this.angle =
      owner === 'A'
        ? -Math.PI / 2
        : Math.PI / 2;

    this.controls =
      controls;

    this.radius =
      15;

    this.cooldown =
      0;

    this.invulnerable =
      0;

    this.visible =
      true;

    this.thrusting =
      false;

    this.state =
      'ACTIVE';

    /*
     * Remote ships are display-only.
     *
     * Their movement comes from multiplayer interpolation.
     * They never run local keyboard physics or local firing.
     */
    this.remote =
      false;
  }


  /* =======================================================
     UPDATE
     ======================================================= */

  update(
    dt,
    keys,
    width,
    height
  ) {
    if (
      this.remote ||
      this.state !== 'ACTIVE'
    ) {
      return false;
    }

    const frameScale =
      dt * 60;


    /* -----------------------------------------------------
       ROTATION
       ----------------------------------------------------- */

    const turn =
      (
        keys.has(
          this.controls.left
        )
          ? -1
          : 0
      ) +
      (
        keys.has(
          this.controls.right
        )
          ? 1
          : 0
      );

    this.angle +=
      turn *
      (
        Math.PI /
        18
      ) *
      frameScale;


    /* -----------------------------------------------------
       THRUST
       ----------------------------------------------------- */

    const thrust =
      (
        keys.has(
          this.controls.thrust
        )
          ? 1
          : 0
      ) -
      (
        keys.has(
          this.controls.brake
        )
          ? 1
          : 0
      );

    this.thrusting =
      thrust !== 0;

    this.velocityX +=
      Math.cos(
        this.angle
      ) *
      thrust *
      0.25 *
      frameScale;

    this.velocityY +=
      Math.sin(
        this.angle
      ) *
      thrust *
      0.25 *
      frameScale;


    /* -----------------------------------------------------
       DRAG
       ----------------------------------------------------- */

    const retention =
      Math.pow(
        0.98,
        frameScale
      );

    this.velocityX *=
      retention;

    this.velocityY *=
      retention;


    /* -----------------------------------------------------
       MAXIMUM SPEED
       ----------------------------------------------------- */

    const speed =
      Math.hypot(
        this.velocityX,
        this.velocityY
      );

    if (
      speed > 8
    ) {
      const factor =
        8 / speed;

      this.velocityX *=
        factor;

      this.velocityY *=
        factor;
    }


    /* -----------------------------------------------------
       POSITION
       ----------------------------------------------------- */

    this.x +=
      this.velocityX *
      frameScale;

    this.y +=
      this.velocityY *
      frameScale;

    wrapPosition(
      this,
      width,
      height
    );


    /* -----------------------------------------------------
       TIMERS
       ----------------------------------------------------- */

    this.cooldown =
      Math.max(
        0,
        this.cooldown -
          dt
      );

    this.invulnerable =
      Math.max(
        0,
        this.invulnerable -
          dt
      );


    /* -----------------------------------------------------
       FIRE TRIGGER

       Ship decides WHEN firing is allowed.

       Ship does NOT create bullets.

       weaponSystem decides:
       - number of guns
       - emitter positions
       - firing directions

       game/fire system creates the actual Bullet objects.
       ----------------------------------------------------- */

    if (
      keys.has(
        this.controls.fire
      ) &&
      this.cooldown <= 0
    ) {
      this.cooldown =
        0.18;

      return true;
    }

    return false;
  }


  /* =======================================================
     DESTROY
     ======================================================= */

  destroy() {
    if (
      this.state !== 'ACTIVE' ||
      this.invulnerable > 0
    ) {
      return false;
    }

    this.state =
      'SPELLING';

    this.visible =
      false;

    this.velocityX =
      0;

    this.velocityY =
      0;

    this.thrusting =
      false;

    return true;
  }


  /* =======================================================
     RESPAWN
     ======================================================= */

  respawn() {
    this.state =
      'ACTIVE';

    this.visible =
      true;

    this.velocityX =
      0;

    this.velocityY =
      0;

    this.cooldown =
      0;

    this.invulnerable =
      1.5;
  }


  /* =======================================================
     DRAW
     ======================================================= */

  draw(
    ctx,
    width,
    height
  ) {
    if (
      !this.visible ||
      (
        this.invulnerable >
          0 &&
        Math.floor(
          this.invulnerable *
          10
        ) %
          2 ===
          0
      )
    ) {
      return;
    }

    drawWrapped(
      ctx,
      this,
      width,
      height,

      (drawCtx) => {
        drawCtx.rotate(
          this.angle
        );

        /*
         * Local ship = orange.
         * Multiplayer ships = cyan.
         */
        drawCtx.strokeStyle =
          this.owner === 'A'
            ? '#ff875f'
            : '#72e6dd';

        drawCtx.lineWidth =
          1.5;


        /* -----------------------------------------------
           SHIP BODY
           ----------------------------------------------- */

        drawCtx.beginPath();

        drawCtx.moveTo(
          17,
          0
        );

        drawCtx.lineTo(
          -12,
          -11
        );

        drawCtx.lineTo(
          -7,
          0
        );

        drawCtx.lineTo(
          -12,
          11
        );

        drawCtx.closePath();

        drawCtx.stroke();


        /* -----------------------------------------------
           THRUST FLAME
           ----------------------------------------------- */

        if (
          this.thrusting
        ) {
          drawCtx.beginPath();

          drawCtx.moveTo(
            -9,
            -4
          );

          drawCtx.lineTo(
            -18,
            0
          );

          drawCtx.lineTo(
            -9,
            4
          );

          drawCtx.stroke();
        }


        /* -----------------------------------------------
           PILOT NAME

           Undo ship rotation so text remains upright.
           ----------------------------------------------- */

        drawCtx.rotate(
          -this.angle
        );

        drawCtx.fillStyle =
          drawCtx.strokeStyle;

        drawCtx.font =
          '700 12px Barlow Condensed,sans-serif';

        drawCtx.textAlign =
          'center';

        drawCtx.textBaseline =
          'middle';

        const label =
          String(
            this.displayName ||
            this.owner
          )
            .trim()
            .slice(
              0,
              16
            )
            .toUpperCase();

        drawCtx.fillText(
          label,
          0,
          -25
        );
      }
    );
  }
}
