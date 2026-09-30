export function selectSurvivor(current, { uid, name, at }) {
  if (current?.mode !== '1vw' || current.phase !== 'normal') return undefined;
  return { mode: '1vw', phase: 'setup', round: current.round || 0,
    survivorUid: uid, survivorName: name || 'PILOT', gauntletStartedAt: at + 2000 };
}

export function acceptCannonShot(previous, { at, angle, round, x, y, lifetime = SHOT_LIFETIME }) {
  if (!Number.isFinite(angle) || at - (previous?.lastShotAt ?? -Infinity) < 1000) return undefined;
  const sequence = (previous?.sequence || 0) + 1;
  const shots = Object.fromEntries(Object.entries(previous?.shots || {})
    .filter(([, shot]) => at - shot.firedAt < lifetime));
  shots[sequence] = { firedAt: at, angle, round, x, y };
  return { lastShotAt: at, sequence, shots };
}

export function finishGauntlet(current, { uid, reason, at }) {
  if (!['setup', 'gauntlet'].includes(current?.phase) || current.survivorUid !== uid) return undefined;
  return { ...current, phase: 'result', endedAt: at, resultReason: reason };
}

export function resetGauntletState(current) {
  if (current?.phase !== 'result') return undefined;
  return { mode: '1vw', phase: 'normal', round: (current.round || 0) + 1 };
}
import { SHOT_LIFETIME } from './projectiles.js';
