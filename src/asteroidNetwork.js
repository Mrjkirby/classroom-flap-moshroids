import { transportConfig } from './transport/config.js';
const adapter = transportConfig.provider === 'knas'
  ? await import('./transport/knas-shared.js') : await import('./transport/firebase-asteroids.js');
export const { configureAsteroidNetwork, startAsteroidListener, stopAsteroidListener,
  destroySharedAsteroid, isAsteroidDestroyed, getDestroyedAsteroids, clearDestroyedAsteroids } = adapter;
