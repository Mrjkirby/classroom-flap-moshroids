// Run explicitly with PLAYWRIGHT_MODULE pointing to an installed Playwright.
// All identities, claims and browser activity below use an isolated local room.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMoshroidsServer } from '../server/src/app.mjs';
const playwright = await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const { chromium } = playwright.default || playwright;
const root = resolve(import.meta.dirname, '..');
let testWebSocketUrl;
const web = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const path = resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
  if (!path.startsWith(root + '/')) return res.writeHead(403).end();
  try {
    res.setHeader('content-type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(path)] || 'application/octet-stream');
    let body = await readFile(path);
    if (pathname === '/src/transport/config.js')
      body = body.toString().replace('wss://moshroids-staging.mrjkirby.workers.dev/ws', testWebSocketUrl);
    res.end(body);
  }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${web.address().port}`;
const used = new Set();
const syntheticIdentities = new Map();
const realtime = createMoshroidsServer({ allowedOrigins: [origin], authenticate: async ({ accessToken }) => {
  if (!/^ml1_[a-f0-9]{64}$/.test(accessToken) || used.has(accessToken)) throw new Error('Invalid synthetic test grant');
  used.add(accessToken); const id = syntheticIdentities.get(accessToken) || 'browser-test';
  return { studentId: id, displayName: id === 'browser-test' ? 'Browser Test' : id };
} });
const address = await realtime.listen();
testWebSocketUrl = `ws://127.0.0.1:${address.port}/ws`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
try {
  for (const path of ['/', '/teams/', '/1vw/']) {
    const context = await browser.newContext();
    const page = await context.newPage(); const errors = [], firebase = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (/firebase/.test(req.url())) firebase.push(req.url()); });
    const roomId = path === '/teams/' ? 'classroom-teams' : path === '/1vw/' ? 'classroom-1vw' : 'classroom';
    const token = 'ml1_' + crypto.randomUUID().replaceAll('-', '').padEnd(64, 'a');
    const expiry = encodeURIComponent(new Date(Date.now() + 30000).toISOString());
    await page.goto(`${origin}${path}#t=${token}&roomId=${roomId}&expiresAt=${expiry}`);
    assert.equal(await page.evaluate(() => location.hash), '');
    await page.waitForFunction(() => document.getElementById('pilotLoginOverlay')?.classList.contains('hidden'));
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Space');
    const result = await page.evaluate(async () => {
      const net = await import('/src/transport/index.js');
      const asteroids = await import('/src/asteroidNetwork.js');
      const drops = await import('/src/gunDropMultiplayer.js');
      const epoch = Math.floor(Date.now() / 1800000);
      const id = `epoch-${epoch}-field-0-browser-${crypto.randomUUID()}`;
      const first = await asteroids.destroySharedAsteroid(id);
      const second = await asteroids.destroySharedAsteroid(id);
      const published = await drops.publishGunDrops([{ id: 'browser-gun', x: 100, y: 100 }]);
      const claimed = await drops.claimGunDrop('browser-gun');
      return { identity: net.getLocalIdentity(), first, second, published, claimed,
        connected: net.isMultiplayerConnected(), destroyedCount: asteroids.getDestroyedAsteroids().size };
    });
    assert.equal(result.identity.uid, 'browser-test'); assert.ok(result.connected);
    assert.equal(result.first, true); assert.equal(result.second, false);
    assert.equal(result.published, true); assert.equal(result.claimed, true);
    assert.equal(firebase.length, 0, 'KNAS must not load Firebase SDK/auth/RTDB');
    await page.reload();
    await page.waitForFunction(() => document.getElementById('pilotLoginOverlay')?.classList.contains('hidden'));
    assert.equal(firebase.length, 0, 'refresh must resume KNAS without loading Firebase');
    assert.deepEqual(errors, []);
    console.log(`${path}: real Chromium game boot, authoritative identity, shared claims; zero Firebase requests, zero page errors`);
    await context.close();
  }
  // Three real browser game clients, using only isolated synthetic identities.
  // The server is a local fixture; this never joins or modifies the live room.
  const multiplayerContexts = [], multiplayerPages = [], multiplayerErrors = [];
  for (let i = 0; i < 3; i++) {
    const token = 'ml1_' + crypto.randomUUID().replaceAll('-', '').padEnd(64, String(i));
    syntheticIdentities.set(token, `browser-${i}`);
    const context = await browser.newContext(); multiplayerContexts.push(context);
    const page = await context.newPage(); multiplayerPages.push(page);
    page.on('pageerror', error => multiplayerErrors.push(error.message));
    const expiry = encodeURIComponent(new Date(Date.now() + 30000).toISOString());
    await page.goto(`${origin}/#t=${token}&roomId=classroom&expiresAt=${expiry}`);
    await page.waitForFunction(() => document.getElementById('pilotLoginOverlay')?.classList.contains('hidden'));
    await page.evaluate(async () => {
      window.testMissileSnapshots = [];
      const store = await import('/src/transport/knas-store.js');
      store.subscribe(message => {
        if (message.type === 'shared' && message.channel === 'missiles') window.testMissileSnapshots.push(message);
      });
    });
  }
  const mrK = `epoch-${Math.floor(Date.now() / 1800000)}-mrk-0`;
  for (let i = 0; i < 25; i++) {
    const accepted = await multiplayerPages[i % 2].evaluate(async ({ id, i }) => {
      const { request } = await import('/src/transport/knas-store.js');
      return request('mrkHit', { id, batchId: `browser-hit-${String(i).padStart(4, '0')}`, count: 40 });
    }, { id: mrK, i });
    assert.equal(accepted, true);
  }
  for (const page of multiplayerPages)
    await page.waitForFunction(async () => (await import('/src/transport/knas-store.js')).store.missiles?.missiles.length > 0);
  const snapshots = await Promise.all(multiplayerPages.map(page => page.evaluate(() => window.testMissileSnapshots)));
  const common = snapshots[0].find(snapshot => snapshot.missiles.length &&
    snapshots.every(list => list.some(item => item.serverNow === snapshot.serverNow &&
      JSON.stringify(item.missiles) === JSON.stringify(snapshot.missiles))));
  assert.ok(common, 'all three game clients received an identical server missile snapshot');
  const match = realtime.registry.get('classroom');
  const pilot = match.players.get('browser-0');
  const missile = [...match.shared.missiles.active.values()][0];
  assert.ok(pilot && missile);
  missile.x = pilot.x; missile.y = pilot.y; missile.outbound = false;
  await multiplayerPages[0].waitForFunction(() => document.getElementById('wormholeOverlay')?.classList.contains('visible'));
  await multiplayerPages[1].waitForFunction(async () => (await import('/src/transport/knas-store.js'))
    .store.players.get('browser-0')?.visible === false);
  await multiplayerPages[2].reload();
  await multiplayerPages[2].waitForFunction(() => document.getElementById('pilotLoginOverlay')?.classList.contains('hidden'));
  await multiplayerPages[2].waitForFunction(async () => (await import('/src/transport/knas-store.js')).store.missiles?.missiles.length > 0);
  assert.deepEqual(multiplayerErrors, []);
  console.log('Three local Chromium clients: shared missile snapshot, server ship impact, peer visibility and active-wave reconnect passed.');
  for (const context of multiplayerContexts) await context.close();
  const stagingContext = await browser.newContext();
  const stagingPage = await stagingContext.newPage();
  const stagingErrors = [], stagingFirebase = [], websocketUrls = [];
  stagingPage.on('pageerror', error => stagingErrors.push(error.message));
  stagingPage.on('request', req => { if (/firebase/.test(req.url())) stagingFirebase.push(req.url()); });
  stagingPage.on('websocket', socket => websocketUrls.push(socket.url()));
  const stagingToken = 'ml1_' + 'b'.repeat(64);
  const expiry = encodeURIComponent(new Date(Date.now() + 30000).toISOString());
  await stagingPage.goto(`${origin}/knas-staging/#t=${stagingToken}&roomId=classroom&expiresAt=${expiry}`);
  assert.equal(await stagingPage.evaluate(() => location.hash), '');
  await stagingPage.waitForFunction(() => document.getElementById('pilotLoginOverlay')?.classList.contains('hidden'));
  assert.match(await stagingPage.locator('.staging-banner').textContent(), /MOSHROIDS — KNAS STAGING/);
  const serverPlayer = () => realtime.registry.get('classroom').players.get('browser-test');
  const beforeMove = { x: serverPlayer().x, y: serverPlayer().y };
  await stagingPage.keyboard.down('ArrowUp');
  await stagingPage.waitForTimeout(600);
  await stagingPage.keyboard.up('ArrowUp');
  await stagingPage.keyboard.press('Space');
  const afterMove = { x: serverPlayer().x, y: serverPlayer().y };
  assert.notDeepEqual(afterMove, beforeMove, 'keyboard movement state should reach the KNAS server');
  const stagingResult = await stagingPage.evaluate(async () => {
    const net = await import('/src/transport/index.js');
    const asteroids = await import('/src/asteroidNetwork.js');
    const drops = await import('/src/gunDropMultiplayer.js');
    const epoch = Math.floor(Date.now() / 1800000);
    const id = `epoch-${epoch}-staging-browser-${crypto.randomUUID()}`;
    const first = await asteroids.destroySharedAsteroid(id);
    const duplicate = await asteroids.destroySharedAsteroid(id);
    const published = await drops.publishGunDrops([{ id: 'staging-browser-gun', x: 100, y: 100 }]);
    const claimed = await drops.claimGunDrop('staging-browser-gun');
    return { identity: net.getLocalIdentity(), connected: net.isMultiplayerConnected(),
      first, duplicate, published, claimed };
  });
  assert.equal(stagingResult.identity.uid, 'browser-test');
  assert.equal(stagingResult.connected, true);
  assert.deepEqual([stagingResult.first, stagingResult.duplicate, stagingResult.published, stagingResult.claimed],
    [true, false, true, true]);
  assert.deepEqual(websocketUrls, [testWebSocketUrl]);
  assert.equal(stagingFirebase.length, 0, 'the dedicated staging page must not request Firebase');
  assert.deepEqual(stagingErrors, []);
  console.log('KNAS staging page: secure fragment consumed once, playable game shell, fixed local WSS, shared actions; zero Firebase requests, zero page errors');
  await stagingContext.close();

  for (const path of ['/', '/teams/', '/1vw/', '/knas-staging/']) {
    const context = await browser.newContext(); const page = await context.newPage();
    const firebase = [], sockets = [];
    page.on('request', req => { if (/firebase/.test(req.url())) firebase.push(req.url()); });
    page.on('websocket', socket => sockets.push(socket.url()));
    await page.goto(origin + path);
    await page.waitForFunction(async () => (await import('/src/transport/config.js')).transportConfig.provider === 'knas');
    assert.equal(await page.locator('#pilotLoginOverlay').isVisible(), true);
    assert.equal(await page.locator('#pilotLoginForm').count(), 0);
    const portal = page.getByRole('link', { name: 'OPEN CLASSROOM PORTAL' });
    assert.equal(await portal.getAttribute('href'), 'https://spelling-snake-mr-kirby.mr-kirby.chatgpt.site/');
    assert.deepEqual(firebase, [], 'direct visits must not load Firebase');
    assert.deepEqual(sockets, [], 'a direct visit cannot join without a classroom grant');
    console.log(`${path}: direct visit requires classroom launch; zero Firebase requests or unauthenticated sockets`);
    await context.close();
  }
} finally { await browser.close(); await realtime.close(); await new Promise(resolve => web.close(resolve)); }
