import { createHash, randomBytes } from 'node:crypto';

const hash = token => createHash('sha256').update(token).digest('hex');
const valid = token => typeof token === 'string' && /^mr1_[a-f0-9]{64}$/.test(token);
export const GAME_SESSION_TTL_MS = 5 * 60_000;

// Bounded, process-local game credentials; contains no LLP tokens or PINs.
// Reconnect rotates the credential, never extending the original absolute TTL.
export function createGameSessions({ clock = () => Date.now(), limit = 256 } = {}) {
  const records = new Map();
  function cleanup() {
    for (const [key, value] of records) if (value.expiresAt <= clock()) records.delete(key);
  }
  function put(session) {
    const resumeToken = 'mr1_' + randomBytes(32).toString('hex');
    records.set(hash(resumeToken), session);
    return { ...session, resumeToken };
  }
  return {
    create(identity, roomId, origin) {
      cleanup();
      for (const [key, value] of records) {
        if (value.identity.studentId === identity.studentId && value.roomId === roomId) records.delete(key);
      }
      if (records.size >= limit) throw new Error('Game session capacity reached.');
      return put({ identity: Object.freeze({ ...identity }), roomId, origin, expiresAt: clock() + GAME_SESSION_TTL_MS });
    },
    resume(token, roomId, origin) {
      cleanup();
      if (!valid(token)) throw new Error('Invalid game session.');
      const key = hash(token);
      const session = records.get(key);
      if (!session || session.roomId !== roomId || session.origin !== origin) throw new Error('Invalid game session.');
      records.delete(key);
      return put(session);
    },
    cleanup,
    clear() { records.clear(); },
  };
}
