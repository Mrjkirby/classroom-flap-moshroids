// The existing destruction record is the one room-wide event. Each active
// client creates its local missile simulation once, from the same origin.
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
