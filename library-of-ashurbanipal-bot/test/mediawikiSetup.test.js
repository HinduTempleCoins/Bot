// mediawikiSetup.test.js — offline tests for the MediaWiki + bot-account config/runbook generator (#93).
//
// Run: node --test test/mediawikiSetup.test.js
//
// These tests are pure/offline (no network, no fs). They assert the load-bearing guarantees:
//   - localSettingsConfig references env var NAMES and contains NO secret literal
//   - botAccountPlan grants edit/createpage but NOT sysop/delete (least privilege)
//   - setupRunbook mentions BotPasswords + Caddy + vault + least-privilege
//   - requiredEnv lists the env names
//   - validateConfig catches a config with a hardcoded secret

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  localSettingsConfig,
  botAccountPlan,
  setupRunbook,
  requiredEnv,
  validateConfig,
} from '../src/mediawikiSetup.js';

// A representative secret-looking literal we use to prove none leaks into outputs.
const FAKE_SECRET = 'Sup3rSecretP@ssw0rd123';

test('localSettingsConfig contains env var NAMES and references them via getenv()', () => {
  const { object, php, envVarsRequired } = localSettingsConfig();

  // The structured object carries env NAMES, not values.
  assert.equal(object.database.passwordEnv, 'WIKI_DB_PASS');
  assert.equal(object.secretKeyEnv, 'WIKI_SECRET_KEY');

  // The PHP reads each via getenv('NAME'), so the env name appears as a getenv() argument.
  assert.match(php, /getenv\('WIKI_DB_PASS'\)/);
  assert.match(php, /getenv\('WIKI_SECRET_KEY'\)/);
  assert.match(php, /getenv\('WIKI_DB_HOST'\)/);

  // envVarsRequired enumerates the names.
  assert.ok(envVarsRequired.includes('WIKI_DB_PASS'));
  assert.ok(envVarsRequired.includes('WIKI_SECRET_KEY'));
});

test('localSettingsConfig PHP enables the API + bot-friendly editing', () => {
  const { php } = localSettingsConfig();
  assert.match(php, /\$wgEnableAPI\s*=\s*true/);
  assert.match(php, /\$wgEnableWriteAPI\s*=\s*true/);
  assert.match(php, /\$wgEnableBotPasswords\s*=\s*true/);
  assert.match(php, /\$wgGroupPermissions\['bot'\]\['edit'\]\s*=\s*true/);
  assert.match(php, /\$wgGroupPermissions\['bot'\]\['createpage'\]\s*=\s*true/);
});

