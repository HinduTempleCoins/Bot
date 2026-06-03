// secrets.test.mjs — OFFLINE tests for the capability-based secret resolver.
// Run: node --test integrations/secrets.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { getCapability, has, importEnv, source } from './secrets.mjs';
import { store, __reset } from './credential-store.mjs';

// Isolate each test: clear the store and any env we touch.
function reset(names = []) {
  __reset();
  for (const n of names) delete process.env[n];
}

test('env fallback resolves a credential', async () => {
  reset(['T_ENV_ONLY']);
  process.env.T_ENV_ONLY = 'env-secret-1';
  assert.equal(has('T_ENV_ONLY'), true);
  assert.equal(source('T_ENV_ONLY'), 'env');
  const seen = await getCapability('T_ENV_ONLY').use((k) => k);
  assert.equal(seen, 'env-secret-1');
  reset(['T_ENV_ONLY']);
});

test('store takes priority over env', async () => {
  reset(['T_BOTH']);
  process.env.T_BOTH = 'from-env';
  store({ name: 'T_BOTH', secret: 'from-store' });
  assert.equal(source('T_BOTH'), 'store');
  assert.equal(has('T_BOTH'), true);
  const seen = await getCapability('T_BOTH').use((k) => k);
  assert.equal(seen, 'from-store');
  reset(['T_BOTH']);
});

test('use() runs fn with the secret and returns fn result', async () => {
  reset(['T_USE']);
  store({ name: 'T_USE', secret: 'abc123' });
  const result = await getCapability('T_USE').use((k) => `len:${k.length}`);
  assert.equal(result, 'len:6');
  reset(['T_USE']);
});

test('getCapability never exposes the secret on the handle', async () => {
  reset(['T_HIDDEN']);
  store({ name: 'T_HIDDEN', secret: 'top-secret-value' });
  const cap = getCapability('T_HIDDEN');
  // No property of the handle, nor its JSON form, contains the secret.
  const serialized = JSON.stringify({ ...cap, str: String(cap) });
  assert.equal(serialized.includes('top-secret-value'), false);
  for (const v of Object.values(cap)) {
    assert.notEqual(v, 'top-secret-value');
  }
  // Same for the env path.
  reset(['T_HIDDEN_ENV']);
  process.env.T_HIDDEN_ENV = 'env-top-secret';
  const cap2 = getCapability('T_HIDDEN_ENV');
  assert.equal(JSON.stringify(cap2).includes('env-top-secret'), false);
  reset(['T_HIDDEN', 'T_HIDDEN_ENV']);
});

test('has() and source() are correct for store, env, and missing', () => {
  reset(['T_S', 'T_E', 'T_MISSING']);
  store({ name: 'T_S', secret: 's' });
  process.env.T_E = 'e';
  assert.equal(source('T_S'), 'store');
  assert.equal(source('T_E'), 'env');
  assert.equal(source('T_MISSING'), null);
  assert.equal(has('T_S'), true);
  assert.equal(has('T_E'), true);
  assert.equal(has('T_MISSING'), false);
  // empty env string does not count
  process.env.T_EMPTY = '   ';
  assert.equal(has('T_EMPTY'), false);
  assert.equal(source('T_EMPTY'), null);
  reset(['T_S', 'T_E', 'T_MISSING', 'T_EMPTY']);
});

test('missing name → has=false and use() throws cleanly', async () => {
  reset(['T_NONE']);
  assert.equal(has('T_NONE'), false);
  await assert.rejects(
    () => getCapability('T_NONE').use((k) => k),
    /no credential named 'T_NONE'/,
  );
  reset(['T_NONE']);
});

test('getCapability rejects a bad name argument', () => {
  assert.throws(() => getCapability(''), /name \(string\) is required/);
  assert.throws(() => getCapability(null), /name \(string\) is required/);
});

test('use() requires a function', async () => {
  reset(['T_FN']);
  store({ name: 'T_FN', secret: 'x' });
  await assert.rejects(() => getCapability('T_FN').use('nope'), /fn \(function\) is required/);
  reset(['T_FN']);
});

test('importEnv pulls env vars into the store and store then wins', async () => {
  reset(['T_IMP', 'T_SKIP']);
  process.env.T_IMP = 'imported-secret';
  const imported = importEnv(['T_IMP', 'T_SKIP']); // T_SKIP not in env → skipped
  assert.deepEqual(imported, ['T_IMP']);
  assert.equal(source('T_IMP'), 'store');
  // value remains resolvable and correct via the store path
  const seen = await getCapability('T_IMP').use((k) => k);
  assert.equal(seen, 'imported-secret');
  // re-importing is a no-op (store already authoritative)
  assert.deepEqual(importEnv(['T_IMP']), []);
  reset(['T_IMP', 'T_SKIP']);
});

test('importEnv validates its argument', () => {
  assert.throws(() => importEnv('not-an-array'), /names \(array\) is required/);
});
