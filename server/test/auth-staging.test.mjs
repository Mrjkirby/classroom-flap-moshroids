import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const compose = readFileSync(new URL('../auth-staging/compose.yaml', import.meta.url), 'utf8');

test('authenticated staging is a separate private instance, with no published ports or build', () => {
  assert.match(compose, /container_name: moshroids-auth-staging/);
  assert.doesNotMatch(compose, /^\s+(ports|build|privileged|network_mode):/m);
  assert.match(compose, /image: sha256:[a-f0-9]{64}/);
  assert.match(compose, /name: moshroids_default/);
  assert.match(compose, /MOSHROIDS_STANDBY: "false"/);
  assert.match(compose, /read_only: true/);
  assert.match(compose, /cap_drop: \[ALL\]/);
});

test('staging uses the real issuer, original Origin and a private server-only secret file', () => {
  assert.match(compose, /MOSHROIDS_AUTH_VERIFY_URL: https:\/\/spelling-snake-mr-kirby\.mr-kirby\.chatgpt\.site\/api\/moshroids/);
  assert.match(compose, /MOSHROIDS_ALLOWED_ORIGINS: https:\/\/mrjkirby.github.io/);
  assert.match(compose, /env_file:\s+- \.\/private\/service.env/);
  assert.doesNotMatch(compose, /MOSHROIDS_SERVICE_SECRET:/);
  assert.equal(readFileSync(new URL('../auth-staging/.gitignore', import.meta.url), 'utf8').trim(), 'private/');
  assert.match(readFileSync(new URL('../compose.yaml', import.meta.url), 'utf8'), /MOSHROIDS_STANDBY:-true/);
});
