// vault.test.mjs — OFFLINE tests for the Web2 Credential Vault. No network, no real secrets.
// Run: node --test integrations/vault.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';

// Deterministic master key so encrypt/decrypt round-trips within the process.
process.env.VAULT_MASTER_KEY = 'a'.repeat(64); // 32-byte hex

const { store, grant, revoke, audit, list, __reset } = await import('./credential-store.mjs');

const FAKE = 'sk-test-NOT-A-REAL-SECRET-0000';

beforeEach(() => __reset());

test('round-trip: secret is decrypted in-use and fn result is returned', async () => {
  store({ name: 'gemini', secret: FAKE, scope: 'llm:gemini' });
  const h = grant('gemini');
  const seen = await h.use((secret) => `len=${secret.length}`);
  assert.equal(seen, 'len=' + FAKE.length);
  // The same secret value is actually delivered to fn:
  const echoTail = await h.use((secret) => secret.slice(-4));
  assert.equal(echoTail, FAKE.slice(-4));
});

test('use() never returns the secret to the caller (only fn output)', async () => {
  store({ name: 'k', secret: FAKE, scope: 's' });
  const h = grant('k');
  const ret = await h.use(() => 'OK'); // fn ignores the secret
  assert.equal(ret, 'OK');
  assert.notEqual(ret, FAKE);
});

test('list() exposes names/scopes/caps but NEVER secrets or ciphertext', () => {
  store({ name: 'twilio', secret: FAKE, scope: 'sms:twilio', cap: { calls: 5 } });
  const entries = list();
  assert.equal(entries.length, 1);
  const e = entries[0];
  assert.equal(e.name, 'twilio');
  assert.equal(e.scope, 'sms:twilio');
  assert.deepEqual(e.cap, { calls: 5 });
  const blob = JSON.stringify(entries);
  assert.ok(!blob.includes(FAKE), 'list() must not contain the plaintext secret');
  assert.ok(!('secret' in e) && !('blob' in e) && !('ct' in e), 'no secret/ciphertext fields');
});

test('revoke blocks further use()', async () => {
  store({ name: 'ex', secret: FAKE, scope: 'exchange' });
  const h = grant('ex');
  await h.use(() => 'fine'); // works before revoke
  revoke('ex');
  await assert.rejects(() => h.use(() => 'nope'), /revoked/);
  // list reflects revoked state
  assert.equal(list()[0].revoked, true);
});

test('call cap is enforced', async () => {
  store({ name: 'capped', secret: FAKE, scope: 's', cap: { calls: 2 } });
  const h = grant('capped');
  await h.use(() => 1);
  await h.use(() => 2);
  await assert.rejects(() => h.use(() => 3), /cap/);
});

test('spend cap is enforced via per-use cost', async () => {
  store({ name: 'spend', secret: FAKE, scope: 's', cap: { spend: 10 } });
  const h = grant('spend');
  await h.use(() => 'a', 6); // spent=6
  await h.use(() => 'b', 4); // spent=10 (at cap, allowed)
  await assert.rejects(() => h.use(() => 'c', 1), /spend cap/); // would exceed
});

test('audit records store, each use, revoke, and denials', async () => {
  store({ name: 'a', secret: FAKE, scope: 's', cap: { calls: 1 } });
  const h = grant('a');
  await h.use(() => 'x');
  await assert.rejects(() => h.use(() => 'y'), /cap/); // denial
  revoke('a');
  await assert.rejects(() => h.use(() => 'z'), /revoked/); // denial after revoke

  const log = audit();
  const events = log.map((e) => e.event);
  assert.ok(events.includes('store'));
  assert.ok(events.includes('use'));
  assert.ok(events.includes('use_denied'));
  assert.ok(events.includes('revoke'));
  // one successful use logged
  assert.equal(log.filter((e) => e.event === 'use').length, 1);
  // append-only: every entry has a timestamp and name
  for (const e of log) {
    assert.ok(e.ts && e.name);
  }
});

test('store overwrites by name and never returns the secret', () => {
  const r = store({ name: 'dup', secret: FAKE, scope: 's1' });
  assert.ok(!('secret' in r));
  store({ name: 'dup', secret: 'other-fake', scope: 's2' });
  assert.equal(list().length, 1);
  assert.equal(list()[0].scope, 's2');
});

test('grant on unknown name throws', () => {
  assert.throws(() => grant('missing'), /no credential/);
});
