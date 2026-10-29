// metals-market.test.mjs — OFFLINE. No network, no keys. Injected fetch only.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  CHARTS, chartSvg, hasChart, marketPageHtml, arcPath,
  SPOT, RATIO, ANNUAL, YEAR0, years, changeBetween, decades,
  SILVER_DEMAND, SILVERWARE_TONS, SILVERWARE_YEARS, SILVERWARE_GLOBAL, silverwareShares, TON_TO_MOZ,
  fetchSpot, __setFetch,
} from './metals-market.mjs';

const ALL = Object.keys(CHARTS);

test('every registered panel renders a non-trivial SVG', () => {
  assert.ok(ALL.length >= 9, 'the board has all its panels');
  for (const n of ALL) {
    const s = chartSvg(n);
    assert.match(s, /^<svg xmlns=/, `${n} starts as an svg`);
    assert.match(s, /<\/svg>$/, `${n} is closed`);
    assert.ok(s.length > 1200, `${n} is not a stub (${s.length} bytes)`);
  }
});

test('⚠ no panel leaks a JSX brace, NaN, undefined or Infinity into the markup', () => {
  // the exact class of bug that shipped a literal stroke={INK} into the ratio dial
  for (const n of ALL) {
    const s = chartSvg(n);
    assert.doesNotMatch(s, /=\{/, `${n} has a JSX-style attribute`);
    assert.doesNotMatch(s, /NaN|undefined|Infinity/, `${n} has a non-finite number`);
    assert.doesNotMatch(s, /="\s*"/, `${n} has an empty attribute`);
  }
});

test('⚠ a negative daily move prints its sign — red alone is not a minus', () => {
  const s = chartSvg('metals-board');
  assert.ok(SPOT.gold.day < 0, 'fixture precondition: gold fell that day');
  assert.match(s, /−\$11\.33/, 'the loss is signed');
  assert.doesNotMatch(s, />\$11\.33</, 'and never printed bare');
});

test('an unknown chart name is empty, not a throw', () => {
  assert.equal(chartSvg('no-such-panel'), '');
  assert.equal(chartSvg(), '');
  assert.equal(hasChart('metals-board'), true);
  assert.equal(hasChart('nope'), false);
});

test('nothing is drawn outside its own viewBox', () => {
  for (const n of ALL) {
    const s = chartSvg(n);
    const [, w, h] = s.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/).map(Number);
    for (const m of s.matchAll(/\sy="(-?\d+(?:\.\d+)?)"/g)) {
      assert.ok(Number(m[1]) >= -2 && Number(m[1]) <= h + 2, `${n}: y=${m[1]} outside 0..${h}`);
    }
    for (const m of s.matchAll(/\sx="(-?\d+(?:\.\d+)?)"/g)) {
      assert.ok(Number(m[1]) >= -2 && Number(m[1]) <= w + 2, `${n}: x=${m[1]} outside 0..${w}`);
    }
  }
});


