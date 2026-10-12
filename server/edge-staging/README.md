# MOSHROIDS Workers VPC staging

Isolated transport and tester-authorized gameplay verification. Firebase remains
production. The edge does not own identity, sessions, or classroom data.

## Ownership and routing

- `worker.mjs`: exact GET path allowlist, Origin guard, pinned VPC forwarding.
- `wrangler.json`: existing Cloudflare account and two narrow VPC Service bindings.
- `verify-bridge.mjs`: server-only authorization and fixed probe request validation.
- `gameplay-probe.mjs`: private protocol probe; no identity or game authority.
- `probe.mjs`: external TLS/WS upgrade, ping/pong, rejection and socket-concurrency
  checks using synthetic invalid credentials only. No authentication bypass.
- `../test/edge-staging.test.mjs`: isolated edge policy regression tests.

Intended public endpoint: `https://moshroids-staging.mrjkirby.workers.dev`.
Public transport routes are `/health` and `/ws`; the separate POST `/verify`
requires server authorization as described below. Query strings and other
methods/paths are rejected. WebSockets require Origin `https://mrjkirby.github.io` at both
edge and KNAS. Origin is not authentication: game messages still pass through
the existing server's classroom-token/session gate before any join.

VPC Service `01a12255-8c8b-7583-88d8-0093b1c2f779` was created on 2026-10-09,
named `moshroids-staging`, HTTP port 8794 only, hostname `moshroids-realtime`,
using existing Astroids-KNAS tunnel `0df1a0e1-0d74-4873-85e6-4f6392b602d1`.
It is a service binding, NOT a broad network binding. No DNS/public tunnel route,
new connector, router forwarding or raw public NAS port is needed.

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
npx wrangler@4.149.0 deploy --dry-run --config server/edge-staging/wrangler.json
# Only after authorized Cloudflare login, without changing other applications:
npx wrangler@4.149.0 deploy --config server/edge-staging/wrangler.json
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
the ordinary KNAS WebSocket protocol through the separate VPC service
`moshroids-auth-staging`, pinned to that container on private port 8794.
It checks identity against the server-authenticated expected identity, requires
KNAS tester authorization, and waits for natural expiry without modifying TTL.
Original `/health` and `/ws` routing is unchanged.

The secret is provisioned using Wrangler hidden stdin, never its config file.
Observability remains disabled. Do not log request bodies or run credential-
dumping debugging commands. Keep Firebase selected and the earlier unpublished
GitHub commit chain local unless separately approved for publication.

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
