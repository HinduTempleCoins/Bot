// game-collectibles.test.mjs — offline tests for the used/retro collectible reader.
// The link-out builders are pure (no network); the eBay path is key-gated and stubbed via env +
// __setFetch. No live calls. Run: node --test integrations/soapbox/game-collectibles.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  collectorLinks, searchPhrase, ebayBrowse, hasEbayKey, normalizeEbayItem,
  renderCollectibles, dataNote, API_KEY_ENV, __setFetch,
} from './game-collectibles.mjs';

// Helper: run a fn with EBAY_APP_ID set, restoring env afterward.
async function withKey(val, fn) {
  const prev = process.env.EBAY_APP_ID;
  process.env.EBAY_APP_ID = val;
  try { return await fn(); } finally {
    if (prev === undefined) delete process.env.EBAY_APP_ID; else process.env.EBAY_APP_ID = prev;
  }
}

test('searchPhrase trims, joins title + platform, collapses whitespace', () => {
  assert.equal(searchPhrase('  Chrono   Trigger ', 'SNES'), 'Chrono Trigger SNES');
  assert.equal(searchPhrase('Earthbound', ''), 'Earthbound');
  assert.equal(searchPhrase('', 'N64'), 'N64');
  assert.equal(searchPhrase('', ''), '');
});

test('collectorLinks builds aggregate posture link-outs to PriceCharting + eBay sold', () => {
  const r = collectorLinks('Chrono Trigger', 'SNES');
  assert.equal(r.posture, 'aggregate');
  assert.equal(r.phrase, 'Chrono Trigger SNES');
  assert.equal(r.links.length, 3);
  const pc = r.links.find((l) => l.source === 'PriceCharting');
  assert.ok(pc.url.startsWith('https://www.pricecharting.com/search-products?q='));
  assert.ok(pc.url.includes('Chrono%20Trigger%20SNES'));
  const sold = r.links.find((l) => l.source === 'eBay (sold)');
  assert.ok(sold.url.includes('LH_Sold=1'));
  assert.ok(sold.url.includes('LH_Complete=1'));
});

test('collectorLinks returns empty links for a blank title', () => {
  const r = collectorLinks('', '');
  assert.equal(r.posture, 'aggregate');
  assert.deepEqual(r.links, []);
});

test('hasEbayKey reflects the env var by NAME; ebayBrowse soft-skips to null with no key', async () => {
  // Ensure no key present for the soft-skip path.
  const prev = process.env.EBAY_APP_ID;
  delete process.env.EBAY_APP_ID;
  assert.equal(hasEbayKey(), false);
  __setFetch(async () => { throw new Error('should not be called when keyless'); });
  const r = await ebayBrowse('Chrono Trigger', 'SNES');
  __setFetch(null);
  assert.equal(r, null); // soft-skip, no network
  if (prev !== undefined) process.env.EBAY_APP_ID = prev;
  assert.ok(API_KEY_ENV.includes('EBAY_APP_ID'));
});

test('ebayBrowse returns a window result with sorted items when keyed', async () => {
  await withKey('test-app-id', async () => {
    assert.equal(hasEbayKey(), true);
    __setFetch(async (url, opts) => {
      // confirm the bearer auth + category were wired
      assert.ok(opts.headers.Authorization.includes('test-app-id'));
      assert.ok(String(url).includes('category_ids=139973'));
      return { ok: true, json: async () => ({ itemSummaries: [
        { title: 'Chrono Trigger CIB', price: { value: '89.99', currency: 'USD' }, condition: 'Used', itemWebUrl: 'https://ebay/1' },
        { title: 'Chrono Trigger loose', price: { value: '45.00', currency: 'USD' }, condition: 'Used', itemWebUrl: 'https://ebay/2' },
        { title: 'no price', condition: 'Used' }, // dropped
      ] }) };
    });
    const r = await ebayBrowse('Chrono Trigger', 'SNES');
    __setFetch(null);
    assert.equal(r.posture, 'window');
    assert.equal(r.items.length, 2);
    assert.deepEqual(r.items.map((i) => i.price), [45, 89.99]); // ascending
  });
});

test('ebayBrowse soft-fails to null on network error / not-ok when keyed', async () => {
  await withKey('test-app-id', async () => {
    __setFetch(async () => { throw new Error('boom'); });
    assert.equal(await ebayBrowse('X', 'PS1'), null);
    __setFetch(async () => ({ ok: false, json: async () => ({}) }));
    assert.equal(await ebayBrowse('X', 'PS1'), null);
    __setFetch(null);
  });
});

test('normalizeEbayItem handles bad rows + currency default', () => {
  assert.equal(normalizeEbayItem(null), null);
  assert.equal(normalizeEbayItem({ price: { value: 'NaN' } }), null);
  const it = normalizeEbayItem({ title: 'X', price: { value: '5.00' } });
  assert.equal(it.price, 5);
  assert.equal(it.currency, 'USD'); // default
});

test('renderCollectibles renders link-outs always + eBay table when present, all escaped', () => {
  const collector = collectorLinks('<b>Chrono</b>', 'SNES');
  const html = renderCollectibles({
    collector,
    ebay: { posture: 'window', phrase: 'x', items: [
      { title: '<i>CIB</i>', price: 89.99, currency: 'USD', condition: 'Used', url: 'https://ebay/1' },
    ] },
  });
  assert.ok(html.includes('Collector price links'));
  assert.ok(html.includes('PriceCharting'));
  assert.ok(html.includes('Live listings'));
  assert.ok(html.includes('$89.99'));
  assert.ok(!html.includes('<i>CIB</i>')); // escaped
  assert.ok(html.includes('&lt;i&gt;'));
  assert.ok(html.includes('link-out aggregate'));

  // No eBay block when none.
  const linkOnly = renderCollectibles({ collector, ebay: null });
  assert.ok(!linkOnly.includes('Live listings'));
  assert.ok(linkOnly.includes('Collector price links'));
});

test('dataNote declares link-out aggregate posture (never scrape)', () => {
  assert.match(dataNote(), /PriceCharting/);
  assert.match(dataNote(), /never scrape/i);
});
