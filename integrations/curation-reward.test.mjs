// curation-reward.test.mjs — offline tests for the Hive-style curation reward calculator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  curationWindowFactor,
  splitCurationReward,
  renderCurationTable,
} from './curation-reward.mjs';

// ── esc ──────────────────────────────────────────────────────────────────────────────────
test('esc escapes HTML metacharacters and handles null', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

// ── curationWindowFactor ───────────────────────────────────────────────────────────────────
test('curationWindowFactor: floor at t=0, ramps linearly to 1 at window end', () => {
  assert.equal(curationWindowFactor(0), 0.15);                 // default floor
  assert.equal(curationWindowFactor(300), 1);                  // window close
  assert.equal(curationWindowFactor(9999), 1);                 // past close → flat 1
  // midpoint: 0.15 + 0.85 * 0.5 = 0.575
  assert.ok(Math.abs(curationWindowFactor(150) - 0.575) < 1e-12);
});

test('curationWindowFactor: monotonic non-decreasing within the window', () => {
  let prev = -1;
  for (let t = 0; t <= 300; t += 30) {
    const f = curationWindowFactor(t);
    assert.ok(f >= prev, `factor should not decrease at t=${t}`);
    assert.ok(f >= 0.15 && f <= 1, `factor in [floor,1] at t=${t}`);
    prev = f;
  }
});

test('curationWindowFactor: custom window and floor', () => {
  assert.equal(curationWindowFactor(0, { windowSec: 60, floor: 0.5 }), 0.5);
  assert.equal(curationWindowFactor(60, { windowSec: 60, floor: 0.5 }), 1);
  assert.equal(curationWindowFactor(30, { windowSec: 60, floor: 0 }), 0.5);
});

test('curationWindowFactor: soft-fail on garbage / degenerate inputs', () => {
  assert.equal(curationWindowFactor(-100), 0.15);              // negative time → t=0
  assert.equal(curationWindowFactor(NaN), 0.15);               // non-finite → t=0
  assert.equal(curationWindowFactor(100, { windowSec: 0 }), 1);     // degenerate window → 1
  assert.equal(curationWindowFactor(100, { windowSec: -5 }), 1);    // negative window → 1
  assert.equal(curationWindowFactor(0, { floor: -1 }), 0);     // floor clamped to 0
  assert.equal(curationWindowFactor(0, { floor: 5 }), 1);      // floor clamped to 1
});

// ── splitCurationReward: happy path ────────────────────────────────────────────────────────
test('splitCurationReward: equal stakes, later voters earn more, sums to total', () => {
  const votes = [
    { voter: 'alice', stake: 1000, secondsSincePost: 0 },    // factor 0.15
    { voter: 'bob',   stake: 1000, secondsSincePost: 300 },  // factor 1.0
  ];
  const out = splitCurationReward({ totalReward: 100, votes });
  assert.equal(out.length, 2);
  // bob (factor 1) should out-earn alice (factor 0.15)
  assert.ok(out[1].share > out[0].share);
  // weights 0.15 : 1.0  →  shares ~13.04 : ~86.96
  assert.ok(Math.abs(out[0].share - 13.04347826) < 1e-6);
  assert.ok(Math.abs(out[1].share - 86.95652174) < 1e-6);
  const sum = out.reduce((a, r) => a + r.share, 0);
  assert.ok(Math.abs(sum - 100) < 1e-8, `sum=${sum}`);
});

test('splitCurationReward: shares sum EXACTLY to total via largest-remainder rounding', () => {
  // 3 voters, a total that does not divide evenly at 8dp.
  const votes = [
    { voter: 'a', stake: 1, secondsSincePost: 300 },
    { voter: 'b', stake: 1, secondsSincePost: 300 },
    { voter: 'c', stake: 1, secondsSincePost: 300 },
  ];
  const out = splitCurationReward({ totalReward: 100, votes });
  const sum = out.reduce((a, r) => a + r.share, 0);
  assert.equal(Math.round(sum * 1e8), Math.round(100 * 1e8), `sum=${sum}`);
  // each ~33.333..., one gets the extra unit
  for (const r of out) assert.ok(r.share > 33.3 && r.share < 33.4);
});

test('splitCurationReward: proportional to stake when timing is equal', () => {
  const votes = [
    { voter: 'big',   stake: 3000, secondsSincePost: 300 },
    { voter: 'small', stake: 1000, secondsSincePost: 300 },
  ];
  const out = splitCurationReward({ totalReward: 100, votes });
  assert.ok(Math.abs(out[0].share - 75) < 1e-8);
  assert.ok(Math.abs(out[1].share - 25) < 1e-8);
});

test('splitCurationReward: output order matches surviving input order', () => {
  const votes = [
    { voter: 'z', stake: 10, secondsSincePost: 300 },
    { voter: 'a', stake: 10, secondsSincePost: 300 },
  ];
  const out = splitCurationReward({ totalReward: 50, votes });
  assert.deepEqual(out.map((r) => r.voter), ['z', 'a']);
});

// ── splitCurationReward: soft-fail / edge ───────────────────────────────────────────────────
test('splitCurationReward: empty / garbage votes -> []', () => {
  assert.deepEqual(splitCurationReward({ totalReward: 100, votes: [] }), []);
  assert.deepEqual(splitCurationReward({ totalReward: 100, votes: null }), []);
  assert.deepEqual(splitCurationReward({ totalReward: 100 }), []);
  assert.deepEqual(splitCurationReward(), []);
});

test('splitCurationReward: non-finite / non-positive stakes are dropped', () => {
  const votes = [
    { voter: 'good', stake: 1000, secondsSincePost: 300 },
    { voter: 'nan',  stake: NaN,  secondsSincePost: 300 },
    { voter: 'neg',  stake: -50,  secondsSincePost: 300 },
    { voter: 'zero', stake: 0,    secondsSincePost: 300 },
    null,
    'garbage',
  ];
  const out = splitCurationReward({ totalReward: 100, votes });
  assert.equal(out.length, 1);
  assert.equal(out[0].voter, 'good');
  assert.ok(Math.abs(out[0].share - 100) < 1e-8);
});

test('splitCurationReward: totalReward <= 0 / non-finite -> zeros for survivors', () => {
  const votes = [
    { voter: 'a', stake: 100, secondsSincePost: 300 },
    { voter: 'b', stake: 100, secondsSincePost: 300 },
  ];
  for (const bad of [0, -10, NaN, undefined, 'x']) {
    const out = splitCurationReward({ totalReward: bad, votes });
    assert.equal(out.length, 2);
    for (const r of out) assert.equal(r.share, 0);
  }
});

test('splitCurationReward: missing secondsSincePost treated as t=0 (floor factor), still valid split', () => {
  const votes = [
    { voter: 'a', stake: 100 },              // no timing → t=0
    { voter: 'b', stake: 100 },
  ];
  const out = splitCurationReward({ totalReward: 100, votes });
  // equal stake + equal (floor) factor → equal shares summing to 100
  const sum = out.reduce((a, r) => a + r.share, 0);
  assert.ok(Math.abs(sum - 100) < 1e-8);
  assert.ok(Math.abs(out[0].share - out[1].share) < 1e-8);
});

// ── renderCurationTable ────────────────────────────────────────────────────────────────────
test('renderCurationTable: renders rows + total, escapes voter names', () => {
  const out = splitCurationReward({
    totalReward: 100,
    votes: [
      { voter: '<b>x</b>', stake: 1000, secondsSincePost: 300 },
      { voter: 'y',        stake: 1000, secondsSincePost: 300 },
    ],
  });
  const md = renderCurationTable(out);
  assert.ok(md.includes('| voter | share |'));
  assert.ok(md.includes('&lt;b&gt;x&lt;/b&gt;'));        // escaped
  assert.ok(!md.includes('<b>x</b>'));                    // raw not present
  assert.ok(md.includes('**total**'));
  assert.ok(md.includes('100.00000000'));                 // total renders at 8dp
});

test('renderCurationTable: soft-fail on empty / garbage -> header-only table', () => {
  assert.ok(renderCurationTable([]).includes('_(none)_'));
  assert.ok(renderCurationTable(null).includes('_(none)_'));
  assert.ok(renderCurationTable('garbage').includes('_(none)_'));
});
