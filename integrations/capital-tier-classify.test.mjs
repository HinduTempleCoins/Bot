// capital-tier-classify.test.mjs — offline tests for the capital ROLE tier classifier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TIERS,
  DEFAULT_MAP,
  classify,
  classifyHoldings,
  tierTotals,
  allocationPct,
  advice,
  renderMarkdown,
  esc,
} from './capital-tier-classify.mjs';

test('TIERS + DEFAULT_MAP shape', () => {
  assert.deepEqual(TIERS, ['premium', 'fuel', 'tradeable']);
  assert.equal(DEFAULT_MAP.VKBT, 'premium');
  assert.equal(DEFAULT_MAP.CURE, 'premium');
  assert.equal(DEFAULT_MAP.BLURT, 'fuel');
  assert.equal(DEFAULT_MAP.BBH, 'tradeable');
  assert.equal(DEFAULT_MAP.POB, 'tradeable');
});

test('classify: known symbols map to default tiers (case/space-insensitive)', () => {
  assert.equal(classify('VKBT'), 'premium');
  assert.equal(classify('cure'), 'premium');
  assert.equal(classify(' blurt '), 'fuel');
  assert.equal(classify('BBH'), 'tradeable');
  assert.equal(classify('POB'), 'tradeable');
});

test('classify: unknown symbol → fallback (default tradeable, override honoured)', () => {
  assert.equal(classify('MYSTERY'), 'tradeable');
  assert.equal(classify('MYSTERY', { fallback: 'premium' }), 'premium');
  // garbage fallback is ignored, reverts to tradeable
  assert.equal(classify('MYSTERY', { fallback: 'nonsense' }), 'tradeable');
});

test('classify: override map wins over default', () => {
  const map = { VKBT: 'tradeable', NEWCOIN: 'premium' };
  assert.equal(classify('VKBT', { map }), 'tradeable');
  assert.equal(classify('NEWCOIN', { map }), 'premium');
  // symbol not in override map and not handled → fallback
  assert.equal(classify('CURE', { map }), 'tradeable');
});

test('classify: garbage / empty input → fallback, never throws', () => {
  assert.equal(classify(undefined), 'tradeable');
  assert.equal(classify(null), 'tradeable');
  assert.equal(classify(''), 'tradeable');
  assert.equal(classify(123), 'tradeable'); // coerced to "123", unknown → fallback
  assert.equal(classify('X', { map: null }), 'tradeable');
});

test('classifyHoldings: maps each holding, normalizes amount/valueUsd', () => {
  const rows = classifyHoldings([
    { symbol: 'VKBT', amount: 100, valueUsd: 300 },
    { symbol: 'blurt', amount: 50, valueUsd: 10 },
    { symbol: 'WEIRD', amount: 7 }, // no valueUsd → 0
  ]);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[0], { symbol: 'VKBT', tier: 'premium', amount: 100, valueUsd: 300 });
  assert.equal(rows[1].symbol, 'BLURT');
  assert.equal(rows[1].tier, 'fuel');
  assert.equal(rows[2].tier, 'tradeable');
  assert.equal(rows[2].valueUsd, 0);
});

test('classifyHoldings: drops garbage rows, empty input → []', () => {
  assert.deepEqual(classifyHoldings([]), []);
  assert.deepEqual(classifyHoldings(), []);
  assert.deepEqual(classifyHoldings('nope'), []);
  const rows = classifyHoldings([null, { amount: 5 }, { symbol: '   ' }, { symbol: 'POB', amount: 1 }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].symbol, 'POB');
});

test('tierTotals: counts + value per tier', () => {
  const rows = classifyHoldings([
    { symbol: 'VKBT', amount: 1, valueUsd: 300 },
    { symbol: 'CURE', amount: 1, valueUsd: 100 },
    { symbol: 'BLURT', amount: 1, valueUsd: 20 },
    { symbol: 'BBH', amount: 1, valueUsd: 50 },
    { symbol: 'POB', amount: 1, valueUsd: 30 },
  ]);
  const t = tierTotals(rows);
  assert.deepEqual(t.premium, { count: 2, valueUsd: 400 });
  assert.deepEqual(t.fuel, { count: 1, valueUsd: 20 });
  assert.deepEqual(t.tradeable, { count: 2, valueUsd: 80 });
});

