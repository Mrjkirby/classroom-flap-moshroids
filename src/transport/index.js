/*
 * MOSHROIDS multiplayer boundary.
 *
 * Game orchestration imports this module, never a provider-specific transport.
 * Published pages use the KNAS WebSocket adapter with the shared LLP launch
 * bridge. The retained Firebase adapter requires explicit trusted configuration.
 */
import { transportConfig } from './config.js';
const adapter = transportConfig.provider === 'knas'
  ? await import('./knas-player.js') : await import('./firebase-adapter.js');
export const { bindPilotLogin, getLocalIdentity, getRemotePlayers,
  isMultiplayerConnected, leaveMultiplayer, publishLocalState,
  publishTeamChange, publishTeamVolley, updateRemotePlayers } = adapter;
