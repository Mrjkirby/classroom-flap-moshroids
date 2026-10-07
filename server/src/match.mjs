import { normalizeEvent, normalizeState, roomMode } from './protocol.mjs';
import { SharedState } from './shared-state.mjs';

const STALE_AFTER_MS = 30_000;
const EVENT_LIMIT = 200;

function now() { return Date.now(); }

export class Match {
  constructor(roomId, { clock = now, log = () => {} } = {}) {
    this.roomId = roomId;
    this.mode = roomMode(roomId);
    this.clock = clock;
    this.log = log;
    this.clients = new Map();
    this.players = new Map();
    this.events = [];
    this.shared = new SharedState(this);
  }

  snapshot() {
    return {
      roomId: this.roomId, mode: this.mode, serverNow: this.clock(),
      players: [...this.players.values()].map(player => ({ ...player, teamShots: [] })),
      events: this.events.slice(-EVENT_LIMIT),
    };
  }

  join(session, socket) {
    if (!this.clients.has(session.studentId) && this.clients.size >= 64) return socket.close(4004, 'Room is full.');
    const existing = this.clients.get(session.studentId);
    if (existing && existing.socket !== socket) existing.socket.close(4001, 'Replaced by a newer connection.');
    const player = this.players.get(session.studentId) || {
      id: session.studentId, name: session.displayName, x: 0, y: 0, angle: 0,
      velocityX: 0, velocityY: 0, visible: true, score: 0, guns: 0, team: 'neutral',
    };
    player.name = session.displayName;
    player.updatedAt = this.clock();
    this.players.set(session.studentId, player);
    this.clients.set(session.studentId, { socket, testerAuthorized: session.testerAuthorized === true, lastSeenAt: this.clock(), stateWindowAt: 0, stateCount: 0, eventWindowAt: 0, eventCount: 0 });
    socket.send({ type: 'welcome', studentId: session.studentId, ...this.snapshot() });
    for (const current of this.players.values()) if (current.teamShots?.length)
      socket.send({ type: 'playerState', player: { ...current }, serverNow: this.clock() });
    this.shared.snapshot(socket);
    socket.send({ type: 'ready', serverNow: this.clock() });
    this.broadcast({ type: 'playerJoined', player: { ...player }, serverNow: this.clock() }, session.studentId);
  }

  leave(studentId, socket) {
    const client = this.clients.get(studentId);
    if (!client || (socket && client.socket !== socket)) return;
    this.clients.delete(studentId);
    this.players.delete(studentId);
    this.broadcast({ type: 'playerLeft', studentId, serverNow: this.clock() });
  }

  receive(studentId, value) {
    const client = this.clients.get(studentId);
    const player = this.players.get(studentId);
    if (!client || !player) return;
    client.lastSeenAt = this.clock();
    if (value.type === 'heartbeat') return client.socket.send({ type: 'heartbeat', serverNow: this.clock(), sentAt: value.sentAt });
    if (value.type === 'action') {
      const time = this.clock();
      if (time - (client.actionWindowAt || 0) >= 1000) { client.actionWindowAt = time; client.actionCount = 0; }
      client.actionCount = (client.actionCount || 0) + 1;
      const ok = client.actionCount <= 100 && typeof value.action === 'string' &&
        value.data && typeof value.data === 'object' && !Array.isArray(value.data) &&
        this.shared.apply(player, value.action, value.data);
      return client.socket.send({ type: 'result', requestId: String(value.requestId || '').slice(0, 64), ok: !!ok });
    }
    if (value.type === 'state') return this.updateState(client, player, value.state);
    if (value.type === 'event') return this.publishEvent(client, player, value.event);
    client.socket.send({ type: 'error', error: 'Unknown message type.' });
  }

  updateState(client, player, value) {
    const time = this.clock();
    if (time - client.stateWindowAt >= 1000) { client.stateWindowAt = time; client.stateCount = 0; }
    if (++client.stateCount > 15) return client.socket.send({ type: 'error', error: 'State rate limit exceeded.' });
    const state = normalizeState(value);
    if (!state) return client.socket.send({ type: 'error', error: 'Invalid player state.' });
    Object.assign(player, state, { updatedAt: time });
    this.broadcast({ type: 'playerState', player: { id: player.id, ...state, updatedAt: time }, serverNow: time }, player.id);
  }

  publishEvent(client, player, raw) {
    const time = this.clock();
    if (time - client.eventWindowAt >= 1000) { client.eventWindowAt = time; client.eventCount = 0; }
    if (++client.eventCount > 25) return client.socket.send({ type: 'error', error: 'Event rate limit exceeded.' });
    const event = normalizeEvent(raw);
    if (!event) return client.socket.send({ type: 'error', error: 'Invalid event.' });
    if (event.kind === 'asteroidDestroyed') {
      if (!this.shared.apply(player, 'asteroidClaim', { id: event.id })) return client.socket.send({ type: 'eventRejected', kind: event.kind, id: event.id });
    }
    if (event.kind === 'gunDropPublished' && !this.shared.apply(player, 'dropPublish', { drops: [{ id: event.id, x: player.x, y: player.y }] }))
      return client.socket.send({ type: 'eventRejected', kind: event.kind, id: event.id });
    if (event.kind === 'gunDropClaimed' && !this.shared.apply(player, 'dropClaim', { id: event.id }))
      return client.socket.send({ type: 'eventRejected', kind: event.kind, id: event.id });
    const record = { ...event, by: player.id, at: time };
    this.events.push(record);
    if (this.events.length > EVENT_LIMIT) this.events.splice(0, this.events.length - EVENT_LIMIT);
    this.broadcast({ type: 'event', event: record, serverNow: time });
  }

  cleanup() {
    const cutoff = this.clock() - STALE_AFTER_MS;
    for (const [studentId, client] of this.clients) {
      if (client.lastSeenAt < cutoff) client.socket.close(4002, 'Connection timed out.');
    }
    this.shared.cleanup();
  }

  broadcast(value, excludedStudentId = null) {
    for (const [studentId, client] of this.clients) if (studentId !== excludedStudentId) client.socket.send(value);
  }
}

export class MatchRegistry {
  constructor(options = {}) { this.options = options; this.matches = new Map(); }
  get(roomId) {
    if (!roomMode(roomId)) return null;
    if (!this.matches.has(roomId)) this.matches.set(roomId, new Match(roomId, this.options));
    return this.matches.get(roomId);
  }
  cleanup() { for (const match of this.matches.values()) match.cleanup(); }
  status() { return { rooms: this.matches.size, connections: [...this.matches.values()].reduce((sum, match) => sum + match.clients.size, 0) }; }
}
