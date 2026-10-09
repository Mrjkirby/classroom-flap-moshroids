# KNAS transport classification and release gate

## Firebase inventory inspected before implementation

| Existing operation | Frequency / authority | KNAS equivalent |
| --- | --- | --- |
| Firebase app + anonymous auth, pilot form | join only; Firebase identity in rollback mode | Existing EDU one-time grant, server-consumed identity; no pilot-name authority |
| `.info/serverTimeOffset` listener | clock calibration | server heartbeat with midpoint RTT offset |
| `players/uid` set + onDisconnect/remove | join/leave presence | verified socket membership, heartbeat expiry, replacement guard |
| players onValue | remote state subscription | welcome snapshot, playerJoined/playerState/playerLeft |
| own player position/velocity/angle/visible/score/guns update | 12 Hz; own local simulation report | bounded self-state message; identity/name/tester/team cannot be overwritten |
| own team update | base contact/death | teamChange with server contact check against existing base geometry |
| own teamShots update | trigger-only, rolling one-second shots | stamped teamVolley; remote projectile reconstruction remains browser-local |
| destroyedAsteroids onValue + transaction | atomic ordinary/MR. K/cannon-projectile claims | one SharedState map and first-writer actions; complete chunked late-join history |
| destroyedAsteroids remove | explicit room-history reset | server-authorized tester only, never an implicit reconnect reset |
| gunDrops onValue + update | death/drop events | validated drop batch, server-owned owner/time/expiry |
| gun drop transaction + remove | atomic pickup, then cleanup | atomic removal/ack plus bounded tombstones |
| expired gun removal | cleanup | server expiry plus compatible expiry action |
| 1VW bossState init/onValue | phase snapshots | single per-room boss state; no database |
| own player / room players get for 1VW | survivor eligibility/perimeter assignment | existing authenticated in-memory player map |
| survivor/activate/end/reset transactions | round transitions | existing pure gauntlet rules on server |
| cannon transaction | at most one shot/sec/player | existing acceptCannonShot rule, server timestamp and perimeter slot |

All Firebase SDK imports are isolated behind conditional dynamic imports. Browser
tests on Classic, Teams and 1VW observed **zero Firebase requests in KNAS mode**.
No game physics, rendering, question or collision implementation moved to KNAS.
Scores and gun counts remain bounded reports of the authenticated player's local
simulation, matching Firebase self-writes; this is not a new anti-cheat physics
server. Atomic shared claims, identity, Teams membership and boss transitions
are server-owned. No new persistence or identity authority was introduced.

## Boundaries and limits

- 64 players/room, three fixed rooms; 256 raw server connections.
- Player position messages: 12 Hz browser / 15 Hz server limit.
- Critical actions: request/ack, 100/sec/client limit, no replay after ambiguous
  disconnect. Pending browser requests bounded to 128 with five-second expiry.
- Current/previous 30-minute asteroid epochs, capacity 20,000; reject on capacity
  instead of evicting live tombstones and allowing duplicate awards.
- 4,096 gun IDs, 10-second live drop expiry, 60-second replay tombstones.
- Chunked snapshots; 1 MiB slow-socket buffer cap; heartbeat and bounded retries.
- Existing five-minute fixed auth lease and rotating reconnect credential reused.
  Server restart loses transient rooms/leases and requires a fresh one-time grant.

## Verified on 2026-10-06

Isolated `moshroids-realtime` container, host binding **127.0.0.1:8794** only.
Read-only filesystem, non-root user, dropped capabilities, 192 MiB memory limit,
restart-unless-stopped, two 5 MiB logs. Synology lacks CFS CPU quota and PID-limit
support; CPU shares are used instead (a scheduling weight, not a hard quota).
TIMEZ :8793 was left unchanged and returned HTTP 200.

On-NAS benchmark used 26 real WebSocket clients and a separate server process
inside this container in EACH of Classic, Teams and 1VW. Identities/verifier were
synthetic and isolated; this is **NAS capacity/integration proof, not production
LLP authentication, public WSS, WAN or 26 physical Chromebook proof**.
All modes passed claims, state agreement, shared clock and reconnect. Final run
(20.8 seconds): 0 duplicate claims/crossovers/disconnects, clock spread 1–4 ms,
17.2% of one CPU core, 78.3 MiB peak server RSS, 7,219 messages/sec received across
all clients, 298 messages/sec sent by clients, 1.46 MB/sec aggregate server
egress and 46.8 KB/sec ingress, action p95 99.2 ms. This short benchmark is not
a long-running classroom soak test. Delta-state updates omit repeated names and
Teams shot histories. Rerun `node server/test/performance.mjs` to reproduce.

