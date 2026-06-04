// groceries.test.mjs — OFFLINE tests for the groceries price aggregator (queue task #235).
// All sources are injected via `deps`; no network. Run:
//   node --test integrations/soapbox/groceries.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  productPrices,
  basketCompare,
  weeklyAd,
  priceTrend,
  renderPage,
  dataNote,
} from './groceries.mjs';

const DAY = 24 * 60 * 60 * 1000;

// ── injected offline sources ────────────────────────────────────────────────────────────────
const openPricesSrc = ({ item }) => {
  if (item === 'milk') return [
    { store: 'Kroger', price: 3.49, unit: 'gallon', date: '2026-06-01' },
    { store: 'Walmart', price: 3.29, unit: 'gallon', date: '2026-06-02' },
  ];
  if (item === 'eggs') return [
    { store: 'Kroger', price: 2.99, unit: 'dozen', date: '2026-06-01' },
    { store: 'Walmart', price: 2.79, unit: 'dozen', date: '2026-06-02' },
  ];
  return [];
};

const crowdSrc = ({ item, city }) => {
  if (item === 'milk' && city === 'denver') return [
    { item: 'milk', city: 'denver', price: 3.6, unit: 'gallon', at: Date.now() - 2 * DAY },
    { item: 'milk', city: 'denver', price: 3.4, unit: 'gallon', at: Date.now() - 1 * DAY },
    { item: 'milk', city: 'denver', price: 3.5, unit: 'gallon', at: Date.now() - 0.5 * DAY },
  ];
  return [];
};

const officialSrc = ({ item }) => (item === 'milk'
  ? { value: 3.55, unit: 'gallon', fetched_at: new Date().toISOString() }
  : null);

const deps = { openPrices: openPricesSrc, crowd: crowdSrc, official: officialSrc };

// ── productPrices ─────────────────────────────────────────────────────────────────────────────
test('productPrices blends crowd + open-prices + official with provenance tags', async () => {
  const rows = await productPrices({ item: 'milk', city: 'Denver' }, deps);
  assert.ok(rows.length >= 4, 'should include open-prices stores + crowd + official');
  const sources = new Set(rows.map((r) => r.source));
  assert.ok(sources.has('open-prices'), 'has open-prices lane');
  assert.ok(sources.has('crowdsource'), 'has crowdsource lane');
  assert.ok(sources.has('official'), 'has official lane');
  // every line is provenance-tagged and carries an asOf field
  for (const r of rows) {
    assert.ok(['open-prices', 'crowdsource', 'official', 'fused'].includes(r.source));
    assert.ok('asOf' in r);
    assert.ok(typeof r.store === 'string' && r.store.length);
    assert.ok(r.price > 0);
  }
  // sorted cheapest-first
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].price >= rows[i - 1].price);
});

test('productPrices soft-fails to [] (no item, throwing source)', async () => {
  assert.deepEqual(await productPrices({}, deps), []);
  const boom = { openPrices: () => { throw new Error('net'); }, crowd: () => { throw new Error('net'); }, official: () => { throw new Error('net'); } };
  assert.deepEqual(await productPrices({ item: 'milk', city: 'Denver' }, boom), []);
});

test('productPrices crowd line is robust-aggregated (reuses crowdsource-prices outlierFilter)', async () => {
  // inject an obvious outlier; the reused MAD filter should keep the figure sane (not the 99).
  const poisoned = {
    openPrices: () => [], // keep fully offline (no live fallback fetch)
    official: () => null,
    crowd: () => [
      { item: 'milk', city: 'denver', price: 3.5, at: Date.now() - 3 * DAY },
      { item: 'milk', city: 'denver', price: 3.6, at: Date.now() - 2 * DAY },
      { item: 'milk', city: 'denver', price: 3.4, at: Date.now() - 1 * DAY },
      { item: 'milk', city: 'denver', price: 99, at: Date.now() },
    ],
  };
  const rows = await productPrices({ item: 'milk', city: 'Denver' }, poisoned);
  const crowd = rows.find((r) => r.source === 'crowdsource');
  assert.ok(crowd, 'crowd line present');
  assert.ok(crowd.price < 10, `outlier rejected, got ${crowd.price}`);
});

