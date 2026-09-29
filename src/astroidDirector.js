/*
 * MOSHROIDS ASTEROID DIFFICULTY DIRECTOR
 *
 * Normal progression:
 *
 * Tier 1: cap 10 — one replacement every 60 seconds
 * Tier 2: cap 20 — one replacement every 50 seconds
 * Tier 3: cap 30 — one replacement every 40 seconds
 * Tier 4: cap 40 — one replacement every 30 seconds
 * Tier 5: cap 50 — one replacement every 20 seconds
 * Tier 6: cap 60 — one replacement every 10 seconds
 *
 * Time automatically advances one tier every 10 minutes.
 *
 * Destroying MR. K immediately advances one tier and requests
 * a complete asteroid-field reset at the new cap.
 *
 * Difficulty never moves backward.
 */

const TIER_DURATION = 10 * 60;

const TIERS = [
  { cap: 10, respawnSeconds: 60 },
  { cap: 20, respawnSeconds: 50 },
  { cap: 30, respawnSeconds: 40 },
  { cap: 40, respawnSeconds: 30 },
  { cap: 50, respawnSeconds: 20 },
  { cap: 60, respawnSeconds: 10 }
];

export class AsteroidDirector {
  constructor() {
    this.reset();
  }

  reset(now = performance.now()) {
    this.startedAt = now;

    /*
     * Number of MR. K difficulty advances.
     *
     * 0 = normal starting tier.
     */
    this.mrKAdvances = 0;

    /*
     * Respawn clock.
     */
    this.lastRespawnAt = now;

    /*
     * Every asteroid receives a unique generation ID.
     *
     * This prevents a newly spawned asteroid from reusing an old
     * Firebase destruction ID.
     */
    this.nextAsteroidId = 1;

    /*
     * Incremented whenever MR. K causes a full field reset.
     */
    this.fieldGeneration = 0;
  }

  /*
   * Tier earned naturally from elapsed play time.
   *
   * 0–9:59   => tier 0
   * 10–19:59 => tier 1
   * ...
   */
  getTimeTier(now = performance.now()) {
    const elapsedSeconds =
      Math.max(0, now - this.startedAt) / 1000;

    return Math.min(
      TIERS.length - 1,
      Math.floor(elapsedSeconds / TIER_DURATION)
    );
  }

  /*
   * MR. K advances difficulty independently.
   *
   * We use whichever progression is harder:
   *
   * natural elapsed time
   * OR
   * MR. K kills.
   *
   * Difficulty therefore never moves backward.
   */
  getTierIndex(now = performance.now()) {
    return Math.min(
      TIERS.length - 1,
      Math.max(
        this.getTimeTier(now),
        this.mrKAdvances
      )
    );
  }

  getTier(now = performance.now()) {
    return TIERS[
      this.getTierIndex(now)
    ];
  }

  getCap(now = performance.now()) {
    return this.getTier(now).cap;
  }

  getRespawnSeconds(now = performance.now()) {
    return this.getTier(now).respawnSeconds;
  }

  /*
   * Called every game frame.
   *
   * Returns true only when:
   *
   * - the field is below its current cap
   * - AND enough time has passed for ONE replacement asteroid
   *
   * It deliberately returns only one asteroid per interval.
   */
  shouldRespawn(
    currentAsteroidCount,
    now = performance.now()
  ) {
    const cap =
      this.getCap(now);

    if (
      currentAsteroidCount >= cap
    ) {
      /*
       * Keep the respawn clock current while the field is full.
       * This prevents an instant replacement the exact frame an
       * asteroid is destroyed after sitting at cap for several minutes.
       */
      this.lastRespawnAt = now;
      return false;
    }

    const intervalMs =
      this.getRespawnSeconds(now) *
      1000;

    if (
      now - this.lastRespawnAt <
      intervalMs
    ) {
      return false;
    }

    this.lastRespawnAt = now;

    return true;
  }

  /*
   * MR. K destroyed.
   *
   * Advance exactly one difficulty tier, up to the maximum.
   *
   * The caller uses fullReset=true to replace the ordinary asteroid
   * field immediately at the new cap.
   */
  mrKDestroyed(
    now = performance.now()
  ) {
    const before =
      this.getTierIndex(now);

    if (
      this.mrKAdvances <
      TIERS.length - 1
    ) {
      /*
       * Advance relative to the CURRENT effective difficulty.
       *
       * Example:
       *
       * Game naturally reached tier 3.
       * mrKAdvances may still be 0.
       *
       * Killing MR. K must advance to tier 4, not tier 1.
       */
      this.mrKAdvances =
        Math.min(
          TIERS.length - 1,
          before + 1
        );
    }

    const after =
      this.getTierIndex(now);

    this.fieldGeneration += 1;
    this.lastRespawnAt = now;

    return {
      advanced: after > before,
      tierIndex: after,
      tierNumber: after + 1,
      cap: TIERS[after].cap,
      respawnSeconds:
        TIERS[after].respawnSeconds,
      fieldGeneration:
        this.fieldGeneration,
      fullReset: true
    };
  }

  /*
   * Generates a unique ordinary-asteroid identity.
   *
   * Example:
   *
   * field-0-asteroid-1
   * field-0-asteroid-2
   *
   * After MR. K reset:
   *
   * field-1-asteroid-11
   */
  createAsteroidIdentity() {
    const number =
      this.nextAsteroidId++;

    return {
      id:
        `field-${this.fieldGeneration}-asteroid-${number}`,

      seed:
        this.fieldGeneration *
        10000 +
        number
    };
  }

  /*
   * Useful for HUD/debugging.
   */
  getState(now = performance.now()) {
    const tierIndex =
      this.getTierIndex(now);

    const tier =
      TIERS[tierIndex];

    return {
      tierIndex,
      tierNumber:
        tierIndex + 1,

      cap:
        tier.cap,

      respawnSeconds:
        tier.respawnSeconds,

      fieldGeneration:
        this.fieldGeneration
    };
  }
}

export const asteroidDirector =
  new AsteroidDirector();

export {
  TIERS,
  TIER_DURATION
};
