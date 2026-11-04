import { transportConfig } from './transport/config.js';
import { createMrKHitQueue } from './mrKHitQueue.js';

const knas = transportConfig.provider === 'knas' ? await import('./transport/knas-store.js') : null;
const queue = knas && createMrKHitQueue({ request: knas.request });

export const hasSharedMrK = Boolean(knas);
export const getSharedMrK = () => knas?.store.mrK ?? null;
export const queueMrKHits = (id, count) => queue?.add(id, count);
export const updateMrKHitQueue = id => { queue?.reset(id); queue?.flush(); };
export const getSharedMissiles = () => knas?.store.missiles ?? null;
export const getSharedMissileHits = () => knas?.store.missileHits ?? new Map();
export const shootSharedMissile = id => knas?.request('missileShot', { id }) ?? Promise.resolve(false);
export async function acknowledgeSharedMissileHit(id) {
  const ok = await knas?.request('missileHitAck', { id });
  if (ok) knas.store.missileHits.delete(id);
  return ok;
}
