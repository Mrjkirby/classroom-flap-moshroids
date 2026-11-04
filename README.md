# Classroom Flap Moshroids

MOSHROIDS is a multiplayer classroom Asteroids game. The deployed primary client
uses the existing LLP/Snake login and KNAS realtime server. GitHub Pages continues
to serve the same game URLs. No student PIN is sent to KNAS.

## Release status — November 4, 2026

The shared LLP login repair is active on the existing deployment as version 68
(source `9ca6275`). It preserves the roster and all identity/access-control
checks while allowing renamed Aspen reporting columns. Activation used the
already authorized deployment-owner browser account; no URL or access settings
changed. The backend suite passed 224 tests.

Primary KNAS client `3b579c1` and renewal fix `7c47e9a` are deployed; public file
readback matches source.
Live Student LLP and Snake login passed with the supplied test account;
Snake login was reconfirmed November 4.
Live programmatic checks using that account passed launch issuance, redemption,
authenticated KNAS WebSocket connection and rotated-token reconnect in Classic,
Teams and 1VW. Automatic renewal through the existing login issuer also passed;
the connection remained active beyond its original five-minute lease.
KNAS's private authenticated health confirmed the test connection. Public
`/health` still describes the separate standby service by design.
Rendered browser game launch and multi-student gameplay remain unverified:
the Mac reported locked and the browser launch control did not activate.
Do not describe API checks as completed visual multiplayer verification.

Release checks passed: 127 MOSHROIDS tests,
190 Snake tests, TypeScript and production build passed. Synthetic 26-client
checks passed in each mode with zero duplicate claims, identity crossovers or
state divergence. Local Chrome boot and reload passed in Classic and Teams;
1VW boot passed. These checks are not a live class of authenticated students.

Snake Site version 38 (`ec2301f`) is deployed and supplies three mode choices and fresh grants
for session renewal. Previous Pages release `9e21018` and Snake version 36 remain
rollback points. No gameplay database migration or NAS rebuild is required.

## Structure

- `index.html`, `teams/index.html`, `1vw/index.html`, `style.css`: existing URLs/UI.
- `src/bootstrap.js`, `src/transport/launch-adapter.js`: shared authenticated entry,
  one-use launch fragment removal, exact-origin opener grants. Staging reuses them.
- `src/game.js`: game orchestration; focused sibling modules own ships, collisions,
  weapons, spelling, asteroids, Teams and 1VW rules.
- `src/transport/config.js`, `index.js`: KNAS selection and provider boundary.
  Published bootstraps pin KNAS; no URL selector or automatic Firebase fallback.
  Legacy Firebase adapters remain available only to explicit trusted configuration.
- `src/transport/connection.js`: short sessions, WebSocket, bounded reconnect,
  acknowledgements and renewal 90 seconds before expiry. Only a fresh authorized
  grant can create another five-minute lease. Old socket events are ignored.
  Portal replies allow 75 seconds because an LLP session recheck can take 60
  seconds; a regression covers delayed replies and missing-reply cleanup.
- `src/transport/knas-store.js`, `knas-player.js`, `knas-shared.js`: replicated
  room state and adapters for existing gameplay interfaces.
- `server/src/`: existing in-memory room authority, one-use grant verification,
  rotating reconnect credentials, atomic claims, snapshots and shared events.
- `src/weaponSystem.js`, `gunDropSystem.js`, `gunDropMultiplayer.js`: one drop per
  earned gun on death; the base gun remains on respawn. Actual upgrades are gun
  count, not a separate inventory. Room drops expire after ten seconds; claims
  are atomic. KNAS sends compact batches so a fully upgraded ship's drops fit
  the server message limit. Firebase uses server-aligned time; KNAS stamps time
  on its server.
- `src/mrKShake.js`: one local 800 ms shake for each new shared Mr. K destruction
  ID. Room isolation and join baselines prevent cross-room effects/history replay.
- `src/mrKRules.js`, `mrKHitQueue.js`, `mrKNetwork.js`, and `mrKBlast.js`:
  KNAS owns one 1,000-hit Mr. K counter per room and field generation. Pilots'
  own hits are sent in bounded idempotent batches; joining or reconnecting
  receives the current count. A single room destruction record carries the
  shared blast origin, and every connected browser creates a missile wave and
  checks impacts against its own ship. Missile flight is locally simulated,
  not a server-synchronized trajectory. Old destruction records are not
  replayed as new waves on joining. The rock's motion uses shared room time.
- `src/asteroidDirector.js`: deterministic shared-time asteroid generation;
  normal asteroid count doubles from ten per Mr. K generation.

## Login and services

Sign into https://spelling-snake-mr-kirby.mr-kirby.chatgpt.site/ with the existing
classroom account and choose a MOSHROIDS mode. Keep that portal tab open for
renewal. A direct game visit offers the same portal; it cannot invent a player.
Closing the portal means relaunch is required when the current lease expires.

| URL | Room |
| --- | --- |
| https://mrjkirby.github.io/classroom-flap-moshroids/ | `classroom` |
| https://mrjkirby.github.io/classroom-flap-moshroids/teams/ | `classroom-teams` |
| https://mrjkirby.github.io/classroom-flap-moshroids/1vw/ | `classroom-1vw` |
| https://mrjkirby.github.io/classroom-flap-moshroids/knas-staging/ | `classroom` |

The existing edge is `wss://moshroids-staging.mrjkirby.workers.dev/ws`, with
`POST /api/launch/redeem` on the same HTTPS host. Its existing private route
reaches `moshroids-auth-staging` on KNAS. The name remains unchanged during
cutover. The standby `moshroids-realtime` container and other services remain
separate. No raw NAS port is exposed and no Cloudflare VPC change is needed.

Only launch/renewal checks use LLP/EDU; game frames use KNAS. Sessions and rooms
are transient and vanish on server restart. No database or inventory was added.
See [server operations](server/README.md), [authenticated instance](server/auth-staging/README.md)
and [historical audit](server/TRANSPORT-AUDIT.md).

## Run and test

Native browser ES modules require no transpilation build. Serve this directory
with `python3 -m http.server 8000` for static UI inspection. Localhost is not a
production-authorized login origin; automated loopback tests use fixtures.

```sh
node --experimental-vm-modules tests/import-graph.mjs
node --experimental-vm-modules --test server/test/*.test.mjs tests/*.mjs
node server/test/performance.mjs
```

The full suite covers shared drops, simultaneous claims, no-upgrade death,
respawn, late join, Mr. K deduplication/room isolation, all three game modes,
security, reconnect, renewal and import validity. The capacity command uses 26
synthetic WebSocket clients in each room and reports traffic/latency. Neither
proves a live class of authenticated students. Optional browser regression:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright/index.js CHROME_PATH=/absolute/path/to/chrome node tools/verify-transport-browser.mjs
```

## Deployment

GitHub Pages automatically publishes `main`; hold publication until required release checks pass. Publish only after tests pass. The prior client cutover's server code
matched the authenticated KNAS container on November 3; later server changes
require a separately verified KNAS release.
Do not redeploy shared Firebase, change runtime secrets, or migrate live data.
After release, verify classroom login, displayed `ONLINE · KNAS`, three mode
routes, reload and renewal, plus browser traffic without Firebase gameplay.

The Mr. K shared-counter change requires the authenticated KNAS server update
before publishing its corresponding Pages client. Restarting that service
disconnects players and clears its transient rooms; check active connections
and retain the previous image for rollback. This does not use or modify Firebase.
