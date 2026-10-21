# MOSHROIDS Workers VPC staging

Isolated transport and tester-authorized gameplay verification. Firebase remains
production. The edge does not own identity, sessions, or classroom data.

## Ownership and routing

- `worker.mjs`: exact path/method allowlist, Origin guard, and fixed service forwarding.
- `wrangler.json`: existing Cloudflare account, two VPC Service bindings, and
  the staging VPC Network binding.
- `verify-bridge.mjs`: server-only authorization and fixed probe request validation.
- `gameplay-probe.mjs`: private protocol probe; no identity or game authority.
- `probe.mjs`: external TLS/WS upgrade, ping/pong, rejection and socket-concurrency
  checks using synthetic invalid credentials only. No authentication bypass.
- `../test/edge-staging.test.mjs`: isolated edge policy regression tests.

Public endpoint: `https://moshroids-staging.mrjkirby.workers.dev`.
The deployed Worker exposes `/health`, `/ws`, POST `/api/launch/redeem`, and
the server-authorized POST `/verify`. Redemption and WebSocket sessions route
only to the isolated `MOSHROIDS_AUTH_STAGING` VPC Service. `/health` continues
to report the public deny-all service, so `classroomReady:false` remains the
explicit cutover gate. Exact Origin `https://mrjkirby.github.io` is required
for browser game requests; Origin is not authentication, and all launch tokens
are verified/consumed by the existing LLP authority. Query strings and unknown
paths/methods are rejected.

VPC Service `01a12255-8c8b-7583-88d8-0093b1c2f779` was created on 2026-10-09,
named `moshroids-staging`, HTTP port 8794 only, hostname `moshroids-realtime`,
using existing Astroids-KNAS tunnel `0df1a0e1-0d74-4873-85e6-4f6392b602d1`.
It remains unchanged and serves `/health`. The authenticated launch and WebSocket routes use the existing staging-only
VPC Service binding for the private auth container. The verifier-only gameplay
probe likewise reaches that service; no user-selected target is accepted. No
DNS/public tunnel route, new connector, router forwarding or raw public NAS
port is needed.

The public transport handler has no storage or game authority. It passes
upgrades intact and forwards neither cookies nor Authorization headers. The
private verification handler alone uses the server secret. No
request logging is enabled; errors do not disclose private network details.
The server remains the authoritative verifier. TLS ends at Cloudflare; the
encrypted tunnel reaches the existing private Docker HTTP origin.

## Checks and deployment

From the repository root:

```sh
node --test server/test/edge-staging.test.mjs
node --experimental-vm-modules --test server/test/*.test.mjs tests/*.mjs
npx wrangler@4.151.1 deploy --dry-run --config server/edge-staging/wrangler.json
# Only after authorized Cloudflare login, without changing other applications:
npx wrangler@4.151.1 deploy --config server/edge-staging/wrangler.json
node server/edge-staging/probe.mjs
```

## External verification — 2026-10-11 (America/Toronto)

Published the unchanged Worker from commit `954d834` using the existing binding.
Cloudflare Worker version: `99d97834-4ac8-48af-87bf-d329679d3f18`.
Wrangler OAuth required `workers_scripts:write` in addition to the previously
granted scopes. No paid upgrade, DNS change or connector restart was needed.

The public hostname above is live. Tests ran from the Mac through public
Cloudflare HTTPS/WSS (edge IP `172.64.80.1`, valid TLS), not through a direct LAN
or container URL. This is external-edge routing proof, not a separate off-site
ISP/browser test. An immediate post-deploy request returned Cloudflare 1042/404;
a subsequent check passed without any code/config changes. Treat this as an
observed transient, not proven long-duration reliability or a known VPC cause.

- `/health`: HTTP 200, real service payload (`ok`, `serverNow`, zero rooms and
  connections, `classroomReady:false`), consistent with direct container health.
  Later external measured latency: 203 ms (earlier successful probe: 227 ms).
- Unexpected HTTP paths and query target attempts: 404. Missing/wrong WebSocket
  Origin: 403 before upgrade. `/health` and `/ws` are the only forwarded paths.
- 26 concurrent external TLS sockets: all valid 101 handshakes; two ping/pong
  rounds separated by a one-second concurrent hold. Upgrade latency 115–297 ms.
  All 26 invalid hello tokens received the backend's close code 4003.
