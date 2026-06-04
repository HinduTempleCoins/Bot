// product-prices.test.mjs — OFFLINE tests for the product price-comparison + price-history module
// (task #236). Injected fetch only — NO network. Exercises normalization + honest ranking + the
// derived good-deal logic + record-only watch + escaping + disclosure.
// Run: node --test integrations/soapbox/product-prices.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareProduct, priceHistory, computeDeal, trackPrice, affiliateOut, renderPage, rankOffers, dataNote,
} from './product-prices.mjs';

// a stub fetch returning JSON `body` with ok=true; or ok=false when `ok:false` passed.
function stubFetch(body, { ok = true } = {}) {
  return async () => ({ ok, json: async () => body });
}
const throwFetch = async () => { throw new Error('network down'); };

test('compareProduct: normalizes cross-retailer offers to the uniform shape', async () => {
  const body = {
    offers: [
      { retailer: 'amazon', title: 'Widget', price: 29.99, url: 'https://amazon.com/w', inStock: true },
      { merchant: 'Walmart', name: 'Widget', amount: 27.5, link: 'https://walmart.com/w', availability: 'In Stock' },
    ],
  };
  const out = await compareProduct({ query: 'widget' }, { fetch: stubFetch(body) });
  assert.equal(out.length, 2);
  for (const o of out) {
    assert.ok(typeof o.retailer === 'string');
    assert.ok(typeof o.title === 'string');
    assert.ok(typeof o.price === 'number');
    assert.ok(typeof o.url === 'string' && o.url);
    assert.equal(typeof o.inStock, 'boolean');
    assert.ok(typeof o.asOf === 'string' && o.asOf);
  }
});

test('compareProduct: soft-fails to [] on bad input / failed response / thrown fetch', async () => {
  assert.deepEqual(await compareProduct({ query: '' }, { fetch: stubFetch({ offers: [] }) }), []);
  assert.deepEqual(await compareProduct({}, {}), []);
  assert.deepEqual(await compareProduct({ query: 'x' }, { fetch: stubFetch({}, { ok: false }) }), []);
  assert.deepEqual(await compareProduct({ query: 'x' }, { fetch: throwFetch }), []);
  assert.deepEqual(await compareProduct({ query: 'x' }, { fetch: stubFetch({ offers: [] }) }), []);
});

test('ranking orders by availability then PRICE, not commission', async () => {
  const body = {
    offers: [
      { retailer: 'amazon', price: 50, url: 'https://a.com', inStock: true },   // pricey but high "commission"
      { retailer: 'walmart', price: 20, url: 'https://w.com', inStock: true },   // cheapest
      { retailer: 'target', price: 10, url: 'https://t.com', inStock: false },   // cheapest overall but OOS
    ],
  };
  const out = await compareProduct({ query: 'thing' }, { fetch: stubFetch(body) });
  // in-stock first, cheapest-in-stock leads; OOS (even if cheapest) goes last.
  assert.equal(out[0].retailer, 'walmart');
  assert.equal(out[1].retailer, 'amazon');
  assert.equal(out[2].retailer, 'target');
  assert.equal(out[2].inStock, false);
});

test('rankOffers is pure and stable on ties', () => {
  const offers = [
    { retailer: 'a', price: 10, inStock: true },
    { retailer: 'b', price: 10, inStock: true },
    { retailer: 'c', price: 5, inStock: true },
  ];
  const ranked = rankOffers(offers);
  assert.equal(ranked[0].retailer, 'c');
  assert.equal(ranked[1].retailer, 'a'); // tie at 10 keeps input order
  assert.equal(ranked[2].retailer, 'b');
  assert.equal(offers[0].retailer, 'a', 'input not mutated');
});

test('priceHistory: computes low/high/current from the series', async () => {
  const body = { history: [
    { t: '2026-01-01', price: 100 },
    { t: '2026-02-01', price: 80 },
    { t: '2026-03-01', price: 120 },
    { t: '2026-04-01', price: 105 },
  ] };
  const h = await priceHistory({ productId: 'ABC' }, { fetch: stubFetch(body) });
  assert.equal(h.low, 80);
  assert.equal(h.high, 120);
  assert.equal(h.current, 105);
  assert.equal(h.series.length, 4);
});

