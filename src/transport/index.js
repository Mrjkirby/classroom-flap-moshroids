/*
 * MOSHROIDS multiplayer boundary.
 *
 * Game orchestration imports this module, never a provider-specific transport.
 * Firebase remains the only active provider until a WebSocket adapter can use a
 * real short-lived classroom access token and passes parity verification.
 */
export * from './firebase-adapter.js';
