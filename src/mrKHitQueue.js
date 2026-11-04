// One bounded in-flight batch at a time. Retrying uses the same ID so an
// acknowledgement lost during reconnect cannot count the same hits twice.
export function createMrKHitQueue({ request, now = () => Date.now(), makeId = () =>
  globalThis.crypto?.randomUUID?.() || `hit-${Date.now()}-${Math.random().toString(36).slice(2)}` }) {
  let generation = '', pending = [], inFlight = false, retryAt = 0;
  function reset(id) {
    if (generation === id) return;
    generation = id; pending = []; retryAt = 0;
  }
  function add(id, count) {
    reset(id);
    while (count > 0 && pending.length < 256) {
      const last = pending[pending.length - 1];
      if (last && !last.sent && last.count < 40) {
        const n = Math.min(count, 40 - last.count); last.count += n; count -= n;
      } else {
        const n = Math.min(count, 40); pending.push({ id, count: n, batchId: makeId(), sent: false }); count -= n;
      }
    }
  }
  function flush() {
    if (inFlight || !pending.length || now() < retryAt) return;
    const batch = pending[0]; batch.sent = true; inFlight = true;
    Promise.resolve(request('mrkHit', { id: batch.id, count: batch.count, batchId: batch.batchId }))
      .then(ok => {
        if (pending[0] !== batch) return;
        if (ok) { pending.shift(); retryAt = 0; } else retryAt = now() + 500;
      }).catch(() => { if (pending[0] === batch) retryAt = now() + 500; })
      .finally(() => { inFlight = false; });
  }
  return { add, reset, flush };
}
