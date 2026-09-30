import { Asteroid } from './asteroid.js';
import { sharedClock } from './sharedClock.js';


/*
 * MOSHROIDS — ASTEROID FIELD / DIFFICULTY DIRECTOR
 *
 * Owns:
 * - synchronized asteroid-field timing
 * - difficulty tiers
 * - asteroid population
 * - replacement timing
 * - field generations
 * - deterministic asteroid identities
 * - deterministic asteroid spawn positions
 * - complete asteroid-field creation
 * - normal replacement asteroid creation
 * - MR. K difficulty advancement
 *
 * Does NOT own:
 * - world.asteroids
 * - asteroid movement
 * - collisions
 * - scoring
 * - explosions
 * - Firebase
 * - multiplayer asteroid destruction
 *
 * Related modules:
 *
 * asteroid.js
 *   Owns one asteroid entity.
 *
 * asteroidMultiplayer.js
 *   Coordinates local/shared asteroid destruction.
 *
 * asteroidNetwork.js
 *   Owns Firebase asteroid-destruction records.
 *
 * collisionSystem.js
 *   Owns asteroid collision resolution.
 *
 * game.js
 *   Owns the world and orchestrates these systems.
 */


/* =========================================================
   DIFFICULTY CONFIGURATION
   ========================================================= */

const TIER_DURATION =
  10 * 60;

const EPOCH_DURATION =
  30 * 60;

const JOIN_WINDOW =
  15;

const SPAWN_MARGIN =
  70;

const BASE_ASTEROID_COUNT = 10;


const TIERS = [
  {
    respawnSeconds: 60
  },

  {
    respawnSeconds: 50
  },

  {
    respawnSeconds: 40
  },

  {
    respawnSeconds: 30
  },

  {
    respawnSeconds: 20
  },

  {
    respawnSeconds: 10
  }
];


/* =========================================================
   DETERMINISTIC RANDOM
   ========================================================= */

/*
 * Used only for deterministic field placement.
 *
 * asteroid.js independently uses the asteroid seed for:
 * - velocity
 * - rotation
 * - rock geometry
 *
 * Given the same seed and world dimensions, every browser
 * therefore creates the same asteroid in the same location.
 */

function seededRandom(
  seed
) {
  const value =
    Math.sin(
      seed *
      9999.91
    ) *
    43758.5453;

  return (
    value -
    Math.floor(
      value
    )
  );
}


/* =========================================================
   ASTEROID DIRECTOR
   ========================================================= */

export class AsteroidDirector {
  constructor() {
    this.reset();
  }


  /* =======================================================
     RESET
     ======================================================= */

  /*
   * Shared wall time is deliberate.
   *
   * performance.now() begins independently in every browser.
   * Firebase's server offset lets browsers derive the same
   * 30-minute epoch from wall-clock time.
   */

  reset(
    now = sharedClock.now()
  ) {
    this.mrKAdvances =
      0;

    this.fieldGeneration =
      0;

    this.nextAsteroidId =
      1;

    this.currentEpoch =
      this.getEpochNumber(
        now
      );

    this.lastRespawnSlot =
      -1;

    this.fieldSpawnTimestamp = this.getEpochStart(now);
  }


  /* =======================================================
     SYNCHRONIZED 30-MINUTE EPOCH
     ======================================================= */

  getEpochNumber(
    now = sharedClock.now()
  ) {
    return Math.floor(
      now /
      (
        EPOCH_DURATION *
        1000
      )
    );
  }


  getEpochStart(
    now = sharedClock.now()
  ) {
    const epoch =
      this.getEpochNumber(
        now
      );

    return (
      epoch *
      EPOCH_DURATION *
      1000
    );
  }


  getEpochElapsedSeconds(
    now = sharedClock.now()
  ) {
    return Math.max(
      0,

      (
        now -
        this.getEpochStart(
          now
        )
      ) /
      1000
    );
  }


  /*
   * First 15 seconds of each synchronized epoch.
   */

  isJoinWindow(
    now = sharedClock.now()
  ) {
    return (
      this.getEpochElapsedSeconds(
        now
      ) <
      JOIN_WINDOW
    );
  }


  getJoinCountdown(
    now = sharedClock.now()
  ) {
    if (
      !this.isJoinWindow(
        now
      )
    ) {
      return 0;
    }

    return Math.max(
      0,

      Math.ceil(
        JOIN_WINDOW -
        this.getEpochElapsedSeconds(
          now
        )
      )
    );
  }


  /*
   * Detects crossing into a new synchronized :00 / :30
   * epoch.
   *
   * game.js uses TRUE to replace the local asteroid field.
   */

  checkEpochChange(
    now = sharedClock.now()
  ) {
    const epoch =
      this.getEpochNumber(
        now
      );

    if (
      epoch ===
      this.currentEpoch
    ) {
      return false;
    }

    this.currentEpoch =
      epoch;

    this.mrKAdvances =
      0;

    this.fieldGeneration =
      0;

    this.nextAsteroidId =
      1;

    this.lastRespawnSlot =
      -1;

    this.fieldSpawnTimestamp = this.getEpochStart(now);

    return true;
  }


