# Private EDU-authenticated staging

This separate service reuses the existing MOSHROIDS image and authenticated
verifier. It does not modify the deny-all `moshroids-realtime` service or its
127.0.0.1:8794 mapping. The public staging Worker/VPC remains bound to that
deny-all service. Firebase and the GitHub Pages client remain unchanged.

Deploy this directory as a separate Compose project, `moshroids-auth-staging`,
under the same-named KNAS docker directory. The only network is the existing
private `moshroids_default` bridge; no host ports are published.

`private/service.env` must be mode 600 inside a mode-700 directory, containing
the server-only `MOSHROIDS_SERVICE_SECRET` configured in the existing Snake Site.
Never commit, print or log it. Do not run unredacted `docker inspect` or
`docker compose config`, which can reveal environment secrets.

The existing per-process `MOSHROIDS_STANDBY=false` flag activates real token
verification **only on this isolated instance**. Its private health therefore
reports classroomReady=true, which is not production readiness. The original
server and public staging edge must continue reporting classroomReady=false.
This is not a tester identity override or a second authentication mechanism.

The issuer is Snake version 29, source `7a8cdab`, integrated onto version 28.
Same-origin POST `/api/moshroids` with action `moshroidsIssueLaunch` and an
allowed room uses the real HttpOnly EDU session. Ordinary learner identity is
rechecked through LLP; SUPERMRKIRBY must pass the existing server tester control.
The single-use grant then follows the normal verifier, expiry, room/scope and
atomic consume checks. This service accepts only legitimately issued identities,
not fixtures, names, injected cookies or static bearer tokens.

Next verification requires an authorized TEST login through the existing Snake
login/LLP entry. Do not create synthetic live learners or reuse student cookies.
Only after private authenticated verification may an explicitly authorized
external staging route be connected. This configuration intentionally does not
reroute the existing Worker or production frontend.

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

The existing public staging Worker is intentionally unchanged. A real authorized
TEST session is the next prerequisite, followed by private positive verification
before connecting an external authenticated staging route.
