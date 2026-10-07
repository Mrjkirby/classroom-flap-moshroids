import { connect, disconnect, store, subscribe, send, request } from './knas-store.js';

let remotePlayers = new Map();
let lastSend = -Infinity;
let lastLocalState = {};
function syncPlayers() {
  const next = new Map();
  for (const [uid, player] of store.players) {
    if (uid === store.identity?.uid) continue;
    const previous = remotePlayers.get(uid);
    next.set(uid, { ...player, uid, targetX: player.x, targetY: player.y, targetAngle: player.angle,
      renderX: previous?.renderX ?? player.x, renderY: previous?.renderY ?? player.y,
      renderAngle: previous?.renderAngle ?? player.angle, teamShots: player.teamShots || [] });
  }
  remotePlayers = next;
}
export function bindPilotLogin(getInitialState, onJoined) {
  let joined = false;
  const element = id => document.getElementById(id);
  // No alternate pilot selection: the server welcome supplies the name.
  if (element('pilotLoginForm')) element('pilotLoginForm').hidden = true;
  subscribe(value => {
    if (value.type === 'status') {
      document.body.classList.toggle('network-offline', !value.connected);
      if (element('networkStatus')) element('networkStatus').textContent = value.connected ? 'ONLINE · KNAS' : 'OFFLINE';
      if (element('pilotLoginStatus')) element('pilotLoginStatus').textContent = value.detail;
    }
    if (['welcome', 'playerJoined', 'playerState', 'playerLeft'].includes(value.type)) syncPlayers();
    if (value.type === 'ready') {
      if (element('pilotLoginOverlay')) { element('pilotLoginOverlay').hidden = true; element('pilotLoginOverlay').classList.add('hidden'); }
      for (const id of ['pilotDisplayName', 'controlsPilotName']) if (element(id)) element(id).textContent = store.identity.name;
      publishLocalState(getInitialState(), true);
      if (!joined) { joined = true; onJoined(store.identity); }
    }
  });
  try { connect(); } catch { if (element('pilotLoginStatus')) element('pilotLoginStatus').textContent = 'Secure classroom connection is not configured.'; }
}
export const getLocalIdentity = () => store.identity;
export const getRemotePlayers = () => remotePlayers;
export const isMultiplayerConnected = () => store.connected;
export async function publishLocalState(state, force = false) {
  if (!state || (!force && performance.now() - lastSend < 1000 / 12)) return false;
  lastSend = performance.now();
  lastLocalState = { ...lastLocalState, ...state };
  const current = store.players.get(store.identity?.uid);
  return send({ type: 'state', state: { ...lastLocalState, ...(state.perimeterLocked && current ?
    { x: current.x, y: current.y, velocityX: current.velocityX, velocityY: current.velocityY } : {}) } });
}
export async function publishTeamChange(team, ship) {
  await publishLocalState({ x: ship.x, y: ship.y, visible: ship.visible }, true);
  return request('teamChange', { team });
}
export async function publishTeamVolley(ship, guns) {
  await publishLocalState({ x: ship.x, y: ship.y, angle: ship.angle,
    velocityX: ship.velocityX, velocityY: ship.velocityY, guns }, true); return request('teamVolley');
}
export async function leaveMultiplayer() { disconnect(); remotePlayers.clear(); }
export function updateRemotePlayers(dt, width, height) {
  const blend = 1 - Math.pow(0.0005, dt), angleBlend = 1 - Math.pow(0.002, dt);
  for (const player of remotePlayers.values()) {
    for (const [axis, size] of [['X', width], ['Y', height]]) {
      let delta = player[`target${axis}`] - player[`render${axis}`];
      if (Math.abs(delta) > size / 2) delta -= Math.sign(delta) * size;
      player[`render${axis}`] = (player[`render${axis}`] + delta * blend + size) % size;
    }
    let difference = (player.targetAngle - player.renderAngle) % (Math.PI * 2);
    if (difference > Math.PI) difference -= Math.PI * 2;
    if (difference < -Math.PI) difference += Math.PI * 2;
    player.renderAngle += difference * angleBlend;
  }
}
