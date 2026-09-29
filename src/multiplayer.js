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

let unsubscribePlayers = null;
let unsubscribeGunDrops = null;

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
  return Math.max(
    1,
    Math.min(40, Math.floor(Number(value) || 1))
  );
}


function applyPilotName(name) {
  pilotName = name;

  if (pilotDisplayName) {
    pilotDisplayName.textContent = name.toUpperCase();
  }

  if (controlsPilotName) {
    controlsPilotName.textContent = name.toUpperCase();
  }
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

  playerRef = ref(
    database,
    `${playersPath}/${currentUser.uid}`
  );

  /*
   * If the browser disappears unexpectedly,
   * remove this player's live ship.
   */
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
  if (unsubscribePlayers) {
    unsubscribePlayers();
  }

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

          renderX: previous
            ? previous.renderX
            : player.x,

          renderY: previous
            ? previous.renderY
            : player.y,

          renderAngle: previous
            ? previous.renderAngle
            : Number(player.angle) || 0
        });
      });

      remotePlayers = nextPlayers;
      setNetworkStatus(true);
    },
    (error) => {
      console.error(
        'Moshroids player listener failed:',
        error
      );

      setNetworkStatus(false);
    }
  );
}


/* =========================================================
   SHARED GUN DROPS
   ========================================================= */

