import { Bullet } from '../bullet.js';
import { WeaponSystem } from '../weaponSystem.js';
import { normalizeTeam } from './teamRules.js';

const emitterSystem = new WeaponSystem();

// Reconstruct a recent remote volley from its immutable fire snapshot.
export function bulletsFromVolley(shot, owner, now, width, height) {
  if (!shot || !Number.isInteger(shot.id) ||
    ![shot.at, shot.x, shot.y, shot.angle, shot.velocityX, shot.velocityY]
      .every(Number.isFinite)) return [];
  const age = (now - shot.at) / 1000;
  if (age < -0.2 || age >= 0.9) return [];
  emitterSystem.setGunCount(shot.guns);
  const bullets = emitterSystem.getEmitters({
    x: shot.x, y: shot.y, angle: shot.angle,
    velocityX: shot.velocityX, velocityY: shot.velocityY
  }).map(emitter => new Bullet(
    emitter.x, emitter.y, emitter.angle,
    emitter.velocityX, emitter.velocityY, owner, normalizeTeam(shot.team)
  ));
  for (const bullet of bullets) {
    const startX = bullet.x;
    const startY = bullet.y;
    bullet.update(Math.max(0, age), width, height);
    bullet.catchUpStart = { x: startX, y: startY };
  }
  return bullets;
}
