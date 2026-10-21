import { isLaunchGrant } from '../src/transport/connection.js';
import { reportTransportDiagnostic } from '../src/transport/diagnostics.js';

export const LLP_LAUNCHER_ORIGIN =
  'https://spelling-snake-mr-kirby.mr-kirby.chatgpt.site';

const ALLOWED_ROOMS = new Set(['classroom', 'classroom-teams', 'classroom-1vw']);
const RESPONSE_TIMEOUT_MS = 15_000;

export function createOpenerLaunchAdapter({
  windowRef = globalThis.window,
  locationRef = globalThis.location,
  historyRef = globalThis.history,
  launcherOrigin = LLP_LAUNCHER_ORIGIN,
  timeoutMs = RESPONSE_TIMEOUT_MS,
  diagnostic = reportTransportDiagnostic,
} = {}) {
  let directGrant = null;
  let fragmentGrantPresent = false;
  if (locationRef?.hash) {
    const params = new URLSearchParams(locationRef.hash.slice(1));
    fragmentGrantPresent = params.has('t');
    if (params.has('t')) {
      const allowed = new Set(['t', 'roomId', 'expiresAt']);
      const entries = [...params.keys()];
      const token = params.getAll('t');
      const rooms = params.getAll('roomId');
      const expiries = params.getAll('expiresAt');
      if (entries.every(key => allowed.has(key)) && token.length === 1 &&
          rooms.length === 1 && expiries.length === 1) {
        directGrant = {
          accessToken: token[0],
          audience: 'moshroids',
          roomId: rooms[0],
          expiresAt: expiries[0],
        };
      }
      historyRef?.replaceState(null, '', `${locationRef.pathname}${locationRef.search}`);
    }
  }
  diagnostic('launch_context', {
    fragmentGrantPresent,
    fragmentGrantAccepted: Boolean(directGrant),
    authorizedOpenerPresent: Boolean(windowRef?.opener),
    fallbackInvoked: false,
  });

  const requestLaunch = roomId => {
    if (directGrant) {
      const grant = directGrant;
      directGrant = null;
      if (!ALLOWED_ROOMS.has(roomId) || !isLaunchGrant(grant, roomId)) {
        diagnostic('launch_grant', { source: 'fragment', present: true, accepted: false });
        return Promise.reject(new Error('The launch link is invalid or expired.'));
      }
      diagnostic('launch_grant', { source: 'fragment', present: true, accepted: true });
      return Promise.resolve(grant);
    }
    if (!ALLOWED_ROOMS.has(roomId) || !windowRef?.opener) {
      diagnostic('launch_request', {
        source: 'opener',
        outcome: 'unavailable',
        grantPresent: false,
        fallbackInvoked: false,
      });
      return Promise.reject(new Error('An authorized LLP launch is required.'));
    }

    const opener = windowRef.opener;
    const requestId = crypto.randomUUID();
    diagnostic('launch_request', { source: 'opener', outcome: 'sent', grantPresent: false });
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        windowRef.removeEventListener('message', receive);
      };
      const receive = event => {
        if (event.source !== opener || event.origin !== launcherOrigin) return;
        const message = event.data;
        if (!message || message.requestId !== requestId ||
            !['moshroids:launch-grant', 'moshroids:launch-error'].includes(message.type)) return;
        cleanup();
        if (message.type === 'moshroids:launch-error' ||
            !isLaunchGrant(message.grant, roomId)) {
          diagnostic('launch_grant', { source: 'opener', present: Boolean(message.grant), accepted: false });
          reject(new Error('The authorized LLP launch did not provide a valid grant.'));
          return;
        }
        diagnostic('launch_grant', { source: 'opener', present: true, accepted: true });
        resolve(message.grant);
      };
      const timer = setTimeout(() => {
        cleanup();
        diagnostic('launch_request', { source: 'opener', outcome: 'timeout', grantPresent: false });
        reject(new Error('The authorized LLP launch did not respond.'));
      }, timeoutMs);
      windowRef.addEventListener('message', receive);
      try {
        opener.postMessage({
          type: 'moshroids:launch-request',
          requestId,
          roomId,
        }, launcherOrigin);
      } catch (error) {
        cleanup();
        diagnostic('launch_request', { source: 'opener', outcome: 'send_failed', grantPresent: false });
        reject(error);
      }
    });
  };
  requestLaunch.hasNewLaunch = Boolean(directGrant);
  return { requestLaunch };
}
