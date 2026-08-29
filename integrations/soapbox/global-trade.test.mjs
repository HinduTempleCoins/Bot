// global-trade.test.mjs — OFFLINE. Injectable fetch, soft-fail, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TRADE_DATA_SOURCES, HS_CODES, hsLookup, productListing, buildLead,
  comtradeFlows, renderListing, renderPage, dataNote, SAMPLE_LISTINGS, esc,
} from './global-trade.mjs';

test('TRADE_DATA_SOURCES: the official sources are present with homepages', () => {
  const ids = TRADE_DATA_SOURCES.map((s) => s.id);
  for (const id of ['comtrade', 'usitc-dataweb', 'importyeti']) assert.ok(ids.includes(id), `${id} present`);
  assert.ok(TRADE_DATA_SOURCES.every((s) => /^https:\/\//.test(s.home)), 'every source has an https home');
  assert.ok(TRADE_DATA_SOURCES.find((s) => s.id === 'comtrade').keyless, 'Comtrade preview is keyless');
});

test('hsLookup resolves exact + nearest heading, soft on unknown', () => {
  assert.equal(hsLookup('1209.99').label, HS_CODES['1209.99'].label);
  assert.equal(hsLookup('1209.99.10').note, 'nearest heading');   // falls back to parent 1209
  assert.equal(hsLookup('9999').label, '', 'unknown → empty label, no throw');
});

test('productListing normalizes fields and drops nothing it was given', () => {
  const l = productListing({ title: 'Test Herb', price: '4.2', commonNames: ['a', '', 'b'], hsCode: '1211.90' });
  assert.equal(l.id, 'test-herb');
  assert.equal(l.price, 4.2);
  assert.deepEqual(l.commonNames, ['a', 'b']);
  assert.equal(l.category, 'ethnobotanical');   // default
  assert.equal(productListing({ title: 'X', price: 'NaN' }).price, null);
});

test('buildLead shapes a buyer RFQ / supplier offer without scraping PII', () => {
  const buy = buildLead({ side: 'demand', product: 'seeds', hsCode: '1209.99', quantity: '100', country: 'US' });
  assert.equal(buy.side, 'demand');
  assert.equal(buy.quantity, 100);
  assert.equal(buildLead({ side: 'supply' }).side, 'supply');
  assert.equal(buildLead({}).side, 'demand');   // default
});

test('comtradeFlows parses rows from an injected response (ranked, capped)', async () => {
  const fakeFetch = async () => ({
    ok: true, status: 200,
    json: async () => ({ data: [
      { partnerDesc: 'China', primaryValue: 500, qty: 10 },
      { partnerDesc: 'South Africa', primaryValue: 1500, qty: 30 },
      { ptTitle: '', primaryValue: 9 }, // no partner → dropped
    ] }),
  });
  const out = await comtradeFlows({ hsCode: '1209.99', reporter: '842', flow: 'M', year: '2023' }, { fetch: fakeFetch });
  assert.equal(out.rows.length, 2);
  assert.equal(out.rows[0].partner, 'South Africa', 'sorted by value desc');
  assert.equal(out.asOf, '2023');
  assert.equal(out.source.name, 'UN Comtrade');
});

test('comtradeFlows soft-fails (never throws) on a dead source', async () => {
  const boom = async () => { throw new Error('network down'); };
  const out = await comtradeFlows({ hsCode: '1209.99' }, { fetch: boom });
  assert.deepEqual(out.rows, []);
  assert.match(out.error, /network down/);
  const bad = await comtradeFlows({ hsCode: '1209.99' }, { fetch: async () => ({ ok: false, status: 503 }) });
  assert.deepEqual(bad.rows, []);
  assert.match(bad.error, /503/);
});

test('the Helinus sample: legal-marketplace + reference framing, cross-linked, no how-to', () => {
  const l = SAMPLE_LISTINGS.helinus;
  assert.equal(l.scientificName, 'Helinus integrifolius');
  assert.equal(l.hsCode, '1209.99');
  assert.ok(l.libraryRef.includes('/library/'), 'cross-links to the Ashurbanipal library');
  assert.match(l.legalNote, /not a controlled substance|jurisdiction/i);
  // reference framing, not dosing/manufacturing
  assert.doesNotMatch(JSON.stringify(l), /\bdose\b|\bdosage\b|\bmg\b|extract .*route|how to make/i);
});

test('render escapes hostile input and shows the trade panel + data note', async () => {
  const evil = productListing({ title: '<script>x</script>', scientificName: '"><img>', hsCode: '1209.99' });
  const html = renderListing(evil);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.doesNotMatch(html, /"><img>/);
  const page = renderPage({ listing: SAMPLE_LISTINGS.helinus, flows: { rows: [{ partner: 'South Africa', value: 1500 }], source: { name: 'UN Comtrade', url: 'https://comtrade.un.org' }, asOf: '2023' } });
  assert.match(page, /South Africa/);
  assert.match(page, /Who trades this/);
  assert.match(page, /official public data/);   // dataNote
  // empty flows still render (soft) — never breaks the page
  assert.match(renderPage({ listing: SAMPLE_LISTINGS.helinus, flows: { rows: [] } }), /unavailable right now/);
});

test('dataNote carries the no-verdict / not-advice discipline', () => {
  assert.match(dataNote(), /not an? endorsement|not medical|provenance/i);
});
