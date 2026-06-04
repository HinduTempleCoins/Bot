// rx-prices.test.mjs — offline tests for the prescription price aggregator (#237). No real network:
// drugLookup uses an injected `pharma` stub via deps; pharmacyPrices uses an injected fetch. Everything
// is deterministic and key-free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  drugLookup, pharmacyPrices, bestPrice, couponInfo, renderPage, dataNote, esc,
  NOT_MEDICAL_ADVICE, DISCLOSURE,
} from './rx-prices.mjs';

// A canned pharma.mjs stub matching the real module's shape (drug() / compound()).
const cannedPharma = {
  async drug(name) {
    return {
      query: name, found: true, source: 'openFDA drug label (FDA)',
      brandNames: ['Lipitor'], genericNames: ['atorvastatin'], manufacturer: 'Pfizer',
      route: ['ORAL'], rxcui: ['83367'],
      sections: { dosage: 'The recommended dose is 10 mg or 20 mg once daily; max 80 mg.' },
    };
  },
  async compound(name) {
    return { query: name, found: true, source: 'PubChem (NIH/NLM)', cid: 60823, formula: 'C33H35FN2O5' };
  },
};

// A fake fetch returning a canned price list (with field-name variants to exercise normalization).
function fakeFetch(rows, { ok = true } = {}) {
  return async () => ({ ok, async json() { return { prices: rows }; } });
}

test('drugLookup — normalizes a canned drug to RxNorm + forms/strengths', async () => {
  const r = await drugLookup({ name: 'atorvastatin' }, { pharma: cannedPharma });
  assert.ok(r, 'returns a lookup');
  assert.equal(r.generic, 'atorvastatin');
  assert.equal(r.brand, 'Lipitor');
  assert.equal(r.rxcui, '83367');            // RxNorm normalization key reused from pharma.mjs
  assert.equal(r.cid, 60823);
  assert.deepEqual(r.forms, ['ORAL']);
  assert.ok(r.strengths.includes('10 mg') && r.strengths.includes('20 mg'), 'parses strengths');
  assert.ok(r.asOf, 'carries as-of');
});

test('drugLookup — soft-fails to null on empty name and on a throwing/not-found pharma', async () => {
  assert.equal(await drugLookup({ name: '' }, { pharma: cannedPharma }), null);
  const notFound = { async drug() { return { found: false }; }, async compound() { return { found: false }; } };
  assert.equal(await drugLookup({ name: 'zzz' }, { pharma: notFound }), null);
  const thrower = { async drug() { throw new Error('boom'); }, async compound() { throw new Error('boom'); } };
  assert.equal(await drugLookup({ name: 'x' }, { pharma: thrower }), null);
});

test('pharmacyPrices — normalizes rows to {pharmacy, price, withCoupon, asOf}', async () => {
  const fetch = fakeFetch([
    { pharmacy: 'Costco', price: '$12.40', with_coupon: false },
    { name: 'Walmart', cash_price: 18, coupon: true },
    { store: 'CVS', cost: '45.99' },
    { pharmacy: '', price: 5 },        // dropped: no pharmacy
    { pharmacy: 'Bad', price: 'n/a' }, // dropped: unparseable price
  ]);
  const rows = await pharmacyPrices({ drug: 'atorvastatin', dosage: '20 mg', zip: '90210' }, { fetch });
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.ok(r.pharmacy && typeof r.pharmacy === 'string');
    assert.ok(Number.isFinite(r.price));
    assert.equal(typeof r.withCoupon, 'boolean');
    assert.ok(r.asOf, 'each row carries as-of');
  }
  const costco = rows.find((r) => r.pharmacy === 'Costco');
  assert.equal(costco.price, 12.4);
  const walmart = rows.find((r) => r.pharmacy === 'Walmart');
  assert.equal(walmart.withCoupon, true);
});

