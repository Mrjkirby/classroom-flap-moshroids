# Classroom Flap Moshroids

MOSHROIDS is a browser-based multiplayer classroom Asteroids game. Players enter a pilot name, sign in anonymously through Firebase, and share a room.

## Structure

- `index.html`, `1vw/index.html`, `teams/index.html`, `style.css`: mode entry pages and presentation.
- `src/game.js`: game setup and orchestration.
- `src/asteroid.js`, `src/asteroidDirector.js`, `src/asteroidMultiplayer.js`, `src/asteroidNetwork.js`: asteroid entity, field generation, shared destruction coordination, and Firebase transport.
- `src/sharedClock.js`, `src/worldConfig.js`: Firebase server-time offset and fixed shared arena dimensions. Asteroid positions are derived from immutable spawn state and shared time; no position frames are sent to Firebase.
- `src/asteroidDirector.js` derives normal field size as 10 × 2^MR. K destructions in the current shared epoch. The existing Firebase MR. K destruction record advances the generation once, and late joins replay those records to recover the same field. Time tiers still set replacement timing.
- `src/transport/firebase-adapter.js`: active Firebase authentication, player presence, and pilot-login transport. `src/transport/index.js` is the provider-neutral import boundary used by game orchestration.
- `src/gunDropSystem.js`, `src/gunDropMultiplayer.js`: gun drop gameplay and networking.
- Other `src/` modules own the corresponding physics, entities, collisions, spelling, and weapons.
- `src/gameMode.js` routes `/` to Classic, `/1vw/` to One vs World, and `/teams/` to Teams. All pages load `src/game.js` and use separate Firebase rooms (`classroom`, `classroom-1vw`, and `classroom-teams`).
- All modes use the same Firebase anonymous sign-in session on the same site origin; switching URLs does not add another login system.
- `src/teams/` owns half-size colored corner-base geometry, team damage rules, and remote volley reconstruction. Teams start neutral, join or switch on physical L-base contact, and reset to neutral on death. Only same-team player weapon damage is disabled. Team claims and fire snapshots use change/trigger writes on the existing player record and player listener; no bases or projectile positions are streamed. The existing asteroid, MR. K, gun, spelling, and shared-clock systems run in the Teams room.
- `src/gauntlet/` owns the 1VW room transition, perimeter layout, cannon events, projectile reconstruction, and deterministic asteroid bounce trajectories. `bossState` in the 1VW room records the Survivor, phase, round, and shared start time. Cannon transactions store at most one accepted shot per player per second; no asteroid or turret positions are streamed.
- `src/spellingController.js` owns the spelling challenge UI, including word-copy and answer-paste guards. The word remains visible, and answers are typed with normal keyboard or mobile input.

## Run and verify

The site uses native browser ES modules and has no package build step. From the repository root, run `python3 -m http.server 8000`, then open `http://localhost:8000/`. Enter a pilot name to test Firebase authentication and room joining. Internet access and a Firebase-authorized browser origin are needed for login.

Run `node --experimental-vm-modules tests/import-graph.mjs` to check local import paths, module syntax, exports, and circular dependencies.

Run `node --test tests/asteroid-sync.mjs` for deterministic movement, late joins, wrapping, destruction, respawn, epoch changes, and 26-client replay.

Run `node --test tests/spelling-input.mjs` for spelling copy/paste guards and the existing practice/retrieval flow.

Run `node --test tests/gauntlet.mjs` for 1VW routing, atomic transition rules, perimeter controls, bounce behavior, cannon timing and size, collision protection, and projectile replay.

Run `node --test tests/teams.mjs` for Teams routing, base geometry/contact, team transitions, player weapon rules, volley replay, and environmental hazards.

## Deployment

GitHub Pages serves the root of the `main` branch at https://mrjkirby.github.io/classroom-flap-moshroids/. The browser loads `src/game.js` directly from `index.html`, so imported filenames must match tracked files exactly, including case. Firebase hosts anonymous authentication and the multiplayer room; its public client configuration is in `src/transport/firebase-adapter.js`.

GitHub Pages serves `1vw/index.html` directly at https://mrjkirby.github.io/classroom-flap-moshroids/1vw/, including direct visits and refreshes. 1VW requires the existing Firebase `bossState`, player, gun-drop, and asteroid write boundaries to be enabled for the separate `classroom-1vw` room. If database rules deny access, login fails closed.

GitHub Pages serves `teams/index.html` directly at https://mrjkirby.github.io/classroom-flap-moshroids/teams/, including direct visits and refreshes. Teams uses the existing authenticated player write boundary in the separate `classroom-teams` room. If database rules deny access, login fails closed.

## KNAS realtime transport (gated; Firebase still default)

`src/transport/config.js` selects `firebase` (default) or `knas`. All player,
asteroid/MR. K, drop, Teams and 1VW networking follows this selector. KNAS mode
does not import Firebase; rollback adapters retain the existing implementation.
Rendering, local physics, collisions, weapons, spelling and questions remain in
the browser. `connection.js` owns the socket, in-memory credentials, heartbeat,
bounded reconnect and request acknowledgements; `knas-store.js` owns replicated
caches; `knas-player.js` and `knas-shared.js` adapt the existing game interfaces.

The selected KNAS configuration requires `websocketUrl` and a
`requestLaunch(roomId)` callback returning a fresh grant from the existing
classroom session. The server, not that callback, authorizes identity. No PIN,
identity override, service secret or token belongs in a URL. Missing launch
configuration fails closed, never falls back to anonymous identity.

An isolated `moshroids-realtime` container runs on KNAS loopback **127.0.0.1:8794**
in deny-all standby while issuer/launcher release and public WSS are incomplete.
No existing KNAS service was repurposed. See [server setup](server/README.md) and
[operation inventory, measurements and release gate](server/TRANSPORT-AUDIT.md).

The dedicated [Astroids-KNAS connector preparation](server/cloudflared/README.md)
reuses the existing isolated Docker bridge without altering the realtime server.
It uses a pinned official Cloudflare image and a private read-only token file;
the connector is now healthy. Firebase remains selected. The isolated
[Workers VPC staging edge](server/edge-staging/README.md) exposes only `/health`
and `/ws` once published; it does not enable classroom authentication or change
the public game's transport.

Verification commands:

```sh
node --experimental-vm-modules --test server/test/*.test.mjs tests/*.mjs
node server/test/performance.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.js CHROME_PATH=/absolute/path/to/chrome node tools/verify-transport-browser.mjs
```

There is no transpilation/typecheck build in this native-JavaScript repository;
the import-graph check validates syntax, static/dynamic local paths and exports.
Browser tests exercise the actual three game pages and prove no Firebase requests
in KNAS mode, using isolated synthetic grants. They do not write classroom data.
