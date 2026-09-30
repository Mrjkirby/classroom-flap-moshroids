import { Asteroid } from '../asteroid.js';
import { wrap } from '../physics.js';

export const SHOT_LIFETIME = 120000;
const SHOT_SPEED = 4 * 60 / 1000;

export function shotMultiplier(firedAt, gauntletStartedAt) {
  return 2 ** Math.max(0, Math.floor((firedAt - gauntletStartedAt) / 60000));
}

export function createCannonProjectile(uid, sequence, shot, gauntletStartedAt, width, height) {
  const multiplier = shotMultiplier(shot.firedAt, gauntletStartedAt);
  const radius = 30 * multiplier;
  const x = wrap(shot.x + Math.cos(shot.angle) * (radius + 18), width);
  const y = wrap(shot.y + Math.sin(shot.angle) * (radius + 18), height);
  const seed = (shot.round + 1) * 100000 + sequence * 31 + uid.split('').reduce((n, c) => n + c.charCodeAt(0), 0);
  const projectile = new Asteroid(x, y, 'large', seed, `1vw-shot-${shot.round}-${uid}-${sequence}`, shot.firedAt);
  projectile.radius = radius;
  projectile.vertices = projectile.vertices.map(vertex => ({ ...vertex, radius: vertex.radius * multiplier }));
  projectile.cannonShot = true;
  projectile.velocityX = Math.cos(shot.angle) * SHOT_SPEED * 1000 / 60;
  projectile.velocityY = Math.sin(shot.angle) * SHOT_SPEED * 1000 / 60;
  return projectile;
}

export function activeCannonShots(state, now, destroyed, width, height) {
  if (state?.phase !== 'gauntlet') return [];
  const shots = [];
  for (const [uid, cannon] of Object.entries(state.cannons || {})) {
    for (const [sequence, shot] of Object.entries(cannon.shots || {})) {
      if (shot.round !== state.round || shot.firedAt > now || now - shot.firedAt >= SHOT_LIFETIME ||
          !Number.isFinite(shot.x) || !Number.isFinite(shot.y)) continue;
      const id = `1vw-shot-${shot.round}-${uid}-${sequence}`;
      if (!destroyed.has(id)) shots.push(createCannonProjectile(uid, Number(sequence), shot,
        state.gauntletStartedAt, width, height));
    }
  }
  return shots;
}