test('pharmacyPrices — soft-fails to [] on empty drug, bad response, and network throw', async () => {
  assert.deepEqual(await pharmacyPrices({ drug: '' }, { fetch: fakeFetch([]) }), []);
  const notOk = fakeFetch([], { ok: false });
  assert.deepEqual(await pharmacyPrices({ drug: 'x' }, { fetch: notOk }), []);
  const thrower = async () => { throw new Error('network down'); };
  assert.deepEqual(await pharmacyPrices({ drug: 'x' }, { fetch: thrower }), []);
  const garbage = async () => ({ ok: true, async json() { return { nope: 1 }; } });
  assert.deepEqual(await pharmacyPrices({ drug: 'x' }, { fetch: garbage }), []);
});

test('bestPrice — finds the cheapest and computes savings vs highest', () => {
  const best = bestPrice([
    { pharmacy: 'CVS', price: 45.99, asOf: 'T' },
    { pharmacy: 'Costco', price: 12.40, asOf: 'T' },
    { pharmacy: 'Walmart', price: 18, asOf: 'T' },
  ]);
  assert.equal(best.cheapest.pharmacy, 'Costco');
  assert.equal(best.highest.pharmacy, 'CVS');
  assert.equal(best.savings, Math.round((45.99 - 12.4) * 100) / 100); // 33.59
  assert.equal(best.savingsPct, Math.round((33.59 / 45.99) * 100));   // ~73
  assert.equal(bestPrice([]), null);
});

test('ranking is by PRICE not commission — a high-commission row does not win', () => {
  // Even if a row advertises a fat commission/payout, the cheapest by price must rank first.
  const prices = [
    { pharmacy: 'PartnerPharm', price: 99.0, commission: 50, partner: true },
    { pharmacy: 'CheapMart', price: 9.0, commission: 0 },
  ];
  const best = bestPrice(prices);
  assert.equal(best.cheapest.pharmacy, 'CheapMart');
  // And the rendered table lists CheapMart before PartnerPharm.
  const html = renderPage({ drug: 'atorvastatin', prices });
  assert.ok(html.indexOf('CheapMart') < html.indexOf('PartnerPharm'), 'cheapest rendered first');
});

test('renderPage — escapes a malicious drug name AND always shows the not-medical-advice banner', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({
    drug: { name: evil, query: evil },
    prices: [{ pharmacy: '<img src=x onerror=alert(2)>', price: 10, withCoupon: false, asOf: 'T' }],
  });
  assert.ok(!html.includes('<script>'), 'no raw script tag');
  assert.ok(!html.includes('<img'), 'no raw img tag (angle brackets neutralized)');
  assert.ok(html.includes('&lt;script&gt;'), 'drug name escaped');
  assert.ok(html.includes('&lt;img'), 'pharmacy name escaped');
  // The banner is present, verbatim-escaped, on EVERY render.
  assert.ok(html.includes(esc(NOT_MEDICAL_ADVICE)), 'not-medical-advice banner present');
});

test('renderPage — banner present even with NO prices (empty state)', () => {
  const html = renderPage({ drug: 'atorvastatin', prices: [] });
  assert.ok(html.includes(esc(NOT_MEDICAL_ADVICE)), 'banner present on empty page');
  assert.ok(html.includes(esc(DISCLOSURE)), 'disclosure present on empty page');
  assert.ok(/No prices available/.test(html), 'empty-state message shown');
});

test('couponInfo — honest savings-program pointers, disclosed', () => {
  const c = couponInfo('atorvastatin');
  assert.ok(Array.isArray(c.programs) && c.programs.length >= 3);
  assert.equal(c.disclosure, DISCLOSURE);
  for (const p of c.programs) assert.ok(p.kind && p.label && p.note);
  assert.ok(c.programs.some((p) => p.kind === 'manufacturer-copay'), 'manufacturer program present');
  assert.ok(c.asOf, 'as-of present');
});

test('dataNote — present, mentions provenance + carries the disclosure', () => {
  const n = dataNote();
  assert.ok(typeof n === 'string' && n.length > 20);
  assert.match(n, /RxNorm|openFDA|PubChem|pharma\.mjs/);
  assert.ok(n.includes(DISCLOSURE), 'data note carries disclosure');
});