  /* =======================================================
     DIFFICULTY
     ======================================================= */

  getTimeTier(
    now = sharedClock.now()
  ) {
    const elapsed =
      this.getEpochElapsedSeconds(
        now
      );

    return Math.min(
      TIERS.length - 1,

      Math.floor(
        elapsed /
        TIER_DURATION
      )
    );
  }


  getTierIndex(
    now = sharedClock.now()
  ) {
    return Math.min(
      TIERS.length - 1,

      Math.max(
        this.getTimeTier(
          now
        ),

        this.mrKAdvances
      )
    );
  }


  getTier(
    now = sharedClock.now()
  ) {
    return TIERS[
      this.getTierIndex(
        now
      )
    ];
  }


  getCap(
    now = sharedClock.now()
  ) {
    return BASE_ASTEROID_COUNT * (2 ** this.fieldGeneration);
  }


  getRespawnSeconds(
    now = sharedClock.now()
  ) {
    return this.getTier(
      now
    ).respawnSeconds;
  }


  /* =======================================================
     DETERMINISTIC RESPAWN CLOCK
     ======================================================= */

  getRespawnSlot(
    now = sharedClock.now()
  ) {
    const interval =
      this.getRespawnSeconds(
        now
      );

    const elapsed =
      this.getEpochElapsedSeconds(
        now
      );

    return Math.floor(
      elapsed /
      interval
    );
  }


  shouldRespawn(
    currentAsteroidCount,
    now = sharedClock.now()
  ) {
    const cap =
      this.getCap(
        now
      );

    if (
      currentAsteroidCount >=
      cap
    ) {
      return false;
    }


    /*
     * No replacement asteroids during the synchronized
     * join window.
     */

    if (
      this.isJoinWindow(
        now
      )
    ) {
      return false;
    }


    const slot =
      this.getRespawnSlot(
        now
      );

    if (
      slot <=
      this.lastRespawnSlot
    ) {
      return false;
    }


    this.lastRespawnSlot =
      slot;

    return true;
  }


  /* =======================================================
     DETERMINISTIC ASTEROID IDENTITY
     ======================================================= */

  /*
   * Identity contains:
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
          (
            epoch %
            100000
          ) *
          100000
        ) +
        (
          this.fieldGeneration *
          1000
        ) +
        number
    };
  }


  /* =======================================================
     ASTEROID CREATION
     ======================================================= */

  /*
   * Creates one ordinary asteroid.
   *
   * Spawn position is deterministic from the asteroid seed.
   */

  createAsteroid(
    worldWidth,
    worldHeight,
    spawnTimestamp = this.fieldSpawnTimestamp,
    identity = this.createAsteroidIdentity()
  ) {

    /*
     * Select one of four outer edges.
     */

    const side =
      Math.floor(
        seededRandom(
          identity.seed +
          300
        ) *
        4
      );


    /*
     * Independent deterministic position along that edge.
     */

    const edgePosition =
      seededRandom(
        identity.seed +
        400
      );


    const horizontalRange =
      Math.max(
        0,

        worldWidth -
        SPAWN_MARGIN *
        2
      );


    const verticalRange =
      Math.max(
        0,

        worldHeight -
        SPAWN_MARGIN *
        2
      );


    let x;
    let y;


    if (
      side === 0
    ) {
      /*
       * TOP
       */

      x =
        SPAWN_MARGIN +
        edgePosition *
        horizontalRange;

      y =
        SPAWN_MARGIN;

    } else if (
      side === 1
    ) {
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

    } else if (
      side === 2
    ) {
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
      identity.id,
      spawnTimestamp
    );
  }


  /* =======================================================
     COMPLETE FIELD CREATION
     ======================================================= */

  /*
   * Returns a complete ordinary asteroid field.
   *
   * The director does NOT own world.asteroids.
   */

  createField(
    worldWidth,
    worldHeight,
    count = this.getCap(),
    now = sharedClock.now()
  ) {
    const asteroidCount =
      Math.max(
        0,

        Math.floor(
          count
        )
      );


    const asteroids =
      [];


    for (
      let index = 0;
      index < asteroidCount;
      index += 1
    ) {
      asteroids.push(
        this.createAsteroid(
          worldWidth,
          worldHeight,
          this.fieldSpawnTimestamp
        )
      );
    }


    return asteroids;
  }


  /* =======================================================
     NORMAL FIELD REPLENISHMENT
     ======================================================= */