test('localSettingsConfig output contains NO secret literal', () => {
  // Even if a caller mistakenly passes a secret VALUE in a *Env field, the renderer only ever emits
  // it as a getenv() argument name — but a real password value should never appear as an assignment.
  const { php } = localSettingsConfig();

  // No hardcoded password/secret assignment with a quoted string literal value.
  assert.doesNotMatch(php, /\$wgDBpassword\s*=\s*["'][^"']+["']/);
  assert.doesNotMatch(php, /\$wgSecretKey\s*=\s*["'][^"']+["']/);

  // The known fake secret never appears anywhere in the rendered config.
  assert.ok(!php.includes(FAKE_SECRET), 'rendered PHP must not contain a secret literal');

  // No "password-looking" high-entropy token sits in the file (a getenv name is SCREAMING_SNAKE).
  const literalSecretLike = /["'][A-Za-z0-9@#$%^&*]{12,}["']/g;
  const matches = (php.match(literalSecretLike) || []).filter((m) => {
    // Strip quotes; allow our known-safe literals (site name, namespace, skin, paths).
    const inner = m.slice(1, -1);
    const safe = [
      'Library of Ashurbanipal',
      'Library_of_Ashurbanipal',
    ];
    if (safe.includes(inner)) return false;
    // Allow lower-case-only words and path-ish/URL-ish strings (no mixed-case+digit secret shape).
    const looksSecret = /[a-z]/.test(inner) && /[A-Z0-9]/.test(inner) && !/[\s/.:]/.test(inner);
    return looksSecret;
  });
  assert.deepEqual(matches, [], `unexpected secret-looking literals in PHP: ${matches.join(', ')}`);
});

test('botAccountPlan grants edit + createpage but NOT sysop/delete (least privilege)', () => {
  const plan = botAccountPlan({ botName: 'Ashurbanipal' });

  assert.equal(plan.botName, 'Ashurbanipal');
  assert.equal(plan.group, 'bot');

  const grants = plan.botPassword.grants;
  assert.ok(grants.includes('edit'), 'bot must be able to edit');
  assert.ok(grants.includes('createpage'), 'bot must be able to create pages');

  // Least privilege: the bot must NOT have administrative grants.
  assert.ok(!grants.includes('sysop'), 'bot must NOT be sysop');
  assert.ok(!grants.includes('delete'), 'bot must NOT be able to delete');
  assert.ok(!grants.includes('protect'), 'bot must NOT be able to protect');

  // And these are explicitly enumerated as denied.
  assert.ok(plan.botPassword.deniedGrants.includes('sysop'));
  assert.ok(plan.botPassword.deniedGrants.includes('delete'));

  // The bot password value is referenced by env NAME only — never a literal.
  assert.match(plan.botPassword.secretEnv, /^[A-Z][A-Z0-9_]*$/);
  assert.equal(plan.botPassword.secretEnv, 'WIKI_BOT_PASSWORD');

  // The plan text spells out least privilege + where the secret lives.
  assert.match(plan.principleOfLeastPrivilege, /least privilege|NOT a sysop|cannot delete/i);
  assert.match(plan.secretsLocation, /vault|never committed/i);
});

test('botAccountPlan soft-fails to defaults on bad input', () => {
  const plan = botAccountPlan(null);
  assert.equal(plan.botName, 'Ashurbanipal');
  assert.ok(plan.botPassword.grants.includes('edit'));
});

test('setupRunbook mentions BotPasswords + Caddy + vault + least-privilege', () => {
  const md = setupRunbook();
  assert.match(md, /BotPasswords/);
  assert.match(md, /Caddy/);
  assert.match(md, /vault/i);
  assert.match(md, /least.?privilege/i);
  // It also covers install, DNS, and the no-anonymous-edit / no-sysop hardening.
  assert.match(md, /DNS/);
  assert.match(md, /no sysop|NOT a sysop|no delete/i);
  assert.match(md, /getenv/);
});

test('requiredEnv lists the env NAMES the deploy needs', () => {
  const env = requiredEnv();
  for (const name of ['WIKI_DB_HOST', 'WIKI_DB_NAME', 'WIKI_DB_USER', 'WIKI_DB_PASS', 'WIKI_SECRET_KEY', 'WIKI_BOT_PASSWORD']) {
    assert.ok(env.includes(name), `requiredEnv must list ${name}`);
  }
  // Every entry is a valid SCREAMING_SNAKE env var name (no secret values).
  for (const name of env) {
    assert.match(name, /^[A-Z][A-Z0-9_]*$/, `${name} should be an env var NAME`);
  }
});

test('validateConfig passes the generated config (env NAMES only)', () => {
  const { object } = localSettingsConfig();
  const res = validateConfig(object);
  assert.equal(res.ok, true, `expected ok, got errors: ${res.errors.join('; ')}`);
  assert.deepEqual(res.errors, []);
});

test('validateConfig catches a config with a hardcoded secret', () => {
  // A config where dbPassEnv holds an actual password VALUE instead of an env var NAME.
  const bad = {
    siteName: 'Library of Ashurbanipal',
    server: 'https://wiki.soapbox.community',
    dbHostEnv: 'WIKI_DB_HOST',
    dbNameEnv: 'WIKI_DB_NAME',
    dbUserEnv: 'WIKI_DB_USER',
    dbPassEnv: FAKE_SECRET, // <-- leaked literal
    secretKeyEnv: 'WIKI_SECRET_KEY',
  };
  const res = validateConfig(bad);
  assert.equal(res.ok, false);
  assert.ok(
    res.errors.some((e) => /dbPassEnv/.test(e) && /secret|env var NAME/i.test(e)),
    `expected a leaked-secret error, got: ${res.errors.join('; ')}`,
  );
});

test('validateConfig catches an assignment-shaped secret literal', () => {
  const bad = {
    dbHostEnv: 'WIKI_DB_HOST',
    dbNameEnv: 'WIKI_DB_NAME',
    dbUserEnv: 'WIKI_DB_USER',
    dbPassEnv: 'password=hunter2',
    secretKeyEnv: 'WIKI_SECRET_KEY',
  };
  const res = validateConfig(bad);
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => /dbPassEnv/.test(e)));
});

test('validateConfig soft-fails on non-object input', () => {
  assert.deepEqual(validateConfig(null), { ok: false, errors: ['config must be an object'] });
  assert.equal(validateConfig('nope').ok, false);
});
