import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSnapshot,
  capWeights,
  allocate,
  summary,
  esc,
} from './airdrop-plan.mjs';

test('normalizeSnapshot drops invalid and coerces weight to BigInt', () => {
  const out = normalizeSnapshot([
    { account: 'alice', weight: 100 },
    { account: 'bob', balance: '250' },
    { account: 'carol', amount: 50 },
    { account: '  dave  ', weight: 10 }, // trimmed
    { account: '', weight: 999 }, // blank account dropped
    { account: 'eve', weight: 0 }, // zero weight dropped
    { account: 'frank', weight: -5 }, // negative dropped
    { account: 'gina', weight: NaN }, // NaN dropped
    { weight: 5 }, // missing account dropped
    null, // garbage dropped
    'nope', // garbage dropped
  ]);
  assert.deepEqual(
    out.map((h) => h.account),
    ['alice', 'bob', 'carol', 'dave'],
  );
  for (const h of out) assert.equal(typeof h.weight, 'bigint');
  assert.equal(out[0].weight, 100n);
  assert.equal(out[1].weight, 250n); // string balance
  assert.equal(out[2].weight, 50n); // amount fallback
});

test('soft-fail: empty / garbage snapshot -> empty allocations + full dust', () => {
  for (const holders of [[], null, undefined, 'garbage', [null, 'x', {}]]) {
    const plan = allocate({ holders, totalAirdrop: 1000n, scheme: 'proportional' });
    assert.deepEqual(plan.allocations, []);
    assert.equal(plan.distributed, 0n);
    assert.equal(plan.dust, 1000n);
  }
});

test('proportional split is by weight and sums exactly (largest-remainder)', () => {
  const holders = [
    { account: 'whale', weight: 700 },
    { account: 'mid', weight: 200 },
    { account: 'small', weight: 100 },
  ];
  const plan = allocate({ holders, totalAirdrop: 1000n, scheme: 'proportional' });
  const byAcct = Object.fromEntries(plan.allocations.map((a) => [a.account, a.units]));
  assert.equal(byAcct.whale, 700n);
  assert.equal(byAcct.mid, 200n);
  assert.equal(byAcct.small, 100n);
  // ordering: whale > mid > small
  assert.deepEqual(
    plan.allocations.map((a) => a.account),
    ['whale', 'mid', 'small'],
  );
  const sum = plan.allocations.reduce((s, a) => s + a.units, 0n);
  assert.equal(sum, 1000n);
  assert.equal(plan.distributed, 1000n);
  assert.equal(plan.dust, 0n);
});

test('largest-remainder rounding makes the sum exact even with awkward weights', () => {
  // 3 equal-ish holders splitting 100 units -> floor gives 33 each, 1 leftover.
  const holders = [
    { account: 'a', weight: 1 },
    { account: 'b', weight: 1 },
    { account: 'c', weight: 1 },
  ];
  const plan = allocate({ holders, totalAirdrop: 100n, scheme: 'proportional' });
  const sum = plan.allocations.reduce((s, a) => s + a.units, 0n);
  assert.equal(sum, 100n);
  // Units are 34/33/33 in some order — total exact, none missing.
  const units = plan.allocations.map((a) => a.units).sort();
  assert.deepEqual(units, [33n, 33n, 34n]);
  assert.equal(plan.dust, 0n);
});

test('equal scheme gives everyone the same share (within 1 unit dust rounding)', () => {
  const holders = [
    { account: 'whale', weight: 1000000 },
    { account: 'mid', weight: 500 },
    { account: 'small', weight: 1 },
  ];
  const plan = allocate({ holders, totalAirdrop: 99n, scheme: 'equal' });
  const units = plan.allocations.map((a) => a.units);
  // 99 / 3 = 33 each, exact.
  assert.deepEqual(units, [33n, 33n, 33n]);
  const sum = units.reduce((s, u) => s + u, 0n);
  assert.equal(sum, 99n);
});

test('quadratic uses integer sqrt of weight — dampens the whale vs proportional', () => {
  const holders = [
    { account: 'whale', weight: 10000 }, // sqrt 100
    { account: 'small', weight: 100 }, //  sqrt 10
  ];
  const prop = allocate({ holders, totalAirdrop: 1100n, scheme: 'proportional' });
  const quad = allocate({ holders, totalAirdrop: 1100n, scheme: 'quadratic' });

  const propWhale = prop.allocations.find((a) => a.account === 'whale').units;
  const quadWhale = quad.allocations.find((a) => a.account === 'whale').units;
  const quadSmall = quad.allocations.find((a) => a.account === 'small').units;

  // proportional: whale gets 10000/10100 of 1100 ~= 1089.
  assert.ok(propWhale > 1000n);
  // quadratic: weights 100 vs 10 of 110 total -> whale 1000, small 100.
  assert.equal(quadWhale, 1000n);
  assert.equal(quadSmall, 100n);
  // whale's share strictly shrinks under quadratic.
  assert.ok(quadWhale < propWhale);
  // ordering still whale first (more sqrt-weight).
  assert.equal(quad.allocations[0].account, 'whale');
  // exact sum.
  const sum = quad.allocations.reduce((s, a) => s + a.units, 0n);
  assert.equal(sum, 1100n);
});

