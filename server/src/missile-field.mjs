import { AsteroidDirector } from '../../src/asteroidDirector.js';
import { BouncingTrajectories } from '../../src/gauntlet/bounceTrajectory.js';
import { activeCannonShots } from '../../src/gauntlet/projectiles.js';
import { perimeterSlots } from '../../src/gauntlet/perimeterLayout.js';
import { MR_K_RESPAWN_MS, MR_K_RADIUS, mrKPosition } from '../../src/mrKRules.js';
import { wrap } from '../../src/physics.js';
import { WORLD_WIDTH as WIDTH, WORLD_HEIGHT as HEIGHT } from '../../src/worldConfig.js';

// Reuse the same deterministic field and 1VW geometry as the browsers.
// Rebuild on shared events/slots, not on each missile or animation frame.
export class MissileField {
  constructor(match) {
    this.match = match;
    this.director = new AsteroidDirector();
    this.trajectories = new BouncingTrajectories();
    this.key = '';
    this.asteroids = [];
  }
  at(now) {
    const shared = this.match.shared;
    const boss = shared.boss;
    const gauntlet = this.match.mode === '1vw' && boss.phase === 'gauntlet';
    const slots = gauntlet ? perimeterSlots([...this.match.players.keys()]
      .filter(id => id !== boss.survivorUid), WIDTH, HEIGHT) : new Map();
    const rosterKey = `${boss.round}:${JSON.stringify([...slots])}`;
    const key = `${this.director.getEpochNumber(now)}:${this.director.getRespawnSlot(now)}:` +
      `${shared.fieldRevision}:${gauntlet ? Math.floor(now / 1000) : ''}:${rosterKey}`;
    if (key !== this.key || boss !== this.boss) {
      this.asteroids = this.director.reconstructField(WIDTH, HEIGHT, now, shared.destroyed, shared.fenceSpawns)
        .filter(asteroid => !shared.destroyed.has(asteroid.id));
      if (gauntlet) this.asteroids.push(...activeCannonShots(boss, now, shared.destroyed, WIDTH, HEIGHT));
      this.key = key; this.boss = boss;
      this.trajectories.retain(new Set(this.asteroids.map(asteroid => asteroid.id)));
    }
    const obstacles = [...slots.values()].map(slot => ({ ...slot, radius: 15 }));
    for (const asteroid of this.asteroids) {
      asteroid.update(now, WIDTH, HEIGHT);
      if (!gauntlet) continue;
      const startedAt = Math.max(boss.gauntletStartedAt, asteroid.spawnTimestamp);
      const elapsed = (startedAt - asteroid.spawnTimestamp) / 1000 * 60;
      const initial = {
        x: wrap(asteroid.startX + asteroid.velocityX * elapsed, WIDTH),
        y: wrap(asteroid.startY + asteroid.velocityY * elapsed, HEIGHT),
        vx: asteroid.velocityX * 60 / 1000, vy: asteroid.velocityY * 60 / 1000,
        radius: asteroid.radius, at: startedAt
      };
      const position = this.trajectories.position(asteroid.id, initial, now, obstacles, WIDTH, HEIGHT, rosterKey);
      asteroid.x = position.x; asteroid.y = position.y;
    }
    const rock = shared.currentMrK(now);
    const mrK = rock.generation === 0 || now >= rock.fieldSpawn + MR_K_RESPAWN_MS
      ? { ...mrKPosition(now, rock.fieldSpawn, rock.generation, WIDTH, HEIGHT), radius: MR_K_RADIUS } : null;
    return mrK ? [...this.asteroids, mrK] : this.asteroids;
  }
}
