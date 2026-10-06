# MOSHROIDS realtime server (pre-production)

This is an isolated WebSocket server preparation for MOSHROIDS. It is **not** wired into the GitHub Pages client. The classroom one-time grant integration is locally tested; secrets, secure ingress, public launch wiring and production parity verification are still required before replacing Firebase.

## Ownership

- `src/app.mjs`: HTTP health endpoint, WebSocket upgrade, origin and access-token gate.
- `src/auth/remote-token-verifier.mjs`: HTTPS-only one-time-token verifier; it never trusts an identity from the WebSocket client.
- `src/auth/game-sessions.mjs`: bounded reconnect sessions with rotating credentials and fixed expiry.
- `src/websocket.mjs`: small RFC 6455 text-frame transport; no gameplay rules.
- `src/protocol.mjs`: bounded untrusted-message parsing and current room identifiers.
- `src/match.mjs`: authoritative in-memory room/player/event state, duplicate protection, stale cleanup, and first-writer claims.

The server intentionally persists no frame data and starts with empty matches after a restart. Clients must re-authenticate and rejoin. Firebase remains the live transport and source of current room state.

## Classroom token contract

The existing EDU compatibility service now owns `POST /api/moshroids`. Configure its HTTPS URL as `MOSHROIDS_AUTH_VERIFY_URL`. The authenticated same-origin classroom browser requests `moshroidsIssueLaunch` using its existing HttpOnly session. Ordinary learners are rechecked against their LLP grant/roster; the reserved tester uses the existing five-second server-authorized tester control. No separate login or browser identity is accepted.

KNAS sends `{ action: 'moshroidsVerifySession', accessToken, audience: 'moshroids', roomId }` with `Authorization: Bearer <MOSHROIDS_SERVICE_SECRET>`. The secret must be matching 32 random bytes encoded as 64 lowercase hex characters, stored only in server secret bindings. Missing configuration fails closed. Redirects are forbidden, requests are bounded to four seconds, and failed consumption is never retried automatically.

The authority is `moshroids_launch_grants` in the existing classroom D1 binding: SHA-256 hashes of 256-bit random tokens, identity snapshot, token ID, scope/room, issuing session and 60-second expiry. Atomic `DELETE ... RETURNING` permits exactly one consumer across processes. No process-local replay cache or Apps Script global lock substitutes for this database operation. The response is `{ ok: true, consumed: true, audience: 'moshroids', roomId, tokenId, issuedAt, expiresAt, testerAuthorized, student: { id, loginName, active: true } }`.

Initial WebSocket message: `{ type: 'hello', accessToken, roomId }`. Extra identity/tester fields are rejected. A successful consume produces a private `authenticated` message containing `resumeToken`, absolute `expiresAt` and verified `testerAuthorized`, followed by the existing game `welcome`. The client must keep that short-lived credential in memory only, never a URL/log/persistent storage. LLP credentials and the service secret never go to KNAS through the browser.

Reconnect uses `{ type: 'hello', resumeToken, roomId }`, not the consumed launch token. Server memory retains only the resume credential hash and verified identity, bounded to 256 sessions. Credentials rotate atomically on reconnect and are bound to room and browser Origin; duplicate credentials lose, duplicate-player launches retire the older resume credential, and reconnect never extends the five-minute absolute lifetime. Expired sockets close; restart invalidates all resume credentials. Fresh launch after expiry uses the existing classroom session, not a second login. Tester checks apply to new grants/consumes; an already established game session is a bounded capability lease, not instantaneous remote-toggle push revocation. Gameplay and reconnect do not call LLP/Sheets. No tester gameplay rules were introduced.

## Test-only run

Run `node --test server/test/*.test.mjs`. Standalone tests bind to loopback and use synthetic credentials. In the existing Spelling Snake/EDU repository, run `MOSHROIDS_SOURCE=/absolute/path/to/classroom-flap-moshroids npm test -- --disableConsoleIntercept lib/moshroids-integration.test.ts` for the actual classroom issuer/atomic consume/remote verifier plus 26 real WebSocket clients, replay and reconnect. The upstream LLP response and service network hop are test doubles; this is not WAN or production-capacity proof. `lib/moshroids-d1.test.ts` separately verifies 26 competing consumes against real local D1/Miniflare. The production entrypoint fails closed without `MOSHROIDS_ALLOWED_ORIGINS`, `MOSHROIDS_AUTH_VERIFY_URL`, and `MOSHROIDS_SERVICE_SECRET`.

## Production prerequisites

1. Release the verified classroom issuer and configure matching private service secrets through the existing deployment workflow (not performed in this pass).
2. A dedicated HTTPS hostname and Synology reverse-proxy WebSocket route must be configured with the exact GitHub Pages origin allowed. Do not expose a raw NAS port to the Internet.
3. The existing client must gain a tested WebSocket transport adapter while retaining the Firebase adapter for rollback.
