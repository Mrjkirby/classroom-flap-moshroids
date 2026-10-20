# MOSHROIDS realtime server (pre-production)

This isolated WebSocket relay is wired through the optional KNAS browser adapter.
Firebase remains the public default. The KNAS container is deployed in explicit
deny-all standby: secrets, issuer release, secure ingress and real classroom
launch wiring still gate public cutover. See [the audit](TRANSPORT-AUDIT.md).

## Ownership

- `src/app.mjs`: HTTP launch redemption, health endpoint, WebSocket upgrade, and exact-origin gate.
- `src/auth/remote-token-verifier.mjs`: HTTPS-only one-time-token verifier; it never trusts an identity from the WebSocket client.
- `src/auth/game-sessions.mjs`: bounded reconnect sessions with rotating credentials and fixed expiry.
- `src/websocket.mjs`: small RFC 6455 text-frame transport; no gameplay rules.
- `src/protocol.mjs`: bounded untrusted-message parsing and current room identifiers.
- `src/match.mjs`: authoritative in-memory room/player/event state, duplicate protection, stale cleanup, and first-writer claims.
- `src/shared-state.mjs`: sole shared claim/drop/boss authority, existing Teams and
  gauntlet rules, chunked late-join snapshots. Player physics/score/gun-count
  reports remain local, bounded and attributed only to the authenticated sender.

The server intentionally persists no frame data or game-session credentials and starts with empty matches after a restart. Firebase remains the live transport and source of current room state.

## Classroom token contract

The existing EDU compatibility service now owns `POST /api/moshroids`. Configure its HTTPS URL as `MOSHROIDS_AUTH_VERIFY_URL`. The authenticated same-origin classroom browser requests `moshroidsIssueLaunch` using its existing HttpOnly session. Ordinary learners are rechecked against their LLP grant/roster; the reserved tester uses the existing five-second server-authorized tester control. No separate login or browser identity is accepted.

The browser redeems its fresh `ml1_` token at `POST /api/launch/redeem` with `{ token, roomId }`. This route requires the exact allowed Origin, accepts JSON only, and returns only a short-lived KNAS session credential. The existing verifier remains the authority for token expiry, scope, replay protection, and canonical student identity.

KNAS sends `{ action: 'moshroidsVerifySession', accessToken, audience: 'moshroids', roomId }` with `Authorization: Bearer <MOSHROIDS_SERVICE_SECRET>`. The secret must be matching 32 random bytes encoded as 64 lowercase hex characters, stored only in server secret bindings. Missing configuration fails closed. Redirects are forbidden, requests are bounded to four seconds, and failed consumption is never retried automatically.

The authority is `moshroids_launch_grants` in the existing classroom D1 binding: SHA-256 hashes of 256-bit random tokens, identity snapshot, token ID, scope/room, issuing session and 60-second expiry. Atomic `DELETE ... RETURNING` permits exactly one consumer across processes. No process-local replay cache or Apps Script global lock substitutes for this database operation. The response is `{ ok: true, consumed: true, audience: 'moshroids', roomId, tokenId, issuedAt, expiresAt, testerAuthorized, student: { id, loginName, active: true } }`.

After consuming the launch grant, KNAS creates a separate five-minute game session. The response to the browser contains only `{ ok: true, sessionToken, expiresAt }`; the raw launch token is not returned or logged. The WebSocket accepts `{ type: 'hello', resumeToken, roomId }` only. The server sends a rotated resume credential and verified `testerAuthorized` value with `authenticated`, followed by `welcome`. The browser keeps the credential in tab-scoped session storage so refresh/reconnect does not redeem the launch token again. LLP credentials and the service secret never go to KNAS through the browser.

Reconnect uses `{ type: 'hello', resumeToken, roomId }`, not the consumed launch token. Server memory retains only the resume credential hash and verified identity, bounded to 256 sessions. Credentials rotate atomically on reconnect and are bound to room and browser Origin; duplicate credentials lose, duplicate-player launches retire the older resume credential, and reconnect never extends the five-minute absolute lifetime. Expired sockets close; restart invalidates all resume credentials. Fresh launch after expiry uses the existing classroom session, not a second login. Tester checks apply to new grants/consumes; an already established game session is a bounded capability lease, not instantaneous remote-toggle push revocation. Gameplay and reconnect do not call LLP/Sheets. No tester gameplay rules were introduced.

## Test-only run

Run `node --test server/test/*.test.mjs`. Standalone tests bind to loopback and use synthetic credentials. In the existing Spelling Snake/EDU repository, run `MOSHROIDS_SOURCE=/absolute/path/to/classroom-flap-moshroids npm test -- --disableConsoleIntercept lib/moshroids-integration.test.ts` for the actual classroom issuer/atomic consume/remote verifier plus 26 real WebSocket clients, replay and reconnect. The upstream LLP response and service network hop are test doubles; this is not WAN or production-capacity proof. `lib/moshroids-d1.test.ts` separately verifies 26 competing consumes against real local D1/Miniflare. The production entrypoint fails closed without `MOSHROIDS_ALLOWED_ORIGINS`, `MOSHROIDS_AUTH_VERIFY_URL`, and `MOSHROIDS_SERVICE_SECRET`.

## Production prerequisites

The outbound-only Astroids-KNAS connector is prepared separately in
[`cloudflared/`](cloudflared/README.md). It reuses the existing private bridge;
the owner credential, public route, real auth and external verification gates
still apply. Preparing it does not activate classroom access or switch Firebase.

1. Release the verified classroom issuer and configure matching private service secrets through the existing deployment workflow (not performed in this pass).
2. A dedicated HTTPS hostname and Synology reverse-proxy WebSocket route must be configured with the exact GitHub Pages origin allowed. Do not expose a raw NAS port to the Internet.
3. Supply the existing authenticated launch through the tested browser adapter;
   verify the public game before changing the default provider.

## Isolated KNAS deployment

From this repository root, `docker compose -p moshroids -f server/compose.yaml
up -d --build` manages only `moshroids-realtime`. The image copies server and game
pure-rule modules, runs as non-root with a read-only filesystem, and publishes
**only 127.0.0.1:8794**. Never change the bind to public 0.0.0.0 on the NAS host.
Container-internal bind is 0.0.0.0 so the loopback host mapping can reach it.
TIMEZ 8793 and other containers are not dependencies and must not be changed.

`MOSHROIDS_STANDBY=true` explicitly rejects every classroom authentication and
reports `classroomReady:false` at `/health`. Production activation requires
`MOSHROIDS_STANDBY=false` plus the existing verifier URL and matching private
service secret; missing configuration then fails startup. Do not commit secrets.
`MOSHROIDS_ALLOWED_ORIGINS` stays `https://mrjkirby.github.io`.

`docker exec moshroids-realtime node server/test/performance.mjs` runs a separate
loopback fixture server and 26 synthetic clients inside the NAS container. It
reports server-process CPU/RSS, aggregate traffic, action latency, claims/state
agreement and reconnect for each mode; it never calls production LLP/Firebase.
This is hardware capacity evidence, not public WSS or real student-login proof.