- Fresh reconnect: valid upgrade; forged resume token rejected with 4003.
  No-token socket closed at 5002 ms, preserving the five-second auth deadline.
  Normal client close 1000 completed; no rooms/game sessions were created.
- Both MOSHROIDS containers remained healthy. Connector readiness passed.
  Realtime host port remains `127.0.0.1:8794`; TIMEZ remains running/healthy.
  No KNAS container, router, production frontend or Firebase changes were made.
- Full regression suite: 74/74 passed. Worker build, syntax and diff checks pass.

**TRANSPORT PASS / GAMEPLAY AUTH GATED.** Ping/pong is transport traffic, not
authenticated gameplay. Cloudflare may handle control frames at the edge;
the backend-specific authentication responses and service health additionally
establish the upstream path. This short 26-socket test is NOT a sustained
26-player workload or a successful authenticated session-resume test.

Next safe authenticated staging requires separate authorization for an isolated
instance of this same server/verifier, configured against the real existing EDU
one-time-token issuer with a designated non-student test identity and private
service credentials. It needs its own equally narrow staging binding; it must
not change this deny-all instance, invent identities, or redirect production.
Do not add a fake verifier or relax Origin checks to obtain a passing test.

The external probe stops if health fails. It never supplies a real student token.
It shows 26 simultaneous unauthenticated upgrades and fail-closed token
rejection, but that is NOT 26-player gameplay capacity or authenticated resume
verification. `classroomReady:false` remains an explicit blocker to those tests;
do not turn off standby or install a synthetic verifier to make them pass.

Workers Free limits apply. Workers VPC is free during beta, not guaranteed free
forever. There is no paid upgrade authorized. On VPC connectivity failure, paid
feature requirement or need to weaken security, stop; retain Firebase.

Rollback: public game never selects this endpoint. Disable only this staging
Worker's workers.dev route if necessary; do not stop Astroids-KNAS or alter the
MOSHROIDS server. Keep all staging actions separate from GitHub Pages release.

