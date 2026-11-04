// KNAS is the production default. No URL/query provider overrides or fallback.
// The legacy Firebase adapter is reachable only through explicit trusted config.
// Published entrypoints pin KNAS in bootstrap.js before loading the game.
import { reportTransportDiagnostic } from './diagnostics.js';

const configured = globalThis.MOSHROIDS_TRANSPORT_CONFIG || {};
const provider = configured.provider === 'firebase' ? 'firebase' : 'knas';
reportTransportDiagnostic('provider_selected', { provider, fallbackInvoked: false });

export const transportConfig = Object.freeze({
  provider,
  websocketUrl: configured.websocketUrl || 'wss://moshroids-staging.mrjkirby.workers.dev/ws',
  // Fresh one-time grant from the EXISTING classroom session, never a PIN,
  // browser-selected identity or signing secret.
  requestLaunch: configured.requestLaunch,
});
