import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch, BASES, TOKENS, bidDepth, buildMatrix, render, handler } from './value-matrix.mjs';

// Real VKBT bids, 2026-09-08: three genuine orders plus one floor-parking wall.
const BIDS = [
  { price: '0.00001902', quantity: '17941.03' },
  { price: '0.00001900', quantity: '443.93' },
  { price: '0.00001870', quantity: '444.00' },
  { price: '0.00000001', quantity: '2000000' },
];

function mockFetch({ bids = BIDS, metrics = [], prices = { hive: { usd: 0.0456 } } } = {}) {
  __setFetch(async (url, opts) => {
    if (String(url).includes('coingecko')) {
      return { text: async () => JSON.stringify(prices) };
    }
    const body = JSON.parse(opts.body);
    const table = body.params && body.params.table;
    const result = table === 'buyBook' ? bids : (table === 'metrics' ? metrics : []);
    return { text: async () => JSON.stringify({ result }) };
  });
}

test('bidDepth walks the book to what a seller would ACTUALLY receive', async (t) => {
  t.after(() => __setFetch(null));
  mockFetch();
  const d = await bidDepth('VKBT', 100000);
  // only ~18,829 units have a real bid behind them
  assert.ok(d.filledUnits < 19000, 'cannot fill 100k into this book');
  assert.ok(d.unfilledUnits > 81000, 'the rest finds no bid');
  assert.ok(d.fillProceedsHive < 0.4);
  assert.equal(d.best, 0.00001902);
});

test('the dust wall is excluded from depth — it is not a bid', async (t) => {
  t.after(() => __setFetch(null));
  mockFetch();
  const d = await bidDepth('VKBT', 0);
  assert.equal(d.orders, 3, 'the 0.00000001 x 2,000,000 wall is not counted');
  assert.ok(d.depthHive < 1);
});

test('a small seller fills entirely and gets the top price', async (t) => {
  t.after(() => __setFetch(null));
  mockFetch();
  const d = await bidDepth('VKBT', 1000);
  assert.equal(d.unfilledUnits, 0);
  assert.equal(d.fillPrice, 0.00001902);
});

test('the matrix exposes the gap between the mark and the exit', async (t) => {
  t.after(() => __setFetch(null));
  mockFetch({ metrics: [{ symbol: 'VKBT', highestBid: '0.00001902', lowestAsk: '0.00094500' }] });
  const m = await buildMatrix({ tokens: ['VKBT'], positions: { VKBT: 958842 } });
  const r = m.rows[0];
  assert.ok(r.broken, '50x spread is broken');
  assert.ok(r.markValueHive > 18, 'the book says ~18 HIVE');
  assert.ok(r.fillValueHive < 1, 'a seller would get under 1 HIVE');
  assert.ok(r.markToFillRatio > 40, 'the mark overstates the exit by 40x+');
  assert.ok(r.illiquid);
  assert.ok(r.unfilledUnits > 900000);
});

test('MELEK is reported as having no market price, never given one', async (t) => {
  t.after(() => __setFetch(null));
  mockFetch();
  const m = await buildMatrix({ tokens: ['VKBT'] });
  assert.equal(m.chainPrices.MELEK, null);
  const melek = BASES.find((b) => b.id === 'MELEK');
  assert.match(melek.note, /will not invent one/);
  assert.equal(m.rows[0].inBase.MELEK, null, 'no cell is fabricated from a missing base');
});

test('a missing external price yields null, not a substituted number', async (t) => {
  t.after(() => __setFetch(null));
  mockFetch({ prices: {} });
  const m = await buildMatrix({ tokens: ['VKBT'] });
  assert.equal(m.chainPrices.HIVE, null);
  assert.equal(m.rows[0].inBase.USD, null);
  assert.equal(m.rows[0].inBase.BLURT, null);
  assert.equal(m.chainPrices.USD, 1, 'the dollar is still the dollar');
});

test('render puts the fill next to the mark so they get compared', async (t) => {
  t.after(() => __setFetch(null));
  mockFetch({ metrics: [{ symbol: 'VKBT', highestBid: '0.00001902', lowestAsk: '0.00094500' }] });
  const m = await buildMatrix({ tokens: ['VKBT'], positions: { VKBT: 958842 } });
  const txt = render(m);
  assert.match(txt, /mark is what the book claims, fill is what a seller would get/);
  assert.match(txt, /would fill for/);
  assert.match(txt, /find NO BID AT ALL/);
  assert.match(txt, /overstates the exit by/);
  assert.match(txt, /no market price/, 'MELEK is labelled, not blank');
});

test('network failure degrades to zeros rather than throwing', async (t) => {
  t.after(() => __setFetch(null));
  __setFetch(async () => { throw new Error('down'); });
  const m = await buildMatrix({ tokens: ['VKBT'] });
  assert.equal(m.rows.length, 1);
  assert.equal(m.rows[0].markHive, 0);
  assert.equal(m.rows[0].illiquid, true);
});

test('the token and base lists cover the ecosystem the operator named', () => {
  for (const b of ['HIVE', 'STEEM', 'BLURT', 'MELEK', 'USD']) {
    assert.ok(BASES.some((x) => x.id === b), `${b} is a base`);
  }
  for (const t of ['VKBT', 'CURE', 'SPS']) assert.ok(TOKENS.includes(t), `${t} is priced`);
});

test('handler states that a mark without depth is not a valuation', () => {
  const res = { statusCode: 0, headers: {}, body: '',
    setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  handler({ url: '/vm' }, res);
  const j = JSON.parse(res.body);
  assert.equal(j.service, 'value-matrix');
  assert.match(j.note, /not a valuation/);
});
