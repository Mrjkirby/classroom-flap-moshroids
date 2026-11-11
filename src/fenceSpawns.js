// The production KNAS room owns the alternating rule and shared spawn events.
import { transportConfig } from './transport/config.js';
const adapter = transportConfig.provider === 'knas'
  ? await import('./transport/knas-store.js') : null;
const empty = new Map();
let lastBarrier = null;
let queue = Promise.resolve();
if (adapter) adapter.subscribe(message => {
  if (message.type === 'welcome') lastBarrier = null;
});
export const getFenceSpawns = () => adapter?.store.fenceSpawns || empty;
export function touchFence(barrier) {
  if (!adapter || !barrier || barrier === lastBarrier) return;
  lastBarrier = barrier;
  queue = queue.then(() => adapter.request('fenceTouch', { barrier })).catch(error => {
    console.error('Fence touch could not be sent:', error);
  });
}
