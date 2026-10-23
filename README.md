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

The [private EDU-authenticated staging instance](server/auth-staging/README.md)
uses the existing Snake/LLP issuer. It is separate from the public deny-all
server and publishes no ports. Firebase remains the production default and
rollback until staging verification is complete.

`src/transport/config.js` selects `firebase` (default) or `knas`. All player,
asteroid/MR. K, drop, Teams and 1VW networking follows this selector. KNAS mode
does not import Firebase; rollback adapters retain the existing implementation.
Rendering, local physics, collisions, weapons, spelling and questions remain in
the browser. `connection.js` owns the socket, temporary session credentials,
heartbeat, bounded reconnect and request acknowledgements; `knas-store.js` owns
replicated caches; `knas-player.js` and `knas-shared.js` adapt the existing game
interfaces.

The selected KNAS configuration requires `websocketUrl` and a
`requestLaunch(roomId)` callback returning a fresh grant from the existing
classroom session. The server consumes it at `POST /api/launch/redeem`, then
issues a separate five-minute KNAS session. Only that session credential is
sent over WebSocket and it rotates on reconnect. A tab-scoped session copy
allows a page refresh without reusing the launch grant. Missing launch
configuration fails closed; it never falls back to anonymous identity.

The browser fetch adapter preserves the Window receiver. Passing native `fetch`
as a connection method causes an illegal invocation before redemption reaches
KNAS; `tests/transport-connection.mjs` covers this browser-specific regression.

### Isolated playable client

[`knas-staging/`](knas-staging/) is a dedicated static shell around the common
game implementation. Its intended public page is
`https://mrjkirby.github.io/classroom-flap-moshroids/knas-staging/`. It pins KNAS to
`wss://moshroids-staging.mrjkirby.workers.dev/ws`; it cannot select Firebase or
override the endpoint from a URL. It displays **MOSHROIDS — KNAS STAGING** and
does not load Firebase SDK modules. Production entry pages keep the Firebase
default.

The root URL `/` is still the legacy Firebase production entry and displays its
pilot-name form. It is not a KNAS launch destination. The LLP game-launch action
must open `/knas-staging/` and provide a fresh grant by the supported fragment
or trusted opener handoff. If a test lands on `/` and shows the pilot-name form,
the KNAS client was not loaded; this is a launch-routing failure, not a KNAS
authentication result. The staging client itself never falls back to Firebase.

The existing authenticated Snake/LLP launcher must issue every launch token.
It may open the page using a one-time URL fragment:

```text
https://mrjkirby.github.io/classroom-flap-moshroids/knas-staging/#t=ml1_<64-hex>&roomId=classroom&expiresAt=<ISO-8601>
```

The fragment is removed from browser history before launch; unlike a query
string, it is not sent to GitHub Pages, Cloudflare, or referrer logs. The staging
page also supports the existing exact-origin opener handoff from
`https://spelling-snake-mr-kirby.mr-kirby.chatgpt.site`. Both paths accept only
a fresh `ml1_` token, audience `moshroids`, a permitted room and an expiry no
more than two minutes away. The launcher must never include identity or service
secrets.

The staging browser and private KNAS service emit diagnostic stage/outcome
events, HTTP status codes and WebSocket close codes only. They do not log launch
grants, session credentials, PINs, student identifiers or display names.

KNAS verifies and atomically consumes each grant through the existing LLP
service. It derives identity there, creates a separate reconnectable game
session, and never accepts identity fields from the browser. Direct access
without an unexpired session or a fresh portal launch is rejected. Do not paste
tokens manually or make browser-side calls to the private issuer.

GitHub Pages serves the `main` branch. The staging page is published with that
branch; publishing it does not change the production transport selector.
The public staging page and isolated KNAS redemption/WebSocket routes are live.
On 2026-10-23, Chrome's existing Timez TEST session launched successfully:
the issuer resolved identity, redemption returned HTTP 200, the game displayed
`test` and `ONLINE · KNAS`, the spelling challenge returned to gameplay, and
reload resumed the authenticated session without another grant. This verifies
one real test account, not a classroom-scale authenticated load test. That
classroom test is still required before changing readiness or production transport.

The original `moshroids-realtime` container remains in deny-all standby; the
authenticated staging service is separate. No existing KNAS service was
repurposed. See [server setup](server/README.md) and [operation inventory,
measurements and release gate](server/TRANSPORT-AUDIT.md).

The dedicated [Astroids-KNAS connector](server/cloudflared/README.md) reuses the
existing isolated Docker bridge. The original `moshroids-realtime` service
remains deny-all; the separate private auth-staging service handles launch
redemption and game sessions. The isolated [Workers VPC staging
edge](server/edge-staging/README.md) exposes `/health`, `/ws`, and
`/api/launch/redeem`, plus a server-credential-protected POST `/verify` for the
existing Snake tester-only staging control. Firebase remains selected. An
authenticated class-size test is still required before the public readiness
gate or production transport can change.

Verification commands:

```sh
node --experimental-vm-modules --test server/test/*.test.mjs tests/*.mjs
node server/test/performance.mjs
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.js CHROME_PATH=/absolute/path/to/chrome node tools/verify-transport-browser.mjs
```

There is no transpilation/typecheck build in this native-JavaScript repository;
the import-graph check validates syntax, static/dynamic local paths and exports.
Browser tests exercise the three game modes and isolated KNAS staging shell with
synthetic grants. They do not write classroom data or consume real grants.
