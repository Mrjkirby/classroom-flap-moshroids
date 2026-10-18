/*
 * MOSHROIDS multiplayer boundary.
 *
 * Game orchestration imports this module, never a provider-specific transport.
 * Firebase remains the production default. The isolated KNAS staging page
 * selects the WebSocket adapter and obtains its grant from an LLP launch bridge.
 */
import { transportConfig } from './config.js';
const adapter = transportConfig.provider === 'knas'
  ? await import('./knas-player.js') : await import('./firebase-adapter.js');
export const { bindPilotLogin, getLocalIdentity, getRemotePlayers,
  isMultiplayerConnected, leaveMultiplayer, publishLocalState,
  publishTeamChange, publishTeamVolley, updateRemotePlayers } = adapter;
