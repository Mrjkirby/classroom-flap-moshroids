// A received server event can be a few milliseconds ahead of the estimated
// clock. Revisit it as soon as that time arrives, even if no new network
// message or asteroid respawn slot has changed in the meantime.
export function createAsteroidFieldCache() {
  let records = null, fences = null, epoch = -1, slot = -1, nextEventAt = Infinity;
  return {
    needsUpdate(nextRecords, nextEpoch, nextSlot, now, nextFences = null) {
      return records !== nextRecords || fences !== nextFences || epoch !== nextEpoch || slot !== nextSlot || now >= nextEventAt;
    },
    remember(nextRecords, nextEpoch, nextSlot, now, nextFences = null) {
      records = nextRecords; fences = nextFences; epoch = nextEpoch; slot = nextSlot;
      nextEventAt = Infinity;
      for (const record of [...records.values(), ...(fences?.values() || [])]) {
        const at = Number(record?.destroyedAt ?? record?.at);
        if (Number.isFinite(at) && at > now && at < nextEventAt) nextEventAt = at;
      }
    },
    reset() { records = null; fences = null; epoch = -1; slot = -1; nextEventAt = Infinity; }
  };
}
