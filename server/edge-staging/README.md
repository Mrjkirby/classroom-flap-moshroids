# MOSHROIDS Workers VPC staging

Transport validation only. Firebase remains production; no game, identity,
session, router, container, or classroom data changes are part of this edge.

## Ownership and routing

- `worker.mjs`: exact GET path allowlist, Origin guard, pinned VPC forwarding.
- `wrangler.json`: existing Cloudflare account and one narrow VPC Service binding.
- `probe.mjs`: external TLS/WS upgrade, ping/pong, rejection and socket-concurrency
  checks using synthetic invalid credentials only. No authentication bypass.
- `../test/edge-staging.test.mjs`: isolated edge policy regression tests.

Intended public endpoint: `https://moshroids-staging.mrjkirby.workers.dev`.
The only routes are `/health` and `/ws`; query strings and other methods/paths
are rejected. WebSockets require Origin `https://mrjkirby.github.io` at both
edge and KNAS. Origin is not authentication: game messages still pass through
the existing server's classroom-token/session gate before any join.

VPC Service `01a12255-8c8b-7583-88d8-0093b1c2f779` was created on 2026-10-09,
named `moshroids-staging`, HTTP port 8794 only, hostname `moshroids-realtime`,
using existing Astroids-KNAS tunnel `0df1a0e1-0d74-4873-85e6-4f6392b602d1`.
It is a service binding, NOT a broad network binding. No DNS/public tunnel route,
new connector, router forwarding or raw public NAS port is needed.

The Worker has no credentials, storage, gameplay logic or authority. It passes
upgrades intact and forwards neither cookies nor Authorization headers. No
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
