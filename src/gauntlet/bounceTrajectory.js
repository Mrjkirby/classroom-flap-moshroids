import { wrap, wrappedDelta } from '../physics.js';

// Continuous circle reflection in a wrapped arena. Positions are rebuilt from
// spawn data and shared time, so no collision or position frames are written.
export function advanceBouncing(state, until, obstacles, width, height) {
  let { x, y, vx, vy, at } = state;
  const radius = state.radius;
  if (obstacles.some(ship => radius + ship.radius >= Math.min(width, height) / 2)) {
    // A rock wider than the wrapped arena overlaps every periodic copy of a
    // turret. Reflect once from the nearest turret; repeated separation has
    // no geometric solution and would stall the simulation.
    let reflected = !!state.oversizedReflected;
    if (!reflected) {
      const nearest = obstacles.map(ship => ({ ship, delta: wrappedDelta(ship, { x, y }, width, height) }))
        .sort((a, b) => Math.hypot(a.delta.x, a.delta.y) - Math.hypot(b.delta.x, b.delta.y))[0];
      const length = Math.hypot(nearest.delta.x, nearest.delta.y) || 1;
      const nx = nearest.delta.x / length;
      const ny = nearest.delta.y / length;
      const normalSpeed = vx * nx + vy * ny;
      if (normalSpeed < 0) { vx -= 2 * normalSpeed * nx; vy -= 2 * normalSpeed * ny; }
      reflected = true;
    }
    const elapsed = Math.max(0, until - at);
    return { x: wrap(x + vx * elapsed, width), y: wrap(y + vy * elapsed, height),
      vx, vy, at: until, radius, oversizedReflected: reflected };
  }
  while (at < until) {
    const speed = Math.hypot(vx, vy);
    if (!speed) break;
    const step = Math.min(until - at, Math.min(width, height) / (2 * speed));
    let first = null;
    let overlap = null;
    for (const ship of obstacles) {
      for (const ox of [-width, 0, width]) for (const oy of [-height, 0, height]) {
        const cx = ship.x + ox;
        const cy = ship.y + oy;
        const rx = x - cx;
        const ry = y - cy;
        const reach = radius + ship.radius;
        const dot = rx * vx + ry * vy;
        const distance = Math.hypot(rx, ry);
        if (distance < reach - 0.01 && (!overlap || distance - reach < overlap.depth)) {
          overlap = { cx, cy, reach, depth: distance - reach };
        }
        if (dot >= 0) continue;
        const discriminant = dot * dot - speed * speed * (rx * rx + ry * ry - reach * reach);
        if (discriminant < 0) continue;
        const hitAt = (-dot - Math.sqrt(discriminant)) / (speed * speed);
        if (hitAt >= 0 && hitAt <= step && (!first || hitAt < first.time)) {
          first = { time: hitAt, cx, cy };
        }
      }
    }
    if (overlap) {
      const length = Math.hypot(x - overlap.cx, y - overlap.cy) || 1;
      const nx = length === 1 && x === overlap.cx && y === overlap.cy ? -vx / speed : (x - overlap.cx) / length;
      const ny = length === 1 && x === overlap.cx && y === overlap.cy ? -vy / speed : (y - overlap.cy) / length;
      const normalSpeed = vx * nx + vy * ny;
      if (normalSpeed < 0) { vx -= 2 * normalSpeed * nx; vy -= 2 * normalSpeed * ny; }
      x = wrap(overlap.cx + nx * (overlap.reach + 0.01), width);
      y = wrap(overlap.cy + ny * (overlap.reach + 0.01), height);
      at += Math.min(until - at, 0.01 / speed);
      continue;
    }
    if (!first) {
      x = wrap(x + vx * step, width);
      y = wrap(y + vy * step, height);
      at += step;
      continue;
    }
    x += vx * first.time;
    y += vy * first.time;
    const length = Math.hypot(x - first.cx, y - first.cy) || 1;
    const nx = (x - first.cx) / length;
    const ny = (y - first.cy) / length;
    const normalSpeed = vx * nx + vy * ny;
    vx -= 2 * normalSpeed * nx;
    vy -= 2 * normalSpeed * ny;
    x = wrap(x + nx * 0.01, width);
    y = wrap(y + ny * 0.01, height);
    at += first.time + Math.min(0.01 / speed, until - at - first.time);
  }
  return { x, y, vx, vy, at: until, radius };
}

export class BouncingTrajectories {
  constructor() { this.states = new Map(); }
  clear() { this.states.clear(); }
  retain(ids) { for (const id of this.states.keys()) if (!ids.has(id)) this.states.delete(id); }
  position(id, initial, now, obstacles, width, height, rosterKey) {
    let entry = this.states.get(id);
    if (!entry || entry.rosterKey !== rosterKey || now < entry.state.at) {
      entry = { rosterKey, state: initial };
      this.states.set(id, entry);
    }
    entry.state = advanceBouncing(entry.state, now, obstacles, width, height);
    return entry.state;
  }
}
