import { createOpenerLaunchAdapter } from './transport/launch-adapter.js';

// Every published game entrypoint uses the same authenticated KNAS launch.
// Transport failures stay on KNAS and require a fresh classroom launch.
globalThis.MOSHROIDS_TRANSPORT_CONFIG = Object.freeze({
  provider: 'knas',
  requestLaunch: createOpenerLaunchAdapter().requestLaunch,
});

await import('./game.js');
