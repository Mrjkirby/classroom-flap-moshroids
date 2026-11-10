import assert from 'node:assert/strict';
import test from 'node:test';
import { createMoshroidsServer } from '../server/src/app.mjs';
import { Ship } from '../src/ship.js';
import { SpellingChallengeController } from '../src/spellingController.js';

class Element {
  constructor() { this.listeners = new Map(); this.classList = { add() {}, remove() {}, toggle() {} }; this.value = ''; this.textContent = ''; }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  setAttribute() {}
  focus() {}
}
const token = id => 'ml1_' + id.toString(16).padStart(64, '0');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, label) {
  for (let n = 0; n < 300; n++) { if (predicate()) return; await pause(10); }
  throw new Error(`Timed out: ${label}`);
}

test('two players remain in one room and receive shared events through death and spelling', async t => {
  const app = createMoshroidsServer({ allowMissingOrigin: true, authenticate: async ({ accessToken }) => ({
    studentId: accessToken === token(1) ? 'pilot-a' : 'pilot-b', displayName: 'Pilot',
  }) });
  const address = await app.listen();
  const sockets = [];
  t.after(async () => { for (const socket of sockets) socket.close(); await app.close(); });
  async function join(id) {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/launch/redeem`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token(id), roomId: 'classroom' }),
    });
    assert.equal(response.status, 200);
    const { sessionToken } = await response.json();
    const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws`);
    sockets.push(socket);
    const received = [];
    socket.addEventListener('message', event => received.push(JSON.parse(event.data)));
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    socket.send(JSON.stringify({ type: 'hello', roomId: 'classroom', resumeToken: sessionToken }));
    await until(() => received.some(message => message.type === 'ready'), 'room ready');
    return { socket, received };
  }
  const a = await join(1), b = await join(2);
  const ship = new Ship('A', 500, 500, {});
  const sendShip = () => a.socket.send(JSON.stringify({ type: 'state', state: {
    x: ship.x, y: ship.y, visible: ship.visible, guns: 1, score: 0,
  } }));
  sendShip();
  await until(() => b.received.some(m => m.type === 'playerState' && m.player.id === 'pilot-a' && m.player.visible), 'initial ship');
  assert.equal(ship.destroy(), true);
  sendShip();
  await until(() => b.received.some(m => m.type === 'playerState' && m.player.id === 'pilot-a' && !m.player.visible), 'death visible to peer');

  const elements = Object.fromEntries(['title','phase','word','input','feedback','ready','test','check','form'].map(name => [name, new Element()]));
  const overlay = new Element();
  overlay.querySelector = selector => elements[selector.match(/data-wormhole-(\w+)/)[1]];
  const spelling = new SpellingChallengeController({ overlay, onComplete: () => { ship.respawn(); sendShip(); } });
  spelling.begin({ playerId: 'A', reason: 'asteroid' });
  const challenge = spelling.challenges.get('A');
  const asteroidId = `epoch-${Math.floor(Date.now() / 1800000)}-field-0-asteroid-1`;
  b.socket.send(JSON.stringify({ type: 'action', action: 'asteroidClaim', data: { id: asteroidId }, requestId: 'claim' }));
  await until(() => a.received.some(m => m.channel === 'asteroids' && m.entries?.some(([id]) => id === asteroidId)), 'shared event during spelling');
  spelling.beginPractice(); elements.input.value = challenge.word; spelling.checkPractice();
  spelling.beginRetrieval(); elements.input.value = challenge.word; spelling.submitRetrieval();
  assert.equal(challenge.phase, 'complete');
  spelling.update(performance.now() + 1000);
  await until(() => b.received.filter(m => m.type === 'playerState' && m.player.id === 'pilot-a' && m.player.visible).length >= 2, 'respawn visible to peer');
  assert.equal(ship.visible, true);
  assert.equal(app.registry.get('classroom').clients.size, 2);
  assert.equal(app.registry.get('classroom').shared.destroyed.has(asteroidId), true);
  assert.equal(app.registry.status().rooms, 1);
});