function startGunDropListener() {
  if (unsubscribeGunDrops) {
    unsubscribeGunDrops();
  }

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

        /*
         * Claimed drops should disappear immediately from gameplay,
         * even during the tiny interval before the winner removes
         * the Firebase node.
         */
        if (drop.claimedBy) return;

        const createdAt =
          Number(drop.createdAt) || Date.now();

        const expiresAt =
          Number(drop.expiresAt) ||
          createdAt + GUN_DROP_LIFETIME;

        nextDrops.set(id, {
          id,

          ownerUid:
            String(drop.ownerUid || ''),

          x: drop.x,
          y: drop.y,

          radius:
            Number(drop.radius) || 8,

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
 *
 * If a player with 17 guns dies, this writes 17 independent
 * pickups. Each can then be claimed independently.
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

      radius:
        Number(drop.radius) || 8,

      createdAt: now,
      expiresAt:
        now + GUN_DROP_LIFETIME,

      claimedBy: null
    };
  });

  if (!Object.keys(writes).length) {
    return false;
  }

  try {
    await update(
      ref(database),
      writes
    );

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
 *
 * IMPORTANT:
 *
 * We do NOT use deletion itself as the claim.
 *
 * Instead Firebase atomically changes:
 *
 *     claimedBy: null
 *
 * to:
 *
 *     claimedBy: <winning UID>
 *
 * If two students hit the same gun at nearly the same time,
 * runTransaction retries against the latest value. Only one UID
 * can become the owner.
 *
 * After winning, that client removes the pickup node.
 */
async function claimGunDrop(dropId) {
  if (!currentUser || !dropId) {
    return false;
  }

  const dropRef = ref(
    database,
    `${gunDropsPath}/${dropId}`
  );

  try {
    const result = await runTransaction(
      dropRef,
      (drop) => {
        /*
         * Returning undefined aborts the transaction.
         */
        if (!drop) {
          return undefined;
        }

        /*
         * Somebody else already owns this pickup.
         */
        if (drop.claimedBy) {
          return undefined;
        }

        const expiresAt =
          Number(drop.expiresAt) || 0;

        /*
         * Expired guns cannot be collected.
         */
        if (
          expiresAt > 0 &&
          Date.now() >= expiresAt
        ) {
          return undefined;
        }

        return {
          ...drop,

          claimedBy:
            currentUser.uid,

          claimedAt:
            Date.now()
        };
      },
      {
        applyLocally: false
      }
    );

    if (!result.committed) {
      return false;
    }

    const claimedDrop =
      result.snapshot.val();

    /*
     * Do not trust "committed" alone.
     * Verify that THIS browser owns the resulting claim.
     */
    if (
      !claimedDrop ||
      claimedDrop.claimedBy !==
        currentUser.uid
    ) {
      return false;
    }

    /*
     * The claim is now authoritative.
     * Remove the pickup from Firebase.
     *
     * Even if this remove fails temporarily, every listener ignores
     * claimed drops, so nobody else can collect it.
     */
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


/*
 * Expired gun cleanup.
 *
 * Multiple browsers may notice the same expiration.
 * That is fine: removing a node that is already gone is harmless.
 */
async function removeExpiredGunDrop(dropId) {
  if (!currentUser || !dropId) {
    return false;
  }

  const drop =
    remoteGunDrops.get(dropId);

  if (
    !drop ||
    Date.now() <
      drop.expiresAt
  ) {
    return false;
  }

  try {
    await remove(
      ref(
        database,
        `${gunDropsPath}/${dropId}`
      )
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

async function publishLocalState(
  state,
  force = false
) {
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
    now - lastNetworkSend <
      NETWORK_SEND_INTERVAL
  ) {
    return false;
  }

  lastNetworkSend = now;

  try {
    await update(
      playerRef,
      {
        name: pilotName,

        x: Number(state.x) || 0,
        y: Number(state.y) || 0,

        angle:
          Number(state.angle) || 0,

        velocityX:
          Number(state.velocityX) || 0,

        velocityY:
          Number(state.velocityY) || 0,

        visible:
          state.visible !== false,

        score:
          Number(state.score) || 0,

        guns:
          clampGunCount(state.guns),

        updatedAt:
          serverTimestamp()
      }
    );

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

function shortestAngleDifference(
  from,
  to
) {
  let difference =
    (to - from) %
    (Math.PI * 2);

  if (difference > Math.PI) {
    difference -=
      Math.PI * 2;
  }

  if (difference < -Math.PI) {
    difference +=
      Math.PI * 2;
  }

  return difference;
}


function updateRemotePlayers(
  dt,
  worldWidth,
  worldHeight
) {
  const positionBlend =
    1 -
    Math.pow(
      0.0005,
      dt
    );

  const angleBlend =
    1 -
    Math.pow(
      0.002,
      dt
    );

  remotePlayers.forEach(
    (player) => {
      let deltaX =
        player.targetX -
        player.renderX;

      let deltaY =
        player.targetY -
        player.renderY;

      /*
       * Interpolate across wrapped arena boundaries using
       * the shortest route instead of crossing the whole map.
       */
      if (
        Math.abs(deltaX) >
        worldWidth / 2
      ) {
        deltaX -=
          Math.sign(deltaX) *
          worldWidth;
      }

      if (
        Math.abs(deltaY) >
        worldHeight / 2
      ) {
        deltaY -=
          Math.sign(deltaY) *
          worldHeight;
      }

      player.renderX +=
        deltaX *
        positionBlend;

      player.renderY +=
        deltaY *
        positionBlend;

      if (player.renderX < 0) {
        player.renderX +=
          worldWidth;
      }

      if (
        player.renderX >
        worldWidth
      ) {
        player.renderX -=
          worldWidth;
      }

      if (player.renderY < 0) {
        player.renderY +=
          worldHeight;
      }

      if (
        player.renderY >
        worldHeight
      ) {
        player.renderY -=
          worldHeight;
      }

      player.renderAngle +=
        shortestAngleDifference(
          player.renderAngle,
          player.targetAngle
        ) *
        angleBlend;
    }
  );
}


/* =========================================================
   LOGIN
   ========================================================= */

async function joinMultiplayer(
  name,
  initialState
) {
  const cleanedName =
    cleanPilotName(name);

  if (!cleanedName) {
    throw new Error(
      'Enter a pilot name.'
    );
  }

  applyPilotName(
    cleanedName
  );

  setStatus(
    'CONNECTING TO MOSH...'
  );

  if (pilotEnterButton) {
    pilotEnterButton.disabled =
      true;
  }

  try {
    await waitForAuth();

    await createPlayerRecord(
      initialState
    );

    startPlayerListener();
    startGunDropListener();

    setNetworkStatus(true);

    setStatus(
      'CONNECTED',
      'connected'
    );

    if (loginOverlay) {
      loginOverlay.classList.add(
        'hidden'
      );
    }

    return {
      uid:
        currentUser.uid,

      name:
        pilotName
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
      pilotEnterButton.disabled =
        false;
    }
  }
}


/* =========================================================
   LOGIN FORM
   ========================================================= */

function bindPilotLogin(
  getInitialState,
  onJoined
) {
  if (
    !loginForm ||
    !pilotNameInput
  ) {
    return;
  }

  /*
   * Only the student's chosen display name is remembered.
   * Authentication itself remains Firebase Anonymous Auth.
   */
  const rememberedName =
    localStorage.getItem(
      'moshroidsPilotName'
    );

  if (rememberedName) {
    pilotNameInput.value =
      rememberedName;
  }

  loginForm.addEventListener(
    'submit',
    async (event) => {
      event.preventDefault();

      const name =
        cleanPilotName(
          pilotNameInput.value
        );

      if (!name) {
        setStatus(
          'ENTER A PILOT NAME',
          'error'
        );

        pilotNameInput.focus();

        return;
      }

      try {
        const initialState =
          getInitialState();

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
         * joinMultiplayer already displays the connection error.
         */
      }
    }
  );

  requestAnimationFrame(
    () =>
      pilotNameInput.focus()
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

  setNetworkStatus(false);
}


/* =========================================================
   PUBLIC API
   ========================================================= */

function getRemotePlayers() {
  return remotePlayers;
}


function getLocalIdentity() {
  if (!currentUser) {
    return null;
  }

  return {
    uid:
      currentUser.uid,

    name:
      pilotName
  };
}


function isMultiplayerConnected() {
  return connected;
}


export {
  bindPilotLogin,
  claimGunDrop,
  getGunDrops,
  getLocalIdentity,
  getRemotePlayers,
  isMultiplayerConnected,
  leaveMultiplayer,
  publishGunDrops,
  publishLocalState,
  removeExpiredGunDrop,
  updateRemotePlayers
};
