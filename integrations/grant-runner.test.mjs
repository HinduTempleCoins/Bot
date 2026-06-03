// grant-runner.test.mjs — offline tests for the capability-grant runner (queue #76).
// node --test integrations/grant-runner.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  issueGrant,
  checkGrant,
  useGrant,
  revoke,
  isRevoked,
  redactGrant,
  __setClock,
  __setActionRunner,
  __reset,
} from './grant-runner.mjs';

function freshGrant(over = {}) {
  return issueGrant({
    subject: 'hathor',
    capability: 'GEMINI_KEY',
    scopes: ['llm:compose'],
    ttlMs: 60_000,
    max_uses: 2,
    ...over,
  });
}

test('issue -> use happy path increments uses', async () => {
  __reset();
  const g = freshGrant();
  assert.equal(g.uses, 0);
  const out = await useGrant(g, { capability: 'GEMINI_KEY', scope: 'llm:compose', action: 'compose' });
  assert.deepEqual(out, { ok: true, ran: true, capability: 'GEMINI_KEY', scope: 'llm:compose' });
  assert.equal(g.uses, 1);
});

test('expired grant throws (clock advanced)', async () => {
  __reset();
  let t = 1_000;
  __setClock(() => t);
  const g = freshGrant({ ttlMs: 5_000 });
  // before expiry -> ok
  assert.equal(checkGrant(g, { capability: 'GEMINI_KEY', scope: 'llm:compose' }), true);
  t += 6_000; // now past expiresAt
  assert.throws(() => checkGrant(g, { capability: 'GEMINI_KEY', scope: 'llm:compose' }), /expired/);
  await assert.rejects(useGrant(g, { capability: 'GEMINI_KEY', scope: 'llm:compose' }), /expired/);
});

test('over-scope throws', async () => {
  __reset();
  const g = freshGrant();
  await assert.rejects(useGrant(g, { capability: 'GEMINI_KEY', scope: 'llm:withdraw' }), /scope/);
  assert.equal(g.uses, 0, 'a denied use must not be counted');
});

test('capability mismatch throws', async () => {
  __reset();
  const g = freshGrant();
  await assert.rejects(useGrant(g, { capability: 'TWILIO_KEY', scope: 'llm:compose' }), /capability mismatch/);
});

test('max_uses exhaustion throws on the next use', async () => {
  __reset();
  const g = freshGrant({ max_uses: 2 });
  await useGrant(g, { capability: 'GEMINI_KEY', scope: 'llm:compose' });
  await useGrant(g, { capability: 'GEMINI_KEY', scope: 'llm:compose' });
  assert.equal(g.uses, 2);
  await assert.rejects(useGrant(g, { capability: 'GEMINI_KEY', scope: 'llm:compose' }), /exhausted/);
});

test('revoke then use throws', async () => {
  __reset();
  const g = freshGrant();
  assert.equal(isRevoked(g.id), false);
  revoke(g.id);
  assert.equal(isRevoked(g.id), true);
  await assert.rejects(useGrant(g, { capability: 'GEMINI_KEY', scope: 'llm:compose' }), /revoked/);
});

test('the injected action runner NEVER receives a secret field', async () => {
  __reset();
  let seenArg = null;
  __setActionRunner(async (arg) => { seenArg = arg; return { ok: true, ran: true }; });
  const g = freshGrant();
  await useGrant(g, { capability: 'GEMINI_KEY', scope: 'llm:compose', action: 'compose' });
  assert.ok(seenArg && typeof seenArg === 'object');
  // The arg must carry capability + scope (+ the action label) and NOTHING resembling a secret.
  const keys = Object.keys(seenArg).sort();
  assert.deepEqual(keys, ['action', 'capability', 'scope']);
  for (const k of keys) {
    assert.ok(!/secret|key|wif|password|token|plaintext/i.test(k), `runner arg leaked a secret-shaped key: ${k}`);
  }
  // And there must be no secret VALUE smuggled in either — only the cap NAME, scope, action label.
  assert.equal(seenArg.capability, 'GEMINI_KEY');
  assert.equal(seenArg.scope, 'llm:compose');
});

test('redactGrant has no secret keys', () => {
  __reset();
  const g = freshGrant();
  const r = redactGrant(g);
  const keys = Object.keys(r);
  for (const k of keys) {
    assert.ok(!/secret|wif|password|plaintext/i.test(k), `redactGrant exposed a secret-shaped key: ${k}`);
  }
  // capability is present but it is a NAME (reference), never key material.
  assert.equal(r.capability, 'GEMINI_KEY');
  assert.equal(r.revoked, false);
  // No surprise extra fields beyond the documented safe view.
  assert.deepEqual(
    keys.sort(),
    ['capability', 'expiresAt', 'id', 'issuedAt', 'kind', 'max_uses', 'revoked', 'scopes', 'subject', 'uses'],
  );
});

test('input validation throws on bad issueGrant args', () => {
  __reset();
  assert.throws(() => issueGrant({ capability: 'X', ttlMs: 1, max_uses: 1 }), /subject/);
  assert.throws(() => issueGrant({ subject: 's', ttlMs: 1, max_uses: 1 }), /capability/);
  assert.throws(() => issueGrant({ subject: 's', capability: 'X', ttlMs: 0, max_uses: 1 }), /ttlMs/);
  assert.throws(() => issueGrant({ subject: 's', capability: 'X', ttlMs: 1, max_uses: 0 }), /max_uses/);
});
