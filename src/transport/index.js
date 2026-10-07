/*
 * MOSHROIDS multiplayer boundary.
 *
 * Game orchestration imports this module, never a provider-specific transport.
 * Firebase remains the only active provider until a WebSocket adapter can use a
 * real short-lived classroom access token and passes public WSS verification.
 */
import { transportConfig } from './config.js';
const adapter = transportConfig.provider === 'knas'
  ? await import('./knas-player.js') : await import('./firebase-adapter.js');
export const { bindPilotLogin, getLocalIdentity, getRemotePlayers,
  isMultiplayerConnected, leaveMultiplayer, publishLocalState,
  publishTeamChange, publishTeamVolley, updateRemotePlayers } = adapter;
