// tenant-grants.test.mjs — offline tests for multi-tenant capability isolation (task #77).
// node --test integrations/tenant-grants.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  connectCapability,
  listCapabilities,
  getCapability,
  assertTenantOwns,
  revokeTenant,
  revokeCapability,
  tenantSummary,
  CrossTenantError,
  __setClock,
  __reset,
} from './tenant-grants.mjs';

function reset() { __reset(); }

// no record returned by any surface may carry secret-shaped material.
function assertNoSecret(obj) {
  const json = JSON.stringify(obj);
  for (const k of ['secret', 'plaintext', 'key', 'value', 'token', 'wif', 'blob', 'ct', 'iv', 'tag']) {
    assert.ok(!Object.prototype.hasOwnProperty.call(obj, k), `record must not have a '${k}' field`);
  }
  // sanity: the redacted view exposes exactly the expected fields
  assert.deepEqual(
    Object.keys(obj).sort(),
    ['capability', 'connectedAt', 'expiresAt', 'id', 'provider', 'scopes', 'tenantId'].sort(),
  );
  return json;
}

test('connect + list returns only that tenant\'s capabilities', () => {
  reset();
  connectCapability('A', { provider: 'gemini', capability: 'A_GEMINI', scopes: ['llm'] });
  connectCapability('A', { provider: 'twilio', capability: 'A_TWILIO', scopes: ['sms'] });
  connectCapability('B', { provider: 'gemini', capability: 'B_GEMINI', scopes: ['llm'] });

  const a = listCapabilities('A');
  assert.equal(a.length, 2);
  assert.deepEqual(a.map((c) => c.provider).sort(), ['gemini', 'twilio']);
  for (const rec of a) {
    assert.equal(rec.tenantId, 'A');
    assertNoSecret(rec);
  }

  const b = listCapabilities('B');
  assert.equal(b.length, 1);
  assert.equal(b[0].tenantId, 'B');
  // A's list must not contain any of B's vault names
  assert.ok(!a.some((c) => c.capability === 'B_GEMINI'));
});

test('unknown tenant list is empty (soft)', () => {
  reset();
  assert.deepEqual(listCapabilities('nobody'), []);
  assert.equal(getCapability('nobody', 'gemini'), null);
});

test('tenant A cannot see/getCapability tenant B\'s connection', () => {
  reset();
  connectCapability('B', { provider: 'gemini', capability: 'B_GEMINI', scopes: ['llm'] });

  // A has no gemini connection of its own → null (B's is invisible)
  assert.equal(getCapability('A', 'gemini'), null);

  // B sees its own
  const own = getCapability('B', 'gemini');
  assert.ok(own);
  assert.equal(own.tenantId, 'B');
  assert.equal(own.capability, 'B_GEMINI');
  assertNoSecret(own);
});

test('assertTenantOwns throws CrossTenantError on cross-tenant id', () => {
  reset();
  const aCap = connectCapability('A', { provider: 'gemini', capability: 'A_GEMINI', scopes: ['llm'] });
  const bCap = connectCapability('B', { provider: 'gemini', capability: 'B_GEMINI', scopes: ['llm'] });

  // owner check passes
  assert.equal(assertTenantOwns('A', aCap.id), true);
  assert.equal(assertTenantOwns('B', bCap.id), true);

  // cross-tenant: A tries to reach B's capability → LOUD
  assert.throws(() => assertTenantOwns('A', bCap.id), CrossTenantError);
  assert.throws(() => assertTenantOwns('B', aCap.id), CrossTenantError);

  // the error must not leak the true owner's id
  try {
    assertTenantOwns('A', bCap.id);
    assert.fail('expected CrossTenantError');
  } catch (e) {
    assert.ok(e instanceof CrossTenantError);
    assert.ok(!e.message.includes('B'), 'error must not name the true owner tenant');
  }
});

test('assertTenantOwns throws on unknown capability id', () => {
  reset();
  assert.throws(() => assertTenantOwns('A', 'does-not-exist'), CrossTenantError);
});

test('revokeTenant removes all of A\'s caps and leaves B\'s intact', () => {
  reset();
  connectCapability('A', { provider: 'gemini', capability: 'A_GEMINI', scopes: ['llm'] });
  connectCapability('A', { provider: 'twilio', capability: 'A_TWILIO', scopes: ['sms'] });
  const bCap = connectCapability('B', { provider: 'gemini', capability: 'B_GEMINI', scopes: ['llm'] });

  const removed = revokeTenant('A');
  assert.equal(removed, 2);
  assert.deepEqual(listCapabilities('A'), []);

  // B untouched
  assert.equal(listCapabilities('B').length, 1);
  assert.equal(assertTenantOwns('B', bCap.id), true);

  // re-revoking A is a soft no-op
  assert.equal(revokeTenant('A'), 0);
});

