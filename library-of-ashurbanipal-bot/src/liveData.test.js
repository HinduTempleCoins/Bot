// Tests for the live-data connector (#94). OFFLINE: a canned data source is injected via
// __setDataSource — no network, no .mjs import. Run: node --test src/liveData.test.js
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { priceFact, marketFacts, chainFact, citeLiveData, enrich, __setDataSource } from './liveData.js';

// Canned data source matching the steemd contract: fn(cmd) → { ok, text, data }.
function cannedSource(map) {
  return async (cmd) => {
    if (cmd in map) return map[cmd];
    return { ok: false, text: `unknown ${cmd}`, data: null };
  };
}

const VKBT = { ok: true, text: 'VKBT $1.50', data: { symbol: 'VKBT', name: 'VKBT', price_usd: 1.5, change_24h: 2.3 } };
const BTC = { ok: true, text: 'BTC $60000', data: { symbol: 'BTC', name: 'Bitcoin', price_usd: 60000, change_24h: -1.1 } };

afterEach(() => __setDataSource(null)); // reset to the real layer between tests.

test('priceFact returns a fact from injected data', async () => {
  __setDataSource(cannedSource({ 'price VKBT': VKBT }));
  const f = await priceFact('VKBT');
  assert.equal(f.symbol, 'VKBT');
  assert.equal(f.priceUsd, 1.5);
  assert.equal(f.change24h, 2.3);
  assert.match(f.asOf, /^\d{4}-\d{2}-\d{2}T/); // ISO timestamp present.
});

test('priceFact soft-fails to null when the source throws', async () => {
  __setDataSource(async () => { throw new Error('network down'); });
  const f = await priceFact('VKBT');
  assert.equal(f, null);
});

test('priceFact soft-fails to null on unknown symbol (ok:false)', async () => {
  __setDataSource(cannedSource({}));
  assert.equal(await priceFact('NOPE'), null);
});

test('marketFacts maps a watchlist, dropping soft-failures', async () => {
  __setDataSource(cannedSource({ 'price VKBT': VKBT, 'price BTC': BTC }));
  const facts = await marketFacts(['VKBT', 'BTC', 'MISSING']);
  assert.deepEqual(facts.map((f) => f.symbol), ['VKBT', 'BTC']);
});

test('marketFacts returns [] for empty/invalid input', async () => {
  __setDataSource(cannedSource({}));
  assert.deepEqual(await marketFacts(), []);
  assert.deepEqual(await marketFacts([]), []);
});

test('citeLiveData includes the as-of timestamp (honest time-stamping)', async () => {
  __setDataSource(cannedSource({ 'price VKBT': VKBT }));
  const f = await priceFact('VKBT');
  const cite = citeLiveData(f);
  const date = f.asOf.slice(0, 10);
  assert.match(cite, new RegExp(`^As of ${date},`)); // dated, not eternal.
  assert.match(cite, /VKBT traded at \$1\.5/);
  assert.match(cite, /source: SoapBox\/steemd/);
});

test('citeLiveData returns empty string for bad input', () => {
  assert.equal(citeLiveData(null), '');
  assert.equal(citeLiveData('x'), '');
});

test('enrich adds a Live-data footnote without altering the original body (string)', async () => {
  __setDataSource(cannedSource({ 'price VKBT': VKBT }));
  const body = '# Witness\n\nA witness produces blocks.';
  const out = await enrich(body, { symbols: ['VKBT'] });
  assert.ok(out.startsWith(body), 'original body preserved verbatim at the start');
  assert.match(out, /## Live data/);
  assert.match(out, /VKBT traded at/);
});

test('enrich preserves the body field on an article object', async () => {
  __setDataSource(cannedSource({ 'price BTC': BTC }));
  const article = { title: 'X', content: 'original content here' };
  const out = await enrich(article, { symbols: ['BTC'] });
  assert.ok(out.content.startsWith('original content here'));
  assert.match(out.content, /## Live data/);
  assert.equal(out.title, 'X');
});

test('enrich returns the article unchanged when no live data is available', async () => {
  __setDataSource(cannedSource({})); // all symbols soft-fail.
  const body = 'untouched body';
  assert.equal(await enrich(body, { symbols: ['VKBT'] }), body);
  const article = { content: 'untouched' };
  assert.deepEqual(await enrich(article, { symbols: ['VKBT'] }), article);
});

test('chainFact returns a current chain fact through the data layer', async () => {
  __setDataSource(cannedSource({ 'price MELEK': { ok: true, text: 'MELEK info', data: { symbol: 'MELEK' } } }));
  const fact = await chainFact('price MELEK');
  assert.equal(fact.query, 'price MELEK');
  assert.equal(fact.text, 'MELEK info');
  assert.match(fact.asOf, /^\d{4}-\d{2}-\d{2}T/);
});

test('chainFact soft-fails to null on error / unavailable', async () => {
  __setDataSource(async () => { throw new Error('boom'); });
  assert.equal(await chainFact('price MELEK'), null);
  __setDataSource(cannedSource({}));
  assert.equal(await chainFact('account nobody'), null);
  assert.equal(await chainFact(''), null);
});

test('no data source at all → everything soft-fails, never throws', async () => {
  // Force the "import unavailable" path by injecting a source that returns null-ish.
  __setDataSource(async () => null);
  assert.equal(await priceFact('VKBT'), null);
  assert.deepEqual(await marketFacts(['VKBT']), []);
  assert.equal(await chainFact('price VKBT'), null);
  assert.equal(await enrich('body', { symbols: ['VKBT'] }), 'body'); // generation never breaks.
});