test('capWeights applies a whale cap', () => {
  const holders = [
    { account: 'whale', weight: 900 },
    { account: 'a', weight: 50 },
    { account: 'b', weight: 50 },
  ];
  // total 1000, cap at 50% -> 500. whale clamps from 900 to 500.
  const capped = capWeights(holders, 0.5);
  const byAcct = Object.fromEntries(capped.map((h) => [h.account, h.weight]));
  assert.equal(byAcct.whale, 500n);
  assert.equal(byAcct.a, 50n); // under cap, untouched
  assert.equal(byAcct.b, 50n);
  for (const h of capped) assert.equal(typeof h.weight, 'bigint');

  // Feeding capped weights to a proportional allocate reduces the whale's cut.
  const uncappedPlan = allocate({ holders, totalAirdrop: 1000n, scheme: 'proportional' });
  const cappedPlan = allocate({ holders: capped, totalAirdrop: 1000n, scheme: 'proportional' });
  const uw = uncappedPlan.allocations.find((a) => a.account === 'whale').units;
  const cw = cappedPlan.allocations.find((a) => a.account === 'whale').units;
  assert.ok(cw < uw);
});

test('capWeights with no/degenerate fraction returns normalized snapshot unchanged', () => {
  const holders = [
    { account: 'whale', weight: 900 },
    { account: 'a', weight: 100 },
  ];
  for (const frac of [0, -1, NaN, 1, 2]) {
    const out = capWeights(holders, frac);
    assert.equal(out.find((h) => h.account === 'whale').weight, 900n);
  }
  assert.deepEqual(capWeights([], 0.5), []);
});

test('minThreshold drops sub-minimum dust recipients into dust', () => {
  const holders = [
    { account: 'whale', weight: 980 },
    { account: 'tiny1', weight: 10 },
    { account: 'tiny2', weight: 10 },
  ];
  // proportional of 1000: whale 980, tiny 10 each.
  const noMin = allocate({ holders, totalAirdrop: 1000n, scheme: 'proportional' });
  assert.equal(noMin.allocations.length, 3);
  assert.equal(noMin.dust, 0n);

  const withMin = allocate({
    holders,
    totalAirdrop: 1000n,
    scheme: 'proportional',
    minThreshold: 50,
  });
  // tinies (10 < 50) dropped; only whale survives.
  assert.deepEqual(
    withMin.allocations.map((a) => a.account),
    ['whale'],
  );
  assert.equal(withMin.distributed, 980n);
  assert.equal(withMin.dust, 20n); // the two tinies rolled into dust
  // invariant: distributed + dust === totalAirdrop
  assert.equal(withMin.distributed + withMin.dust, 1000n);
});

test('BigInt purity: all unit fields are BigInt, pct is Number', () => {
  const holders = [
    { account: 'a', weight: 3 },
    { account: 'b', weight: 1 },
  ];
  const plan = allocate({ holders, totalAirdrop: 100n, scheme: 'proportional' });
  assert.equal(typeof plan.distributed, 'bigint');
  assert.equal(typeof plan.dust, 'bigint');
  for (const a of plan.allocations) {
    assert.equal(typeof a.units, 'bigint');
    assert.equal(typeof a.pct, 'number');
    assert.ok(a.pct >= 0 && a.pct <= 100);
  }
});

test('unknown scheme falls back to proportional', () => {
  const holders = [{ account: 'a', weight: 1 }];
  const plan = allocate({ holders, totalAirdrop: 10n, scheme: 'bogus' });
  assert.equal(plan.scheme, 'proportional');
  assert.equal(plan.allocations[0].units, 10n);
});

test('soft-fail: negative / NaN / string totalAirdrop coerced safely', () => {
  const holders = [{ account: 'a', weight: 1 }];
  assert.equal(allocate({ holders, totalAirdrop: -5, scheme: 'equal' }).dust, 0n);
  assert.equal(allocate({ holders, totalAirdrop: NaN, scheme: 'equal' }).distributed, 0n);
  // all-digits string is accepted.
  const s = allocate({ holders, totalAirdrop: '42', scheme: 'equal' });
  assert.equal(s.allocations[0].units, 42n);
  // calling with no args at all never throws.
  const z = allocate();
  assert.deepEqual(z.allocations, []);
  assert.equal(z.dust, 0n);
});

test('summary is esc()-safe and BigInt-typed', () => {
  const plan = allocate({
    holders: [{ account: '<b>x&y</b>', weight: 1 }],
    totalAirdrop: 100n,
    scheme: 'proportional',
  });
  const s = summary(plan);
  assert.equal(s.recipients, 1);
  assert.equal(typeof s.distributed, 'bigint');
  assert.equal(typeof s.dust, 'bigint');
  assert.ok(!s.allocations[0].account.includes('<'));
  assert.equal(s.allocations[0].account, '&lt;b&gt;x&amp;y&lt;/b&gt;');
  // degenerate plan -> safe empty summary, never throws.
  const empty = summary(null);
  assert.deepEqual(empty.allocations, []);
  assert.equal(empty.recipients, 0);
  assert.equal(empty.distributed, 0n);
});

test('esc escapes the five HTML-significant chars', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});
