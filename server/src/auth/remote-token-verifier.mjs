import { roomMode } from '../protocol.mjs';

// The issuer may recheck LLP tester permission before its atomic consume.
// Leave headroom within the existing 60-second grant lifetime; never retry a consume.
const VERIFY_TIMEOUT_MS = 45_000;

// The classroom D1 DELETE/RETURNING, not process-local memory, owns replay protection.
export function createRemoteTokenVerifier({ endpoint, serviceSecret,
  fetcher = globalThis.fetch, clock = () => Date.now() } = {}) {
  const url = new URL(endpoint);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('MOSHROIDS token verification must use a credential-free HTTPS endpoint.');
  }
  if (!/^[a-f0-9]{64}$/.test(serviceSecret || '')) throw new Error('A server-only MOSHROIDS service secret is required.');
  return async function verifyMoshroidsToken({ accessToken, roomId }) {
    if (typeof accessToken !== 'string' || !/^ml1_[a-f0-9]{64}$/.test(accessToken) || !roomMode(roomId)) {
      throw new Error('Invalid MOSHROIDS access token or room.');
    }
    let response, body;
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('Verification timeout'));
      }, VERIFY_TIMEOUT_MS);
    });
    try {
      const result = await Promise.race([deadline, (async () => {
        const response = await fetcher(url, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { 'content-type': 'application/json', accept: 'application/json',
            authorization: 'Bearer ' + serviceSecret },
          body: JSON.stringify({ action: 'moshroidsVerifySession', accessToken, audience: 'moshroids', roomId }),
        });
        return { response, body: await response.json() };
      })()]);
      ({ response, body } = result);
    } catch {
      throw new Error('MOSHROIDS identity service is unavailable.');
    } finally { clearTimeout(timer); }
    const issuedAt = Date.parse(body?.issuedAt);
    const expiresAt = Date.parse(body?.expiresAt);
    const studentId = body?.student?.id;
    const displayName = body?.student?.loginName;
    if (!response.ok || body?.ok !== true || body.consumed !== true || body.audience !== 'moshroids' ||
      body.roomId !== roomId || typeof body.tokenId !== 'string' || !body.tokenId ||
      !Number.isFinite(issuedAt) || !Number.isFinite(expiresAt) || issuedAt > clock() + 1000 ||
      expiresAt <= clock() || expiresAt - issuedAt > 60_000 || expiresAt <= issuedAt ||
      typeof body.testerAuthorized !== 'boolean' || body.student?.active !== true ||
      typeof studentId !== 'string' || !studentId || studentId.length > 96 ||
      typeof displayName !== 'string' || !displayName.trim() || displayName.length > 32 ||
      /[\u0000-\u001f<>]/.test(studentId + displayName) ||
      (body.testerAuthorized !== (studentId === 'supermrkirby-test-player'))) {
      throw new Error('MOSHROIDS identity response was not valid.');
    }
    return { studentId, displayName, testerAuthorized: body.testerAuthorized };
  };
}
