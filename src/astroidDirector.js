import { Asteroid } from './asteroid.js';

/*
 * MOSHROIDS ASTEROID FIELD / DIFFICULTY DIRECTOR
 *
 * RESPONSIBILITY
 *
 * Asteroid:
 * - owns one asteroid's movement, geometry and drawing.
 *
 * AsteroidDirector:
 * - owns synchronized field timing
 * - difficulty tiers
 * - asteroid caps
 * - respawn timing
 * - field generations
 * - deterministic asteroid identities
 * - deterministic asteroid spawn positions
 * - creation of complete asteroid fields
 * - creation of normal replacement asteroids
 * - MR. K difficulty advancement
 *
 * game.js:
 * - owns the world
 * - owns multiplayer destruction synchronization
 * - owns collisions, scoring and effects
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

const SPAWN_MARGIN = 70;

const TIERS = [
  { cap: 10, respawnSeconds: 60 },
  { cap: 20, respawnSeconds: 50 },
  { cap: 30, respawnSeconds: 40 },
  { cap: 40, respawnSeconds: 30 },
  { cap: 50, respawnSeconds: 20 },
  { cap: 60, respawnSeconds: 10 }
];


/*
 * Small deterministic random helper used ONLY for field placement.
 *
 * Asteroid.js independently uses its seed for deterministic:
 * - velocity
 * - rotation
 * - rock geometry
 *
 * Using the same asteroid seed here means every browser places
 * a given asteroid at the same starting location.
 */
function seededRandom(seed) {
  const value =
    Math.sin(seed * 9999.91) *
    43758.5453;

  return value -
    Math.floor(value);
}


export class AsteroidDirector {
  constructor() {
    this.reset();
  }


  /* =========================================================
     RESET
     ========================================================= */

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
      (
        now -
        this.getEpochStart(now)
      ) / 1000
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
   * game.js can use this signal to rebuild the asteroid field.
   */
  checkEpochChange(now = Date.now()) {
    const epoch =
      this.getEpochNumber(now);

    if (
      epoch ===
      this.currentEpoch
    ) {
      return false;
    }

    this.currentEpoch = epoch;

    this.mrKAdvances = 0;
    this.fieldGeneration = 0;
    this.nextAsteroidId = 1;
    this.lastRespawnSlot = -1;

    return true;
  }


  /* =========================================================
     DIFFICULTY
     ========================================================= */

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

  getRespawnSlot(now = Date.now()) {
    const interval =
      this.getRespawnSeconds(now);

    const elapsed =
      this.getEpochElapsedSeconds(now);

    return Math.floor(
      elapsed /
      interval
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
      slot <=
      this.lastRespawnSlot
    ) {
      return false;
    }

    this.lastRespawnSlot = slot;

    return true;
  }


  /* =========================================================
     DETERMINISTIC ASTEROID IDENTITY
     ========================================================= */

  /*
   * IDs include:
   *
   * - synchronized epoch
   * - field generation
   * - asteroid number
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
     ASTEROID CREATION
     ========================================================= */

  /*
   * Creates ONE ordinary asteroid.
   *
   * Position is deterministic from the asteroid seed.
   *
   * Therefore browsers using the same:
   *
   * - epoch
   * - field generation
   * - asteroid number
   * - world dimensions
   *
   * create the same asteroid in the same starting location.
   */
  createAsteroid(
    worldWidth,
    worldHeight
  ) {
    const identity =
      this.createAsteroidIdentity();

    /*
     * Deterministically choose one of four outer edges.
     */
    const side =
      Math.floor(
        seededRandom(
          identity.seed + 300
        ) * 4
      );

    /*
     * Independent deterministic value used for position
     * along the selected edge.
     */
    const edgePosition =
      seededRandom(
        identity.seed + 400
      );

    const horizontalRange =
      Math.max(
        0,
        worldWidth -
        SPAWN_MARGIN * 2
      );

    const verticalRange =
      Math.max(
        0,
        worldHeight -
        SPAWN_MARGIN * 2
      );

    let x;
    let y;

    if (side === 0) {
      /*
       * TOP
       */
      x =
        SPAWN_MARGIN +
        edgePosition *
        horizontalRange;

      y =
        SPAWN_MARGIN;
    } else if (side === 1) {
      /*
       * RIGHT
       */
      x =
        worldWidth -
        SPAWN_MARGIN;

      y =
        SPAWN_MARGIN +
        edgePosition *
        verticalRange;
    } else if (side === 2) {
      /*
       * BOTTOM
       */
      x =
        SPAWN_MARGIN +
        edgePosition *
        horizontalRange;

      y =
        worldHeight -
        SPAWN_MARGIN;
    } else {
      /*
       * LEFT
       */
      x =
        SPAWN_MARGIN;

      y =
        SPAWN_MARGIN +
        edgePosition *
        verticalRange;
    }

    return new Asteroid(
      x,
      y,
      'large',
      identity.seed,
      identity.id
    );
  }


  /* =========================================================
     COMPLETE FIELD CREATION
     ========================================================= */

  /*
   * Creates and RETURNS a complete ordinary asteroid field.
   *
   * AsteroidDirector does NOT own world.asteroids.
   *
   * game.js remains responsible for assigning the returned field
   * to its world state.
   */
  createField(
    worldWidth,
    worldHeight,
    count = this.getCap()
  ) {
    const asteroidCount =
      Math.max(
        0,
        Math.floor(count)
      );

    const asteroids = [];

    for (
      let index = 0;
      index < asteroidCount;
      index += 1
    ) {
      asteroids.push(
        this.createAsteroid(
          worldWidth,
          worldHeight
        )
      );
    }

    return asteroids;
  }


  /* =========================================================
     NORMAL FIELD REPLENISHMENT
     ========================================================= */

  /*
   * Normal replenishment creates AT MOST ONE asteroid.
   *
   * Returns:
   *
   * Asteroid -> replacement is due
   * null     -> no replacement is due
   */
  createRespawn(
    currentAsteroidCount,
    worldWidth,
    worldHeight,
    now = Date.now()
  ) {
    if (
      !this.shouldRespawn(
        currentAsteroidCount,
        now
      )
    ) {
      return null;
    }

    return this.createAsteroid(
      worldWidth,
      worldHeight
    );
  }


  /* =========================================================
     MR. K
     ========================================================= */

  /*
   * Destroying MR. K advances the CURRENT effective
   * difficulty by one tier.
   *
   * The returned result tells game.js to perform a complete
   * ordinary-asteroid field replacement at the new cap.
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

    /*
     * A new field generation guarantees that the replacement
     * field receives fresh asteroid IDs.
     */
    this.fieldGeneration += 1;
    this.nextAsteroidId = 1;

    /*
     * Start replacement timing from the current shared slot.
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
  JOIN_WINDOW,
  SPAWN_MARGIN
};
