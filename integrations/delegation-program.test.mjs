// delegation-program.test.mjs — offline. `node --test`. Deterministic reward math.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accrue, ledger, joinLink, inviteMessage, upsertDelegation, distributeRewards, PROGRAM,
  voteEntitlement, voteEntitlementFor, MAX_VOTE_WEIGHT } from './delegation-program.mjs';
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
  assert.match(link, /to=kula/);
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
  assert.equal(PROGRAM.token, 'SOULA');
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

// ── the curation vote a delegation earns ────────────────────────────────────────────────────────

test('vote entitlement is pro-rata, capped at a full vote, and floored so a small stake still votes', () => {
  const st = { delegations: [{ account: 'Alice', vests: 9000 }, { account: 'bob', vests: 1000 }, { account: 'tiny', vests: 1 }] };
  const e = voteEntitlement(st, { votesPerDay: 10, postsPerWeek: 3 });
  assert.equal(e.totalVests, 10001);
  assert.equal(e.weeklyCapacityBps, 10 * 7 * MAX_VOTE_WEIGHT);
  // sorted by weight lent, biggest first, and accounts normalised
  assert.deepEqual(e.rows.map((r) => r.account), ['alice', 'bob', 'tiny']);
  // a share big enough to exceed a full vote is clamped to one, never above
  for (const r of e.rows) assert.ok(r.weightBps <= MAX_VOTE_WEIGHT, `${r.account} over a full vote`);
  // the smallest delegator gets a visible vote rather than a rounding error
  const tiny = e.rows.find((r) => r.account === 'tiny');
  assert.equal(tiny.weightBps, 100);
  assert.ok(tiny.fullVotesPerWeek > 0);
});

test('vote entitlement scales with the pool: the same stake is worth less as others join', () => {
  const alone = voteEntitlementFor({ delegations: [{ account: 'me', vests: 100 }] }, 'me', { votesPerDay: 1, postsPerWeek: 10 });
  const shared = voteEntitlementFor({ delegations: [{ account: 'me', vests: 100 }, { account: 'other', vests: 900 }] }, 'me', { votesPerDay: 1, postsPerWeek: 10 });
  assert.ok(shared.weightBps < alone.weightBps, 'dilution must show up in the weight');
  assert.equal(shared.sharePct, 10);
});

test('vote entitlement soft-fails: no delegations, junk vests and unknown accounts return nothing', () => {
  assert.deepEqual(voteEntitlement(null).rows, []);
  assert.deepEqual(voteEntitlement({}).rows, []);
  assert.deepEqual(voteEntitlement({ delegations: [{ account: 'a', vests: 'abc' }, { account: 'b', vests: -5 }] }).rows, []);
  assert.equal(voteEntitlementFor({ delegations: [{ account: 'a', vests: 1 }] }, 'nobody'), null);
});

test('vote entitlement is deterministic for the same input', () => {
  const st = { delegations: [{ account: 'a', vests: 7 }, { account: 'b', vests: 13 }] };
  assert.deepEqual(voteEntitlement(st), voteEntitlement(st));
});

test('house delegation funds the pool without eating the members\' votes', () => {
  // Hathor lending 78,000 MP must not drop a real member from a full vote to nothing.
  const st = { delegations: [{ account: 'hathor', vests: 78000 }, { account: 'udabeu', vests: 11 }] };
  const withHouse = voteEntitlementFor(st, 'udabeu', { exclude: ['kula', 'hathor'] });
  assert.equal(withHouse.sharePct, 100, 'the only non-house member holds the whole member share');
  assert.equal(withHouse.weightBps, MAX_VOTE_WEIGHT);
  // and the house gets no row of its own
  assert.equal(voteEntitlementFor(st, 'hathor', { exclude: ['kula', 'hathor'] }), null);
  // without the exclusion the member is diluted to the floor — the behaviour this guards against
  const diluted = voteEntitlementFor(st, 'udabeu', { exclude: [] });
  assert.ok(diluted.weightBps < MAX_VOTE_WEIGHT, 'unexcluded house weight dilutes the member');
});
