import { HomingMissile } from '../../src/homingMissile.js';
import { wrappedDelta, wrappedDistance, wrap } from '../../src/physics.js';
import { SafeZones } from '../../src/safeZone.js';
import { WORLD_WIDTH as WIDTH, WORLD_HEIGHT as HEIGHT } from '../../src/worldConfig.js';
import { MissileField } from './missile-field.mjs';

const STEP_MS = 50;
const BROADCAST_MS = 100;
const HIT_RETENTION_MS = 30_000;
const MAX_POSITION_AGE_MS = 1_000;
const MAX_PREDICTION_MS = 100;
const PLAYER_RADIUS = 15;

function playerAt(player, at) {
  const elapsed = Math.max(0, Math.min(MAX_PREDICTION_MS, at - player.updatedAt)) * 60 / 1000;
  return { id: player.id, visible: player.visible,
    x: wrap(player.x + player.velocityX * elapsed, WIDTH),
    y: wrap(player.y + player.velocityY * elapsed, HEIGHT) };
}

// Swept relative movement catches a fast ship crossing a missile between
// server ticks without inflating the collision radius to compensate for lag.
function crossed(missileBefore, missileAfter, playerBefore, playerAfter) {
  const start = wrappedDelta(playerBefore, missileBefore, WIDTH, HEIGHT);
  const m = wrappedDelta(missileBefore, missileAfter, WIDTH, HEIGHT);
  const p = wrappedDelta(playerBefore, playerAfter, WIDTH, HEIGHT);
  const dx = m.x - p.x, dy = m.y - p.y;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, -(start.x * dx + start.y * dy) / length)) : 0;
  return Math.hypot(start.x + dx * t, start.y + dy * t) < PLAYER_RADIUS + missileAfter.radius;
}

export class MrKMissiles {
  constructor(match) {
    this.match = match;
    this.field = new MissileField(match);
    this.safeZones = match.mode === 'teams' ? null : new SafeZones(WIDTH, HEIGHT);
    this.active = new Map();
    this.pendingHits = new Map();
    this.acknowledgedHits = new Map();
    this.lastTick = null;
    this.lastBroadcast = 0;
  }
  launch(rockId, origin, at) {
    for (let index = 0; index < 20; index++) {
      const angle = index / 20 * Math.PI * 2;
      const missile = new HomingMissile(origin.x + Math.cos(angle) * 105,
        origin.y + Math.sin(angle) * 105, angle, 105);
      missile.id = `${rockId}-missile-${index}`;
      missile.expiresAt = at + 120_000;
      this.active.set(missile.id, missile);
    }
    if (this.lastTick === null) this.lastTick = at;
    this.broadcast(at);
  }
  state(at) {
    const round = n => Math.round(n * 100) / 100;
    return { type: 'shared', channel: 'missiles', serverNow: at,
      missiles: [...this.active.values()].map(m => [m.id, round(m.x), round(m.y), round(m.angle), m.outbound, m.target?.id || null]) };
  }
  broadcast(at) { this.lastBroadcast = at; this.match.broadcast(this.state(at)); }
  snapshot(socket, playerId, at) {
    socket.send(this.state(at));
    socket.send({ type: 'missileHitSnapshot', hits: [...this.pendingHits.values()]
      .filter(hit => hit.playerId === playerId && at - hit.at < HIT_RETENTION_MS) });
  }
  shot(player, id, at) {
    if (!player.visible || !this.match.stateSeen.has(player.id) || !this.active.delete(id)) return false;
    this.broadcast(at); return true;
  }
  acknowledge(playerId, id) {
    const hit = this.pendingHits.get(id);
    if (!hit) return this.acknowledgedHits.get(id)?.playerId === playerId;
    if (hit.playerId !== playerId) return false;
    this.pendingHits.delete(id);
    this.acknowledgedHits.set(id, { playerId, at: this.match.clock() });
    return true;
  }
  tick(now) {
    for (const [id, hit] of this.pendingHits)
      if (now - hit.at >= HIT_RETENTION_MS) this.pendingHits.delete(id);
    for (const [id, hit] of this.acknowledgedHits)
      if (now - hit.at >= HIT_RETENTION_MS) this.acknowledgedHits.delete(id);
    if (!this.active.size) { this.lastTick = null; return; }
    if (this.lastTick === null || now < this.lastTick) this.lastTick = now;
    // Bound catch-up after a stalled server. The room remains authoritative;
    // movement slows briefly instead of teleporting through a student's ship.
    const elapsed = Math.min(250, now - this.lastTick);
    if (elapsed <= 0) return;
    const steps = Math.ceil(elapsed / STEP_MS), step = elapsed / steps;
    let changed = false;
    for (let index = 0; index < steps; index++) {
      const at = now - elapsed + (index + 1) * step;
      const players = [...this.match.players.values()].filter(player => player.visible &&
        this.match.stateSeen.has(player.id) && at - player.updatedAt < MAX_POSITION_AGE_MS);
      const targets = players.map(player => playerAt(player, at));
      const rocks = this.field.at(at);
      const boss = this.match.shared.boss;
      for (const missile of this.active.values()) {
        const before = { x: missile.x, y: missile.y };
        missile.update(step / 1000, targets, WIDTH, HEIGHT);
        if (at >= missile.expiresAt || this.safeZones?.hitsMissile(missile) ||
            (!missile.outbound && rocks.some(rock => wrappedDistance(missile, rock, WIDTH, HEIGHT) < missile.radius + rock.radius))) {
          this.active.delete(missile.id); changed = true; continue;
        }
        for (const player of players) {
          if ((boss.phase === 'gauntlet' && this.match.mode === '1vw' && player.id !== boss.survivorUid) ||
              (this.match.invulnerableUntil.get(player.id) || 0) > at ||
              [...this.pendingHits.values()].some(hit => hit.playerId === player.id)) continue;
          if (!crossed(before, missile, playerAt(player, at - step), playerAt(player, at))) continue;
          const hit = { id: `${missile.id}-hit`, playerId: player.id, at,
            x: missile.x, y: missile.y };
          this.pendingHits.set(hit.id, hit);
          this.active.delete(missile.id); changed = true;
          this.match.broadcast({ type: 'missileHit', hit });
          break;
        }
      }
    }
    this.lastTick = now;
    if (changed || now - this.lastBroadcast >= BROADCAST_MS) this.broadcast(now);
  }
}
