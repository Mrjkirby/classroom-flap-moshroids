import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

class Element {
  constructor() { this.children = []; this.hidden = false; this.textContent = ''; this.classList = { add() {}, toggle() {} }; }
  setAttribute() {}
  append(...nodes) { this.children.push(...nodes); }
}

test('an interrupted joined game shows recovery guidance and hides it on return', async () => {
  const shell = new Element(), body = new Element(), elements = new Map();
  for (const id of ['networkStatus', 'pilotLoginStatus', 'pilotLoginOverlay', 'pilotDisplayName', 'controlsPilotName']) elements.set(id, new Element());
  const document = { body, createElement: () => new Element(), querySelector: () => shell,
    getElementById: id => elements.get(id) || null };
  const context = createContext({ document, performance: { now: () => 1000 }, console });
  let listener, joined = 0;
  const store = { players: new Map(), identity: { uid: 'pilot', name: 'Pilot' } };
  const values = { store, connect() {}, disconnect() {}, subscribe(fn) { listener = fn; }, send: () => true, request: () => Promise.resolve(true) };
  const stub = new SyntheticModule(Object.keys(values), function () {
    for (const [key, value] of Object.entries(values)) this.setExport(key, value);
  }, { context });
  const module = new SourceTextModule(await readFile(new URL('../src/transport/knas-player.js', import.meta.url), 'utf8'), { context });
  await module.link(() => stub); await module.evaluate();
  module.namespace.bindPilotLogin(() => ({ visible: true }), () => { joined++; });
  const [notice] = shell.children;
  listener({ type: 'status', connected: false, detail: 'Connecting…' });
  assert.equal(notice.hidden, true, 'initial login retains its existing screen');
  listener({ type: 'ready' });
  listener({ type: 'status', connected: false, detail: 'Disconnected' });
  assert.equal(notice.hidden, false);
  assert.match(notice.children[0].textContent, /paused until it reconnects/);
  assert.match(notice.children[1].href, /^https:\/\/spelling-snake-/);
  listener({ type: 'status', connected: true, detail: 'Connected' });
  listener({ type: 'ready' });
  assert.equal(notice.hidden, true);
  assert.equal(joined, 1, 'reconnect does not create or restart a game');
});
