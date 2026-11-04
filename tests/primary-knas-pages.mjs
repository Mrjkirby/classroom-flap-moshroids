import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { SourceTextModule, SyntheticModule, createContext } from 'node:vm';
import { modeForPath } from '../src/gameMode.js';

const root = new URL('../', import.meta.url);
const bootstrapSource = await readFile(new URL('src/bootstrap.js', root), 'utf8');
const configSource = await readFile(new URL('src/transport/config.js', root), 'utf8');

test('every primary game URL uses the shared secure launch and retains its room mode', async () => {
  for (const [path, mode] of [['/', 'classic'], ['/teams/', 'teams'], ['/1vw/', '1vw']]) {
    const html = await readFile(new URL(`${path.slice(1)}index.html`, root), 'utf8');
    assert.match(html, /<script type="module" src="(?:\.\.\/)?src\/bootstrap\.js"><\/script>/);
    assert.doesNotMatch(html, /pilotLoginForm|pilotNameInput|ENTER PILOT NAME|firebase/i);
    assert.match(html, /href="https:\/\/spelling-snake-mr-kirby\.mr-kirby\.chatgpt\.site\/"/);
    assert.match(html, /id="gameCanvas"/);
    assert.equal(modeForPath(`/classroom-flap-moshroids${path}`), mode);
  }
});

test('published bootstrap pins KNAS before loading gameplay even with a legacy provider override', async () => {
  const context = createContext({ MOSHROIDS_TRANSPORT_CONFIG: { provider: 'firebase' } });
  const requestLaunch = () => {};
  let loaded = false;
  const launch = new SyntheticModule(['createOpenerLaunchAdapter'], function () {
    this.setExport('createOpenerLaunchAdapter', () => ({ requestLaunch }));
  }, { context });
  const game = new SyntheticModule([], () => { loaded = true; }, { context });
  await game.link(() => {});
  const bootstrap = new SourceTextModule(bootstrapSource, { context,
    importModuleDynamically: async specifier => {
      assert.equal(specifier, './game.js');
      assert.equal(context.MOSHROIDS_TRANSPORT_CONFIG.provider, 'knas');
      assert.equal(context.MOSHROIDS_TRANSPORT_CONFIG.requestLaunch, requestLaunch);
      assert.ok(Object.isFrozen(context.MOSHROIDS_TRANSPORT_CONFIG));
      await game.evaluate();
      return game;
    },
  });
  await bootstrap.link(specifier => {
    assert.equal(specifier, './transport/launch-adapter.js');
    return launch;
  });
  await bootstrap.evaluate();
  assert.ok(loaded);
});

test('unconfigured transport defaults to pinned KNAS and ignores URL provider choices', async () => {
  const context = createContext({ location: { search: '?provider=firebase&websocketUrl=ws://other' } });
  const diagnostics = new SyntheticModule(['reportTransportDiagnostic'], function () {
    this.setExport('reportTransportDiagnostic', () => {});
  }, { context });
  const config = new SourceTextModule(configSource, { context });
  await config.link(() => diagnostics);
  await config.evaluate();
  assert.equal(config.namespace.transportConfig.provider, 'knas');
  assert.equal(config.namespace.transportConfig.websocketUrl,
    'wss://moshroids-staging.mrjkirby.workers.dev/ws');
});
