import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, statSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const compose = readFileSync(new URL('../cloudflared/compose.yaml', import.meta.url), 'utf8');
const helper = fileURLToPath(new URL('../cloudflared/store-token.sh', import.meta.url));
const syntheticToken = 'A'.repeat(64); // Synthetic fixture, not a Cloudflare credential.

test('connector adds only one service on the existing isolated bridge', () => {
  assert.deepEqual([...compose.matchAll(/^  ([a-z][\w-]+):$/gm)].map(m => m[1]),
    ['moshroids-cloudflared', 'moshroids']);
  assert.match(compose, /external: true\n    name: moshroids_default/);
  assert.doesNotMatch(compose, /^\s*(ports|network_mode|privileged|depends_on):/m);
  assert.doesNotMatch(compose, /docker\.sock|host\.docker\.internal/);
});

test('official pinned image has private token-file, least privilege and edge readiness', () => {
  assert.match(compose, /image: cloudflare\/cloudflared@sha256:[a-f0-9]{64}/);
  assert.match(compose, /user: "1026:100"/);
  assert.match(compose, /--token-file, \/run\/secrets\/tunnel-token/);
  assert.doesNotMatch(compose, /--token[, ]|TUNNEL_TOKEN:|environment:/);
  assert.match(compose, /create_host_path: false/);
  assert.match(compose, /cap_drop: \[ALL\]/);
  assert.match(compose, /no-new-privileges:true/);
  assert.match(compose, /restart: unless-stopped/);
  assert.match(compose, /healthcheck:[\s\S]*127\.0\.0\.1:2000.*ready/);
});

test('helper is valid POSIX shell and restores hidden-input terminal state', () => {
  assert.equal(spawnSync('sh', ['-n', helper]).status, 0);
  const source = readFileSync(helper, 'utf8');
  assert.match(source, /set \+x/);
  assert.match(source, /umask 077/);
  assert.match(source, /trap cleanup EXIT/);
  assert.match(source, /set -C/);
  assert.match(source, /chmod 600/);
});

function enterInTerminal(directory, token) {
  const fixture = fileURLToPath(new URL('./support/token-terminal.py', import.meta.url));
  const result = spawnSync('python3', [fixture, helper, directory], {
    input: token, encoding: 'utf8', timeout: 6000,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('owner helper saves synthetic token without echo, securely, and refuses overwrite', async () => {
  const directory = join(mkdtempSync(join(tmpdir(), 'moshroids-token-test-')), 'secrets');
  const result = await enterInTerminal(directory, syntheticToken);
  assert.equal(result.code, 0, result.output);
  assert.doesNotMatch(result.output, new RegExp(syntheticToken));
  assert.equal(readFileSync(join(directory, 'tunnel-token'), 'utf8'), syntheticToken);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(directory, 'tunnel-token')).mode & 0o777, 0o600);
  const again = spawnSync('sh', [helper, directory], { encoding: 'utf8' });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /refusing to overwrite/);
  assert.equal(readFileSync(join(directory, 'tunnel-token'), 'utf8'), syntheticToken);
});

test('invalid terminal input does not save a credential', async () => {
  const directory = join(mkdtempSync(join(tmpdir(), 'moshroids-token-test-')), 'secrets');
  const result = await enterInTerminal(directory, 'not a token');
  assert.match(result.output, /Invalid token format/);
  assert.equal(existsSync(join(directory, 'tunnel-token')), false);
});

test('public selector remains Firebase and credential files are Git-ignored', () => {
  const config = readFileSync(new URL('../../src/transport/config.js', import.meta.url), 'utf8');
  assert.match(config, /configured\.provider === 'knas' \? 'knas' : 'firebase'/);
  const ignore = readFileSync(new URL('../../.gitignore', import.meta.url), 'utf8');
  assert.match(ignore, /server\/cloudflared\/secrets\//);
  assert.match(ignore, /\*\*\/tunnel-token/);
});
