// Shared timeline for the single room-wide Mr. K rock. Epoch and generation
// already identify the authoritative asteroid-field destruction event.
export const MR_K_MAX_HEALTH = 1000;
export const MR_K_RADIUS = 105;
export const MR_K_SPEED_PER_SECOND = 39;
export const MR_K_RESPAWN_MS = 60_000;
export const MR_K_EPOCH_MS = 1_800_000;

export function mrKPosition(now, fieldSpawnTimestamp, generation, width, height) {
  const born = fieldSpawnTimestamp + (generation > 0 ? MR_K_RESPAWN_MS : 0);
  const distance = Math.max(0, now - born) * MR_K_SPEED_PER_SECOND / 1000;
  return { x: width / 2, y: -MR_K_RADIUS + distance % (height + 2 * MR_K_RADIUS) };
}
