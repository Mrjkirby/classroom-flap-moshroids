/*
 * MOSHROIDS MULTIPLAYER
 *
 * Firebase handles:
 * - anonymous player identity
 * - pilot names
 * - shared player state
 * - disconnect cleanup
 * - shared gun drops
 * - atomic gun pickup claims
 * - shared asteroid destruction
 *
 * Firebase DOES NOT run ship physics.
 * Each browser remains responsible for its own local ship.
 */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';

import {
  getAuth,
  onAuthStateChanged,
  signInAnonymously
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';

import {
  getDatabase,
  ref,
  set,
  update,
  remove,
  onValue,
  onDisconnect,
  serverTimestamp,
  runTransaction
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-database.js';


/* =========================================================
   FIREBASE
   ========================================================= */

const firebaseConfig = {
  apiKey: 'AIzaSyCe69g85VilnwMeOgpcJ0_bIgb-VFDajso',
  authDomain: 'routeriotgame.firebaseapp.com',
  databaseURL: 'https://routeriotgame-default-rtdb.firebaseio.com',
  projectId: 'routeriotgame',
  storageBucket: 'routeriotgame.firebasestorage.app',
  messagingSenderId: '872258112513',
  appId: '1:872258112513:web:3b1d9694a1c78f04f8c400',
  measurementId: 'G-5MBCFDB983'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const database = getDatabase(app);


/* =========================================================
   ROOM
   ========================================================= */

const ROOM_ID = 'classroom';
const roomPath = `moshroids/rooms/${ROOM_ID}`;
const playersPath = `${roomPath}/players`;
const gunDropsPath = `${roomPath}/gunDrops`;
const destroyedAsteroidsPath = `${roomPath}/destroyedAsteroids`;

const NETWORK_SEND_INTERVAL = 1000 / 12;
const GUN_DROP_LIFETIME = 10000;


/* =========================================================
   STATE
   ========================================================= */

let currentUser = null;
let pilotName = '';
let playerRef = null;

let remotePlayers = new Map();
let remoteGunDrops = new Map();
let destroyedAsteroids = new Map();

let unsubscribePlayers = null;
let unsubscribeGunDrops = null;
let unsubscribeDestroyedAsteroids = null;

let lastNetworkSend = 0;
let connected = false;


/* =========================================================
   UI
   ========================================================= */

const loginOverlay = document.querySelector('#pilotLoginOverlay');
const loginForm = document.querySelector('#pilotLoginForm');
const pilotNameInput = document.querySelector('#pilotNameInput');
const pilotEnterButton = document.querySelector('#pilotEnterButton');
const loginStatus = document.querySelector('#pilotLoginStatus');
const pilotDisplayName = document.querySelector('#pilotDisplayName');
const controlsPilotName = document.querySelector('#controlsPilotName');
const networkStatus = document.querySelector('#networkStatus');

function setStatus(message, state = '') {
  if (!loginStatus) return;

  loginStatus.textContent = message;
  loginStatus.classList.remove('error', 'connected');

  if (state) loginStatus.classList.add(state);
}

function setNetworkStatus(isConnected) {
  connected = isConnected;

  document.body.classList.toggle('network-offline', !isConnected);

  if (networkStatus) {
    networkStatus.textContent = isConnected
      ? 'MULTIPLAYER LIVE'
      : 'NETWORK OFFLINE';
  }
}


/* =========================================================
   HELPERS
   ========================================================= */

function cleanPilotName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}

function clampGunCount(value) {
  return Math.max(1, Math.min(40, Math.floor(Number(value) || 1)));
}

function applyPilotName(name) {
  pilotName = name;

  if (pilotDisplayName) pilotDisplayName.textContent = name.toUpperCase();
  if (controlsPilotName) controlsPilotName.textContent = name.toUpperCase();
}


/* =========================================================
   AUTHENTICATION
   ========================================================= */

function waitForAuth() {
  return new Promise((resolve, reject) => {
    const existingUser = auth.currentUser;

    if (existingUser) {
      currentUser = existingUser;
      resolve(existingUser);
      return;
    }

    let settled = false;

    const unsubscribe = onAuthStateChanged(
      auth,
      (user) => {
        if (!user || settled) return;

        settled = true;
        unsubscribe();

        currentUser = user;
        resolve(user);
      },
      (error) => {
        if (settled) return;

        settled = true;
        unsubscribe();
        reject(error);
      }
    );

    signInAnonymously(auth).catch((error) => {
      if (settled) return;

      settled = true;
      unsubscribe();
      reject(error);
    });
  });
}


/* =========================================================
   PLAYER PRESENCE
   ========================================================= */

async function createPlayerRecord(initialState) {
  if (!currentUser) {
    throw new Error('Firebase user is not authenticated.');
  }

  playerRef = ref(database, `${playersPath}/${currentUser.uid}`);

  await onDisconnect(playerRef).remove();

  await set(playerRef, {
    name: pilotName,
    x: Number(initialState.x) || 0,
    y: Number(initialState.y) || 0,
    angle: Number(initialState.angle) || 0,
    velocityX: Number(initialState.velocityX) || 0,
    velocityY: Number(initialState.velocityY) || 0,
    visible: initialState.visible !== false,
    score: Number(initialState.score) || 0,
    guns: clampGunCount(initialState.guns),
    updatedAt: serverTimestamp()
  });
}


/* =========================================================
   REMOTE PLAYERS
   ========================================================= */

function startPlayerListener() {
  if (unsubscribePlayers) unsubscribePlayers();

  const playersRef = ref(database, playersPath);

  unsubscribePlayers = onValue(
    playersRef,
    (snapshot) => {
      const data = snapshot.val() || {};
      const nextPlayers = new Map();

      Object.entries(data).forEach(([uid, player]) => {
        if (currentUser && uid === currentUser.uid) return;

        if (
          !player ||
          typeof player.x !== 'number' ||
          typeof player.y !== 'number'
        ) {
          return;
        }

        const previous = remotePlayers.get(uid);

        nextPlayers.set(uid, {
          uid,
          name: cleanPilotName(player.name) || 'PILOT',

          targetX: player.x,
          targetY: player.y,
          targetAngle: Number(player.angle) || 0,

          velocityX: Number(player.velocityX) || 0,
          velocityY: Number(player.velocityY) || 0,

          visible: player.visible !== false,
          score: Number(player.score) || 0,
          guns: clampGunCount(player.guns),

          renderX: previous ? previous.renderX : player.x,
          renderY: previous ? previous.renderY : player.y,
          renderAngle: previous
            ? previous.renderAngle
            : Number(player.angle) || 0
        });
      });

      remotePlayers = nextPlayers;
      setNetworkStatus(true);
    },
    (error) => {
      console.error('Moshroids player listener failed:', error);
      setNetworkStatus(false);
    }
  );
}


/* =========================================================
   SHARED ASTEROID DESTRUCTION
   ========================================================= */

/*
 * Asteroids themselves remain locally simulated.
 *
 * Because every browser creates the same asteroid IDs and deterministic
 * movement, Firebase only needs to synchronize the IMPORTANT EVENT:
 *
 *     asteroid-3 was destroyed
 *
 * Every browser then removes asteroid-3 from its local world.
 */

function startDestroyedAsteroidListener() {
  if (unsubscribeDestroyedAsteroids) {
    unsubscribeDestroyedAsteroids();
  }

  const asteroidRef = ref(database, destroyedAsteroidsPath);

  unsubscribeDestroyedAsteroids = onValue(
    asteroidRef,
    (snapshot) => {
      const data = snapshot.val() || {};
      const nextDestroyed = new Map();

      Object.entries(data).forEach(([asteroidId, destruction]) => {
        if (!destruction) return;

        nextDestroyed.set(asteroidId, {
          asteroidId,
          destroyedBy: String(destruction.destroyedBy || ''),
          destroyedAt: Number(destruction.destroyedAt) || 0
        });
      });

      destroyedAsteroids = nextDestroyed;
    },
    (error) => {
      console.error(
        'Moshroids asteroid listener failed:',
        error
      );
    }
  );
}


/*
 * Record one asteroid destruction.
 *
 * runTransaction means two students shooting the same asteroid at nearly
 * the same time still creates only ONE authoritative destruction record.
 */
async function destroySharedAsteroid(asteroidId) {
  if (!currentUser || !asteroidId) return false;

  const asteroidRef = ref(
    database,
    `${destroyedAsteroidsPath}/${asteroidId}`
  );

  try {
    const result = await runTransaction(
      asteroidRef,
      (current) => {
        /*
         * Somebody already destroyed it.
         */
        if (current) return undefined;

        return {
          destroyedBy: currentUser.uid,
          destroyedAt: Date.now()
        };
      },
      {
        applyLocally: false
      }
    );

    return result.committed;
  } catch (error) {
    console.error(
      'Moshroids asteroid destruction failed:',
      error
    );

    return false;
  }
}


function isAsteroidDestroyed(asteroidId) {
  return destroyedAsteroids.has(String(asteroidId));
}


function getDestroyedAsteroids() {
  return destroyedAsteroids;
}


/*
 * Useful when we later begin a completely fresh classroom round.
 *
 * Do NOT call this when an individual asteroid respawns.
 * This clears the room-wide destruction history.
 */
async function clearDestroyedAsteroids() {
  if (!currentUser) return false;

  try {
    await remove(ref(database, destroyedAsteroidsPath));
    return true;
  } catch (error) {
    console.error(
      'Moshroids asteroid reset failed:',
      error
    );

    return false;
  }
}


/* =========================================================
   SHARED GUN DROPS
   ========================================================= */

function startGunDropListener() {
  if (unsubscribeGunDrops) unsubscribeGunDrops();

  const dropsRef = ref(database, gunDropsPath);

  unsubscribeGunDrops = onValue(
    dropsRef,
    (snapshot) => {
      const data = snapshot.val() || {};
      const nextDrops = new Map();

      Object.entries(data).forEach(([id, drop]) => {
        if (
          !drop ||
          typeof drop.x !== 'number' ||
          typeof drop.y !== 'number'
        ) {
          return;
        }

        if (drop.claimedBy) return;

        const createdAt = Number(drop.createdAt) || Date.now();
        const expiresAt =
          Number(drop.expiresAt) ||
          createdAt + GUN_DROP_LIFETIME;

        nextDrops.set(id, {
          id,
          ownerUid: String(drop.ownerUid || ''),
          x: drop.x,
          y: drop.y,
          radius: Number(drop.radius) || 8,
          createdAt,
          expiresAt
        });
      });

      remoteGunDrops = nextDrops;
    },
    (error) => {
      console.error(
        'Moshroids gun-drop listener failed:',
        error
      );
    }
  );
}


/*
 * Every gun is stored as its own Firebase node.
 */
async function publishGunDrops(drops) {
  if (
    !currentUser ||
    !Array.isArray(drops) ||
    !drops.length
  ) {
    return false;
  }

  const writes = {};
  const now = Date.now();

  drops.forEach((drop) => {
    if (!drop?.id) return;

    writes[`${gunDropsPath}/${drop.id}`] = {
      ownerUid: currentUser.uid,
      x: Number(drop.x) || 0,
      y: Number(drop.y) || 0,
      radius: Number(drop.radius) || 8,
      createdAt: now,
      expiresAt: now + GUN_DROP_LIFETIME,
      claimedBy: null
    };
  });

  if (!Object.keys(writes).length) return false;

  try {
    await update(ref(database), writes);
    return true;
  } catch (error) {
    console.error(
      'Moshroids gun-drop publish failed:',
      error
    );

    return false;
  }
}


/*
 * ATOMIC PICKUP CLAIM
 */
async function claimGunDrop(dropId) {
  if (!currentUser || !dropId) return false;

  const dropRef = ref(
    database,
    `${gunDropsPath}/${dropId}`
  );

  try {
    const result = await runTransaction(
      dropRef,
      (drop) => {
        if (!drop) return undefined;
        if (drop.claimedBy) return undefined;

        const expiresAt = Number(drop.expiresAt) || 0;

        if (
          expiresAt > 0 &&
          Date.now() >= expiresAt
        ) {
          return undefined;
        }

        return {
          ...drop,
          claimedBy: currentUser.uid,
          claimedAt: Date.now()
        };
      },
      {
        applyLocally: false
      }
    );

    if (!result.committed) return false;

    const claimedDrop = result.snapshot.val();

    if (
      !claimedDrop ||
      claimedDrop.claimedBy !== currentUser.uid
    ) {
      return false;
    }

    try {
      await remove(dropRef);
    } catch (error) {
      console.warn(
        'Gun was claimed but cleanup was delayed:',
        error
      );
    }

    return true;
  } catch (error) {
    console.error(
      'Moshroids gun pickup failed:',
      error
    );

    return false;
  }
}


async function removeExpiredGunDrop(dropId) {
  if (!currentUser || !dropId) return false;

  const drop = remoteGunDrops.get(dropId);

  if (
    !drop ||
    Date.now() < drop.expiresAt
  ) {
    return false;
  }

  try {
    await remove(
      ref(database, `${gunDropsPath}/${dropId}`)
    );

    return true;
  } catch (error) {
    console.error(
      'Moshroids expired gun cleanup failed:',
      error
    );

    return false;
  }
}


function getGunDrops() {
  return remoteGunDrops;
}


/* =========================================================
   NETWORK SEND
   ========================================================= */

async function publishLocalState(state, force = false) {
  if (
    !connected ||
    !playerRef ||
    !currentUser
  ) {
    return false;
  }

  const now = performance.now();

  if (
    !force &&
    now - lastNetworkSend < NETWORK_SEND_INTERVAL
  ) {
    return false;
  }

  lastNetworkSend = now;

  try {
    await update(playerRef, {
      name: pilotName,

      x: Number(state.x) || 0,
      y: Number(state.y) || 0,

      angle: Number(state.angle) || 0,

      velocityX: Number(state.velocityX) || 0,
      velocityY: Number(state.velocityY) || 0,

      visible: state.visible !== false,
      score: Number(state.score) || 0,
      guns: clampGunCount(state.guns),

      updatedAt: serverTimestamp()
    });

    return true;
  } catch (error) {
    console.error(
      'Moshroids state update failed:',
      error
    );

    setNetworkStatus(false);

    return false;
  }
}


/* =========================================================
   SMOOTH REMOTE MOVEMENT
   ========================================================= */

function shortestAngleDifference(from, to) {
  let difference =
    (to - from) %
    (Math.PI * 2);

  if (difference > Math.PI) {
    difference -= Math.PI * 2;
  }

  if (difference < -Math.PI) {
    difference += Math.PI * 2;
  }

  return difference;
}


function updateRemotePlayers(dt, worldWidth, worldHeight) {
  const positionBlend =
    1 - Math.pow(0.0005, dt);

  const angleBlend =
    1 - Math.pow(0.002, dt);

  remotePlayers.forEach((player) => {
    let deltaX =
      player.targetX - player.renderX;

    let deltaY =
      player.targetY - player.renderY;

    if (Math.abs(deltaX) > worldWidth / 2) {
      deltaX -=
        Math.sign(deltaX) *
        worldWidth;
    }

    if (Math.abs(deltaY) > worldHeight / 2) {
      deltaY -=
        Math.sign(deltaY) *
        worldHeight;
    }

    player.renderX +=
      deltaX * positionBlend;

    player.renderY +=
      deltaY * positionBlend;

    if (player.renderX < 0) {
      player.renderX += worldWidth;
    }

    if (player.renderX > worldWidth) {
      player.renderX -= worldWidth;
    }

    if (player.renderY < 0) {
      player.renderY += worldHeight;
    }

    if (player.renderY > worldHeight) {
      player.renderY -= worldHeight;
    }

    player.renderAngle +=
      shortestAngleDifference(
        player.renderAngle,
        player.targetAngle
      ) *
      angleBlend;
  });
}


/* =========================================================
   LOGIN
   ========================================================= */

async function joinMultiplayer(name, initialState) {
  const cleanedName = cleanPilotName(name);

  if (!cleanedName) {
    throw new Error('Enter a pilot name.');
  }

  applyPilotName(cleanedName);
  setStatus('CONNECTING TO MOSH...');

  if (pilotEnterButton) {
    pilotEnterButton.disabled = true;
  }

  try {
    await waitForAuth();

    await createPlayerRecord(initialState);

    startPlayerListener();
    startGunDropListener();
    startDestroyedAsteroidListener();

    setNetworkStatus(true);
    setStatus('CONNECTED', 'connected');

    if (loginOverlay) {
      loginOverlay.classList.add('hidden');
    }

    return {
      uid: currentUser.uid,
      name: pilotName
    };
  } catch (error) {
    console.error(
      'Moshroids multiplayer login failed:',
      error
    );

    setNetworkStatus(false);

    setStatus(
      'CONNECTION FAILED — TRY AGAIN',
      'error'
    );

    throw error;
  } finally {
    if (pilotEnterButton) {
      pilotEnterButton.disabled = false;
    }
  }
}


/* =========================================================
   LOGIN FORM
   ========================================================= */

function bindPilotLogin(getInitialState, onJoined) {
  if (!loginForm || !pilotNameInput) return;

  const rememberedName =
    localStorage.getItem('moshroidsPilotName');

  if (rememberedName) {
    pilotNameInput.value = rememberedName;
  }

  loginForm.addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();

      const name =
        cleanPilotName(pilotNameInput.value);

      if (!name) {
        setStatus(
          'ENTER A PILOT NAME',
          'error'
        );

        pilotNameInput.focus();
        return;
      }

      try {
        const initialState = getInitialState();

        const identity =
          await joinMultiplayer(
            name,
            initialState
          );

        localStorage.setItem(
          'moshroidsPilotName',
          name
        );

        if (onJoined) {
          onJoined(identity);
        }
      } catch {
        /*
         * joinMultiplayer already displays the error.
         */
      }
    }
  );

  requestAnimationFrame(
    () => pilotNameInput.focus()
  );
}


