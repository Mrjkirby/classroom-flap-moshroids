import { transportConfig } from '../transport/config.js';
const adapter = transportConfig.provider === 'knas'
  ? await import('../transport/knas-shared.js') : await import('../transport/firebase-gauntlet.js');
export const { configureGauntletNetwork, getGauntletState, startGauntletListener,
  stopGauntletListener, claimSurvivor, activateGauntlet, fireCannon,
  endGauntlet, endIfSurvivorDisconnected, resetGauntlet } = adapter;
