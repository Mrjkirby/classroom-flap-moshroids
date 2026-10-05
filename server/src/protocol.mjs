const ROOM_IDS = new Map([
  ['classroom', 'classic'],
  ['classroom-teams', 'teams'],
  ['classroom-1vw', '1vw'],
]);

const MAX_MESSAGE_BYTES = 8 * 1024;
const MAX_NAME_LENGTH = 32;
const MAX_COORDINATE = 20_000;

export function roomMode(roomId) {
  return ROOM_IDS.get(roomId) || null;
}

export function safeText(value, maximum = MAX_NAME_LENGTH) {
  return typeof value === 'string'
    ? value.replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, maximum)
    : '';
}

export function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) <= MAX_COORDINATE
    ? number
    : fallback;
}

export function parseMessage(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_MESSAGE_BYTES) {
    return { ok: false, error: 'Message is too large.' };
  }

  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.type !== 'string') {
      return { ok: false, error: 'Message must be an object with a type.' };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, error: 'Message is not valid JSON.' };
  }
}

export function normalizeState(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    x: finiteNumber(value.x),
    y: finiteNumber(value.y),
    angle: finiteNumber(value.angle),
    velocityX: finiteNumber(value.velocityX),
    velocityY: finiteNumber(value.velocityY),
    visible: value.visible !== false,
    score: Math.max(0, finiteNumber(value.score)),
    guns: Math.max(0, Math.min(40, Math.floor(finiteNumber(value.guns)))),
    team: ['neutral', 'red', 'blue'].includes(value.team) ? value.team : 'neutral',
  };
}

export function normalizeEvent(value) {
  if (!value || typeof value !== 'object') return null;
  const kind = safeText(value.kind, 40);
  if (!['asteroidDestroyed', 'gunDropPublished', 'gunDropClaimed', 'teamVolley', 'gauntletAction', 'bullet', 'collision', 'reset'].includes(kind)) return null;
  const id = safeText(value.id, 80);
  return { kind, id, payload: value.payload && typeof value.payload === 'object' && !Array.isArray(value.payload) ? value.payload : {} };
}