test('⚠ no label runs off the edge of its panel', () => {
  // the viewBox test above checks COORDINATES; this checks TEXT EXTENT, which is how a legend note
  // ran past the right edge of the demand donut and got clipped mid-word.
  for (const n of ALL) {
    const s = chartSvg(n);
    const [, W] = s.match(/viewBox="0 0 (\d+(?:\.\d+)?) /).map(Number);
    for (const m of s.matchAll(/<text x="(-?[\d.]+)"[^>]*text-anchor="(\w+)"[^>]*font-size="([\d.]+)"[^>]*>([^<]*)<\/text>/g)) {
      const [, x, anchor, size, label] = m;
      const w = label.length * Number(size) * 0.58;          // generous for a proportional face
      const left = anchor === 'start' ? Number(x) : anchor === 'end' ? Number(x) - w : Number(x) - w / 2;
      assert.ok(left + w <= W + 6, `${n}: "${label}" ends at ${Math.round(left + w)} past width ${W}`);
      assert.ok(left >= -6, `${n}: "${label}" starts at ${Math.round(left)}`);
    }
  }
});

test('the assembled page carries every panel once', () => {
  const html = marketPageHtml();
  assert.equal((html.match(/<figure/g) || []).length, ALL.length);
  assert.match(html, /data-asof="2026-10-28"/);
});

// ── the numbers ───────────────────────────────────────────────────────────────────────────────────
test('the stated gold/silver ratio agrees with the two prices on the same board', () => {
  const derived = SPOT.gold.price / SPOT.silver.price;
  assert.ok(Math.abs(derived - RATIO.now) < 0.1, `${derived.toFixed(2)} vs stated ${RATIO.now}`);
});

test('an approximate price is flagged and carries no invented daily move', () => {
  for (const m of ['platinum', 'palladium', 'copper']) {
    assert.equal(SPOT[m].approx, true, `${m} is labelled approximate`);
    assert.equal(SPOT[m].day, undefined, `${m} has no fabricated tick`);
  }
  for (const m of ['gold', 'silver']) {
    assert.ok(!SPOT[m].approx && Number.isFinite(SPOT[m].day), `${m} is a verified quote`);
  }
});

test('the annual series are complete, aligned and positive', () => {
  const n = ANNUAL.gold.length;
  assert.equal(n, 66);
  assert.equal(years()[0], YEAR0);
  assert.equal(years()[n - 1], 2025);
  for (const [k, v] of Object.entries(ANNUAL)) {
    assert.equal(v.length, n, `${k} is the same length`);
    assert.ok(v.every((x) => Number.isFinite(x) && x > 0), `${k} is all positive finite`);
  }
});

test('changeBetween is a real compound calculation', () => {
  const c = changeBetween('gold', 1970, 1980);
  assert.ok(c.totalPct > 1500, 'gold did what it did in the 1970s');
  // the CAGR must actually reproduce the total
  assert.ok(Math.abs(Math.pow(1 + c.cagrPct / 100, 10) - (1 + c.totalPct / 100)) < 1e-6);
  assert.equal(changeBetween('nope', 1970, 1980), null);
});

test('decades are computed, cover 1960 to the 2020s, and the last one is short', () => {
  const d = decades('silver');
  assert.equal(d[0].label, '1960s');
  assert.equal(d[d.length - 1].label, '2020s');
  assert.equal(d[d.length - 1].to, 2025, 'the current decade is not fabricated out to 2029');
});

test('silver demand components sum to the stated total', () => {
  const t = SILVER_DEMAND.reduce((a, [, v]) => a + v, 0);
  assert.ok(Math.abs(t - 1113) <= 2, `components sum to ${t}`);
});

// ── silverware ────────────────────────────────────────────────────────────────────────────────────
test('⚠ silverware tons reproduce the survey’s own million-ounce total', () => {
  // an independent check on the unit conversion: 1,717 t must come back as 55.2 Moz
  const moz = silverwareShares().reduce((a, r) => a + r.moz, 0);
  assert.ok(Math.abs(moz - 55.2) < 0.15, `${moz.toFixed(2)} Moz vs the survey's 55.2`);
});

test('country shares are a real distribution and India dominates', () => {
  const sh = silverwareShares();
  assert.ok(Math.abs(sh.reduce((a, r) => a + r.sharePct, 0) - 100) < 1e-6);
  assert.equal(sh[0].name, 'India');
  assert.ok(sh[0].sharePct > 60);
  const us = sh.find((r) => r.name === 'United States');
  assert.ok(us.sharePct < 3, 'the American table is a rounding error');
});

test('⚠ the US series is FLAT — the panel’s headline claim, asserted', () => {
  const us = SILVERWARE_TONS.find(([n]) => n === 'United States')[1];
  assert.equal(us.length, SILVERWARE_YEARS.length);
  assert.ok(Math.max(...us) - Math.min(...us) <= 5, 'ten years inside a five-ton band');
});

test('every country row is aligned to the year axis', () => {
  for (const [name, v] of SILVERWARE_TONS) {
    assert.equal(v.length, SILVERWARE_YEARS.length, `${name} row length`);
    assert.ok(v.every((x) => Number.isFinite(x) && x >= 0), `${name} values`);
  }
});

test('⚠ the global silverware series omits 2024 on purpose', () => {
  const ys = SILVERWARE_GLOBAL.map(([y]) => y);
  assert.ok(!ys.includes(2024), 'forecast and outturn disagree, so no number is plotted');
  assert.deepEqual(ys, [2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023]);
});

test('the global series is NOT a monotonic decline — the honest shape', () => {
  const v = SILVERWARE_GLOBAL.map(([, x]) => x);
  const falling = v.every((x, i) => i === 0 || x <= v[i - 1]);
  assert.equal(falling, false, 'claiming a glide path would misstate the data');
});

test('the ton-to-ounce constant is the real one', () => {
  assert.ok(Math.abs(TON_TO_MOZ * 1e6 - 32150.7) < 0.1);
});

// ── arcs ──────────────────────────────────────────────────────────────────────────────────────────
test('arcPath closes, and a donut differs from a pie', () => {
  const donut = arcPath(100, 100, 80, 40, 0, 1.2);
  const pie = arcPath(100, 100, 80, 0, 0, 1.2);
  assert.match(donut, /^M[\d.\- ]+A.*Z$/s);
  assert.match(pie, /^M100 100 L/, 'a pie wedge starts at the centre');
  assert.notEqual(donut, pie);
  assert.doesNotMatch(donut + pie, /NaN/);
});

test('an arc past a half-turn sets the large-arc flag', () => {
  assert.match(arcPath(0, 0, 10, 5, 0, Math.PI * 1.5), /A10 10 0 1 1/);
  assert.match(arcPath(0, 0, 10, 5, 0, Math.PI * 0.5), /A10 10 0 0 1/);
});

// ── the optional live reader ──────────────────────────────────────────────────────────────────────
test('fetchSpot averages the gold proxies and reads silver', async () => {
  __setFetch(async () => ({ json: async () => ({
    'pax-gold': { usd: 4066.14 }, 'tether-gold': { usd: 4059.84 }, 'kinesis-silver': { usd: 53.91 },
  }) }));
  const r = await fetchSpot();
  assert.ok(Math.abs(r.gold - 4062.99) < 0.01, 'two proxies averaged');
  assert.equal(r.silver, 53.91);
  __setFetch(null);
});

test('fetchSpot soft-fails to null and never throws', async () => {
  __setFetch(async () => { throw new Error('ENOTFOUND'); });
  assert.equal(await fetchSpot(), null);
  __setFetch(async () => ({ json: async () => ({}) }));
  assert.equal(await fetchSpot(), null, 'an empty body is null, not zeroes');
  __setFetch(null);
});

test('the panels need no network at all', async () => {
  __setFetch(async () => { throw new Error('the board must not call out'); });
  for (const n of ALL) assert.ok(chartSvg(n).length > 1200);
  __setFetch(null);
});
