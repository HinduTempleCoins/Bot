// audience-store.test.mjs — OFFLINE tests for the two-audience private store (#223).
// No network, no real secrets. Every secret-shaped fixture is assembled at runtime.
// Run: node --test integrations/audience-store.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';

import {
  putPrivate,
  readFor,
  diagnosticsStore,
  emailCredential,
  emailKeyName,
  redactForLog,
  tierOf,
  accessLog,
  __setStore,
  __reset,
} from './audience-store.mjs';

// ---- offline injectable store (mimics credential-store's store/grant capability surface) ----
function makeFakeStore() {
  const m = new Map(); // name -> secret (offline; no crypto needed for the access-boundary tests)
  return {
    store({ name, secret, scope }) {
      m.set(name, { secret: String(secret), scope });
      return { name, scope };
    },
    grant(name) {
      return Object.freeze({
        name,
        async use(fn) {
          const rec = m.get(name);
          let secret = rec ? rec.secret : null;
          try {
            return await fn(secret);
          } finally {
            secret = null;
          }
        },
      });
    },
    _has: (name) => m.has(name),
  };
}

// Assemble secret-shaped fixtures at RUNTIME so no secret literal sits in source.
function fakeSecret(tag) {
  return ['NOT', 'A', 'REAL', tag, Math.random().toString(36).slice(2, 10)].join('-');
}
// A 16-char-app-password-shaped fixture (4 groups of 4), assembled at runtime.
function fakeAppPassword() {
  const grp = () => Math.random().toString(36).slice(2, 6);
  return [grp(), grp(), grp(), grp()].join('');
}

let fake;
beforeEach(() => {
  fake = makeFakeStore();
  __setStore(fake);
  __reset();
});

test('putPrivate + readFor round-trips for the operator audience', async () => {
  const secret = fakeSecret('OPDIAG');
  putPrivate('OPERATOR_NOTE', secret, { tier: 'operator' });
  assert.equal(tierOf('OPERATOR_NOTE'), 'operator');

  const r = readFor('operator', 'OPERATOR_NOTE');
  assert.equal(r.ok, true);
  assert.equal(r.tier, 'operator');
  assert.ok(r.capability, 'operator read returns a capability handle');

  // The capability delivers the real secret to fn but never returns it directly.
  const echoed = await r.capability.use((s) => s);
  assert.equal(echoed, secret);
  // readFor itself never carries the value.
  assert.ok(!JSON.stringify({ ...r, capability: undefined }).includes(secret), 'readFor result must not contain the value');
});

test("operator audience can read BOTH tiers", async () => {
  putPrivate('AI_KEY', fakeSecret('AIKEY'), { tier: 'ai' });
  putPrivate('OP_KEY', fakeSecret('OPKEY'), { tier: 'operator' });
  assert.equal(readFor('operator', 'AI_KEY').ok, true);
  assert.equal(readFor('operator', 'OP_KEY').ok, true);
});

test('CORE RULE: ai audience reading an operator-tier key is DENIED with NO value and NO leak', async () => {
  const secret = fakeSecret('SEALED');
  putPrivate('OPERATOR_ONLY', secret, { tier: 'operator' });

  const r = readFor('ai', 'OPERATOR_ONLY');
  assert.equal(r.ok, false);
  assert.equal(r.denied, true);
  // No value, no capability, no tier disclosed.
  assert.ok(!('capability' in r), 'denied result must not include a capability');
  assert.ok(!('value' in r) && !('secret' in r), 'denied result must not include a value');
  assert.ok(!('tier' in r), 'denied result must not even confirm the tier');
  // The secret string must appear NOWHERE in the denied result.
  assert.ok(!JSON.stringify(r).includes(secret), 'the value must never appear in a denied result');

  // ai audience CAN read an ai-tier key (positive control).
  const aiSecret = fakeSecret('AIOK');
  putPrivate('AI_OK', aiSecret, { tier: 'ai' });
  const ok = readFor('ai', 'AI_OK');
  assert.equal(ok.ok, true);
  assert.equal(await ok.capability.use((s) => s), aiSecret);
});

