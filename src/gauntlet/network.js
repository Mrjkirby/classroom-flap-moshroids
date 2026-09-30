import { getDatabase, ref, get, onValue, runTransaction } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js';
import { ROOM_PATH } from '../gameMode.js';
import { sharedClock } from '../sharedClock.js';
import { selectSurvivor, acceptCannonShot, finishGauntlet, resetGauntletState } from './rules.js';
import { perimeterSlots } from './perimeterLayout.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../worldConfig.js';
import { SHOT_LIFETIME } from './projectiles.js';

// The existing bossState write boundary is scoped to this mode's separate room.
const STATE_PATH = `${ROOM_PATH}/bossState`;
let identity = () => null;
let state = null;
let unsubscribe = null;

export function configureGauntletNetwork({ currentUser }) {
  identity = currentUser;
}

export function getGauntletState() { return state; }

export async function startGauntletListener() {
  const stateRef = ref(getDatabase(), STATE_PATH);
  const initial = await runTransaction(stateRef, current =>
    current === null ? { mode: '1vw', phase: 'normal', round: 0 } : undefined,
  { applyLocally: false });
  const value = initial.snapshot.val();
  if (value?.mode !== '1vw') throw new Error('1VW room mode mismatch.');
  state = value;
  unsubscribe?.();
  unsubscribe = onValue(stateRef, snapshot => { state = snapshot.val(); });
}

export function stopGauntletListener() {
  unsubscribe?.();
  unsubscribe = null;
  state = null;
}

export async function claimSurvivor() {
  const user = identity();
  if (!user || state?.phase !== 'normal') return false;
  const player = (await get(ref(getDatabase(), `${ROOM_PATH}/players/${user.uid}`))).val();
  if (player?.guns !== 40 || player.visible === false) return false;
  const at = sharedClock.now();
  const result = await runTransaction(ref(getDatabase(), STATE_PATH), current =>
    selectSurvivor(current, { uid: user.uid, name: player.name, at }), { applyLocally: false });
  return result.committed && result.snapshot.val()?.survivorUid === user.uid;
}

export async function activateGauntlet() {
  if (state?.phase !== 'setup' || sharedClock.now() < state.gauntletStartedAt) return false;
  const result = await runTransaction(ref(getDatabase(), STATE_PATH), current => {
    if (current?.phase !== 'setup' || sharedClock.now() < current.gauntletStartedAt) return undefined;
    return { ...current, phase: 'gauntlet' };
  }, { applyLocally: false });
  return result.committed;
}

export async function fireCannon(angle) {
  const user = identity();
  const current = state;
  if (!user || current?.phase !== 'gauntlet' || current.survivorUid === user.uid) return false;
  const players = (await get(ref(getDatabase(), `${ROOM_PATH}/players`))).val() || {};
  const player = players[user.uid];
  if (!player || player.visible === false || !Number.isFinite(angle)) return false;
  const slot = perimeterSlots(Object.keys(players).filter(uid => uid !== current.survivorUid),
    WORLD_WIDTH, WORLD_HEIGHT).get(user.uid);
  if (!slot) return false;
  const at = sharedClock.now();
  const result = await runTransaction(ref(getDatabase(), `${STATE_PATH}/cannons/${user.uid}`), previous =>
    acceptCannonShot(previous, { at, angle, round: current.round, x: slot.x, y: slot.y,
      lifetime: SHOT_LIFETIME }),
  { applyLocally: false });
  return result.committed;
}

export async function endGauntlet(reason, survivorUid) {
  const at = sharedClock.now();
  const result = await runTransaction(ref(getDatabase(), STATE_PATH), current =>
    finishGauntlet(current, { uid: survivorUid, reason, at }), { applyLocally: false });
  return result.committed;
}

export async function endIfSurvivorDisconnected() {
  const current = state;
  if (!['setup', 'gauntlet', 'result'].includes(current?.phase)) return false;
  const survivor = (await get(ref(getDatabase(), `${ROOM_PATH}/players/${current.survivorUid}`))).val();
  if (survivor) return false;
  if (current.phase === 'result') return sharedClock.now() - current.endedAt >= 3000 && resetGauntlet();
  return endGauntlet('disconnect', current.survivorUid);
}

export async function resetGauntlet() {
  const result = await runTransaction(ref(getDatabase(), STATE_PATH), resetGauntletState,
    { applyLocally: false });
  return result.committed;
}
