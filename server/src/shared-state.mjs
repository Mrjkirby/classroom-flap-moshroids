import { safeText, finiteNumber } from './protocol.mjs';
import { teamAtBase } from '../../src/teams/teamBases.js';
import { normalizeTeam } from '../../src/teams/teamRules.js';
import { WORLD_WIDTH, WORLD_HEIGHT } from '../../src/worldConfig.js';
import { selectSurvivor, acceptCannonShot, finishGauntlet, resetGauntletState } from '../../src/gauntlet/rules.js';
import { perimeterSlots } from '../../src/gauntlet/perimeterLayout.js';
import { SHOT_LIFETIME } from '../../src/gauntlet/projectiles.js';

// One room owns shared resources. Local scores/physics remain player reports,
// just as in Firebase; clients cannot select the reporting player's identity.
export class SharedState {
  constructor(match) {
    this.match = match;
    this.destroyed = new Map();
    this.drops = new Map();
    this.dropIds = new Map();
    this.boss = { mode: '1vw', phase: 'normal', round: 0 };
    this.sequence = 0;
  }
  emit(channel, entries) {
    this.match.broadcast({ type: 'shared', channel, entries, serverNow: this.match.clock() });
  }
  snapshot(socket) {
    for (const [channel, map] of [['asteroids', this.destroyed], ['drops', this.drops]]) {
      const entries = [...map];
      socket.send({ type: 'shared', channel, reset: true, entries: [] });
      for (let i = 0; i < entries.length; i += 100)
        socket.send({ type: 'shared', channel, entries: entries.slice(i, i + 100) });
    }
    const { cannons, ...state } = this.boss;
    socket.send({ type: 'shared', channel: 'boss', state, reset: true });
    for (const [uid, cannon] of Object.entries(cannons || {}))
      socket.send({ type: 'shared', channel: 'cannon', uid, cannon });
  }
  apply(player, action, data = {}) {
    const now = this.match.clock();
    const id = safeText(data.id, 120);
    if (action === 'asteroidClaim') {
      // Keep complete current + previous epoch history, never evict active
      // tombstones to make room (that would award a duplicate claim).
      const epoch = /^epoch-(\d+)-/.exec(id);
      const projectile = Object.entries(this.boss.cannons || {}).some(([uid, cannon]) =>
        Object.entries(cannon.shots || {}).some(([seq, shot]) =>
          id === `1vw-shot-${this.boss.round}-${uid}-${seq}` && now - shot.firedAt < SHOT_LIFETIME));
      if ((!projectile && (!epoch || Math.abs(Number(epoch[1]) - Math.floor(now / 1800000)) > 1)) ||
          this.destroyed.has(id) || this.destroyed.size >= 20000) return false;
      const record = { asteroidId: id, destroyedBy: player.id, destroyedAt: now };
      this.destroyed.set(id, record); this.emit('asteroids', [[id, record]]); return true;
    }
    if (action === 'asteroidClear') {
      if (!this.match.clients.get(player.id)?.testerAuthorized) return false;
      this.destroyed.clear();
      this.match.broadcast({ type: 'shared', channel: 'asteroids', reset: true, entries: [] }); return true;
    }
    if (action === 'dropPublish') {
      const drops = data.drops;
      if (!Array.isArray(drops) || !drops.length || drops.length > 40 || this.dropIds.size + drops.length > 4096) return false;
      const ids = drops.map(drop => safeText(drop?.id, 120));
      if (ids.some(value => !value || this.dropIds.has(value)) || new Set(ids).size !== ids.length) return false;
      const entries = drops.map((drop, i) => [ids[i], { id: ids[i], ownerUid: player.id,
        x: finiteNumber(drop.x), y: finiteNumber(drop.y), radius: 8, createdAt: now, expiresAt: now + 10000 }]);
      for (const [key, value] of entries) { this.drops.set(key, value); this.dropIds.set(key, now + 60000); }
      this.emit('drops', entries); return true;
    }
    if (action === 'dropClaim' || action === 'dropExpire') {
      const drop = this.drops.get(id);
      if (!drop || (action === 'dropClaim' ? drop.expiresAt <= now : drop.expiresAt > now)) return false;
      this.drops.delete(id); this.emit('drops', [[id, null]]); return true;
    }
    if (action === 'teamChange') {
      const team = normalizeTeam(data.team);
      if (this.match.mode !== 'teams' || (team !== 'neutral' &&
        teamAtBase(player.x, player.y, 18, WORLD_WIDTH, WORLD_HEIGHT) !== team)) return false;
      player.team = team; this.playerChanged(player); return true;
    }
    if (action === 'teamVolley') {
      if (this.match.mode !== 'teams' || !player.visible) return false;
      player.teamShots = (player.teamShots || []).filter(shot => now - shot.at < 1000).slice(-24);
      player.teamShots.push({ id: ++this.sequence, at: now, x: player.x, y: player.y,
        angle: player.angle, velocityX: player.velocityX, velocityY: player.velocityY, guns: player.guns, team: player.team });
      this.playerChanged(player); return true;
    }
    if (this.match.mode !== '1vw') return false;
    let next;
    if (action === 'survivorClaim' && player.guns === 40 && player.visible)
      next = selectSurvivor(this.boss, { uid: player.id, name: player.name, at: now });
    if (action === 'gauntletActivate' && this.boss.phase === 'setup' && now >= this.boss.gauntletStartedAt)
      next = { ...this.boss, phase: 'gauntlet' };
    if (action === 'cannonFire' && this.boss.phase === 'gauntlet' && player.id !== this.boss.survivorUid && player.visible && Number.isFinite(data.angle)) {
      const slot = perimeterSlots([...this.match.players.keys()].filter(uid => uid !== this.boss.survivorUid), WORLD_WIDTH, WORLD_HEIGHT).get(player.id);
      if (!slot) return false;
      const cannon = acceptCannonShot(this.boss.cannons?.[player.id], { at: now, angle: data.angle,
        round: this.boss.round, x: slot.x, y: slot.y, lifetime: SHOT_LIFETIME });
      if (cannon) next = { ...this.boss, cannons: { ...this.boss.cannons, [player.id]: cannon } };
    }
    if (action === 'gauntletEnd' && player.id === this.boss.survivorUid)
      next = finishGauntlet(this.boss, { uid: player.id, reason: safeText(data.reason, 32), at: now });
    if (action === 'survivorDisconnected' && !this.match.players.has(this.boss.survivorUid))
      next = this.boss.phase === 'result' && now - this.boss.endedAt >= 3000 ? resetGauntletState(this.boss)
        : finishGauntlet(this.boss, { uid: this.boss.survivorUid, reason: 'disconnect', at: now });
    if (action === 'gauntletReset' && this.boss.phase === 'result' && now - this.boss.endedAt >= 3000)
      next = resetGauntletState(this.boss);
    if (!next) return false;
    const previous = this.boss;
    this.boss = next;
    if (action === 'cannonFire') this.match.broadcast({ type: 'shared', channel: 'cannon', uid: player.id,
      cannon: next.cannons[player.id], serverNow: now });
    else {
      const { cannons, ...state } = next;
      this.match.broadcast({ type: 'shared', channel: 'boss', state, reset: previous.round !== next.round, serverNow: now });
    }
    return true;
  }
  playerChanged(player) { this.match.broadcast({ type: 'playerState', player: { ...player }, serverNow: this.match.clock() }); }
  cleanup() {
    const now = this.match.clock();
    const expired = [];
    for (const [id, drop] of this.drops) if (drop.expiresAt <= now) { this.drops.delete(id); expired.push([id, null]); }
    if (expired.length) this.emit('drops', expired);
    for (const [id, expires] of this.dropIds) if (expires <= now) this.dropIds.delete(id);
    const epoch = Math.floor(now / 1800000);
    const old = [];
    for (const [id, record] of this.destroyed) if (Number(/^epoch-(\d+)-/.exec(id)?.[1]) < epoch - 1 ||
      (id.startsWith('1vw-shot-') && now - record.destroyedAt > SHOT_LIFETIME)) { this.destroyed.delete(id); old.push([id, null]); }
    for (let i = 0; i < old.length; i += 100) this.emit('asteroids', old.slice(i, i + 100));
    if (this.match.mode === '1vw') this.apply({ id: '' }, 'survivorDisconnected');
  }
}
