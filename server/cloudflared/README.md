# Astroids-KNAS connector preparation

This standalone Compose project adds only `moshroids-cloudflared`. It reuses
the verified `moshroids_default` bridge, currently containing only
`moshroids-realtime`. No host networking, published ports, Docker socket,
new database, server rebuild, or change to the existing realtime service.
The official Cloudflare 2026.10.0 image is pinned by registry digest.

## Credential gate / owner action

The connector is **prepared, not started** until the owner installs the existing
Astroids-KNAS token privately. From the owner's Mac Terminal:

```sh
ssh -t mrkirby@knas.local 'sh "/volume1/Shared NAS Folder/docker/moshroids-cloudflared/store-token.sh"'
```

Paste **only the token**, not the dashboard Docker command, into the hidden
prompt. Never paste it into chat, source, Git, environment variables, or logs.
The helper refuses replacement and writes `secrets/tunnel-token` with mode 0600
inside a mode-0700 directory owned by the verified KNAS account (1026:100).
It does not start a container. The credential is mounted read-only and excluded
from Git. File contents must never be inspected or printed by deployment tools.
The Python 3 input reader accepts the current base64 JSON tunnel-token envelope,
removes only paired terminal bracketed-paste markers, and rejects empty input,
whitespace, multiline pastes, whole Docker commands and malformed envelopes.
It reports categories only, never the rejected input. This is syntax validation;
only Cloudflare can authenticate the token.

### Current gate (2026-10-09)

Owner-authorized hidden storage succeeded; the connector is running healthy and
Cloudflare lists one healthy Astroids-KNAS replica. All four edge connections
registered, and the origin health check from the connector network namespace
returns HTTP 200 with `classroomReady:false`. No public route was created: the
account's Domains overview shows no domains. A conventional published route
requires an owner-controlled Cloudflare domain. The alternative
[Workers VPC staging edge](../edge-staging/README.md) is now published with a
narrowly scoped service binding. External health, 26-socket transport and
fail-closed authentication probes pass; authenticated gameplay remains gated.
Firebase remains selected. The realtime server, TIMEZ and routers are unchanged.

## Resume after the credential gate

On KNAS, in `/volume1/Shared NAS Folder/docker/moshroids-cloudflared`:

```sh
/usr/local/bin/docker compose -p moshroids-cloudflared -f compose.yaml config --quiet
/usr/local/bin/docker compose -p moshroids-cloudflared -f compose.yaml up -d --no-deps
/usr/local/bin/docker inspect moshroids-cloudflared --format '{{.State.Health.Status}}'
```

Readiness checks Cloudflare's `/ready` endpoint using the bundled `tunnel ready`
command, not just process existence. Metrics bind to container loopback only.
Use info-level logs only; never debug logging or unfiltered credential dumps.
Automatic restart policy is `unless-stopped`; do not restart the game server.

## Dedicated public route (not configured yet)

After confirming an owner-controlled Cloudflare zone and hostname, configure
only its MOSHROIDS published application route with HTTP origin
`http://moshroids-realtime:8794`. The existing server accepts `/health` and
WebSocket upgrades at `/ws`; the browser URL is `wss://<approved-hostname>/ws`.
Do not route DSM, SSH, TIMEZ, other NAS applications or a wildcard/default NAS
service. No inbound forwarding is needed. No hostname has been invented here.

Connector readiness proves neither classroom auth nor public gameplay. Keep
Firebase selected and `classroomReady:false` until real issuer/launcher auth,
external HTTPS/WSS, strict GitHub Origin, reconnect and external 26-client tests
pass. The existing in-memory server and Firebase rollback are unchanged.

## Verification

```sh
node --test server/test/cloudflared-config.test.mjs
node --experimental-vm-modules --test server/test/*.test.mjs tests/*.mjs
```

The preparation tests use Node plus Python 3's standard-library pseudo-terminal,
with synthetic token input only. Do not run the 26-client
production/tunnel load test before external WSS and authorization are verified.