test('priceHistory: isGoodDeal TRUE at a historic low, FALSE at a high', async () => {
  // current == low → clearly a good deal
  const lowBody = { history: [{ t: 1, price: 200 }, { t: 2, price: 150 }, { t: 3, price: 100 }] };
  const atLow = await priceHistory({ productId: 'p1' }, { fetch: stubFetch(lowBody) });
  assert.equal(atLow.current, 100);
  assert.equal(atLow.isGoodDeal, true);

  // current == high → not a deal
  const highBody = { history: [{ t: 1, price: 100 }, { t: 2, price: 150 }, { t: 3, price: 200 }] };
  const atHigh = await priceHistory({ productId: 'p2' }, { fetch: stubFetch(highBody) });
  assert.equal(atHigh.current, 200);
  assert.equal(atHigh.isGoodDeal, false);
});

test('computeDeal: pure good-deal band logic (near-low yes, mid no, flat never)', () => {
  // range 10..110 ($100), band 10% → within $10 of the low (i.e. <= 20) is a deal.
  assert.equal(computeDeal([{ price: 110 }, { price: 10 }, { price: 15 }]).isGoodDeal, true);   // current 15 near low 10
  assert.equal(computeDeal([{ price: 10 }, { price: 110 }, { price: 60 }]).isGoodDeal, false);  // current 60 mid-range
  assert.equal(computeDeal([{ price: 42 }, { price: 42 }]).isGoodDeal, false);                  // flat → never a deal
  const empty = computeDeal([]);
  assert.equal(empty.low, null);
  assert.equal(empty.isGoodDeal, false);
});

test('priceHistory: soft-fails to a shaped result (no throw)', async () => {
  const shaped = await priceHistory({ productId: 'x' }, { fetch: throwFetch });
  assert.equal(shaped.low, null);
  assert.equal(shaped.high, null);
  assert.equal(shaped.current, null);
  assert.equal(shaped.isGoodDeal, false);
  assert.deepEqual(shaped.series, []);
  const noId = await priceHistory({}, {});
  assert.equal(noId.isGoodDeal, false);
});

test('trackPrice: returns a record-only watch record', () => {
  const w = trackPrice({ productId: 'SKU-1', targetPrice: 19.99 });
  assert.equal(w.ok, true);
  assert.equal(w.kind, 'price-watch');
  assert.equal(w.productId, 'SKU-1');
  assert.equal(w.targetPrice, 19.99);
  assert.ok(typeof w.createdAt === 'string');
  assert.match(w.note, /no external call|no data/i);
});

test('trackPrice: soft-fails on bad input', () => {
  assert.equal(trackPrice({ targetPrice: 10 }).ok, false);
  assert.equal(trackPrice({ productId: 'x' }).ok, false);
  assert.equal(trackPrice({ productId: 'x', targetPrice: -5 }).ok, false);
  assert.equal(trackPrice({ productId: 'x', targetPrice: 'abc' }).ok, false);
});

test('affiliateOut: plain url + not-configured when env unset / unknown retailer', () => {
  delete process.env.IMPACT_PARTNER_ID;
  const a = affiliateOut('amazon', 'https://amazon.com/x');
  assert.equal(a.configured, false);
  assert.equal(a.url, 'https://amazon.com/x'); // plain, untagged
  assert.match(String(a.reason), /not configured/i);
  assert.ok(a.disclosure);

  const u = affiliateOut('not-a-retailer', 'https://x.com');
  assert.equal(u.configured, false);
  assert.equal(u.url, 'https://x.com');
});

test('renderPage: escapes a malicious title and shows the disclosure', () => {
  const html = renderPage({
    query: 'widget <x>',
    offers: [{ retailer: 'amazon', retailerLabel: 'Amazon', title: '<script>alert(1)</script>', price: 9.99, url: 'https://a.com/x"onmouseover=1', inStock: true, asOf: '2026-06-04T00:00:00Z' }],
    history: { low: 5, high: 20, current: 6, isGoodDeal: true, series: [{ price: 20 }, { price: 6 }] },
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'title is escaped');
  assert.ok(html.includes('ftc-disclosure'), 'disclosure paragraph present');
  assert.ok(html.includes('pp-deal-good'), 'good-deal badge shown');
  assert.ok(html.includes('data-sparkline'), 'sparkline data present');
});

test('renderPage: handles empty data without throwing', () => {
  const html = renderPage({});
  assert.ok(html.includes('No offers found.'));
  assert.ok(html.includes('ftc-disclosure'));
});

test('dataNote: present with the honest-ranking + no-data-selling stance', () => {
  const n = dataNote();
  assert.ok(n.what && n.offers && n.history && n.ranking && n.disclosure && n.privacy);
  assert.match(n.ranking, /never by commission/i);
  assert.match(n.privacy, /never sell/i);
});
