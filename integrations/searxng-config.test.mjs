// searxng-config.test.mjs — offline tests for the SearXNG self-host config generator (task #31).
// node --test integrations/searxng-config.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  settingsYml, dockerCompose, engineList, setupRunbook, validateSettings,
} from './searxng-config.mjs';

// ── settingsYml ────────────────────────────────────────────────────────────
test('settingsYml references the secret via env NAME and contains NO literal secret', () => {
  const s = settingsYml({ secretKeyEnv: 'SEARXNG_SECRET_KEY' });
  // env interpolation form present
  assert.match(s.yaml, /secret_key:\s*"\$\{SEARXNG_SECRET_KEY\}"/);
  assert.equal(s.secretKeyEnv, 'SEARXNG_SECRET_KEY');
  assert.equal(s.object.server.secretKeyEnv, 'SEARXNG_SECRET_KEY');
  // the env NAME, not a value, is what appears
  assert.ok(s.envVarsRequired.includes('SEARXNG_SECRET_KEY'));
  // no hex/base64-looking literal secret anywhere on the secret_key line
  const line = s.yaml.match(/secret_key:.*/)[0];
  const stripped = line.replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, '');
  assert.doesNotMatch(stripped, /[A-Fa-f0-9]{16,}/, 'no hex literal secret');
  assert.doesNotMatch(stripped, /[A-Za-z0-9+/]{24,}={0,2}/, 'no base64 literal secret');
});

test('settingsYml enables the JSON output format', () => {
  const s = settingsYml();
  assert.ok(s.object.search.formats.includes('json'), 'object lists json format');
  assert.match(s.yaml, /formats:[\s\S]*?\bjson\b/, 'yaml formats block includes json');
});

test('settingsYml includes foreign/metasearch engines', () => {
  const s = settingsYml();
  const names = s.object.engines.map((e) => e.name);
  for (const eng of ['yandex', 'baidu', 'mojeek', 'duckduckgo', 'brave']) {
    assert.ok(names.includes(eng), `engine ${eng} present`);
    assert.match(s.yaml, new RegExp(eng), `yaml mentions ${eng}`);
  }
});

test('settingsYml base_url also uses an env NAME (no host-specific literal)', () => {
  const s = settingsYml({ baseUrlEnv: 'SEARXNG_BASE_URL' });
  assert.match(s.yaml, /base_url:\s*"\$\{SEARXNG_BASE_URL\}"/);
  // limiter + non-public hardening present
  assert.match(s.yaml, /limiter:\s*true/);
  assert.match(s.yaml, /public_instance:\s*false/);
});

test('settingsYml soft-fails on bad input (returns defaults, never throws)', () => {
  const s = settingsYml(null);
  assert.ok(s.object.engines.length > 0);
  assert.match(s.yaml, /secret_key:\s*"\$\{SEARXNG_SECRET_KEY\}"/);
});

// ── dockerCompose ──────────────────────────────────────────────────────────
test('dockerCompose references env NAMES, not literal secrets', () => {
  const c = dockerCompose({ port: 8080, secretKeyEnv: 'SEARXNG_SECRET_KEY' });
  assert.match(c.yaml, /SEARXNG_SECRET_KEY:\s*"\$\{SEARXNG_SECRET_KEY\}"/);
  assert.ok(c.envVarsRequired.includes('SEARXNG_SECRET_KEY'));
  // localhost bind only
  assert.match(c.yaml, /127\.0\.0\.1:8080:8080/);
  // image present
  assert.match(c.yaml, /searxng\/searxng/);
  // no hex/base64 literal alongside the env ref
  const line = c.yaml.match(/SEARXNG_SECRET_KEY:.*/)[0].replace(/\$\{[A-Za-z_][A-Za-z0-9_]*\}/g, '');
  assert.doesNotMatch(line, /[A-Fa-f0-9]{16,}/);
});

test('dockerCompose includes a redis/valkey for rate-limiting by default', () => {
  const c = dockerCompose();
  assert.match(c.yaml, /valkey|redis/);
  assert.ok(c.object.services.redis, 'redis service present');
  assert.deepEqual(c.object.services.searxng.depends_on, ['redis']);
});

test('dockerCompose can omit redis', () => {
  const c = dockerCompose({ withRedis: false });
  assert.ok(!c.object.services.redis);
});

// ── engineList ─────────────────────────────────────────────────────────────
test('engineList includes the foreign engines flagged as foreign/metasearch', () => {
  const list = engineList();
  const byName = Object.fromEntries(list.map((e) => [e.name, e]));
  for (const eng of ['yandex', 'baidu', 'mojeek', 'brave', 'duckduckgo']) {
    assert.ok(byName[eng], `${eng} in list`);
    assert.equal(byName[eng].foreignOrMetasearch, true, `${eng} flagged foreign/metasearch`);
  }
  // mainstream still present
  assert.ok(byName.google && byName.bing);
});

// ── setupRunbook ───────────────────────────────────────────────────────────
test('setupRunbook mentions docker-compose, JSON, and scraper wiring', () => {
  const md = setupRunbook();
  assert.match(md, /docker-compose/i);
  assert.match(md, /\bjson\b/i);
  assert.match(md, /format=json/);
  assert.match(md, /scraper\.mjs/);
  assert.match(md, /SEARX_INSTANCES/);
  // hardening notes
  assert.match(md, /limiter/i);
  assert.match(md, /public_instance/i);
});

// ── validateSettings ───────────────────────────────────────────────────────
test('validateSettings passes a generated config', () => {
  const s = settingsYml();
  const v = validateSettings(s);
  assert.equal(v.ok, true, 'errors: ' + v.errors.join('; '));
});

test('validateSettings catches a hardcoded secret_key literal', () => {
  const bad = `server:
  secret_key: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
search:
  formats:
    - json
    - html
engines:
  - name: google`;
  const v = validateSettings(bad);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /hardcoded|literal/i.test(e)), 'flags the literal secret');
});

test('validateSettings catches missing JSON format', () => {
  const noJson = `server:
  secret_key: "\${SEARXNG_SECRET_KEY}"
search:
  formats:
    - html
engines:
  - name: google`;
  const v = validateSettings(noJson);
  assert.equal(v.ok, false);
  assert.ok(v.errors.some((e) => /json/i.test(e)), 'flags missing json format');
});

test('validateSettings soft-fails on garbage input', () => {
  assert.equal(validateSettings(null).ok, false);
  assert.equal(validateSettings(42).ok, false);
});