// ── basketCompare ─────────────────────────────────────────────────────────────────────────────
test('basketCompare totals a basket across stores and flags the cheapest', async () => {
  const res = await basketCompare({ items: ['milk', 'eggs'], city: 'Denver' }, deps);
  assert.equal(res.city, 'denver');
  assert.ok(res.stores.length >= 2, 'multiple stores');
  // Walmart (3.29 + 2.79 = 6.08) should beat Kroger (3.49 + 2.99 = 6.48)
  const walmart = res.stores.find((s) => s.store === 'Walmart');
  const kroger = res.stores.find((s) => s.store === 'Kroger');
  assert.ok(walmart && kroger);
  assert.equal(walmart.total, 6.08);
  assert.equal(kroger.total, 6.48);
  assert.equal(res.cheapest, 'Walmart');
  // each line provenance-tagged
  for (const st of res.stores) for (const l of st.lines) {
    assert.ok(['open-prices', 'crowdsource', 'official', 'fused'].includes(l.source));
    assert.ok('asOf' in l);
  }
});

test('basketCompare soft-fails to a valid empty shape with no items', async () => {
  const res = await basketCompare({ items: [], city: 'Denver' }, deps);
  assert.deepEqual(res.stores, []);
  assert.equal(res.cheapest, null);
  assert.ok(typeof res.asOf === 'string');
});

// ── weeklyAd ──────────────────────────────────────────────────────────────────────────────────
test('weeklyAd returns a windowed link-out (not stored)', () => {
  const ad = weeklyAd('Kroger');
  assert.ok(ad);
  assert.equal(ad.store, 'Kroger');
  assert.match(ad.url, /^https?:\/\//);
  assert.equal(ad.stored, false);
  assert.ok(ad.window && ad.window.from && ad.window.to);
  assert.ok(Date.parse(ad.window.to) > Date.parse(ad.window.from), 'window is forward-looking');
  assert.equal(weeklyAd('NoSuchStore'), null);
  assert.equal(weeklyAd(''), null);
});

// ── priceTrend ────────────────────────────────────────────────────────────────────────────────
test('priceTrend returns a time-ordered series with a direction', async () => {
  const tr = await priceTrend('milk', 'Denver', deps);
  assert.ok(Array.isArray(tr.series));
  assert.ok(tr.series.length >= 2, 'series has points');
  // time-ordered ascending
  for (let i = 1; i < tr.series.length; i++) {
    assert.ok(Date.parse(tr.series[i].at) >= Date.parse(tr.series[i - 1].at));
  }
  assert.ok(['up', 'down', 'flat'].includes(tr.direction));
  assert.ok('change' in tr && typeof tr.asOf === 'string');
});

test('priceTrend soft-fails to an empty series', async () => {
  const tr = await priceTrend('milk', 'Nowhere', { crowd: () => [], openPrices: () => [] });
  assert.deepEqual(tr.series, []);
  assert.equal(tr.direction, 'flat');
});

// ── renderPage ────────────────────────────────────────────────────────────────────────────────
test('renderPage escapes a malicious item name and shows provenance + crowd note', async () => {
  const evil = '<script>alert(1)</script>';
  const data = await basketCompare({ items: [evil, 'milk'], city: 'Denver' }, {
    openPrices: ({ item }) => [{ store: 'EvilMart', price: 1.23, unit: 'each', date: '2026-06-01', _it: item }],
    crowd: () => [],
    official: () => null,
  });
  const html = renderPage(data);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'item name is escaped');
  assert.ok(/badge/.test(html), 'provenance badges rendered');
  assert.ok(/you helped crowdsource/i.test(html), 'crowdsource note present');
  assert.ok(/cheapest/i.test(html), 'cheapest flagged in render');
});

// ── dataNote ──────────────────────────────────────────────────────────────────────────────────
test('dataNote is present with provenance + as-of', () => {
  const n = dataNote();
  assert.ok(Array.isArray(n.sources) && n.sources.length >= 3);
  const ids = n.sources.map((s) => s.id);
  assert.ok(ids.includes('open-prices') && ids.includes('crowdsource') && ids.includes('official'));
  assert.ok(Array.isArray(n.provenanceTags) && n.provenanceTags.includes('open-prices'));
  assert.ok(typeof n.note === 'string' && n.note.length);
  assert.ok(typeof n.asOf === 'string');
});
