// bio-consent-broker.test.mjs — OFFLINE tests for the per-query consent + pay-the-owner
// broker (queue #160). Run: node --test integrations/bio-consent-broker.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  requestAccess, decide, payoutIntent, auditLog,
  assertReceiveOnly, MOVES_VALUE, __reset,
  TIER1_NEURAL, TIER2_BEHAVIORAL,
} from './bio-consent-broker.mjs';

beforeEach(() => __reset());

test('requestAccess creates a PENDING request (no access granted yet)', () => {
  const r = requestAccess({ requester: 'lab-x', ownerId: 'alice', scope: 'vr', dataTier: 'TIER2_BEHAVIORAL' });
  assert.equal(r.status, 'pending');
  assert.equal(r.requester, 'lab-x');
  assert.equal(r.ownerId, 'alice');
  assert.equal(r.tier, TIER2_BEHAVIORAL);
  assert.equal(r.payoutIntent, null);
});

test('requestAccess requires requester and ownerId', () => {
  assert.throws(() => requestAccess({ ownerId: 'alice' }), /requester/i);
  assert.throws(() => requestAccess({ requester: 'lab-x' }), /ownerId/i);
});

test('unknown/unspecified tier fail-safes to Tier-1 (higher protection)', () => {
  assert.equal(requestAccess({ requester: 'l', ownerId: 'a' }).tier, TIER1_NEURAL);
  assert.equal(requestAccess({ requester: 'l', ownerId: 'a', dataTier: 'mystery' }).tier, TIER1_NEURAL);
});

test('DENY BY DEFAULT: no access without an explicit owner approval', () => {
  const r = requestAccess({ requester: 'lab-x', ownerId: 'alice', scope: 'vr', dataTier: 'TIER2_BEHAVIORAL' });
  const d = decide(r.id, { owner: 'alice' }); // approve omitted
  assert.equal(d.granted, false);
  assert.equal(d.payoutIntent, null);
  assert.equal(d.reason, 'not-approved');
});

test('DENY: a non-owner cannot approve', () => {
  const r = requestAccess({ requester: 'lab-x', ownerId: 'alice', scope: 'vr', dataTier: 'TIER2_BEHAVIORAL' });
  const d = decide(r.id, { approve: true, owner: 'mallory' });
  assert.equal(d.granted, false);
  assert.equal(d.reason, 'not-owner');
});

test('Tier-1 NEURAL is DENIED without explicit neural opt-in (even if approved)', () => {
  const r = requestAccess({ requester: 'lab-x', ownerId: 'alice', scope: 'eeg', dataTier: 'TIER1_NEURAL' });
  const d = decide(r.id, { approve: true, owner: 'alice' });
  assert.equal(d.granted, false);
  assert.equal(d.reason, 'tier1-needs-neural-opt-in');
  assert.equal(d.payoutIntent, null);
});

test('Tier-1 NEURAL is GRANTED with explicit neural opt-in', () => {
  const r = requestAccess({ requester: 'lab-x', ownerId: 'alice', scope: 'eeg', dataTier: 'TIER1_NEURAL' });
  const d = decide(r.id, { approve: true, owner: 'alice', neuralOptIn: true, amount: 7 });
  assert.equal(d.granted, true);
  assert.ok(d.payoutIntent);
  assert.equal(d.payoutIntent.amount, 7);
});

test('owner approval (Tier-2) yields a SIMULATED receive-only payout intent', () => {
  const r = requestAccess({ requester: 'lab-x', ownerId: 'alice', scope: 'vr', dataTier: 'TIER2_BEHAVIORAL' });
  const d = decide(r.id, { approve: true, owner: 'alice', amount: 5, to: 'alice' });
  assert.equal(d.granted, true);
  assert.equal(d.payoutIntent.direction, 'receive');
  assert.equal(d.payoutIntent.to, 'alice');
  assert.equal(d.payoutIntent.amount, 5);
  assert.equal(d.payoutIntent.simulated, true);
  assert.equal(d.payoutIntent.signed, false);
});

test('payout defaults the recipient to the owner', () => {
  const r = requestAccess({ requester: 'lab-x', ownerId: 'bob', scope: 'vr', dataTier: 'TIER2_BEHAVIORAL' });
  const d = decide(r.id, { approve: true, owner: 'bob', amount: 3 });
  assert.equal(d.payoutIntent.to, 'bob');
});

test('payoutIntent is RECEIVE-ONLY and dry-run by default', () => {
  const p = payoutIntent({ amount: 10, to: 'alice' });
  assert.equal(p.direction, 'receive');
  assert.equal(p.simulated, true);
  assert.equal(p.signed, false);
  assert.ok(!('from' in p), 'no source-of-funds field — cannot author a debit');
});

test('payoutIntent records an injected signer but still does not move value here', () => {
  let called = false;
  const p = payoutIntent({ amount: 2, to: 'alice', sign: (m) => { called = true; return 'SIG:' + m.id; } });
  assert.equal(called, true);
  assert.equal(p.signed, true);
  assert.ok(p.signature.startsWith('SIG:'));
  assert.equal(p.direction, 'receive', 'still receive-only even when signed');
});

test('payoutIntent rejects bad inputs', () => {
  assert.throws(() => payoutIntent({ amount: 5 }), /to/i);
  assert.throws(() => payoutIntent({ to: 'alice', amount: 0 }), /positive/i);
  assert.throws(() => payoutIntent({ to: 'alice', amount: -1 }), /positive/i);
  assert.throws(() => payoutIntent({ to: 'alice' }), /positive/i);
});

test('a request cannot be decided twice', () => {
  const r = requestAccess({ requester: 'lab-x', ownerId: 'alice', scope: 'vr', dataTier: 'TIER2_BEHAVIORAL' });
  decide(r.id, { approve: true, owner: 'alice', amount: 1 });
  assert.throws(() => decide(r.id, { approve: true, owner: 'alice' }), /already granted/i);
});

test('decide throws on unknown requestId', () => {
  assert.throws(() => decide('nope', { approve: true, owner: 'alice' }), /unknown/i);
});

test('auditLog records request / grant / deny / payout actions', () => {
  const r1 = requestAccess({ requester: 'lab-x', ownerId: 'alice', scope: 'vr', dataTier: 'TIER2_BEHAVIORAL' });
  decide(r1.id, { approve: true, owner: 'alice', amount: 4 });
  const r2 = requestAccess({ requester: 'lab-x', ownerId: 'alice', scope: 'vr' });
  decide(r2.id, { owner: 'alice' });
  const actions = auditLog().log.map((e) => e.action);
  assert.ok(actions.includes('request'));
  assert.ok(actions.includes('decide.granted'));
  assert.ok(actions.includes('decide.denied'));
  assert.ok(actions.includes('payout-intent'));
  assert.equal(auditLog().byStatus.granted, 1);
  assert.equal(auditLog().byStatus.denied, 1);
});

test('HARD invariant: broker never moves value (receive-only)', () => {
  assert.equal(MOVES_VALUE, false);
  assert.equal(assertReceiveOnly(), true);
  import('./bio-consent-broker.mjs').then((mod) => {
    const names = Object.keys(mod).map((n) => n.toLowerCase());
    for (const v of ['send', 'transfer', 'broadcast', 'withdraw', 'debit', 'spend']) {
      assert.ok(!names.some((n) => n.includes(v)), `no '${v}' export`);
    }
  });
});