test('cross-audience denial is recorded in the access log (loud) but value-free', () => {
  putPrivate('OPERATOR_ONLY', fakeSecret('LOG'), { tier: 'operator' });
  readFor('ai', 'OPERATOR_ONLY');
  const denied = accessLog().filter((e) => e.event === 'read_denied');
  assert.equal(denied.length, 1);
  assert.equal(denied[0].audience, 'ai');
  assert.equal(denied[0].key, 'OPERATOR_ONLY');
  // The log entry carries no value/secret/data field.
  assert.ok(!('value' in denied[0]) && !('secret' in denied[0]) && !('data' in denied[0]));
});

test('diagnosticsStore gives operator and ai SEPARATE namespaces', () => {
  const op = diagnosticsStore('operator');
  const ai = diagnosticsStore('ai');
  assert.notEqual(op.namespace, ai.namespace);

  op.write('boot', { status: 'operator-side ok' });
  ai.write('boot', { status: 'ai-side ok' });

  // An ai write is NOT visible to an operator read of the operator namespace.
  const opRead = op.read('boot');
  assert.equal(opRead.ok, true);
  assert.equal(opRead.data.status, 'operator-side ok');

  // And vice-versa: operator's entry is not visible in the ai namespace.
  const aiRead = ai.read('boot');
  assert.equal(aiRead.ok, true);
  assert.equal(aiRead.data.status, 'ai-side ok');

  // Each namespace lists only its own keys.
  assert.deepEqual(op.list(), ['boot']);
  assert.deepEqual(ai.list(), ['boot']);

  // A name written ONLY on the ai side is absent from the operator side.
  ai.write('ai-secret-metric', { v: 42 });
  assert.equal(op.read('ai-secret-metric').ok, false);
  assert.equal(op.read('ai-secret-metric').notFound, true);
});

test('emailCredential is operator-tier and an ai audience can never read it', async () => {
  const pw = fakeAppPassword();
  assert.equal(pw.length, 16, 'fixture is a 16-char app-password shape');

  // Store under the canonical email key as operator-tier.
  putPrivate(emailKeyName(), pw, { tier: 'operator' });
  assert.equal(tierOf(emailKeyName()), 'operator');

  // The convenience handle (operator) resolves it.
  const ec = emailCredential();
  assert.equal(ec.ok, true);
  assert.equal(ec.tier, 'operator');
  assert.equal(await ec.capability.use((s) => s), pw);

  // An ai audience routing through readFor for the same key is DENIED — no value, no leak.
  const aiTry = readFor('ai', emailKeyName());
  assert.equal(aiTry.ok, false);
  assert.equal(aiTry.denied, true);
  assert.ok(!('capability' in aiTry));
  assert.ok(!JSON.stringify(aiTry).includes(pw), 'the email password must never appear in an ai-denied result');
});

test('redactForLog hides the secret/value/capability', async () => {
  const secret = fakeSecret('REDACT');
  putPrivate('K', secret, { tier: 'operator' });
  const r = readFor('operator', 'K');
  const safe = redactForLog(r);
  const blob = JSON.stringify(safe);
  assert.ok(!blob.includes(secret), 'redacted log must not contain the secret');
  assert.equal(safe.capability, '[capability]');
  assert.equal(safe.ok, true);
  assert.equal(safe.tier, 'operator');

  // Diagnostics entries redact their data too.
  const op = diagnosticsStore('operator');
  op.write('m', { sensitive: secret });
  const e = op.read('m');
  const safeDiag = redactForLog(e);
  assert.ok(!JSON.stringify(safeDiag).includes(secret), 'redacted diagnostics must not contain the value');
  assert.equal(safeDiag.data, '[redacted]');
});

test('unknown audience / tier throw loudly; missing key soft-fails', () => {
  assert.throws(() => readFor('annal', 'X'), /unknown audience/);
  assert.throws(() => putPrivate('X', 'v', { tier: 'public' }), /unknown tier/);
  // Missing key is a soft notFound, not a throw.
  const r = readFor('operator', 'NEVER_STORED');
  assert.equal(r.ok, false);
  assert.equal(r.notFound, true);
});

test('putPrivate never returns or logs the value', () => {
  const secret = fakeSecret('RECEIPT');
  const receipt = putPrivate('R', secret, { tier: 'ai' });
  assert.equal(receipt.ok, true);
  assert.equal(receipt.key, 'R');
  assert.equal(receipt.tier, 'ai');
  assert.ok(!('value' in receipt) && !('secret' in receipt));
  // The access log records the put without the value.
  const blob = JSON.stringify(accessLog());
  assert.ok(!blob.includes(secret), 'access log must not contain the value');
});
