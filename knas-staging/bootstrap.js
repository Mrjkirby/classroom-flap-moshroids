import { createOpenerLaunchAdapter } from './launch-adapter.js';

globalThis.MOSHROIDS_TRANSPORT_CONFIG = Object.freeze({
  provider: 'knas',
  websocketUrl: 'wss://moshroids-staging.mrjkirby.workers.dev/ws',
  requestLaunch: createOpenerLaunchAdapter().requestLaunch,
});

await import('../src/game.js');
