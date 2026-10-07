import { transportConfig } from './transport/config.js';
const adapter = transportConfig.provider === 'knas'
  ? await import('./transport/knas-shared.js') : await import('./transport/firebase-drops.js');
export const { configureGunDropMultiplayer, startGunDropListener, stopGunDropListener,
  publishGunDrops, claimGunDrop, removeExpiredGunDrop, getGunDrops } = adapter;
