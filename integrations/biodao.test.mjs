import { test } from 'node:test';
import assert from 'node:assert';
import {
  createProposal, vote, tally, quorumRule, recordPayment,
  isTier1Scope, DEFAULTS, __reset, getProposal,
} from './biodao.mjs';

test('quorumRule is pure: required = totalStake * fraction, met flag', () => {
  const r = quorumRule(1000, { quorumFraction: 0.2 });
  assert.equal(r.required, 200);
  assert.equal(r.met, undefined); // no participated → no met flag
  assert.equal(quorumRule(1000, { quorumFraction: 0.2, participated: 250 }).met, true);
  assert.equal(quorumRule(1000, { quorumFraction: 0.2, participated: 150 }).met, false);
  assert.equal(quorumRule(0, {}).required, 0);
});

test('createProposal validates inputs', () => {
  __reset();
  assert.throws(() => createProposal({ requester: 'r', dataScope: 'x' }), /title/);
  assert.throws(() => createProposal({ title: 't', dataScope: 'x' }), /requester/);
  assert.throws(() => createProposal({ title: 't', requester: 'r', dataScope: [] }), /dataScope/);
  assert.throws(() => createProposal({ title: 't', requester: 'r', dataScope: 'x', fundingAsk: -5 }), /fundingAsk/);
});

test('Tier-1 neural scope gets a higher pass threshold than ordinary data', () => {
  __reset();
  const ordinary = createProposal({ title: 'metab', requester: 'r', dataScope: ['metabolomics'] });
  const neural = createProposal({ title: 'eeg', requester: 'r', dataScope: ['neural', 'eeg'] });
  assert.equal(ordinary.tier1, false);
  assert.equal(neural.tier1, true);
  assert.equal(ordinary.passThreshold, DEFAULTS.passThreshold);
  assert.equal(neural.passThreshold, DEFAULTS.tier1PassThreshold);
  assert.ok(neural.passThreshold > ordinary.passThreshold);
  assert.ok(isTier1Scope('bci-stream'));
  assert.ok(!isTier1Scope('wearable-hr'));
});

test('tally is stake-weighted (voting power == held stake)', () => {
  __reset();
  const p = createProposal({ title: 't', requester: 'r', dataScope: 'genomics' });
  vote(p.id, { voter: 'whale', stake: 300_000, support: true });
  vote(p.id, { voter: 'minnow', stake: 1_000, support: false });
  const t = tally(p.id);
  assert.equal(t.forStake, 300_000);
  assert.equal(t.againstStake, 1_000);
  assert.equal(t.participated, 301_000);
});

test('re-voting replaces a voter (power never doubled)', () => {
  __reset();
  const p = createProposal({ title: 't', requester: 'r', dataScope: 'genomics' });
  vote(p.id, { voter: 'alice', stake: 100_000, support: false });
  vote(p.id, { voter: 'alice', stake: 100_000, support: true }); // flips
  const t = tally(p.id);
  assert.equal(t.forStake, 100_000);
  assert.equal(t.againstStake, 0);
});

test('quorum threshold gates passing', () => {
  __reset();
  // total = 1,000,000; quorum 20% = 200,000 needed.
  const p = createProposal({ title: 't', requester: 'r', dataScope: 'genomics' });
  vote(p.id, { voter: 'alice', stake: 150_000, support: true }); // below quorum
  let t = tally(p.id);
  assert.equal(t.quorumRequired, 200_000);
  assert.equal(t.quorumMet, false);
  assert.equal(t.passed, false);
  // add enough to clear quorum, still majority for
  vote(p.id, { voter: 'bob', stake: 60_000, support: true });
  t = tally(p.id);
  assert.equal(t.quorumMet, true);
  assert.equal(t.passed, true);
});

test('ordinary proposal: simple majority passes, tie/minority fails', () => {
  __reset();
  const p = createProposal({ title: 't', requester: 'r', dataScope: 'genomics' });
  vote(p.id, { voter: 'a', stake: 120_000, support: true });
  vote(p.id, { voter: 'b', stake: 120_000, support: false }); // exact tie → not > 50%
  let t = tally(p.id);
  assert.equal(t.quorumMet, true);
  assert.equal(t.passed, false, 'tie should not pass (needs > threshold)');
  vote(p.id, { voter: 'c', stake: 10_000, support: true });
  t = tally(p.id);
  assert.equal(t.passed, true, 'majority for should pass');
});

test('Tier-1 needs super-majority: a bare majority that passes ordinary FAILS Tier-1', () => {
  __reset();
  // 55% support: passes ordinary (>50%), fails Tier-1 (<66.7%).
  const ordinary = createProposal({ title: 'o', requester: 'r', dataScope: 'genomics' });
  vote(ordinary.id, { voter: 'a', stake: 220_000, support: true });
  vote(ordinary.id, { voter: 'b', stake: 180_000, support: false });
  const ot = tally(ordinary.id);
  assert.ok(Math.abs(ot.supportRatio - 0.55) < 1e-9);
  assert.equal(ot.passed, true);

  const neural = createProposal({ title: 'n', requester: 'r', dataScope: ['neural'] });
  vote(neural.id, { voter: 'a', stake: 220_000, support: true });
  vote(neural.id, { voter: 'b', stake: 180_000, support: false });
  const nt = tally(neural.id);
  assert.ok(Math.abs(nt.supportRatio - 0.55) < 1e-9);
  assert.equal(nt.tier1, true);
  assert.equal(nt.passed, false, 'Tier-1 needs >66.7%, 55% must fail');

  // bump Tier-1 over the super-majority bar → passes
  vote(neural.id, { voter: 'c', stake: 200_000, support: true }); // now 420k/600k = 70%
  const nt2 = tally(neural.id);
  assert.ok(nt2.supportRatio > DEFAULTS.tier1PassThreshold);
  assert.equal(nt2.passed, true);
});

test('treasury is receive-only and accumulates buyer payments', () => {
  __reset();
  const p = createProposal({ title: 't', requester: 'buyer', dataScope: 'genomics', fundingAsk: 50_000 });
  recordPayment(p.id, { from: 'buyer', amount: 30_000 });
  recordPayment(p.id, { from: 'buyer', amount: 20_000 });
  assert.equal(tally(p.id).treasuryBalance, 50_000);
  assert.equal(getProposal(p.id).treasury.receipts.length, 2);
  assert.throws(() => recordPayment(p.id, { from: 'buyer', amount: -5 }), /amount/);
  assert.throws(() => recordPayment(p.id, { from: 'buyer', amount: 0 }), /amount/);
  // no withdrawal API exists → balance can never decrease
  assert.equal(tally(p.id).treasuryBalance, 50_000);
});

test('vote validation: bad stake / unknown proposal rejected', () => {
  __reset();
  const p = createProposal({ title: 't', requester: 'r', dataScope: 'genomics' });
  assert.throws(() => vote(p.id, { voter: 'a', stake: 0, support: true }), /stake/);
  assert.throws(() => vote(p.id, { voter: 'a', stake: -10, support: true }), /stake/);
  assert.throws(() => vote(p.id, { voter: '', stake: 10, support: true }), /voter/);
  assert.throws(() => vote(p.id, { voter: 'a', stake: 9_999_999, support: true }), /exceeds/);
  assert.throws(() => vote('nope', { voter: 'a', stake: 10, support: true }), /unknown proposal/);
});
