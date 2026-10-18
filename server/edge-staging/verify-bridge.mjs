import { connectPrivate, runGameplayProbe } from './gameplay-probe.mjs';

const reply = (body, status = 200) => Response.json(body, { status,
  headers: { 'cache-control': 'no-store' } });
async function serviceAuthorized(request, secret) {
  if (!/^[a-f0-9]{64}$/.test(secret || '')) return false;
  const hash = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const a = await hash(request.headers.get('authorization') || '');
  const b = await hash('Bearer ' + secret);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function grantValid(g) {
  return g && typeof g === 'object' && Object.keys(g).every(k => ['accessToken', 'expiresAt', 'audience', 'ok'].includes(k)) &&
    /^ml1_[a-f0-9]{64}$/.test(g.accessToken) && g.audience === 'moshroids' &&
    Number.isFinite(Date.parse(g.expiresAt));
}
export async function verifyBridge(request, env, run = runGameplayProbe) {
  if (request.method !== 'POST') return reply({ ok: false }, 405);
  // A server-only probe, not a browser WebSocket proxy or alternate sign-in.
  if (request.headers.has('origin') || request.headers.has('cookie') ||
    !await serviceAuthorized(request, env.MOSHROIDS_SERVICE_SECRET)) return reply({ ok: false }, 403);
  if (!env.MOSHROIDS_VPC) return reply({ ok: false }, 503);
  try {
    const raw = await request.text();
    if (raw.length > 2048) return reply({ ok: false }, 413);
    const body = JSON.parse(raw);
    if (!body || Object.keys(body).sort().join() !== 'active,expectedId,expiring' ||
      !grantValid(body.active) || !grantValid(body.expiring) ||
      typeof body.expectedId !== 'string' || !body.expectedId || body.expectedId.length > 96)
      return reply({ ok: false }, 400);
    const result = await run(body, hello => connectPrivate(env.MOSHROIDS_VPC, hello));
    if (result.failure) console.warn(JSON.stringify({ event: 'staging_probe_failure', ...result.failure }));
    return reply(result);
  } catch { return reply({ ok: false }, 502); }
}
