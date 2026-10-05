import { createHash } from 'node:crypto';

const MAX_TOKEN_LENGTH = 4_096;
const MIN_REMAINING_LIFETIME_MS = 1_000;

function asText(value, maximum = 160) {
  return typeof value === 'string' ? value.trim().slice(0, maximum) : '';
}

function tokenHash(token) {
  return createHash('sha256').update(token).digest('base64url');
}

function validEndpoint(value) {
  const endpoint = new URL(value);
  if (endpoint.protocol !== 'https:') throw new Error('MOSHROIDS token verification must use HTTPS.');
  return endpoint;
}

/**
 * Verifies a browser-presented, one-time MOSHROIDS token with the existing
 * classroom identity service. The browser never receives a verifier secret.
 *
 * The identity service must consume the token atomically and respond with:
 * { ok, consumed: true, audience: 'moshroids', tokenId, expiresAt,
 *   student: { id, loginName, active: true } }
 */
export function createRemoteTokenVerifier({
  endpoint,
  audience = 'moshroids',
  fetcher = globalThis.fetch,
  clock = () => Date.now(),
} = {}) {
  const url = validEndpoint(endpoint);
  if (typeof fetcher !== 'function') throw new Error('A fetch implementation is required.');
  const accepted = new Map();

  return async function verifyMoshroidsToken({ accessToken, roomId }) {
    const token = asText(accessToken, MAX_TOKEN_LENGTH + 1);
    if (!token || token.length > MAX_TOKEN_LENGTH) throw new Error('Invalid MOSHROIDS access token.');
    const fingerprint = tokenHash(token);
    const previousExpiry = accepted.get(fingerprint);
    if (previousExpiry && previousExpiry > clock()) throw new Error('MOSHROIDS access token was already used.');
    if (previousExpiry) accepted.delete(fingerprint);

    let response;
    try {
      response = await fetcher(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ action: 'moshroidsVerifySession', accessToken: token, audience, roomId }),
      });
    } catch {
      throw new Error('MOSHROIDS identity service is unavailable.');
    }

    let body;
    try { body = await response.json(); } catch { throw new Error('MOSHROIDS identity service returned invalid data.'); }
    if (!response.ok || !body || body.ok !== true || body.consumed !== true || body.audience !== audience) {
      throw new Error('MOSHROIDS access token was rejected.');
    }
    const expiresAt = new Date(asText(body.expiresAt, 64)).getTime();
    const tokenId = asText(body.tokenId, 160);
    const studentId = asText(body.student?.id, 96);
    const displayName = asText(body.student?.loginName, 32);
    if (!tokenId || !studentId || !displayName || body.student?.active !== true ||
      !Number.isFinite(expiresAt) || expiresAt - clock() < MIN_REMAINING_LIFETIME_MS) {
      throw new Error('MOSHROIDS identity response was not valid.');
    }
    accepted.set(fingerprint, expiresAt);
    return { studentId, displayName };
  };
}
