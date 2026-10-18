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
    if (pathname === '/knas-staging/bootstrap.js')
      body = body.toString().replace('wss://moshroids-staging.mrjkirby.workers.dev/ws', testWebSocketUrl);
    res.end(body);
  }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${web.address().port}`;
const used = new Set();
const realtime = createMoshroidsServer({ allowedOrigins: [origin], authenticate: async ({ accessToken }) => {
  if (!/^ml1_[a-f0-9]{64}$/.test(accessToken) || used.has(accessToken)) throw new Error('Invalid synthetic test grant');
  used.add(accessToken); return { studentId: 'browser-test', displayName: 'Browser Test' };
} });
const address = await realtime.listen();
testWebSocketUrl = `ws://127.0.0.1:${address.port}/ws`;
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
try {
  for (const path of ['/', '/teams/', '/1vw/']) {
    const context = await browser.newContext();
    await context.addInitScript(({ url }) => { globalThis.MOSHROIDS_TRANSPORT_CONFIG = {
      provider: 'knas', websocketUrl: url,
    requestLaunch: async roomId => ({ accessToken: 'ml1_' + crypto.randomUUID().replaceAll('-', '').padEnd(64, 'a').slice(0, 64),
      audience: 'moshroids', expiresAt: new Date(Date.now() + 30000).toISOString(), roomId }),
    }; }, { url: `ws://127.0.0.1:${address.port}/ws` });
    const page = await context.newPage(); const errors = [], firebase = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', req => { if (/firebase/.test(req.url())) firebase.push(req.url()); });
    await page.goto(origin + path);
    await page.waitForFunction(() => document.getElementById('pilotLoginOverlay')?.classList.contains('hidden'));
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Space');
    const result = await page.evaluate(async () => {
      const net = await import('/src/transport/index.js');
      const asteroids = await import('/src/asteroidNetwork.js');
      const drops = await import('/src/gunDropMultiplayer.js');
      const epoch = Math.floor(Date.now() / 1800000);
      const first = await asteroids.destroySharedAsteroid(`epoch-${epoch}-mrk-0`);
      const second = await asteroids.destroySharedAsteroid(`epoch-${epoch}-mrk-0`);
      const published = await drops.publishGunDrops([{ id: 'browser-gun', x: 100, y: 100 }]);
      const claimed = await drops.claimGunDrop('browser-gun');
      return { identity: net.getLocalIdentity(), first, second, published, claimed,
        connected: net.isMultiplayerConnected(), destroyedCount: asteroids.getDestroyedAsteroids().size };
    });
    assert.equal(result.identity.uid, 'browser-test'); assert.ok(result.connected);
    assert.equal(result.first, true); assert.equal(result.second, false);
    assert.equal(result.published, true); assert.equal(result.claimed, true);
    assert.equal(firebase.length, 0, 'KNAS must not load Firebase SDK/auth/RTDB');
    assert.deepEqual(errors, []);
    console.log(`${path}: real Chromium game boot, authoritative identity, shared claims; zero Firebase requests, zero page errors`);
    await context.close();
  }
  const stagingContext = await browser.newContext();
  await stagingContext.addInitScript(({ launcherOrigin }) => {
    const opener = {
      postMessage(message, targetOrigin) {
        if (targetOrigin !== launcherOrigin) return;
        setTimeout(() => {
          const event = new MessageEvent('message', {
            origin: launcherOrigin,
            data: {
              type: 'moshroids:launch-grant',
              requestId: message.requestId,
              grant: {
                accessToken: 'ml1_' + 'b'.repeat(64),
                audience: 'moshroids',
                expiresAt: new Date(Date.now() + 30000).toISOString(),
                roomId: 'classroom',
              },
            },
          });
          Object.defineProperty(event, 'source', { value: opener });
          window.dispatchEvent(event);
        }, 0);
      },
    };
    Object.defineProperty(window, 'opener', { value: opener });
  }, { launcherOrigin: 'https://spelling-snake-mr-kirby.mr-kirby.chatgpt.site' });
  const stagingPage = await stagingContext.newPage();
  const stagingErrors = [], stagingFirebase = [], websocketUrls = [];
  stagingPage.on('pageerror', error => stagingErrors.push(error.message));
  stagingPage.on('request', req => { if (/firebase/.test(req.url())) stagingFirebase.push(req.url()); });
  stagingPage.on('websocket', socket => websocketUrls.push(socket.url()));
  await stagingPage.goto(origin + '/knas-staging/');
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
  console.log('KNAS staging page: synthetic opener grant, playable game shell, fixed local WSS, shared actions; zero Firebase requests, zero page errors');
  await stagingContext.close();

  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(async () => (await import('/src/transport/config.js')).transportConfig.provider === 'firebase');
  await page.waitForFunction(async () => typeof (await import('/src/transport/index.js')).bindPilotLogin === 'function');
  assert.equal(await page.locator('#pilotLoginForm').isVisible(), true);
  console.log('Firebase default: existing adapter loads and pilot form remains; no live login/data writes attempted');
  await context.close();
} finally { await browser.close(); await realtime.close(); await new Promise(resolve => web.close(resolve)); }
