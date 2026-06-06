// games-market.test.mjs — offline tests for the Gamer Hub unifier.
// One __setFetch wires BOTH children; we route by URL so digital (CheapShark) and eBay (key-gated) can
// be stubbed independently. Run: node --test integrations/soapbox/games-market.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { marketFor, renderMarket, dataNote, __setFetch } from './games-market.mjs';

const hkDeals = [
  { title: 'Hollow Knight', storeID: '1', salePrice: '7.49', normalPrice: '14.99', savings: '50.0', dealID: 'a' },
  { title: 'Hollow Knight', storeID: '7', salePrice: '6.74', normalPrice: '14.99', savings: '55.0', dealID: 'b' },
];

// Route CheapShark /deals and eBay Browse by URL.
function routeFetch({ deals = [], ebayItems = null } = {}) {
  return async (url, opts) => {
    const s = String(url);
    if (s.includes('cheapshark.com')) return { ok: true, json: async () => deals };
    if (s.includes('api.ebay.com')) {
      if (ebayItems == null) return { ok: false, json: async () => ({}) };
      return { ok: true, json: async () => ({ itemSummaries: ebayItems }) };
    }
    return { ok: false, json: async () => ({}) };
  };
}

async function withoutKey(fn) {
  const prev = process.env.EBAY_APP_ID;
  delete process.env.EBAY_APP_ID;
  try { return await fn(); } finally { if (prev !== undefined) process.env.EBAY_APP_ID = prev; }
}
async function withKey(val, fn) {
  const prev = process.env.EBAY_APP_ID;
  process.env.EBAY_APP_ID = val;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.EBAY_APP_ID; else process.env.EBAY_APP_ID = prev;
  }
}

test('marketFor unifies digital deals + collectible link-outs (keyless: eBay null)', async () => {
  await withoutKey(async () => {
    __setFetch(routeFetch({ deals: hkDeals }));
    const m = await marketFor('Hollow Knight');
    __setFetch(null);
    // digital
    assert.equal(m.title, 'Hollow Knight');
    assert.equal(m.newDigital.deals.length, 2);
    assert.equal(m.newDigital.best.price, 6.74); // cheapest
    assert.equal(m.newDigital.best.comparedAcross, 2);
    assert.equal(m.newDigital.source, 'CheapShark');
    // collectible
    assert.equal(m.collectible.posture, 'aggregate');
    assert.equal(m.collectible.keyed, false);
    assert.equal(m.collectible.ebay, null); // no key → link-out only
    assert.equal(m.collectible.links.length, 3);
  });
});

test('marketFor includes live eBay window result when keyed', async () => {
  await withKey('test-id', async () => {
    __setFetch(routeFetch({ deals: hkDeals, ebayItems: [
      { title: 'Hollow Knight phys', price: { value: '34.99', currency: 'USD' }, condition: 'Used', itemWebUrl: 'https://ebay/1' },
    ] }));
    const m = await marketFor('Hollow Knight', 'Switch');
    __setFetch(null);
    assert.equal(m.platform, 'Switch');
    assert.equal(m.collectible.keyed, true);
    assert.ok(m.collectible.ebay);
    assert.equal(m.collectible.ebay.posture, 'window');
    assert.equal(m.collectible.ebay.items.length, 1);
  });
});

test('marketFor soft-fails gracefully: blank title, and digital network failure', async () => {
  await withoutKey(async () => {
    const blank = await marketFor('');
    assert.equal(blank.title, '');
    assert.deepEqual(blank.newDigital.deals, []);
    assert.deepEqual(blank.collectible.links, []);

    __setFetch(async () => { throw new Error('down'); });
    const m = await marketFor('Hollow Knight');
    __setFetch(null);
    assert.deepEqual(m.newDigital.deals, []);
    assert.equal(m.newDigital.best, null);
    // collectible link-outs still present (pure)
    assert.equal(m.collectible.links.length, 3);
  });
});

test('provenance discipline: disclosed sources, payToRank false, no-merge note', async () => {
  await withoutKey(async () => {
    __setFetch(routeFetch({ deals: hkDeals }));
    const m = await marketFor('Hollow Knight');
    __setFetch(null);
    assert.equal(m.provenance.payToRank, false);
    assert.ok(m.provenance.sources.length >= 3);
    assert.match(m.provenance.note, /no sponsored/i);
    assert.match(m.provenance.note, /side by side/i);
    // digital deals are price-ascending (no pay-to-rank reordering)
    const prices = m.newDigital.deals.map((d) => d.price);
    assert.deepEqual(prices, [...prices].sort((a, b) => a - b));
  });
});

test('renderMarket renders both sections + provenance, all escaped', async () => {
  await withoutKey(async () => {
    __setFetch(routeFetch({ deals: hkDeals }));
    const m = await marketFor('<b>Hollow Knight</b>', '<i>Switch</i>');
    __setFetch(null);
    const html = renderMarket(m);
    assert.ok(html.includes('Game market —'));
    assert.ok(html.includes('Digital prices'));
    assert.ok(html.includes('Collector price links'));
    assert.ok(html.includes('How these prices are sourced'));
    assert.ok(!html.includes('<b>Hollow Knight</b>'));
    assert.ok(html.includes('&lt;b&gt;'));
    assert.ok(html.includes('no pay-to-rank'));
  });
});

test('dataNote summarizes disclosed sources + no pay-to-rank', () => {
  assert.match(dataNote(), /CheapShark/);
  assert.match(dataNote(), /no pay-to-rank/i);
  assert.match(dataNote(), /link-out/i);
});
