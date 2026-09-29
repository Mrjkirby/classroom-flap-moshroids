/*
 * MOSHROIDS MULTIPLAYER
 *
 * Firebase is used for:
 * - anonymous player identity
 * - pilot names
 * - shared player state
 * - disconnect cleanup
 *
 * Firebase DOES NOT run local ship physics.
 * The local browser remains responsible for its own ship.
 */

import {
  initializeApp
} from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';

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
  serverTimestamp
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

const roomPath =
  `moshroids/rooms/${ROOM_ID}`;

const playersPath =
  `${roomPath}/players`;


/*
 * We do NOT send movement every animation frame.
 *
 * Local physics can remain ~60 FPS.
 * Network state is sent at 12 updates/second.
 */
const NETWORK_SEND_INTERVAL = 1000 / 12;


/* =========================================================
   STATE
   ========================================================= */

let currentUser = null;
let pilotName = '';

let playerRef = null;

let remotePlayers = new Map();

let unsubscribePlayers = null;

let lastNetworkSend = 0;

let connected = false;


/* =========================================================
   UI
   ========================================================= */

const loginOverlay =
  document.querySelector('#pilotLoginOverlay');

const loginForm =
  document.querySelector('#pilotLoginForm');

const pilotNameInput =
  document.querySelector('#pilotNameInput');

const pilotEnterButton =
  document.querySelector('#pilotEnterButton');

const loginStatus =
  document.querySelector('#pilotLoginStatus');

const pilotDisplayName =
  document.querySelector('#pilotDisplayName');

const controlsPilotName =
  document.querySelector('#controlsPilotName');

const networkStatus =
  document.querySelector('#networkStatus');


function setStatus(message, state = '') {
  if (loginStatus) {
    loginStatus.textContent = message;

    loginStatus.classList.remove(
      'error',
      'connected'
    );

    if (state) {
      loginStatus.classList.add(state);
    }
  }
}


function setNetworkStatus(isConnected) {
  connected = isConnected;

  document.body.classList.toggle(
    'network-offline',
    !isConnected
  );

  if (networkStatus) {
    networkStatus.textContent =
      isConnected
        ? 'MULTIPLAYER LIVE'
        : 'NETWORK OFFLINE';
  }
}


/* =========================================================
   NAME
   ========================================================= */

function cleanPilotName(value) {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 24);
}


function applyPilotName(name) {
  pilotName = name;

  if (pilotDisplayName) {
    pilotDisplayName.textContent =
      name.toUpperCase();
  }

  if (controlsPilotName) {
    controlsPilotName.textContent =
      name.toUpperCase();
  }
}


/* =========================================================
   AUTHENTICATION
   ========================================================= */

function waitForAuth() {
  return new Promise(
    (resolve, reject) => {
      const unsubscribe =
        onAuthStateChanged(
          auth,
          (user) => {
            if (!user) {
              return;
            }

            unsubscribe();

            currentUser = user;

            resolve(user);
          },
          (error) => {
            unsubscribe();
            reject(error);
          }
        );

      if (!auth.currentUser) {
        signInAnonymously(auth)
          .catch(reject);
      }
    }
  );
}


/* =========================================================
   PLAYER PRESENCE
   ========================================================= */

async function createPlayerRecord(
  initialState
) {
  if (!currentUser) {
    throw new Error(
      'Firebase user is not authenticated.'
    );
  }

  playerRef = ref(
    database,
    `${playersPath}/${currentUser.uid}`
  );

  /*
   * Remove this player's ship if the browser disconnects.
   */
  await onDisconnect(
    playerRef
  ).remove();

  await set(
    playerRef,
    {
      name: pilotName,

      x: Number(initialState.x) || 0,
      y: Number(initialState.y) || 0,

      angle:
        Number(initialState.angle) || 0,

      velocityX:
        Number(initialState.velocityX) || 0,

      velocityY:
        Number(initialState.velocityY) || 0,

      visible:
        initialState.visible !== false,

      score:
        Number(initialState.score) || 0,

      updatedAt:
        serverTimestamp()
    }
  );
}


/* =========================================================
   REMOTE PLAYERS
   ========================================================= */

function startPlayerListener() {
  if (unsubscribePlayers) {
    unsubscribePlayers();
  }

  const playersRef =
    ref(database, playersPath);

  unsubscribePlayers =
    onValue(
      playersRef,
      (snapshot) => {
        const data =
          snapshot.val() || {};

        const nextPlayers =
          new Map();

        Object.entries(data).forEach(
          ([uid, player]) => {
            if (
              currentUser &&
              uid === currentUser.uid
            ) {
              return;
            }

            if (
              !player ||
              typeof player.x !== 'number' ||
              typeof player.y !== 'number'
            ) {
              return;
            }

            const previous =
              remotePlayers.get(uid);

            nextPlayers.set(
              uid,
              {
                uid,

                name:
                  cleanPilotName(
                    player.name
                  ) || 'PILOT',

                /*
                 * Authoritative target received
                 * from Firebase.
                 */
                targetX: player.x,
                targetY: player.y,
                targetAngle:
                  Number(player.angle) || 0,

                velocityX:
                  Number(
                    player.velocityX
                  ) || 0,

                velocityY:
                  Number(
                    player.velocityY
                  ) || 0,

                visible:
                  player.visible !== false,

                score:
                  Number(player.score) || 0,

                /*
                 * Render coordinates are kept
                 * separately so game.js can
                 * interpolate smoothly.
                 */
                renderX:
                  previous
                    ? previous.renderX
                    : player.x,

                renderY:
                  previous
                    ? previous.renderY
                    : player.y,

                renderAngle:
                  previous
                    ? previous.renderAngle
                    : (
                        Number(
                          player.angle
                        ) || 0
                      )
              }
            );
          }
        );

        remotePlayers =
          nextPlayers;

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
    return;
  }

  const now =
    performance.now();

  if (
    !force &&
    now - lastNetworkSend <
      NETWORK_SEND_INTERVAL
  ) {
    return;
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

        updatedAt:
          serverTimestamp()
      }
    );
  } catch (error) {
    console.error(
      'Moshroids state update failed:',
      error
    );

    setNetworkStatus(false);
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
      /*
       * Handle world wrapping before interpolation.
       * Otherwise a ship crossing one edge could
       * visually fly across the entire arena.
       */

      let deltaX =
        player.targetX -
        player.renderX;

      let deltaY =
        player.targetY -
        player.renderY;

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
   * Remember only the display name.
   * Firebase authentication remains anonymous.
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
         * Error is already displayed
         * by joinMultiplayer().
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

  if (playerRef) {
    try {
      await remove(playerRef);
    } catch {
      /*
       * onDisconnect is the fallback.
       */
    }
  }

  playerRef = null;

  remotePlayers.clear();

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
    uid: currentUser.uid,
    name: pilotName
  };
}


function isMultiplayerConnected() {
  return connected;
}


export {
  bindPilotLogin,
  getLocalIdentity,
  getRemotePlayers,
  isMultiplayerConnected,
  leaveMultiplayer,
  publishLocalState,
  updateRemotePlayers
};
