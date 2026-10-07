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
const web = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const path = resolve(root, '.' + pathname + (pathname.endsWith('/') ? 'index.html' : ''));
  if (!path.startsWith(root + '/')) return res.writeHead(403).end();
  try { res.setHeader('content-type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(path)] || 'application/octet-stream'); res.end(await readFile(path)); }
  catch { res.writeHead(404).end(); }
});
await new Promise(resolve => web.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${web.address().port}`;
const used = new Set();
const realtime = createMoshroidsServer({ allowedOrigins: [origin], authenticate: async ({ accessToken }) => {
  if (!accessToken.startsWith('fixture-') || used.has(accessToken)) throw new Error('Invalid test grant');
  used.add(accessToken); return { studentId: 'browser-test', displayName: 'Browser Test' };
} });
const address = await realtime.listen();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH });
try {
  for (const path of ['/', '/teams/', '/1vw/']) {
    const context = await browser.newContext();
    await context.addInitScript(({ url }) => { globalThis.MOSHROIDS_TRANSPORT_CONFIG = {
      provider: 'knas', websocketUrl: url,
      requestLaunch: async () => ({ accessToken: 'fixture-' + crypto.randomUUID() }),
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
  const context = await browser.newContext(); const page = await context.newPage();
  await page.goto(origin);
  await page.waitForFunction(async () => (await import('/src/transport/config.js')).transportConfig.provider === 'firebase');
  await page.waitForFunction(async () => typeof (await import('/src/transport/index.js')).bindPilotLogin === 'function');
  assert.equal(await page.locator('#pilotLoginForm').isVisible(), true);
  console.log('Firebase default: existing adapter loads and pilot form remains; no live login/data writes attempted');
  await context.close();
} finally { await browser.close(); await realtime.close(); await new Promise(resolve => web.close(resolve)); }
