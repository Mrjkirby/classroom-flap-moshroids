// A received server event can be a few milliseconds ahead of the estimated
// clock. Revisit it as soon as that time arrives, even if no new network
// message or asteroid respawn slot has changed in the meantime.
export function createAsteroidFieldCache() {
  let records = null, epoch = -1, slot = -1, nextEventAt = Infinity;
  return {
    needsUpdate(nextRecords, nextEpoch, nextSlot, now) {
      return records !== nextRecords || epoch !== nextEpoch || slot !== nextSlot || now >= nextEventAt;
    },
    remember(nextRecords, nextEpoch, nextSlot, now) {
      records = nextRecords; epoch = nextEpoch; slot = nextSlot;
      nextEventAt = Infinity;
      for (const record of records.values()) {
        const at = Number(record?.destroyedAt);
        if (Number.isFinite(at) && at > now && at < nextEventAt) nextEventAt = at;
      }
    },
    reset() { records = null; epoch = -1; slot = -1; nextEventAt = Infinity; }
  };
}
