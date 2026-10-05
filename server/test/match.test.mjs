import assert from 'node:assert/strict';
import test from 'node:test';
import { Match } from '../src/match.mjs';

function socket() {
  const sent = [];
  const closed = [];
  return { sent, closed, send: value => sent.push(value), close: (code, reason) => closed.push({ code, reason }) };
}

test('stale clients are closed and current match data remains in memory only', () => {
  let now = 1_000;
  const match = new Match('classroom', { clock: () => now });
  const stale = socket();
  match.join({ studentId: 'a', displayName: 'A' }, stale);
  now += 30_001;
  match.cleanup();
  assert.deepEqual(stale.closed, [{ code: 4002, reason: 'Connection timed out.' }]);
  assert.equal(match.players.size, 1, 'the socket close callback performs the actual leave cleanup');
});

test('bullet, collision, and reset events are server-stamped and broadcast', () => {
  const match = new Match('classroom', { clock: () => 42_000 });
  const a = socket(); const b = socket();
  match.join({ studentId: 'a', displayName: 'A' }, a);
  match.join({ studentId: 'b', displayName: 'B' }, b);
  for (const kind of ['bullet', 'collision', 'reset']) {
    match.receive('a', { type: 'event', event: { kind, id: `${kind}-1` } });
  }
  const emitted = b.sent.filter(message => message.type === 'event').map(message => message.event);
  assert.deepEqual(emitted.map(event => event.kind), ['bullet', 'collision', 'reset']);
  assert.ok(emitted.every(event => event.by === 'a' && event.at === 42_000));
});
