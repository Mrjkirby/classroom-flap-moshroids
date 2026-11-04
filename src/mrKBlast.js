// The existing destruction record drives the local shake and rock explosion.
// KNAS independently owns the shared missile wave.
export function syncMrKBlasts(shake, records, now, onBlast) {
  const ids = shake.sync(records, now);
  for (const id of ids) {
    const event = records.get(id);
    // The server timestamp may be slightly ahead of the estimated shared
    // clock. The delivered event is authoritative even with clock jitter.
    if (Number.isFinite(event?.x) && Number.isFinite(event?.y) &&
        now - event.destroyedAt > -5000 && now - event.destroyedAt < 5000)
      onBlast({ x: event.x, y: event.y, radius: 105 }, id);
  }
  return ids;
}
