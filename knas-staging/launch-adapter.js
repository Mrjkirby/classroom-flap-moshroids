import { isLaunchGrant } from '../src/transport/connection.js';

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
} = {}) {
  let directGrant = null;
  if (locationRef?.hash) {
    const params = new URLSearchParams(locationRef.hash.slice(1));
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

  const requestLaunch = roomId => {
    if (directGrant) {
      const grant = directGrant;
      directGrant = null;
      if (!ALLOWED_ROOMS.has(roomId) || !isLaunchGrant(grant, roomId)) {
        return Promise.reject(new Error('The launch link is invalid or expired.'));
      }
      return Promise.resolve(grant);
    }
    if (!ALLOWED_ROOMS.has(roomId) || !windowRef?.opener) {
      return Promise.reject(new Error('An authorized LLP launch is required.'));
    }

    const opener = windowRef.opener;
    const requestId = crypto.randomUUID();
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
          reject(new Error('The authorized LLP launch did not provide a valid grant.'));
          return;
        }
        resolve(message.grant);
      };
      const timer = setTimeout(() => {
        cleanup();
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
        reject(error);
      }
    });
  };
  requestLaunch.hasNewLaunch = Boolean(directGrant);
  return { requestLaunch };
}
