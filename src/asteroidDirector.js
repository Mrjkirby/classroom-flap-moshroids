import { Asteroid } from './asteroid.js';


/*
 * MOSHROIDS — ASTEROID FIELD / DIFFICULTY DIRECTOR
 *
 * Owns:
 * - synchronized asteroid-field timing
 * - difficulty tiers
 * - asteroid caps
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


const TIERS = [
  {
    cap: 10,
    respawnSeconds: 60
  },

  {
    cap: 20,
    respawnSeconds: 50
  },

  {
    cap: 30,
    respawnSeconds: 40
  },

  {
    cap: 40,
    respawnSeconds: 30
  },

  {
    cap: 50,
    respawnSeconds: 20
  },

  {
    cap: 60,
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
   * Date.now() is deliberate.
   *
   * performance.now() begins independently in every browser.
   * Date.now() lets all browsers derive the same 30-minute
   * epoch from wall-clock time.
   */

  reset(
    now = Date.now()
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
  }


  /* =======================================================
     SYNCHRONIZED 30-MINUTE EPOCH
     ======================================================= */

  getEpochNumber(
    now = Date.now()
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
    now = Date.now()
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
    now = Date.now()
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
    now = Date.now()
  ) {
    return (
      this.getEpochElapsedSeconds(
        now
      ) <
      JOIN_WINDOW
    );
  }


  getJoinCountdown(
    now = Date.now()
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
    now = Date.now()
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

    return true;
  }


  /* =======================================================
     DIFFICULTY
     ======================================================= */

  getTimeTier(
    now = Date.now()
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
    now = Date.now()
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
    now = Date.now()
  ) {
    return TIERS[
      this.getTierIndex(
        now
      )
    ];
  }


  getCap(
    now = Date.now()
  ) {
    return this.getTier(
      now
    ).cap;
  }


  getRespawnSeconds(
    now = Date.now()
  ) {
    return this.getTier(
      now
    ).respawnSeconds;
  }


  /* =======================================================
     DETERMINISTIC RESPAWN CLOCK
     ======================================================= */

  getRespawnSlot(
    now = Date.now()
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
    now = Date.now()
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
    worldHeight
  ) {
    const identity =
      this.createAsteroidIdentity();


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
      identity.id
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
    count = this.getCap()
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
          worldHeight
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


  /* =======================================================
     MR. K DIFFICULTY ADVANCEMENT
     ======================================================= */

  /*
   * Destroying MR. K advances the current effective
   * difficulty by one tier.
   *
   * game.js receives the new cap and replaces the ordinary
   * asteroid field.
   */

  mrKDestroyed(
    now = Date.now()
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
        TIERS[
          after
        ].cap,

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
    now = Date.now()
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
        tier.cap,

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
  TIERS,
  TIER_DURATION,
  EPOCH_DURATION,
  JOIN_WINDOW,
  SPAWN_MARGIN
};