test('tierTotals: empty / garbage → zeros for all tiers', () => {
  const z = tierTotals([]);
  for (const t of TIERS) assert.deepEqual(z[t], { count: 0, valueUsd: 0 });
  assert.deepEqual(tierTotals('garbage').premium, { count: 0, valueUsd: 0 });
});

test('allocationPct: sums to ~100 with value present', () => {
  const rows = classifyHoldings([
    { symbol: 'VKBT', valueUsd: 300 },
    { symbol: 'BLURT', valueUsd: 100 },
    { symbol: 'BBH', valueUsd: 100 },
  ]);
  const pct = allocationPct(rows);
  const sum = pct.premium + pct.fuel + pct.tradeable;
  assert.ok(Math.abs(sum - 100) < 0.5, `pct should sum to ~100, got ${sum}`);
  assert.equal(pct.premium, 60);
});

test('allocationPct: no value → all zeros, never NaN', () => {
  const pct = allocationPct([]);
  assert.deepEqual(pct, { premium: 0, fuel: 0, tradeable: 0 });
  const pct2 = allocationPct(classifyHoldings([{ symbol: 'VKBT', amount: 5 }]));
  assert.deepEqual(pct2, { premium: 0, fuel: 0, tradeable: 0 });
});

test('advice: warns on low fuel below threshold', () => {
  const rows = classifyHoldings([
    { symbol: 'VKBT', valueUsd: 300 },
    { symbol: 'BLURT', valueUsd: 5 },
    { symbol: 'BBH', valueUsd: 50 },
  ]);
  const tips = advice(tierTotals(rows));
  assert.ok(tips.some((t) => /protect fuel/.test(t)), tips.join(' | '));
});

test('advice: warns when no fuel tier at all', () => {
  const rows = classifyHoldings([{ symbol: 'VKBT', valueUsd: 300 }, { symbol: 'BBH', valueUsd: 100 }]);
  const tips = advice(rows); // also accepts classified array
  assert.ok(tips.some((t) => /protect fuel: no fuel-tier/.test(t)));
});

test('advice: warns when premium core too thin and tradeable too heavy', () => {
  const rows = classifyHoldings([
    { symbol: 'VKBT', valueUsd: 10 },
    { symbol: 'BLURT', valueUsd: 30 },
    { symbol: 'BBH', valueUsd: 200 },
  ]);
  const tips = advice(tierTotals(rows));
  assert.ok(tips.some((t) => /grow premium/.test(t)), tips.join(' | '));
  assert.ok(tips.some((t) => /trim tradeable/.test(t)), tips.join(' | '));
});

test('advice: balanced book gives a balanced message', () => {
  const rows = classifyHoldings([
    { symbol: 'VKBT', valueUsd: 500 },
    { symbol: 'CURE', valueUsd: 100 },
    { symbol: 'BLURT', valueUsd: 100 },
    { symbol: 'BBH', valueUsd: 200 },
  ]);
  const tips = advice(tierTotals(rows));
  assert.ok(tips.some((t) => /balanced/.test(t)), tips.join(' | '));
});

test('advice: empty / garbage input → array, never throws', () => {
  assert.ok(Array.isArray(advice([])));
  assert.ok(Array.isArray(advice(undefined)));
  assert.ok(Array.isArray(advice('garbage')));
  assert.ok(advice([]).some((t) => /no valued holdings/.test(t)));
});

test('renderMarkdown: includes rows, allocation, advice; escapes symbols', () => {
  const rows = classifyHoldings([
    { symbol: 'VKBT', amount: 10, valueUsd: 300 },
    { symbol: 'BLURT', amount: 5, valueUsd: 8 },
  ]);
  const md = renderMarkdown(rows);
  assert.match(md, /# Capital Tier Classification/);
  assert.match(md, /VKBT/);
  assert.match(md, /Allocation by value/);
  assert.match(md, /Advice/);
});

test('renderMarkdown: empty input → no-row table, never throws', () => {
  const md = renderMarkdown([]);
  assert.match(md, /_\(none\)_/);
  assert.match(md, /premium/);
});

test('esc: escapes HTML metacharacters', () => {
  assert.equal(esc('<a & "b">'), '&lt;a &amp; &quot;b&quot;&gt;');
  assert.equal(esc(null), '');
});
