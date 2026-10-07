// Release gate: Firebase remains the default. No URL/query provider overrides.
// A trusted launcher/test harness can supply this configuration before game.js.
const configured = globalThis.MOSHROIDS_TRANSPORT_CONFIG || {};
export const transportConfig = Object.freeze({
  provider: configured.provider === 'knas' ? 'knas' : 'firebase',
  websocketUrl: configured.websocketUrl || '',
  // Fresh one-time grant from the EXISTING classroom session, never a PIN,
  // browser-selected identity or signing secret.
  requestLaunch: configured.requestLaunch,
});
