// Mr. K's destruction record is the room event. Each browser renders its own
// effect from that record; camera positions are never sent over the network.
export const MR_K_SHAKE_DURATION_MS = 800;
export const MR_K_SHAKE_AMPLITUDE_PX = 12;

export class MrKShake {
  constructor() {
    this.joinedAt = null;
    this.seen = new Set();
    this.startedAt = -Infinity;
  }

  activate(joinedAt) {
    if (this.joinedAt === null) this.joinedAt = joinedAt;
  }

  sync(records, now) {
    if (this.joinedAt === null) return [];
    const triggered = [];
    for (const [id, record] of records) {
      if (!/^epoch-\d+-mrk-\d+$/.test(id) || this.seen.has(id)) continue;
      this.seen.add(id);
      // Shared history is replayed on join/reconnect. Only destructions that
      // happened during this browser's current game session create an effect.
      const destroyedAt = Number(record?.destroyedAt);
      if (!Number.isFinite(destroyedAt) || destroyedAt <= this.joinedAt) continue;
      triggered.push(id);
    }
    if (triggered.length) this.startedAt = now;
    return triggered;
  }

  offset(now) {
    const elapsed = now - this.startedAt;
    if (elapsed < 0 || elapsed >= MR_K_SHAKE_DURATION_MS) return { x: 0, y: 0 };
    const fade = (1 - elapsed / MR_K_SHAKE_DURATION_MS) ** 2;
    return {
      x: MR_K_SHAKE_AMPLITUDE_PX * fade * Math.sin(elapsed * 0.093 + 1),
      y: MR_K_SHAKE_AMPLITUDE_PX * fade * Math.sin(elapsed * 0.071 + 2),
    };
  }
}