test('revokeCapability is scoped to one provider for one tenant', () => {
  reset();
  connectCapability('A', { provider: 'gemini', capability: 'A_GEMINI', scopes: ['llm'] });
  connectCapability('A', { provider: 'twilio', capability: 'A_TWILIO', scopes: ['sms'] });
  connectCapability('B', { provider: 'gemini', capability: 'B_GEMINI', scopes: ['llm'] });

  assert.equal(revokeCapability('A', 'gemini'), true);
  assert.equal(getCapability('A', 'gemini'), null);
  // A's other provider survives
  assert.ok(getCapability('A', 'twilio'));
  // B's gemini untouched
  assert.ok(getCapability('B', 'gemini'));

  // revoking a provider the tenant doesn't have is a soft false
  assert.equal(revokeCapability('A', 'gemini'), false);

  // a tenant cannot revoke another tenant's provider via its own namespace
  assert.equal(revokeCapability('A', 'gemini'), false);
  assert.ok(getCapability('B', 'gemini'), 'B\'s gemini must remain after A\'s revoke attempts');
});

test('connecting same provider twice replaces (one connection per provider)', () => {
  reset();
  const first = connectCapability('A', { provider: 'gemini', capability: 'A_GEMINI_OLD', scopes: ['llm'] });
  const second = connectCapability('A', { provider: 'gemini', capability: 'A_GEMINI_NEW', scopes: ['llm', 'embed'] });

  const list = listCapabilities('A');
  assert.equal(list.length, 1);
  assert.equal(list[0].capability, 'A_GEMINI_NEW');
  assert.notEqual(first.id, second.id);
  // the old id is gone → owner assertion on it is loud
  assert.throws(() => assertTenantOwns('A', first.id), CrossTenantError);
  assert.equal(assertTenantOwns('A', second.id), true);
});

test('expired capability is excluded from list/get and assert is loud', () => {
  reset();
  let t = 1_000;
  __setClock(() => t);
  const cap = connectCapability('A', { provider: 'gemini', capability: 'A_GEMINI', scopes: ['llm'], ttlMs: 5_000 });

  // still valid
  assert.equal(listCapabilities('A').length, 1);
  assert.ok(getCapability('A', 'gemini'));
  assert.equal(assertTenantOwns('A', cap.id), true);

  // advance past TTL
  t = 1_000 + 5_001;
  assert.deepEqual(listCapabilities('A'), []);
  assert.equal(getCapability('A', 'gemini'), null);
  assert.throws(() => assertTenantOwns('A', cap.id), CrossTenantError);
});

test('tenantSummary reports aggregate counts only (no per-secret detail)', () => {
  reset();
  let t = 0;
  __setClock(() => t);
  connectCapability('A', { provider: 'gemini', capability: 'A_GEMINI', scopes: ['llm'] });
  connectCapability('A', { provider: 'twilio', capability: 'A_TWILIO', scopes: ['sms'] });
  connectCapability('B', { provider: 'gemini', capability: 'B_GEMINI', scopes: ['llm'], ttlMs: 10 });

  let s = tenantSummary();
  assert.deepEqual(Object.keys(s).sort(), ['capabilities', 'tenants']);
  assert.equal(s.tenants, 2);
  assert.equal(s.capabilities, 3);

  // expire B's only cap → it drops out of the aggregate, and so does tenant B
  t = 11;
  s = tenantSummary();
  assert.equal(s.tenants, 1);
  assert.equal(s.capabilities, 2);
});

test('no secret material appears in any returned object', () => {
  reset();
  const connected = connectCapability('A', { provider: 'gemini', capability: 'A_GEMINI', scopes: ['llm'] });
  assertNoSecret(connected);
  assertNoSecret(getCapability('A', 'gemini'));
  for (const rec of listCapabilities('A')) assertNoSecret(rec);
  // summary is just counts
  const s = tenantSummary();
  assert.equal(typeof s.tenants, 'number');
  assert.equal(typeof s.capabilities, 'number');
});

test('input validation throws on bad connect input', () => {
  reset();
  assert.throws(() => connectCapability('', { provider: 'gemini', capability: 'X' }), /tenantId/);
  assert.throws(() => connectCapability('A', { provider: '', capability: 'X' }), /provider/);
  assert.throws(() => connectCapability('A', { provider: 'g', capability: '' }), /capability/);
  assert.throws(() => connectCapability('A', { provider: 'g', capability: 'X', scopes: 'no' }), /scopes/);
  assert.throws(() => connectCapability('A', { provider: 'g', capability: 'X', ttlMs: -1 }), /ttlMs/);
});
