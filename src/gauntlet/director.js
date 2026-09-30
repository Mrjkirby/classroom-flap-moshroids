import { IS_ONE_VS_WORLD } from '../gameMode.js';
import { wrap } from '../physics.js';
import { sharedClock } from '../sharedClock.js';
import { getDestroyedAsteroids, destroySharedAsteroid } from '../asteroidNetwork.js';
import { getGauntletState, claimSurvivor, activateGauntlet, fireCannon,
  endGauntlet, endIfSurvivorDisconnected, resetGauntlet } from './network.js';
import { perimeterSlots } from './perimeterLayout.js';
import { BouncingTrajectories } from './bounceTrajectory.js';
import { activeCannonShots } from './projectiles.js';

export function createGauntletDirector({ world, weaponSystem, getWorldWidth, getWorldHeight,
  isJoined, getRemotePlayers, getLocalIdentity, publishPlayerState, addExplosion }) {
  const trajectories = new BouncingTrajectories();
  const pending = new Set();
  const banner = IS_ONE_VS_WORLD ? document.createElement('div') : null;
  if (banner) {
    banner.className = 'gauntlet-banner';
    banner.setAttribute('aria-live', 'polite');
    document.querySelector('.game-shell').prepend(banner);
  }
  let slots = new Map();
  let obstacles = [];
  let rosterKey = '';
  let lastRound = null;
  let lastShotState = null;
  let lastShotSecond = -1;
  let phasePending = false;
  let lastDisconnectCheck = 0;
  let lastClaimAttempt = 0;
  let lastCannonAttempt = 0;

  function active() { return IS_ONE_VS_WORLD && getGauntletState()?.phase === 'gauntlet'; }
  function isPerimeterShip(ship) {
    const uid = ship.owner === 'A' ? getLocalIdentity()?.uid : ship.owner;
    return active() && !!uid && uid !== getGauntletState().survivorUid;
  }

  function update(now) {
    if (!IS_ONE_VS_WORLD || !isJoined()) return;
    const state = getGauntletState();
    if (!state) return;
    if (state.phase === 'setup' && now >= state.gauntletStartedAt && !phasePending) {
      phasePending = true;
      activateGauntlet().catch(console.error).finally(() => { phasePending = false; });
    }
    if (['setup', 'gauntlet', 'result'].includes(state.phase) && now - lastDisconnectCheck >= 1000) {
      lastDisconnectCheck = now;
      endIfSurvivorDisconnected().catch(console.error);
    }
    if (lastRound !== null && state.round !== lastRound && state.phase === 'normal') {
      clear();
      const ship = world.ships.find(candidate => candidate.owner === 'A');
      if (ship) {
        ship.perimeterLocked = false;
        ship.x = getWorldWidth() / 2;
        ship.y = getWorldHeight() / 2;
        ship.velocityX = ship.velocityY = 0;
        weaponSystem.setGunCount(1);
        publishPlayerState(true);
      }
    }
    lastRound = state.round;
    if (state.phase === 'normal' && weaponSystem.getGunCount() === 40 &&
        now - lastClaimAttempt >= 1000) {
      lastClaimAttempt = now;
      claimSurvivor().catch(console.error);
    }

    const ids = [...getRemotePlayers().keys()];
    const localUid = getLocalIdentity()?.uid;
    if (localUid) ids.push(localUid);
    slots = state.phase === 'gauntlet'
      ? perimeterSlots(ids.filter(uid => uid !== state.survivorUid), getWorldWidth(), getWorldHeight())
      : new Map();
    const nextKey = `${state.round}:${JSON.stringify([...slots])}`;
    const changed = nextKey !== rosterKey;
    if (changed) {
      rosterKey = nextKey;
      obstacles = [...slots.values()].map(slot => ({ ...slot, radius: 15 }));
      trajectories.clear();
      lastShotState = null;
    }
    for (const ship of world.ships) {
      const uid = ship.owner === 'A' ? localUid : ship.owner;
      const slot = slots.get(uid);
      ship.perimeterLocked = !!slot;
      if (slot) {
        ship.x = slot.x;
        ship.y = slot.y;
        ship.velocityX = ship.velocityY = 0;
        if (changed) ship.angle = slot.angle;
        ship.visible = true;
        ship.state = 'ACTIVE';
      }
    }

    if (state.phase === 'result') {
      const seconds = Math.max(0, Math.floor((state.endedAt - state.gauntletStartedAt) / 1000));
      banner.textContent = `SURVIVOR DEFEATED — ${state.survivorName} — SURVIVAL TIME ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    } else if (state.phase === 'gauntlet') {
      banner.textContent = `ONE VS WORLD — ${state.survivorName} — ${Math.floor((now - state.gauntletStartedAt) / 1000)}s`;
    } else if (state.phase === 'setup') {
      banner.textContent = `${state.survivorName} IS THE SURVIVOR — GET READY`;
    } else {
      banner.textContent = 'ONE VS WORLD — FIRST TO 40 GUNS BECOMES THE SURVIVOR';
    }
  }

  function positionAsteroid(asteroid, now) {
    if (!active()) return;
    const state = getGauntletState();
    const width = getWorldWidth();
    const height = getWorldHeight();
    const startedAt = Math.max(state.gauntletStartedAt, asteroid.spawnTimestamp);
    const elapsed = (startedAt - asteroid.spawnTimestamp) / 1000 * 60;
    const initial = {
      x: wrap(asteroid.startX + asteroid.velocityX * elapsed, width),
      y: wrap(asteroid.startY + asteroid.velocityY * elapsed, height),
      vx: asteroid.velocityX * 60 / 1000,
      vy: asteroid.velocityY * 60 / 1000,
      radius: asteroid.radius,
      at: startedAt
    };
    const position = trajectories.position(asteroid.id, initial, now, obstacles, width, height, rosterKey);
    asteroid.x = position.x;
    asteroid.y = position.y;
  }

  function updateProjectiles(now) {
    if (!active()) { world.gauntletProjectiles = []; return; }
    const state = getGauntletState();
    const second = Math.floor(now / 1000);
    const newSecond = second !== lastShotSecond;
    if (state !== lastShotState || newSecond) {
      world.gauntletProjectiles = activeCannonShots(state, now, getDestroyedAsteroids(),
        getWorldWidth(), getWorldHeight());
      lastShotState = state;
      lastShotSecond = second;
    }
    world.gauntletProjectiles = world.gauntletProjectiles.filter(asteroid =>
      !pending.has(asteroid.id) && !getDestroyedAsteroids().has(asteroid.id));
    world.gauntletProjectiles.forEach(asteroid => positionAsteroid(asteroid, now));
    if (newSecond) trajectories.retain(new Set([
      ...world.asteroids.map(asteroid => asteroid.id),
      ...world.gauntletProjectiles.map(asteroid => asteroid.id)
    ]));
  }

  async function destroyProjectile(asteroid, color) {
    if (pending.has(asteroid.id)) return false;
    pending.add(asteroid.id);
    world.gauntletProjectiles = world.gauntletProjectiles.filter(candidate => candidate.id !== asteroid.id);
    const won = await destroySharedAsteroid(asteroid.id);
    if (won) addExplosion(asteroid.x, asteroid.y, color, 16, 4);
    else { pending.delete(asteroid.id); lastShotState = null; }
    return won;
  }

  function fire(ship) {
    if (!isPerimeterShip(ship)) return false;
    const now = sharedClock.now();
    if (now - lastCannonAttempt >= 1000) {
      lastCannonAttempt = now;
      fireCannon(ship.angle).catch(console.error);
    }
    return true;
  }

  function onDeath() {
    if (active() && getGauntletState().survivorUid === getLocalIdentity()?.uid) {
      endGauntlet('defeated', getLocalIdentity().uid).catch(console.error);
    }
  }

  function onSpellingComplete() {
    const state = getGauntletState();
    if (IS_ONE_VS_WORLD && state?.phase === 'result' &&
        state.survivorUid === getLocalIdentity()?.uid) resetGauntlet().catch(console.error);
  }

  function clear() {
    world.gauntletProjectiles = [];
    slots = new Map();
    obstacles = [];
    trajectories.clear();
    pending.clear();
    lastShotState = null;
  }

  return { active, getState: getGauntletState, isPerimeterShip, update, positionAsteroid, updateProjectiles,
    destroyProjectile, isProjectilePending: id => pending.has(id), fire, onDeath,
    onSpellingComplete, clear, claimSurvivor: () => IS_ONE_VS_WORLD ? claimSurvivor() : false };
}
