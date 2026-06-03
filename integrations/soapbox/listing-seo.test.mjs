import { test } from 'node:test';
import assert from 'node:assert';
import {
  seoTitle, seoDescription, seoH1, canonical, faqPairs, structuredData,
  slugFor, fmtMoney, fmtPct, jsonLdScript, esc,
} from './listing-seo.mjs';

const BTC = { name: 'Bitcoin', symbol: 'BTC', kind: 'crypto', price: 67000.42, marketCap: 1.32e12, rank: 1, change24h: 2.41, priceCurrency: 'USD' };
const STOCK = { name: 'Apple Inc.', symbol: 'AAPL', kind: 'stock', price: 212.5, marketCap: 3.3e12, rank: 1, change24h: -0.8 };
const SPARSE = { name: 'Obscure Coin', symbol: 'OBC', kind: 'crypto' }; // no price/cap

test('seoTitle includes name + symbol and the canonical phrase', () => {
  const t = seoTitle(BTC);
  assert.match(t, /Bitcoin/);
  assert.match(t, /BTC/);
  assert.match(t, /Price, Chart & Market Cap/);
});

test('seoH1 includes name + symbol', () => {
  const h = seoH1(BTC);
  assert.match(h, /Bitcoin/);
  assert.match(h, /BTC/);
  assert.match(h, /Price/);
});

test('seoDescription includes symbol, name, and record-specific facts (not thin-duplicate)', () => {
  const d = seoDescription(BTC);
  assert.match(d, /Bitcoin/);
  assert.match(d, /BTC/);
  assert.match(d, /\$67,000\.42/, 'live price fact present');
  assert.match(d, /\+2\.41%/, '24h change fact present');
  assert.match(d, /\$1\.32T/, 'market cap fact present');
  assert.match(d, /#1/, 'rank fact present');
});

test('seoDescription of two different records differs (no thin-duplicate)', () => {
  assert.notEqual(seoDescription(BTC), seoDescription(STOCK));
});

test('seoDescription degrades gracefully with no numeric facts', () => {
  const d = seoDescription(SPARSE);
  assert.match(d, /Obscure Coin/);
  assert.match(d, /OBC/);
  assert.doesNotMatch(d, /undefined|null|NaN/);
});

test('canonical is well-formed absolute URL under the right section', () => {
  const u = canonical(BTC);
  assert.match(u, /^https:\/\//);
  assert.match(u, /\/coins\/bitcoin$/);
  assert.equal(canonical(STOCK), 'https://data.soapbox.community/stocks/apple-inc');
  assert.equal(canonical(BTC, 'https://x.test/'), 'https://x.test/coins/bitcoin', 'trailing slash trimmed, custom base honored');
});

test('slugFor slugifies name/symbol safely', () => {
  assert.equal(slugFor({ name: 'Apple Inc.' }), 'apple-inc');
  assert.equal(slugFor({ symbol: 'BTC' }), 'btc');
  assert.equal(slugFor({ slug: 'custom-slug', name: 'Ignored' }), 'custom-slug');
  assert.equal(slugFor({}), 'asset');
});

test('faqPairs cover the price / to-USD / chart / market-cap / how-to-buy patterns', () => {
  const pairs = faqPairs(BTC);
  const qs = pairs.map((p) => p.q.toLowerCase());
  assert.ok(qs.some((q) => q.includes('price')), 'price query');
  assert.ok(qs.some((q) => q.includes('to usd')), 'to USD query');
  assert.ok(qs.some((q) => q.includes('chart')), 'chart query');
  assert.ok(qs.some((q) => q.includes('market cap')), 'market cap query');
  assert.ok(qs.some((q) => q.includes('how do i buy') || q.includes('how to buy')), 'how to buy query');
  for (const p of pairs) { assert.ok(p.q && p.a, 'each pair has Q and A'); }
});

test('faqPairs answers fold in record facts', () => {
  const pairs = faqPairs(BTC);
  const joined = pairs.map((p) => p.a).join('\n');
  assert.match(joined, /\$67,000\.42/, 'price in an answer');
  assert.match(joined, /\$1\.32T/, 'market cap in an answer');
});

test('structuredData is valid JSON with the right @context and node types', () => {
  const sd = structuredData(BTC);
  // round-trips through JSON cleanly
  const round = JSON.parse(JSON.stringify(sd));
  assert.equal(round['@context'], 'https://schema.org');
  assert.ok(Array.isArray(round['@graph']));
  const types = round['@graph'].map((n) => n['@type']);
  assert.ok(types.includes('Dataset'), 'Dataset present');
  assert.ok(types.includes('FAQPage'), 'FAQPage present');
  assert.ok(types.includes('BreadcrumbList'), 'BreadcrumbList present');
});

test('structuredData FAQPage mirrors faqPairs', () => {
  const sd = structuredData(BTC);
  const faq = sd['@graph'].find((n) => n['@type'] === 'FAQPage');
  assert.equal(faq.mainEntity.length, faqPairs(BTC).length);
  for (const e of faq.mainEntity) {
    assert.equal(e['@type'], 'Question');
    assert.equal(e.acceptedAnswer['@type'], 'Answer');
    assert.ok(e.name && e.acceptedAnswer.text);
  }
});

test('structuredData BreadcrumbList is ordered with absolute items', () => {
  const sd = structuredData(BTC);
  const bc = sd['@graph'].find((n) => n['@type'] === 'BreadcrumbList');
  const positions = bc.itemListElement.map((i) => i.position);
  assert.deepEqual(positions, [1, 2, 3]);
  for (const i of bc.itemListElement) assert.match(i.item, /^https:\/\//);
});

test('structuredData Dataset carries record-specific measured values', () => {
  const sd = structuredData(BTC);
  const ds = sd['@graph'].find((n) => n['@type'] === 'Dataset');
  const price = ds.variableMeasured.find((v) => v.name === 'Price');
  assert.equal(price.value, 67000.42);
  assert.ok(ds.url.startsWith('https://'));
  assert.ok(Array.isArray(ds.keywords) && ds.keywords.includes('BTC'));
});

test('fmtMoney + fmtPct format and return null for non-numbers', () => {
  assert.equal(fmtMoney(1.32e12), '$1.32T');
  assert.equal(fmtMoney(3.3e9), '$3.30B');
  assert.equal(fmtMoney(undefined), null);
  assert.equal(fmtPct(2.41), '+2.41%');
  assert.equal(fmtPct(-0.8), '-0.80%');
  assert.equal(fmtPct(null), null);
});

test('esc and jsonLdScript escape unsafe content', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
  const block = jsonLdScript({ x: '</script><b>' });
  assert.doesNotMatch(block, /<\/script><b>/, 'closing tag sequence neutralized');
  assert.match(block, /^<script type="application\/ld\+json">/);
});

test('structuredData stays valid for a sparse record (no NaN/undefined leaks in JSON)', () => {
  const json = JSON.stringify(structuredData(SPARSE));
  assert.doesNotMatch(json, /NaN/);
  const ds = JSON.parse(json)['@graph'].find((n) => n['@type'] === 'Dataset');
  // measured values with no data must omit `value` rather than emit null/NaN
  for (const v of ds.variableMeasured) assert.ok(!('value' in v) || Number.isFinite(v.value));
});