  /*
   * Creates at most one replacement asteroid.
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
    now = sharedClock.now()
  ) {
    if (
      !this.shouldRespawn(
        currentAsteroidCount,
        now
      )
    ) {
      return null;
    }


    const slotStart = this.getEpochStart(now) +
      this.lastRespawnSlot * this.getRespawnSeconds(now) * 1000;

    const slot = this.lastRespawnSlot;
    const identity = this.respawnIdentity(slot);

    return this.createAsteroid(worldWidth, worldHeight, slotStart, identity);
  }

  respawnIdentity(slot) {
    return {
      id: `epoch-${this.currentEpoch}-field-${this.fieldGeneration}-respawn-${slot}`,
      seed: ((this.currentEpoch % 100000) * 100000) + this.fieldGeneration * 1000 + 10000 + slot
    };
  }

  /* Rebuild the active field from shared events and clock slots. A late
   * joiner follows the same timeline as a client that stayed connected. */
  reconstructField(worldWidth, worldHeight, now, destroyedRecords) {
    const epoch = this.getEpochNumber(now);
    const epochStart = this.getEpochStart(now);
    const mrKEvents = [...destroyedRecords]
      .filter(([id, record]) => id.startsWith(`epoch-${epoch}-mrk-`) &&
        record.destroyedAt >= epochStart && record.destroyedAt <= now)
      .sort((a, b) => a[1].destroyedAt - b[1].destroyedAt);

    this.reset(now);
    for (const [, record] of mrKEvents) {
      this.mrKDestroyed(record.destroyedAt);
      this.fieldSpawnTimestamp = record.destroyedAt;
    }

    const initialCount = this.getCap(this.fieldSpawnTimestamp);
    const asteroids = this.createField(worldWidth, worldHeight, initialCount, now);
    const active = new Map(asteroids.map(asteroid => [asteroid.id, asteroid]));
    const prefix = `epoch-${epoch}-field-${this.fieldGeneration}-`;
    const destructions = [...destroyedRecords]
      .filter(([id, record]) => id.startsWith(prefix) &&
        record.destroyedAt >= this.fieldSpawnTimestamp && record.destroyedAt <= now)
      .sort((a, b) => a[1].destroyedAt - b[1].destroyedAt);

    let destructionIndex = 0;
    const applyDestructions = (at) => {
      while (destructionIndex < destructions.length &&
        destructions[destructionIndex][1].destroyedAt <= at) {
        active.delete(destructions[destructionIndex][0]);
        destructionIndex += 1;
      }
    };

    let previousSlot = this.getRespawnSlot(this.fieldSpawnTimestamp);
    for (let time = Math.ceil(this.fieldSpawnTimestamp / 1000) * 1000;
      time <= now; time += 1000) {
      applyDestructions(time);
      const slot = this.getRespawnSlot(time);
      if (slot > previousSlot && !this.isJoinWindow(time) &&
        active.size < this.getCap(time)) {
        const asteroid = this.createAsteroid(
          worldWidth, worldHeight, time, this.respawnIdentity(slot));
        active.set(asteroid.id, asteroid);
      }
      previousSlot = slot;
    }
    applyDestructions(now);
    this.lastRespawnSlot = previousSlot;
    return [...active.values()];
  }


  /* =======================================================
     MR. K DIFFICULTY ADVANCEMENT
     ======================================================= */

  /*
   * Each authoritative MR. K event doubles the base field.
   *
   * game.js receives the new cap and replaces the ordinary
   * asteroid field.
   */

  mrKDestroyed(
    now = sharedClock.now()
  ) {
    const before =
      this.getTierIndex(
        now
      );


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
     * Fresh generation means fresh deterministic asteroid IDs.
     */

    this.fieldGeneration +=
      1;

    this.fieldSpawnTimestamp = now;

    this.nextAsteroidId =
      1;


    /*
     * Do not immediately create an extra normal replacement
     * after the complete field reset.
     */

    this.lastRespawnSlot =
      this.getRespawnSlot(
        now
      );


    return {
      advanced:
        after >
        before,

      tierIndex:
        after,

      tierNumber:
        after +
        1,

      cap:
        this.getCap(now),

      respawnSeconds:
        TIERS[
          after
        ].respawnSeconds,

      fieldGeneration:
        this.fieldGeneration,

      fullReset:
        true
    };
  }


  /* =======================================================
     STATE
     ======================================================= */

  getState(
    now = sharedClock.now()
  ) {
    const tierIndex =
      this.getTierIndex(
        now
      );

    const tier =
      TIERS[
        tierIndex
      ];


    return {
      epoch:
        this.getEpochNumber(
          now
        ),

      epochElapsedSeconds:
        this.getEpochElapsedSeconds(
          now
        ),

      joinWindow:
        this.isJoinWindow(
          now
        ),

      joinCountdown:
        this.getJoinCountdown(
          now
        ),

      tierIndex,

      tierNumber:
        tierIndex +
        1,

      cap:
        this.getCap(now),

      respawnSeconds:
        tier.respawnSeconds,

      fieldGeneration:
        this.fieldGeneration
    };
  }
}


/* =========================================================
   SHARED DIRECTOR INSTANCE
   ========================================================= */

export const asteroidDirector =
  new AsteroidDirector();


/* =========================================================
   CONSTANT EXPORTS
   ========================================================= */

export {
  BASE_ASTEROID_COUNT,
  TIERS,
  TIER_DURATION,
  EPOCH_DURATION,
  JOIN_WINDOW,
  SPAWN_MARGIN
};
