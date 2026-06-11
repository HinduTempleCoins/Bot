// siring-model.test.mjs — offline tests for the Siring Model merit math. node --test, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sireScore,
  needinessWeight,
  rankSires,
  REFERENCE_BP,
  MIN_WEIGHT,
} from './siring-model.mjs';

test('constants are sane', () => {
  assert.ok(REFERENCE_BP > 0, 'REFERENCE_BP positive');
  assert.ok(MIN_WEIGHT > 0 && MIN_WEIGHT < 1, 'MIN_WEIGHT in (0,1)');
});

test('sireScore: verbatim formula (usersVoted * bpGained) * needinessWeight', () => {
  assert.equal(sireScore({ usersVoted: 5, bpGained: 4, needinessWeight: 0.5 }), 10);
  assert.equal(sireScore({ usersVoted: 3, bpGained: 10, needinessWeight: 1 }), 30);
  assert.equal(sireScore({ usersVoted: 2, bpGained: 2, needinessWeight: 0.25 }), 1);
});

test('sireScore: missing weight defaults to 1 (raw reach×effect)', () => {
  assert.equal(sireScore({ usersVoted: 6, bpGained: 7 }), 42);
});

test('sireScore: explicit zero weight stays zero', () => {
  assert.equal(sireScore({ usersVoted: 6, bpGained: 7, needinessWeight: 0 }), 0);
});

test('sireScore: soft-fail — missing/NaN/garbage inputs coerce to 0, never throws', () => {
  assert.equal(sireScore(), 0);
  assert.equal(sireScore({}), 0);
  assert.equal(sireScore({ usersVoted: NaN, bpGained: 5, needinessWeight: 1 }), 0);
  assert.equal(sireScore({ usersVoted: 'x', bpGained: undefined, needinessWeight: null }), 0);
  assert.equal(sireScore({ usersVoted: Infinity, bpGained: 5, needinessWeight: 1 }), 0);
  assert.equal(sireScore({ usersVoted: 4, bpGained: 'oops', needinessWeight: 2 }), 0);
});

test('needinessWeight: higher for low-BP accounts, floors at MIN_WEIGHT', () => {
  const fresh = needinessWeight({ bp: 0 });
  const whale = needinessWeight({ bp: REFERENCE_BP });
  const big = needinessWeight({ bp: REFERENCE_BP * 5 });
  assert.equal(fresh, 1, 'BP 0 → weight 1');
  assert.equal(whale, MIN_WEIGHT, 'BP at reference → MIN_WEIGHT');
  assert.equal(big, MIN_WEIGHT, 'BP above reference clamps to MIN_WEIGHT');
  assert.ok(fresh > whale, 'needier account weighted higher');
});

test('needinessWeight: monotonic decreasing in BP within range', () => {
  const a = needinessWeight({ bp: 1000 });
  const b = needinessWeight({ bp: 5000 });
  assert.ok(a > b, 'lower BP → higher weight');
  assert.ok(a <= 1 && b >= MIN_WEIGHT);
});

test('needinessWeight: accepts a raw BP number', () => {
  assert.equal(needinessWeight(0), 1);
  assert.equal(needinessWeight(REFERENCE_BP), MIN_WEIGHT);
});

test('needinessWeight: activity discounts an active beneficiary', () => {
  const idle = needinessWeight({ bp: 1000, activity: 0 });
  const active = needinessWeight({ bp: 1000, activity: 500 });
  assert.ok(active < idle, 'activity lowers neediness');
  assert.ok(active >= MIN_WEIGHT, 'never below floor');
});

test('needinessWeight: soft-fail on garbage → maximally needy (1), never throws', () => {
  assert.equal(needinessWeight(undefined), 1);
  assert.equal(needinessWeight(null), 1);
  assert.equal(needinessWeight({}), 1);
  assert.equal(needinessWeight({ bp: NaN }), 1);
  assert.equal(needinessWeight('garbage'), 1);
  assert.equal(needinessWeight({ bp: -50 }), 1, 'negative BP clamps up to 1');
});

test('rankSires: sorts desc by score, returns {account, score}', () => {
  const out = rankSires([
    { account: 'alice', usersVoted: 2, bpGained: 2, needinessWeight: 0.5 }, // 2
    { account: 'bob', usersVoted: 5, bpGained: 4, needinessWeight: 0.5 },   // 10
    { account: 'carol', usersVoted: 3, bpGained: 3, needinessWeight: 1 },   // 9
  ]);
  assert.deepEqual(out.map((r) => r.account), ['bob', 'carol', 'alice']);
  assert.deepEqual(out.map((r) => r.score), [10, 9, 2]);
  assert.deepEqual(Object.keys(out[0]).sort(), ['account', 'score']);
});

test('rankSires: derives weight from beneficiary when needinessWeight absent', () => {
  const out = rankSires([
    { account: 'needy', usersVoted: 1, bpGained: 100, beneficiary: { bp: 0 } },        // *1
    { account: 'whale', usersVoted: 1, bpGained: 100, beneficiary: { bp: REFERENCE_BP } }, // *MIN_WEIGHT
  ]);
  assert.equal(out[0].account, 'needy', 'lifting a needy account outranks lifting a whale');
  assert.equal(out[0].score, 100);
  assert.ok(out[1].score < out[0].score);
});

test('rankSires: un-weighted records use raw reach×effect (weight 1)', () => {
  const out = rankSires([
    { account: 'x', usersVoted: 2, bpGained: 3 }, // 6
    { account: 'y', usersVoted: 1, bpGained: 4 }, // 4
  ]);
  assert.deepEqual(out.map((r) => r.score), [6, 4]);
});

test('rankSires: soft-fail — non-array / empty / malformed → [], never throws', () => {
  assert.deepEqual(rankSires(undefined), []);
  assert.deepEqual(rankSires(null), []);
  assert.deepEqual(rankSires('nope'), []);
  assert.deepEqual(rankSires({}), []);
  assert.deepEqual(rankSires([]), []);
});

test('rankSires: tolerates null/garbage records and missing accounts', () => {
  const out = rankSires([null, {}, { usersVoted: 9, bpGained: 9, needinessWeight: 1 }]);
  assert.equal(out.length, 3);
  assert.equal(out[0].score, 81, 'valid record ranks first');
  assert.ok(out.every((r) => typeof r.account === 'string' && typeof r.score === 'number'));
});
