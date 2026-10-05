# MOSHROIDS realtime server (pre-production)

This is an isolated WebSocket server preparation for MOSHROIDS. It is **not** wired into the GitHub Pages client and must not replace Firebase until a secure, short-lived MOSHROIDS access-token verifier and an exact HTTPS WebSocket reverse-proxy route are approved.

## Ownership

- `src/app.mjs`: HTTP health endpoint, WebSocket upgrade, origin and access-token gate.
- `src/auth/remote-token-verifier.mjs`: HTTPS-only one-time-token verifier; it never trusts an identity from the WebSocket client.
- `src/websocket.mjs`: small RFC 6455 text-frame transport; no gameplay rules.
- `src/protocol.mjs`: bounded untrusted-message parsing and current room identifiers.
- `src/match.mjs`: authoritative in-memory room/player/event state, duplicate protection, stale cleanup, and first-writer claims.

The server intentionally persists no frame data and starts with empty matches after a restart. Clients must re-authenticate and rejoin. Firebase remains the live transport and source of current room state.

## Classroom token contract

The existing classroom identity service must expose an HTTPS-only server endpoint configured by `MOSHROIDS_AUTH_VERIFY_URL`. It receives `{ action: 'moshroidsVerifySession', accessToken, audience: 'moshroids', roomId }`, atomically consumes a short-lived token, and returns only `{ ok: true, consumed: true, audience: 'moshroids', tokenId, expiresAt, student: { id, loginName, active: true } }`. Reuse the existing LLP/GameAccess session as the issuer; do not put a password, LLP credential, signing key, or persistent session in the browser or URL.

## Test-only run

Run `node --test server/test/*.test.mjs`. The tests inject a fake verifier and bind to loopback only. The production entrypoint fails closed without both `MOSHROIDS_ALLOWED_ORIGINS` and `MOSHROIDS_AUTH_VERIFY_URL`.

## Production prerequisites

1. An existing classroom service must issue and verify a MOSHROIDS-scoped, short-lived access token server-to-server.
2. A dedicated HTTPS hostname and Synology reverse-proxy WebSocket route must be configured with the exact GitHub Pages origin allowed. Do not expose a raw NAS port to the Internet.
3. The existing client must gain a tested WebSocket transport adapter while retaining the Firebase adapter for rollback.
