// Compatibility surface only: game systems retain their existing interfaces.
import { store, request } from './knas-store.js';
export const configureAsteroidNetwork = () => {};
export const configureGunDropMultiplayer = () => {};
export const configureGauntletNetwork = () => {};
export const startAsteroidListener = () => {};
export const startGunDropListener = () => {};
export const startGauntletListener = () => {};
export const stopAsteroidListener = () => { store.destroyed = new Map(); };
export const stopGunDropListener = () => { store.drops = new Map(); };
export const stopGauntletListener = () => { store.boss = null; };
export const getDestroyedAsteroids = () => store.destroyed;
export const isAsteroidDestroyed = id => store.destroyed.has(String(id));
export const destroySharedAsteroid = id => request('asteroidClaim', { id });
export const clearDestroyedAsteroids = () => request('asteroidClear');
export const getGunDrops = () => store.drops;
// KNAS supplies ownership, radius and timestamps. Keep batches small enough
// for its 8 KB message limit even with long, multibyte student IDs.
export async function publishGunDrops(drops) {
  const compact = drops.map(({ id, x, y }) => ({ id, x, y }));
  const batches = [];
  for (let i = 0; i < compact.length; i += 10)
    batches.push(request('dropPublish', { drops: compact.slice(i, i + 10) }));
  return (await Promise.all(batches)).every(Boolean);
}
export const claimGunDrop = id => request('dropClaim', { id });
export const removeExpiredGunDrop = id => request('dropExpire', { id });
export const getGauntletState = () => store.boss;
export const claimSurvivor = () => request('survivorClaim');
export const activateGauntlet = () => request('gauntletActivate');
export const fireCannon = angle => request('cannonFire', { angle });
export const endGauntlet = reason => request('gauntletEnd', { reason });
export const endIfSurvivorDisconnected = () => request('survivorDisconnected');
export const resetGauntlet = () => request('gauntletReset');
