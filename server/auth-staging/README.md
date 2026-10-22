# Private EDU-authenticated staging

This separate service runs the existing MOSHROIDS verifier and game server with
the new one-time-token redemption and reconnect-session flow. It does not
modify the deny-all `moshroids-realtime` service or its 127.0.0.1:8794 mapping.
The isolated Worker may route only `/api/launch/redeem` and `/ws` to this
authenticated service. Firebase remains the production default.

Deploy this directory as a separate Compose project, `moshroids-auth-staging`,
under the same-named KNAS docker directory. The only network is the existing
private `moshroids_default` bridge; no host ports are published.

`private/service.env` must be mode 600 inside a mode-700 directory, containing
the server-only `MOSHROIDS_SERVICE_SECRET` configured in the existing Snake Site.
Never commit, print or log it. Do not run unredacted `docker inspect` or
`docker compose config`, which can reveal environment secrets.

The existing per-process `MOSHROIDS_STANDBY=false` flag activates real token
verification **only on this isolated instance**. Its private health therefore
reports classroomReady=true, which is configuration health, not release
readiness. The original server/public health remains classroomReady=false until
the end-to-end, security, reconnect and capacity gates pass. This is not a
tester identity override or a second authentication mechanism.

The issuer is Snake version 29, source `7a8cdab`, integrated onto version 28.
Same-origin POST `/api/moshroids` with action `moshroidsIssueLaunch` and an
allowed room uses the real HttpOnly EDU session. Ordinary learner identity is
rechecked through LLP; SUPERMRKIRBY must pass the existing server tester control.
The single-use grant then follows the normal verifier, expiry, room/scope and
atomic consume checks. This service accepts only legitimately issued identities,
not fixtures, names, injected cookies or static bearer tokens.

The staging page redeems the grant over the exact-origin HTTPS API; the WebSocket
accepts only the separate five-minute KNAS session credential. The browser
removes the one-time launch fragment immediately, and refresh/reconnect uses a
rotating tab-scoped session credential. Never create synthetic live learners or
reuse student cookies.

Issuer redemption has a bounded 45-second network/body deadline, allowing a
live LLP tester-permission check rather than abandoning it after four seconds.
There is no automatic consume retry. The existing 60-second grant expiry is
still checked after the issuer responds, and expired/replayed grants fail closed.

The October 22 launch-timeout repair image is
`sha256:b5b599fda02a04d94c07dd66eefae3e790d5966fff72a9ac582283519b6316f0`
(source `d75aded`). It changes only the server verifier; the standby image,
public Firebase configuration, private service secret and network are unchanged.

## Release verification (2026-10-12)

- Snake version 29 deployed successfully with runtime environment revision 2.
  Public home: HTTP 200. Issuer: unauthenticated 401, wrong Origin 403,
  browser identity substitution 400, unauthorized consume 403.
- Live D1 overview confirms the new grant table alongside all previous tables.
  No live learner rows or evaluations were edited during verification.
- KNAS service-secret acceptance is proven by authenticated wrong-audience
  consume returning 400 (the unauthorized service branch returns 403).
  A syntactically valid unknown grant returns 403, not a database error.
- Both realtime containers and the tunnel are healthy. The private authenticated
  instance has zero rooms/connections and no published ports. Original standby
  remains classroomReady=false with only its existing loopback mapping.
- Host Docker warns that its kernel cannot enforce the configured PIDs limit.
  Read-only filesystem, dropped capabilities, no-new-privileges and memory limit
  remain configured. No unrelated service configuration was changed.
- Snake regression/issuer/migration suite: 154/154; TypeScript and production
  build passed. MOSHROIDS existing suite: 74/74, plus two staging config tests.
- Positive live TEST issuance/consume and authenticated gameplay remain untested.
  Local tests used synthetic fixtures; these are not live EDU identities.

## Session launch update (2026-10-20)

- Updated isolated image: `sha256:5b67ddd25ccfd155d79a60eb296f86eea0beb6c1ad935edb59e3c6ec425a8cbc`.
- `/api/launch/redeem` delegates one-use token validation/consumption to the
  existing LLP verifier and returns a separate session token. WebSocket hello
  accepts only that session credential; reconnect rotates it without extending
  the five-minute absolute lifetime.
- The public staging Worker and GitHub Pages release must use the new flow.
  End-to-end live LLP launch, one-use/replay, refresh and authenticated 26
  distinct classroom accounts remain unverified; do not infer those passes from
  synthetic tests.
- Worker version `9adf60bd-b64b-4fe7-8b1b-6cf8663cadb1` and the Pages client
  from commit `911ca3f` are live. Public invalid-token/session rejection and
  the staging page's fail-closed direct access were verified. A positive
  authorized launch is still required; `classroomReady:false` and the Firebase
  production default remain unchanged.
