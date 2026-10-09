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

At preparation, all five focused tests, the full 74-test regression suite and
the Wrangler build pass. Worker
publication is awaiting the owner completing Cloudflare's Wrangler consent
screen. No public hostname has been verified yet. The VPC service exists;
both existing KNAS containers were checked running/healthy afterwards.

The external probe stops if health fails. It never supplies a real student token.
It can show 26 simultaneous unauthenticated upgrades and fail-closed token
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