/* =========================================================
   CLEANUP
   ========================================================= */

async function leaveMultiplayer() {
  if (unsubscribePlayers) {
    unsubscribePlayers();
    unsubscribePlayers = null;
  }

  if (unsubscribeGunDrops) {
    unsubscribeGunDrops();
    unsubscribeGunDrops = null;
  }

  if (unsubscribeDestroyedAsteroids) {
    unsubscribeDestroyedAsteroids();
    unsubscribeDestroyedAsteroids = null;
  }

  if (playerRef) {
    try {
      await remove(playerRef);
    } catch {
      /*
       * onDisconnect remains the fallback.
       */
    }
  }

  playerRef = null;

  remotePlayers.clear();
  remoteGunDrops.clear();
  destroyedAsteroids.clear();

  setNetworkStatus(false);
}


/* =========================================================
   PUBLIC API
   ========================================================= */

function getRemotePlayers() {
  return remotePlayers;
}

function getLocalIdentity() {
  if (!currentUser) return null;

  return {
    uid: currentUser.uid,
    name: pilotName
  };
}

function isMultiplayerConnected() {
  return connected;
}


export {
  bindPilotLogin,
  claimGunDrop,
  clearDestroyedAsteroids,
  destroySharedAsteroid,
  getDestroyedAsteroids,
  getGunDrops,
  getLocalIdentity,
  getRemotePlayers,
  isAsteroidDestroyed,
  isMultiplayerConnected,
  leaveMultiplayer,
  publishGunDrops,
  publishLocalState,
  removeExpiredGunDrop,
  updateRemotePlayers
};
