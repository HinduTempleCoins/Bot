import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  splitReward,
  distributeCuration,
  validateSplit,
} from './reward-split.mjs';

// ---- splitReward -----------------------------------------------------------

test('splitReward: 50/50 conserves and splits evenly', () => {
  const { author, curators } = splitReward(1000, { authorPct: 50, curationPct: 50 });
  assert.equal(author, 500);
  assert.equal(curators, 500);
  assert.equal(author + curators, 1000);
});

test('splitReward: remainder accrues to author (odd total)', () => {
  const { author, curators } = splitReward(1001, { authorPct: 50, curationPct: 50 });
  assert.equal(curators, 500); // floor(1001 * 0.5) = 500
  assert.equal(author, 501);
  assert.equal(author + curators, 1001);
});

test('splitReward: 75/25 curation split conserves', () => {
  const { author, curators } = splitReward(1000, { authorPct: 75, curationPct: 25 });
  assert.equal(curators, 250);
  assert.equal(author, 750);
  assert.equal(author + curators, 1000);
});

test('splitReward: non-integer total floors and conserves', () => {
  const { author, curators } = splitReward(99.9, { authorPct: 50, curationPct: 50 });
  // total floors to 99; curators = floor(99*0.5)=49; author=50
  assert.equal(author + curators, 99);
  assert.equal(curators, 49);
  assert.equal(author, 50);
});

test('splitReward: soft-fail negative/NaN total clamps to 0', () => {
  assert.deepEqual(splitReward(-100, {}), { author: 0, curators: 0 });
  assert.deepEqual(splitReward(NaN, {}), { author: 0, curators: 0 });
  assert.deepEqual(splitReward('nope', {}), { author: 0, curators: 0 });
  assert.deepEqual(splitReward(undefined, undefined), { author: 0, curators: 0 });
});

test('splitReward: bad percentages fall back to 50/50 and conserve', () => {
  const r = splitReward(1000, { authorPct: -5, curationPct: NaN });
  assert.equal(r.author + r.curators, 1000);
  assert.equal(r.author, 500);
  assert.equal(r.curators, 500);
});

test('splitReward: default percentages applied when omitted', () => {
  const r = splitReward(1000);
  assert.equal(r.author, 500);
  assert.equal(r.curators, 500);
});

// ---- distributeCuration ----------------------------------------------------

test('distributeCuration: proportional to weight*stake, conserves pool', () => {
  const votes = [
    { voter: 'alice', weight: 1, stake: 100 },
    { voter: 'bob', weight: 1, stake: 300 },
  ];
  const out = distributeCuration(400, votes);
  const sum = out.reduce((s, x) => s + x.share, 0);
  assert.equal(sum, 400); // conservation
  assert.equal(out.find((x) => x.voter === 'alice').share, 100);
  assert.equal(out.find((x) => x.voter === 'bob').share, 300);
});

test('distributeCuration: conservation holds for awkward remainders', () => {
  const votes = [
    { voter: 'a', weight: 1, stake: 1 },
    { voter: 'b', weight: 1, stake: 1 },
    { voter: 'c', weight: 1, stake: 1 },
  ];
  const out = distributeCuration(100, votes); // 100/3 each
  const sum = out.reduce((s, x) => s + x.share, 0);
  assert.equal(sum, 100);
  const shares = out.map((x) => x.share).sort();
  assert.deepEqual(shares, [33, 33, 34]); // one gets the extra unit
});

test('distributeCuration: remainder tie-break deterministic by voter name', () => {
  // Equal claims, pool 100, 3 voters -> 34,33,33. The +1 goes to the
  // alphabetically-first voter ("a"), regardless of input order.
  const votes = [
    { voter: 'c', weight: 1, stake: 1 },
    { voter: 'a', weight: 1, stake: 1 },
    { voter: 'b', weight: 1, stake: 1 },
  ];
  const out1 = distributeCuration(100, votes);
  const out2 = distributeCuration(100, votes);
  assert.deepEqual(out1, out2); // determinism
  assert.equal(out1.find((x) => x.voter === 'a').share, 34);
  assert.equal(out1.find((x) => x.voter === 'b').share, 33);
  assert.equal(out1.find((x) => x.voter === 'c').share, 33);
});

test('distributeCuration: output order matches input order', () => {
  const votes = [
    { voter: 'z', weight: 1, stake: 1 },
    { voter: 'a', weight: 1, stake: 1 },
  ];
  const out = distributeCuration(2, votes);
  assert.deepEqual(out.map((x) => x.voter), ['z', 'a']);
  assert.equal(out.reduce((s, x) => s + x.share, 0), 2);
});

test('distributeCuration: zero total weight splits evenly and conserves', () => {
  const votes = [
    { voter: 'a', weight: 0, stake: 0 },
    { voter: 'b', weight: 5, stake: 0 }, // stake 0 -> claim 0
  ];
  const out = distributeCuration(7, votes);
  const sum = out.reduce((s, x) => s + x.share, 0);
  assert.equal(sum, 7); // conservation despite no usable weight
  // even split: floor(7/2)=3 each, remainder 1 to 'a' (first by name)
  assert.equal(out.find((x) => x.voter === 'a').share, 4);
  assert.equal(out.find((x) => x.voter === 'b').share, 3);
});

test('distributeCuration: soft-fail on empty / bad inputs', () => {
  assert.deepEqual(distributeCuration(100, []), []);
  assert.deepEqual(distributeCuration(100, null), []);
  assert.deepEqual(distributeCuration(100, 'nope'), []);
  // zero pool -> zero shares, still one entry per voter
  const out = distributeCuration(0, [{ voter: 'a', weight: 1, stake: 1 }]);
  assert.deepEqual(out, [{ voter: 'a', share: 0 }]);
  // negative pool clamps to 0
  const out2 = distributeCuration(-50, [{ voter: 'a', weight: 1, stake: 1 }]);
  assert.deepEqual(out2, [{ voter: 'a', share: 0 }]);
});

test('distributeCuration: negative weight/stake clamp to 0, never throw', () => {
  const votes = [
    { voter: 'a', weight: -10, stake: 100 }, // weight clamps to 0
    { voter: 'b', weight: 2, stake: 50 },
  ];
  const out = distributeCuration(100, votes);
  assert.equal(out.reduce((s, x) => s + x.share, 0), 100);
  assert.equal(out.find((x) => x.voter === 'a').share, 0);
  assert.equal(out.find((x) => x.voter === 'b').share, 100);
});

test('distributeCuration: missing voter name handled, defaults weight=1 stake=0', () => {
  const out = distributeCuration(10, [{}, {}]);
  // both claim 0 -> even split, conserves
  assert.equal(out.reduce((s, x) => s + x.share, 0), 10);
});

// ---- validateSplit ---------------------------------------------------------

test('validateSplit: valid 50/50', () => {
  assert.deepEqual(validateSplit({ authorPct: 50, curationPct: 50 }), {
    ok: true,
    errors: [],
  });
});

test('validateSplit: valid defaults', () => {
  assert.equal(validateSplit().ok, true);
  assert.equal(validateSplit({}).ok, true);
});

test('validateSplit: sum != 100 fails', () => {
  const r = validateSplit({ authorPct: 60, curationPct: 50 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => /equal 100/.test(e)));
});

test('validateSplit: negative / non-numeric fail and never throw', () => {
  const r = validateSplit({ authorPct: -1, curationPct: 101 });
  assert.equal(r.ok, false);
  assert.ok(r.errors.length >= 1);
  const r2 = validateSplit({ authorPct: 'x', curationPct: 50 });
  assert.equal(r2.ok, false);
});