Regression verification: 39 browser/game/transport tests, 22 server tests on NAS,
14 existing classroom issuer/D1/real-WebSocket integration tests. Chromium booted
all three game modes, exercised shared claims, found no page errors and no
Firebase requests in KNAS mode. Firebase default loaded its unchanged adapter and
pilot form without a production login/write. No compiler build exists; module
syntax/import validation and the Node 24 Docker build passed. macOS Node tests
occasionally retain a closing client socket for about 60 seconds after assertions
pass; a 15-second diagnostic file timeout cancelled that run, while the normal
suite completed. The NAS runtime suite exits normally.

## Unfinished production gate — do not switch the public client

The container is deliberately **standby / classroomReady=false**, rejecting all
launches until the existing issuer is released/configured with matching service
secrets. The issuer exists in the EDU/Snake repository but is not a MOSHROIDS
browser launcher. `transportConfig.requestLaunch(roomId)` is a tested injection
contract, not proof that the live LLP chooser supplies a grant. Wiring that
existing authenticated launcher and releasing/configuring its issuer remain
required. Do not replace this with a client-picked identity or another login.

There is no verified public WSS hostname. DSM DDNS configuration and certificate
metadata are owner-protected; its reverse-proxy configuration was empty. No
router/DNS/certificate changes were guessed or made. Smallest owner discovery
action: **DSM → Control Panel → External Access → DDNS: provide the hostname and
status shown (no credentials)**. After confirming a controlled hostname and TLS,
the intended route is only its WSS `/ws` to HTTP `127.0.0.1:8794`; never forward
raw port 8794 or DSM administration. Do not enable a broad default NAS route.

Firebase remains the default and the immediate rollback. Public cutover needs
the real existing-session launch, HTTPS/WSS Origin checks, public browser gameplay
and reconnect verification. The current pass does not claim those have passed.

## Files in this pass

### Follow-up: Astroids-KNAS connector preparation, 2026-10-09

Fresh inspection confirms `moshroids_default` contains only the existing healthy
realtime container, with host loopback port 8794 and `classroomReady:false`.
The owner's existing Astroids-KNAS tunnel is reported inactive with no routes.
No usable tunnel credential was found in the deployment's known locations or
configuration keys. A separate `cloudflared/compose.yaml` and hidden terminal
credential helper are staged on KNAS; the official 2026.10.0 image was pulled
and pinned by digest. Compose validates without creating a connector or changing
the realtime container. The owner credential gate stops this pass before tunnel
startup, route configuration, external WSS tests or production cutover.

The earlier empty-reverse-proxy observation above is historical: subsequent
read-only inspection found `mrkirbyastroids.synology.me:443 -> localhost:8794`
with upgrade headers, but external reachability remains unverified. The outbound
tunnel does not depend on that route or any inbound router forwarding.

Paths relative to `/Users/btkir/Developer/MOSHroids/classroom-flap-moshroids`:

```text
README.md
server/README.md
server/TRANSPORT-AUDIT.md
server/Dockerfile
server/compose.yaml
server/index.mjs
server/src/app.mjs
server/src/match.mjs
server/src/protocol.mjs
server/src/shared-state.mjs
server/src/websocket.mjs
server/test/benchmark-host.mjs
server/test/performance.mjs
server/test/server.test.mjs
server/test/shared-state.test.mjs
src/asteroidNetwork.js
src/gauntlet/network.js
src/gunDropMultiplayer.js
src/transport/config.js
src/transport/connection.js
src/transport/firebase-asteroids.js
src/transport/firebase-drops.js
src/transport/firebase-gauntlet.js
src/transport/index.js
src/transport/knas-player.js
src/transport/knas-shared.js
src/transport/knas-store.js
tests/import-graph.mjs
tests/transport-connection.mjs
tools/verify-transport-browser.mjs
```

The Firebase subsystem files are moves with import-path corrections, not rewrites.
New focused source modules are at most 128 lines. `firebase-debug.log` was present
before the task and remains untracked/untouched. No LLP/Snake source, TIMEZ,
Firebase rules, live student records, DSM or router configuration was changed.
