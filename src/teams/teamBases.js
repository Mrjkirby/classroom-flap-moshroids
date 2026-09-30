import { SAFE_ZONE_ARM_LENGTH, SAFE_ZONE_WALL_THICKNESS,
  SAFE_ZONE_SHIP_LENGTH } from '../safeZone.js';

export const TEAM_ARM_LENGTH = SAFE_ZONE_ARM_LENGTH / 2;
export const TEAM_WALL_THICKNESS = SAFE_ZONE_WALL_THICKNESS / 2;
export const TEAM_OFFSET = SAFE_ZONE_SHIP_LENGTH; // half the original 68-unit offset
export const TEAM_COLORS = { blue: '#3894ff', red: '#ff4d5b' };

export function teamBases(width, height) {
  return [
    ['blue', TEAM_OFFSET, TEAM_OFFSET, 1, 1],
    ['red', width - TEAM_OFFSET, TEAM_OFFSET, -1, 1],
    ['red', TEAM_OFFSET, height - TEAM_OFFSET, 1, -1],
    ['blue', width - TEAM_OFFSET, height - TEAM_OFFSET, -1, -1]
  ].map(([team, x, y, dx, dy]) => ({ team, segments: [
    { x1: x, y1: y, x2: x + dx * TEAM_ARM_LENGTH, y2: y },
    { x1: x, y1: y, x2: x, y2: y + dy * TEAM_ARM_LENGTH }
  ] }));
}

function touchesSegment(x, y, radius, segment) {
  const dx = segment.x2 - segment.x1;
  const dy = segment.y2 - segment.y1;
  const t = Math.max(0, Math.min(1,
    ((x - segment.x1) * dx + (y - segment.y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - segment.x1 - t * dx, y - segment.y1 - t * dy) <=
    radius + TEAM_WALL_THICKNESS / 2;
}

export function teamAtBase(x, y, radius, width, height) {
  if (![x, y, radius, width, height].every(Number.isFinite)) return null;
  return teamBases(width, height).find(base =>
    base.segments.some(segment => touchesSegment(x, y, radius, segment)))?.team ?? null;
}

export function drawTeamBases(ctx, width, height) {
  ctx.save();
  ctx.lineWidth = TEAM_WALL_THICKNESS;
  ctx.lineCap = 'square';
  ctx.lineJoin = 'miter';
  for (const base of teamBases(width, height)) {
    ctx.strokeStyle = TEAM_COLORS[base.team];
    for (const segment of base.segments) {
      ctx.beginPath();
      ctx.moveTo(segment.x1, segment.y1);
      ctx.lineTo(segment.x2, segment.y2);
      ctx.stroke();
    }
  }
  ctx.restore();
}
