import { HomingMissile } from './homingMissile.js';
import { angleDifference, wrappedDelta, wrap } from './physics.js';

// KNAS owns trajectory and hits. Browsers smoothly draw snapshots and report
// their own bullets; no browser independently chooses a missile target.
export function createSharedMissiles({ shoot, acknowledge, onHit, onRemoved, now = () => Date.now() }) {
  const views = new Map(), pendingShots = new Set(), seenHits = new Set(), pendingAcks = new Map();
  let lastSnapshot = null;
  function shot(id) {
    if (pendingShots.has(id)) return;
    pendingShots.add(id);
    Promise.resolve(shoot(id)).then(ok => {
      if (!ok || !views.has(id)) pendingShots.delete(id);
    }).catch(() => pendingShots.delete(id));
  }
  function update(snapshot, hits, dt, width, height) {
    if (snapshot && snapshot !== lastSnapshot) {
      const ids = new Set();
      for (const [id, x, y, angle, outbound, targetId] of snapshot.missiles || []) {
        if (typeof id !== 'string' || ![x, y, angle].every(Number.isFinite)) continue;
        ids.add(id);
        let missile = views.get(id);
        if (!missile) { missile = new HomingMissile(x, y, angle, 105); missile.id = id; views.set(id, missile); }
        missile.targetX = x; missile.targetY = y; missile.targetAngle = angle;
        missile.outbound = !!outbound; missile.targetId = targetId;
      }
      for (const [id, missile] of views) if (!ids.has(id)) {
        views.delete(id);
        if (!pendingShots.has(id)) onRemoved(missile);
        pendingShots.delete(id);
      }
      lastSnapshot = snapshot;
    }
    for (const hit of hits.values()) {
      if (!seenHits.has(hit.id)) { seenHits.add(hit.id); onHit(hit); }
      const pending = pendingAcks.get(hit.id);
      if (pending?.inFlight || (pending && now() < pending.retryAt)) continue;
      const attempt = { inFlight: true, retryAt: 0 }; pendingAcks.set(hit.id, attempt);
      Promise.resolve(acknowledge(hit.id)).then(ok => {
        if (ok) pendingAcks.delete(hit.id);
        else { attempt.inFlight = false; attempt.retryAt = now() + 500; }
      }).catch(() => { attempt.inFlight = false; attempt.retryAt = now() + 500; });
    }
    for (const id of pendingAcks.keys()) if (!hits.has(id)) pendingAcks.delete(id);
    const blend = 1 - Math.exp(-18 * dt);
    for (const missile of views.values()) {
      const delta = wrappedDelta(missile, { x: missile.targetX, y: missile.targetY }, width, height);
      missile.x = wrap(missile.x + delta.x * blend, width);
      missile.y = wrap(missile.y + delta.y * blend, height);
      missile.angle += angleDifference(missile.targetAngle, missile.angle) * blend;
    }
    return [...views.values()].filter(missile => !pendingShots.has(missile.id));
  }
  return { update, shot };
}
