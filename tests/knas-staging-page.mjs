import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { modeForPath } from '../src/gameMode.js';

const html = await readFile(new URL('../knas-staging/index.html', import.meta.url), 'utf8');
const bootstrap = await readFile(new URL('../knas-staging/bootstrap.js', import.meta.url), 'utf8');
const launchAdapter = await readFile(new URL('../knas-staging/launch-adapter.js', import.meta.url), 'utf8');

test('the isolated playable page is visibly labeled and uses the common game shell', () => {
  assert.match(html, /MOSHROIDS — KNAS STAGING/);
  assert.match(html, /id="gameCanvas"/);
  assert.match(html, /data-wormhole-form/);
  assert.match(bootstrap, /await import\('\.\.\/src\/game\.js'\)/);
  assert.equal(modeForPath('/classroom-flap-moshroids/knas-staging/'), 'classic');
});

test('staging pins KNAS transport and accepts only its secure launch adapter', () => {
  assert.match(bootstrap, /provider: 'knas'/);
  assert.match(bootstrap, /wss:\/\/moshroids-staging\.mrjkirby\.workers\.dev\/ws/);
  assert.match(bootstrap, /createOpenerLaunchAdapter/);
  assert.doesNotMatch(html, /id="pilotLoginForm"/);
  assert.doesNotMatch(bootstrap, /location\.search|localStorage/);
  assert.match(launchAdapter, /new URLSearchParams\(locationRef\.hash/);
  assert.match(launchAdapter, /historyRef\?\.replaceState/);
  assert.match(launchAdapter, /event\.source !== opener/);
  assert.match(launchAdapter, /event\.origin !== launcherOrigin/);
  assert.match(launchAdapter, /targetOrigin|launcherOrigin/);
  assert.doesNotMatch(launchAdapter, /console\.(log|warn|error)/);
  assert.doesNotMatch(bootstrap, /firebase/i);
  assert.match(html, /token is removed before connecting/);
});
