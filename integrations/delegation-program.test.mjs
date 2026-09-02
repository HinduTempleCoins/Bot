// delegation-program.test.mjs — offline. `node --test`. Deterministic reward math.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accrue, ledger, joinLink, inviteMessage, upsertDelegation, distributeRewards, PROGRAM } from './delegation-program.mjs';
// The Nutbox invariant: a membership change SETTLES accrual first (upsertDelegation calls accrue), so the
// time-weighted math stays exact across changes. Tests exercise that path, not a single accrue over a change.

const T0 = 1_700_000_000_000;
const DAY = 86400000;

test('pro-rata: over one day, emission splits by vest share; deterministic', () => {
  let s = { delegations: [
    { account: 'alice', vests: 300, since: T0, earned: 0, lastAccrued: T0 },
    { account: 'bob', vests: 100, since: T0, earned: 0, lastAccrued: T0 },
  ] };
  s = accrue(s, { now: T0 + DAY, emissionPerDay: 1000 });
  const byA = Object.fromEntries(s.delegations.map((d) => [d.account, d.earned]));
  assert.equal(byA.alice, 750);   // 300/400 * 1000
  assert.equal(byA.bob, 250);     // 100/400 * 1000
  // same inputs → same outputs
  let s2 = accrue({ delegations: [
    { account: 'alice', vests: 300, since: T0, earned: 0, lastAccrued: T0 },
    { account: 'bob', vests: 100, since: T0, earned: 0, lastAccrued: T0 },
  ] }, { now: T0 + DAY, emissionPerDay: 1000 });
  assert.equal(s2.delegations[0].earned, 750);
});

test('time-weighted: a delegation that joins halfway earns for half the interval', () => {
  // alice alone for the first half; `late` joins at the midpoint (upsertDelegation settles alice first).
  let s = { delegations: [{ account: 'alice', vests: 100, since: T0, earned: 0, lastAccrued: T0 }] };
  s = upsertDelegation(s, { account: 'late', vests: 100, now: T0 + DAY / 2, emissionPerDay: 1000 });
  s = accrue(s, { now: T0 + DAY, emissionPerDay: 1000 });
  const byA = Object.fromEntries(s.delegations.map((d) => [d.account, d.earned]));
  // first half: only alice → 500 to alice; second half: both 100 vests → 250 each
  assert.equal(byA.alice, 750);
  assert.equal(byA.late, 250);
});

test('empty pool accrues nothing and does not divide by zero', () => {
  const s = accrue({ delegations: [] }, { now: T0 + DAY });
  assert.equal(s.totalVests, 0);
  assert.deepEqual(s.delegations, []);
});

test('ledger projects share + earned, sorted by stake', () => {
  const s = { delegations: [
    { account: 'small', vests: 50, since: T0, earned: 0, lastAccrued: T0 },
    { account: 'whale', vests: 950, since: T0, earned: 0, lastAccrued: T0 },
  ] };
  const l = ledger(s, { now: T0 + DAY });
  assert.equal(l.delegators[0].account, 'whale');   // sorted desc
  assert.equal(l.delegators[0].share, 0.95);
  assert.equal(l.token, PROGRAM.token);
});

test('joinLink points at the Signer delegation approval (user consent), carries pool/vests/ref', () => {
  const link = joinLink({ vests: 5000, referrer: 'Hathor', signerUrl: 'https://signer.example' });
  assert.match(link, /^https:\/\/signer\.example\/delegate\?/);
  assert.match(link, /to=hathor/);
  assert.match(link, /vests=5000/);
  assert.match(link, /ref=hathor/);
});

test('inviteMessage is honest (mining + reversible) and includes the link', () => {
  const m = inviteMessage({ vests: 1000, referrer: 'x', signerUrl: 'https://signer.example' });
  assert.match(m, new RegExp(PROGRAM.token));
  assert.match(m, /undelegate|whenever/i);   // says it can be undone
  assert.match(m, /signer\.example\/delegate/);
});

test('UPVU payout: pool earnings split pro-rata minus operator cut (they get MELEK + other tokens)', () => {
  const s = { delegations: [
    { account: 'whale', vests: 900, since: T0, earned: 0, lastAccrued: T0 },
    { account: 'minnow', vests: 100, since: T0, earned: 0, lastAccrued: T0 },
  ] };
  const r = distributeRewards(s, { MELEK: 100, KULA: 10 }, { operatorCutBps: 1000, now: T0 + DAY });
  assert.equal(r.operatorCut.MELEK, 10);          // 10% cut
  assert.equal(r.operatorCut.KULA, 1);
  const byAcct = Object.fromEntries(r.payouts.map((p) => [p.account, p.byToken]));
  assert.equal(byAcct.whale.MELEK, 81);           // 90% of 90 (post-cut pool)
  assert.equal(byAcct.minnow.MELEK, 9);           // 10% of 90
  assert.equal(byAcct.whale.KULA, 8.1);
  assert.ok(r.transfers.length >= 4);             // MELEK+KULA to each of 2 delegators
});

test('distributeRewards with no delegators routes the whole earning to the operator', () => {
  const r = distributeRewards({ delegations: [] }, { MELEK: 50 }, { now: T0 });
  assert.equal(r.operatorCut.MELEK, 50);
  assert.deepEqual(r.payouts, []);
});

test('a delegation can be sourced from a SCOT-token stake, not just MELEK vests', () => {
  let s = upsertDelegation({ delegations: [] }, { account: 'dave', vests: 300, source: 'SCOT:PIZZA', now: T0 });
  assert.equal(s.delegations[0].source, 'SCOT:PIZZA');
  assert.equal(s.delegations[0].vests, 300);      // weight is weight, wherever it comes from
});

test('the mining token is SOULAVA (SOUL) by default', () => {
  assert.equal(PROGRAM.token, 'SOUL');
});

test('upsertDelegation adds then updates a delegator', () => {
  let s = upsertDelegation({ delegations: [] }, { account: 'Carol', vests: 200, now: T0 });
  assert.equal(s.delegations[0].account, 'carol');
  assert.equal(s.delegations[0].vests, 200);
  s = upsertDelegation(s, { account: 'carol', vests: 500, now: T0 + DAY });
  assert.equal(s.delegations.length, 1);
  assert.equal(s.delegations[0].vests, 500);
  assert.equal(s.delegations[0].since, T0);   // original join time preserved
});
