/*
 * MOSHROIDS ASTEROID DIFFICULTY DIRECTOR
 *
 * SHARED CLOCK DESIGN
 *
 * All browsers derive asteroid timing from Date.now().
 * No Firebase clock synchronization is required.
 *
 * A new synchronized field begins every 30 minutes:
 *
 * :00 and :30
 *
 * The first 15 seconds of each 30-minute epoch are a JOIN WINDOW.
 * All players then use the same epoch number, asteroid identities,
 * seeds and elapsed-time schedule.
 *
 * Difficulty:
 *
 * Tier 1: cap 10 — one replacement every 60 seconds
 * Tier 2: cap 20 — one replacement every 50 seconds
 * Tier 3: cap 30 — one replacement every 40 seconds
 * Tier 4: cap 40 — one replacement every 30 seconds
 * Tier 5: cap 50 — one replacement every 20 seconds
 * Tier 6: cap 60 — one replacement every 10 seconds
 *
 * Difficulty advances every 10 minutes of the synchronized epoch.
 *
 * Destroying MR. K immediately advances one tier and requests
 * a complete asteroid-field reset at the new cap.
 */

const TIER_DURATION = 10 * 60;

const EPOCH_DURATION = 30 * 60;
const JOIN_WINDOW = 15;

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

  /*
   * Date.now() is deliberately used instead of performance.now().
   *
   * performance.now() begins independently in every browser.
   * Date.now() lets separate browsers calculate the same epoch.
   */
  reset(now = Date.now()) {
    this.mrKAdvances = 0;
    this.fieldGeneration = 0;
    this.nextAsteroidId = 1;

    this.currentEpoch =
      this.getEpochNumber(now);

    this.lastRespawnSlot = -1;
  }

  /* =========================================================
     SHARED 30-MINUTE EPOCH
     ========================================================= */

  getEpochNumber(now = Date.now()) {
    return Math.floor(
      now /
      (EPOCH_DURATION * 1000)
    );
  }

  getEpochStart(now = Date.now()) {
    const epoch =
      this.getEpochNumber(now);

    return (
      epoch *
      EPOCH_DURATION *
      1000
    );
  }

  getEpochElapsedSeconds(now = Date.now()) {
    return Math.max(
      0,
      (now - this.getEpochStart(now)) /
        1000
    );
  }

  /*
   * TRUE during the first 15 seconds of every
   * synchronized 30-minute epoch.
   */
  isJoinWindow(now = Date.now()) {
    return (
      this.getEpochElapsedSeconds(now) <
      JOIN_WINDOW
    );
  }

  /*
   * Countdown displayed to players:
   *
   * 15
   * 14
   * 13
   * ...
   * 1
   * 0
   */
  getJoinCountdown(now = Date.now()) {
    if (!this.isJoinWindow(now)) {
      return 0;
    }

    return Math.max(
      0,
      Math.ceil(
        JOIN_WINDOW -
        this.getEpochElapsedSeconds(now)
      )
    );
  }

  /*
   * Detect a new :00 / :30 synchronized epoch.
   *
   * game.js can use this to rebuild the asteroid field
   * once for everybody.
   */
  checkEpochChange(now = Date.now()) {
    const epoch =
      this.getEpochNumber(now);

    if (epoch === this.currentEpoch) {
      return false;
    }

    this.currentEpoch = epoch;

    /*
     * New synchronized round.
     *
     * Reset the local progression bookkeeping.
     */
    this.mrKAdvances = 0;
    this.fieldGeneration = 0;
    this.nextAsteroidId = 1;
    this.lastRespawnSlot = -1;

    return true;
  }

  /* =========================================================
     DIFFICULTY
     ========================================================= */

  /*
   * Natural difficulty comes from the shared epoch clock.
   *
   * 0–9:59   => tier 1
   * 10–19:59 => tier 2
   * 20–29:59 => tier 3
   *
   * At the next 30-minute epoch the synchronized field
   * begins again.
   *
   * MR. K can push difficulty ahead of this clock.
   */
  getTimeTier(now = Date.now()) {
    const elapsed =
      this.getEpochElapsedSeconds(now);

    return Math.min(
      TIERS.length - 1,
      Math.floor(
        elapsed /
        TIER_DURATION
      )
    );
  }

  getTierIndex(now = Date.now()) {
    return Math.min(
      TIERS.length - 1,
      Math.max(
        this.getTimeTier(now),
        this.mrKAdvances
      )
    );
  }

  getTier(now = Date.now()) {
    return TIERS[
      this.getTierIndex(now)
    ];
  }

  getCap(now = Date.now()) {
    return this.getTier(now).cap;
  }

  getRespawnSeconds(now = Date.now()) {
    return this.getTier(now)
      .respawnSeconds;
  }

  /* =========================================================
     DETERMINISTIC RESPAWN CLOCK
     ========================================================= */

  /*
   * Respawns are based on shared clock slots rather than
   * "time since this browser last spawned something."
   *
   * Example at Tier 1:
   *
   * 60 sec  -> slot 1
   * 120 sec -> slot 2
   * 180 sec -> slot 3
   *
   * Separate browsers therefore agree about when a replacement
   * becomes eligible.
   */
  getRespawnSlot(now = Date.now()) {
    const interval =
      this.getRespawnSeconds(now);

    const elapsed =
      this.getEpochElapsedSeconds(now);

    return Math.floor(
      elapsed / interval
    );
  }

  shouldRespawn(
    currentAsteroidCount,
    now = Date.now()
  ) {
    const cap =
      this.getCap(now);

    if (
      currentAsteroidCount >= cap
    ) {
      return false;
    }

    /*
     * Do not spawn during the synchronization countdown.
     */
    if (this.isJoinWindow(now)) {
      return false;
    }

    const slot =
      this.getRespawnSlot(now);

    if (
      slot <= this.lastRespawnSlot
    ) {
      return false;
    }

    this.lastRespawnSlot = slot;

    return true;
  }

  /* =========================================================
     MR. K
     ========================================================= */

  /*
   * Destroying MR. K advances the CURRENT effective
   * difficulty by one tier.
   *
   * It also requests a complete asteroid-field reset.
   */
  mrKDestroyed(now = Date.now()) {
    const before =
      this.getTierIndex(now);

    const after =
      Math.min(
        TIERS.length - 1,
        before + 1
      );

    this.mrKAdvances =
      Math.max(
        this.mrKAdvances,
        after
      );

    this.fieldGeneration += 1;
    this.nextAsteroidId = 1;

    /*
     * Allow the new field's respawn clock
     * to begin from the current shared slot.
     */
    this.lastRespawnSlot =
      this.getRespawnSlot(now);

    return {
      advanced:
        after > before,

      tierIndex:
        after,

      tierNumber:
        after + 1,

      cap:
        TIERS[after].cap,

      respawnSeconds:
        TIERS[after]
          .respawnSeconds,

      fieldGeneration:
        this.fieldGeneration,

      fullReset:
        true
    };
  }

  /* =========================================================
     DETERMINISTIC ASTEROID IDENTITY
     ========================================================= */

  /*
   * IDs include the shared epoch.
   *
   * Therefore an asteroid from one synchronized round
   * can never be confused with an asteroid from another.
   *
   * Example:
   *
   * epoch-994412-field-0-asteroid-1
   */
  createAsteroidIdentity() {
    const number =
      this.nextAsteroidId++;

    const epoch =
      this.currentEpoch;

    return {
      id:
        `epoch-${epoch}-field-${this.fieldGeneration}-asteroid-${number}`,

      seed:
        (
          (epoch % 100000) *
          100000
        ) +
        (
          this.fieldGeneration *
          1000
        ) +
        number
    };
  }

  /* =========================================================
     STATE
     ========================================================= */

  getState(now = Date.now()) {
    const tierIndex =
      this.getTierIndex(now);

    const tier =
      TIERS[tierIndex];

    return {
      epoch:
        this.getEpochNumber(now),

      epochElapsedSeconds:
        this.getEpochElapsedSeconds(now),

      joinWindow:
        this.isJoinWindow(now),

      joinCountdown:
        this.getJoinCountdown(now),

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
  TIER_DURATION,
  EPOCH_DURATION,
  JOIN_WINDOW
};
