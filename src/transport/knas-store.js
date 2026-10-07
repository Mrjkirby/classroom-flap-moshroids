import { RealtimeConnection } from './connection.js';
import { transportConfig } from './config.js';
import { ROOM_ID } from '../gameMode.js';
import { sharedClock } from '../sharedClock.js';

export const store = { players: new Map(), destroyed: new Map(), drops: new Map(), boss: null, identity: null, connected: false };
const listeners = new Set();
export const subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
const emit = value => listeners.forEach(listener => listener(value));
let connection;
export function connect() {
  if (connection) return connection;
  connection = new RealtimeConnection({ ...transportConfig, url: transportConfig.websocketUrl, roomId: ROOM_ID,
    onStatus(connected, detail) { store.connected = connected; emit({ type: 'status', connected, detail }); },
    onMessage(value) {
      if (value.type === 'authenticated') store.testerAuthorized = value.testerAuthorized === true;
      if (value.type === 'heartbeat' && Number.isFinite(value.sentAt))
        sharedClock.setOffset(value.serverNow - (value.sentAt + Date.now()) / 2);
      if (value.type === 'welcome') {
        sharedClock.setOffset(value.serverNow - Date.now());
        store.players = new Map(value.players.map(player => [player.id, player]));
        const own = store.players.get(value.studentId);
        store.identity = { uid: value.studentId, name: own?.name || 'PILOT' };
      }
      if (value.type === 'playerState' || value.type === 'playerJoined')
        store.players.set(value.player.id, { ...store.players.get(value.player.id), ...value.player });
      if (value.type === 'playerLeft') store.players.delete(value.studentId);
      if (value.type === 'shared') {
        if (value.channel === 'boss') store.boss = { ...value.state,
          cannons: value.reset ? {} : store.boss?.cannons || {} };
        else if (value.channel === 'cannon') store.boss = { ...store.boss,
          cannons: { ...store.boss?.cannons, [value.uid]: value.cannon } };
        else {
          const key = value.channel === 'asteroids' ? 'destroyed' : value.channel === 'drops' ? 'drops' : null;
          if (key) {
            // Immutable cache identity is the existing asteroid director's
            // reconstruction signal; mutating its Map silently loses MR K.
            const next = value.reset ? new Map() : new Map(store[key]);
            for (const [id, record] of value.entries || []) record === null ? next.delete(id) : next.set(id, record);
            store[key] = next;
          }
        }
      }
      emit(value);
    },
  });
  connection.start(); return connection;
}
export const request = (action, data) => connection?.request(action, data) || Promise.resolve(false);
export const send = value => connection?.send(value) || false;
export function disconnect() { connection?.stop(); connection = null; store.connected = false; store.identity = null; store.players.clear(); }