References: [VPC services](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/),
[VPC pricing](https://developers.cloudflare.com/workers-vpc/platform/pricing/).
## Authenticated private verification bridge

The existing Worker also exposes POST `/verify`, but only for server-to-server
requests authenticated by the existing `MOSHROIDS_SERVICE_SECRET`; browser
Origin/cookies are rejected. Its only operation is a fixed staging probe, not
an arbitrary proxy. No grant, identity or service secret is logged or returned.

Snake `/moshroids-staging` uses the existing authoritative tester gate and issuer.
Its server passes short-lived grants to this bridge. `gameplay-probe.mjs` runs
the ordinary KNAS WebSocket protocol through `MOSHROIDS_VPC`, pinned to
`172.22.0.4:8794/ws`.
It checks identity against the server-authenticated expected identity, requires
KNAS tester authorization, and waits for natural expiry without modifying TTL.
`/health` continues to use the existing `moshroids-staging` VPC Service.

The secret is provisioned using Wrangler hidden stdin, never its config file.
Observability remains disabled. Do not log request bodies or run credential-
dumping debugging commands. Firebase remains selected; this Worker is staging
only.

### Release verification — 2026-10-12

Snake v30 (`423d0b4`) and Worker version
`37a051b5-66cf-450a-9a15-63f914239468` are deployed. Local suites: Snake 159/159,
MOSHROIDS 79/79; Snake TypeScript and production build pass. Public external
probe: 26 upgrades and two ping/pong rounds, invalid grants rejected, reconnect
and clean close pass. Public readiness remains false. Both KNAS servers and
the connector remain healthy; the private server publishes no ports.

Live ordinary TEST is correctly denied by the existing tester gate. Anonymous
Snake staging returns 401; uncredentialed/browser edge requests return 403.
Real authenticated gameplay count is zero: existing SUPERMRKIRBY sign-in with
LLP Tester Mode enabled is still required. Synthetic protocol tests are not
live EDU issuance/consume/gameplay proof.

### VPC Network WebSocket experiment

The staging Worker forwards `/ws` with native `MOSHROIDS_VPC.fetch()` to the
fixed private target `http://172.22.0.4:8794/ws`. The binding uses the existing
tunnel `0df1a0e1-0d74-4873-85e6-4f6392b602d1`; neither existing VPC Service was
changed. Wrangler 4.151.1 deployed Worker version
`6c834cd3-534e-439a-8e94-3555bf5fab60`.

Real Cloudflare/KNAS verification passed:

- External WSS upgrade, text traffic, ping/pong, invalid-grant close 4003,
  clean close, abrupt disconnect and reconnect.
- The existing tester-authorized Snake flow reported issuance, consume, scope,
  replay, expiry, identity, substitution rejection, connection, messages,
  shared state, reconnect and resumed identity all PASS. One authenticated
  tester identity; end-to-end verifier duration was 64 seconds.
- A 26-socket simultaneous unauthenticated transport burst produced 26
  successful upgrades (84–171 ms), 26 ping/pong responses over two rounds,
  and 26 KNAS invalid-token rejections. Authentication deadline measured
  5005 ms. No game state was created.
- A separate real 26-client burst terminated all sockets abruptly after
  liveness ping/pong, then opened 26 reconnects simultaneously. All 26
  reconnects upgraded and were rejected by KNAS for synthetic invalid resume
  tokens (142–164 ms handshakes); there were no unexpected close codes.

This is not a 26-player authenticated gameplay/load test. Only one authorized
tester identity was available; do not reuse its one-time grants or invent
identities to simulate a classroom. Such a test requires 26 distinct,
authorized staging test grants. The 26-client tests establish transport,
abrupt cleanup/reconnect handling, and pre-auth rejection only; they do not
establish 26-player gameplay capacity. Production student data and
authentication were not changed.

The probe initially treated a WebSocket `error` event as a synthetic close
code 1006, obscuring the actual `close` event. It now waits for the real close
event and reports only a fixed transport boundary if no close arrives.
Focused tests and the full repository regression suite pass.

No production route, DNS, Firebase, KNAS container/network, public KNAS
exposure, or VPC Service configuration changed. Roll back by restoring the
previous staging Worker/config revision or disabling only its workers.dev
route; production does not use this staging endpoint.

### One-time launch/session release — 2026-10-20

The isolated auth-staging image
`sha256:5b67ddd25ccfd155d79a60eb296f86eea0beb6c1ad935edb59e3c6ec425a8cbc`
and Worker version `9adf60bd-b64b-4fe7-8b1b-6cf8663cadb1` are deployed. The
GitHub Pages staging client from commit `911ca3f` returns HTTP 200. A fresh
browser load shows no pilot-name login form and remains offline until launched
from an authorized classroom session.

Public probes confirmed CORS preflight 204, an unknown launch grant rejected
with 401, 26 unauthenticated socket upgrades/pongs, and rejection of all 26
invalid session credentials. The authentication deadline remained about five
seconds and a forged resume credential was rejected. These are fail-closed
transport checks, not a positive live grant or authenticated gameplay test.
The full local regression suite passed 95/95; synthetic performance tests are
not NAS or classroom capacity evidence. A real authorized one-time launch,
replay/refresh/reconnect, and 26 distinct authorized learners remain untested.
Keep `classroomReady:false` and Firebase as the production default until those
gates pass.

### Positive TEST launch failure — 2026-10-20

The reported browser landed at the site root `/`, where the published
`index.html` intentionally loads the Firebase-default game and pilot-name form.
Only `/knas-staging/` loads the KNAS client; the root page does not parse KNAS
grants or attempt KNAS redemption. Thus this observation fails before the
staging client/Worker/KNAS boundary and is not evidence of a KNAS grant
rejection. No matching KNAS auth-container log events were found in the
45-minute log window; the deployed earlier version did not log redemption
attempts, so that absence alone cannot establish whether an edge request
occurred.

The canonical local Snake source was located in the separate Spelling Snake
repository. Its issuer route is live (an unauthenticated POST correctly returns
401), but its previous UI had no MOSHROIDS launch action. A local change now
adds a button only to authenticated Snake setup/defeated screens; it requests
the same-origin one-time grant and opens this exact staging path with a fragment.
The Snake source remote currently rejects repository access, so this change is
not published. The authorized browser session is also unavailable here.
Staging-browser and private-server diagnostics record only grant-present
booleans, status categories, WebSocket close codes and identity-resolved
booleans; they exclude grants, session credentials and student identifiers.
Worker observability remains disabled.

No positive grant exchange, authenticated gameplay, replay test or refresh test
has passed from this reported launch. The supplied attempt hit `/`, not
`/knas-staging/`, so it never exercised the KNAS grant flow. The new Snake
button is a local repair only until deployed. Do not change `classroomReady`,
production transport or begin the 26-client test until it is published and the
single real TEST-account flow passes.
