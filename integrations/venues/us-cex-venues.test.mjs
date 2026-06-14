// us-cex-venues.test.mjs — offline tests. NO network: fetch is injected via __setFetch.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  US_CEX_VENUES,
  collectUsCexVenues,
  handler,
  __setFetch,
} from './us-cex-venues.mjs';

// ── a fake fetch router: matches a substring of the URL to a JSON payload ──────────────
function fakeFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, payload] of routes) {
      if (u.includes(needle)) {
        if (payload === 'NETWORK_DEAD') throw new Error('ECONNREFUSED');
        if (payload === 'HTTP_500') return { ok: false, status: 500, json: async () => ({}) };
        if (payload === 'GARBAGE') return { ok: true, json: async () => { throw new Error('bad json'); } };
        return { ok: true, json: async () => payload };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

function restore() { __setFetch(); }

test('registry shape: every venue has name/publicApi/usAvailability/read', () => {
  assert.ok(Array.isArray(US_CEX_VENUES) && US_CEX_VENUES.length >= 17, 'all named venues present');
  for (const v of US_CEX_VENUES) {
    assert.equal(typeof v.name, 'string');
    assert.equal(typeof v.publicApi, 'boolean');
    assert.equal(typeof v.usAvailability, 'string');
    assert.equal(typeof v.read, 'function');
  }
  // the required no-public-API venues are present and marked false
  for (const name of ['Robinhood Crypto', 'eToro', 'Uphold', 'Bullish', 'Cash App', 'PayPal/Venmo', 'River', 'Swan', 'Coinmama']) {
    const v = US_CEX_VENUES.find((x) => x.name === name);
    assert.ok(v, `${name} present`);
    assert.equal(v.publicApi, false, `${name} marked publicApi:false`);
  }
});

test('Coinbase ticker + book parse', async () => {
  __setFetch(fakeFetch([
    ['/products/BTC-USD/ticker', { price: '65000.12', bid: '64999.5', ask: '65000.5', volume: '1234.5' }],
    ['/products/BTC-USD/book', { bids: [['64999.5', '0.5'], ['64998', '1.2']], asks: [['65000.5', '0.4'], ['65001', '2.0']] }],
  ]));
  const v = US_CEX_VENUES.find((x) => x.name === 'Coinbase');
  const r = await v.read('BTC-USD');
  restore();
  assert.equal(r.venue, 'Coinbase');
  assert.equal(r.markets[0].last, 65000.12);
  assert.equal(r.markets[0].bid, 64999.5);
  assert.equal(r.markets[0].ask, 65000.5);
  assert.equal(r.markets[0].vol24h, 1234.5);
  assert.equal(r.depth.bids[0][0], 64999.5);
  assert.equal(r.depth.asks.length, 2);
});

test('Kraken nested-result ticker + depth parse', async () => {
  __setFetch(fakeFetch([
    ['/0/public/Ticker', { error: [], result: { XXBTZUSD: { a: ['65010', '1', '1'], b: ['65000', '2', '2'], c: ['65005', '0.1'], v: ['10', '2500.5'] } } }],
    ['/0/public/Depth', { error: [], result: { XXBTZUSD: { bids: [['65000', '1.5', 1700]], asks: [['65010', '0.8', 1700]] } } }],
  ]));
  const v = US_CEX_VENUES.find((x) => x.name === 'Kraken');
  const r = await v.read('XBTUSD');
  restore();
  assert.equal(r.markets[0].ask, 65010);
  assert.equal(r.markets[0].bid, 65000);
  assert.equal(r.markets[0].last, 65005);
  assert.equal(r.markets[0].vol24h, 2500.5, 'uses the last-24h volume column');
  assert.equal(r.depth.bids[0][0], 65000);
  assert.equal(r.depth.asks[0][1], 0.8);
});

test('Gemini pubticker + book parse', async () => {
  __setFetch(fakeFetch([
    ['/v1/pubticker/btcusd', { bid: '64990', ask: '65010', last: '65000', volume: { BTC: '900.5', USD: '58000000', timestamp: 1 } }],
    ['/v1/book/btcusd', { bids: [{ price: '64990', amount: '1.1' }], asks: [{ price: '65010', amount: '2.2' }] }],
  ]));
  const v = US_CEX_VENUES.find((x) => x.name === 'Gemini');
  const r = await v.read('btcusd');
  restore();
  assert.equal(r.markets[0].bid, 64990);
  assert.equal(r.markets[0].ask, 65010);
  assert.equal(r.markets[0].last, 65000);
  assert.equal(r.markets[0].vol24h, 900.5);
  assert.equal(r.depth.bids[0][0], 64990, 'object-form book level normalized to [price,size]');
  assert.equal(r.depth.asks[0][1], 2.2);
});

test('no-public-API venues return the marked note and empty markets', async () => {
  const rh = await US_CEX_VENUES.find((x) => x.name === 'Robinhood Crypto').read();
  assert.equal(rh.markets.length, 0);
  assert.equal(rh.note, 'retail/no public market data');
  assert.equal(rh.publicApi, false);
});

test('dead source soft-fails to the empty shape (no throw)', async () => {
  __setFetch(fakeFetch([['/products/', 'NETWORK_DEAD']]));
  const v = US_CEX_VENUES.find((x) => x.name === 'Coinbase');
  const r = await v.read('BTC-USD');
  restore();
  assert.equal(r.venue, 'Coinbase');
  assert.deepEqual(r.markets, []);
  assert.match(r.note, /unavailable/);
});

test('HTTP 500 soft-fails to the empty shape', async () => {
  __setFetch(fakeFetch([['/api/kraken', 'HTTP_500'], ['/0/public/', 'HTTP_500']]));
  const v = US_CEX_VENUES.find((x) => x.name === 'Kraken');
  const r = await v.read('XBTUSD');
  restore();
  assert.deepEqual(r.markets, []);
});

test('garbage JSON soft-fails (no throw)', async () => {
  __setFetch(fakeFetch([['/v1/pubticker/', 'GARBAGE'], ['/v1/book/', 'GARBAGE']]));
  const v = US_CEX_VENUES.find((x) => x.name === 'Gemini');
  const r = await v.read('btcusd');
  restore();
  assert.deepEqual(r.markets, []);
});

test('collectUsCexVenues: uniform shape across all venues, one dead source does not break others', async () => {
  __setFetch(fakeFetch([
    ['exchange.coinbase.com', { price: '65000', bid: '64999', ask: '65001', volume: '1' }],
    ['/products/BTC-USD/book', { bids: [['64999', '1']], asks: [['65001', '1']] }],
    ['kraken.com', 'NETWORK_DEAD'],
    ['gemini.com', { bid: '1', ask: '2', last: '1.5', volume: { BTC: '3' } }],
    // everything else 404 -> empty shape
  ]));
  const out = await collectUsCexVenues();
  restore();
  assert.equal(out.ok, true);
  assert.equal(out.venues.length, US_CEX_VENUES.length);
  for (const v of out.venues) {
    assert.equal(typeof v.name, 'string');
    assert.equal(typeof v.publicApi, 'boolean');
    assert.ok(Array.isArray(v.markets));
    assert.equal(typeof v.asOf, 'string');
  }
  const cb = out.venues.find((v) => v.name === 'Coinbase');
  assert.equal(cb.markets[0].last, 65000);
  const kr = out.venues.find((v) => v.name === 'Kraken');
  assert.deepEqual(kr.markets, [], 'dead Kraken soft-failed but did not break the collection');
});

test('handler GET /api/venues/us-cex returns ok + venues', async () => {
  __setFetch(fakeFetch([])); // everything 404 -> all venues soft-fail to empty, still ok:true
  let code = 0, body = '';
  const res = { writeHead: (c) => { code = c; }, end: (b) => { body = b; } };
  await handler({ method: 'GET', url: '/api/venues/us-cex' }, res);
  restore();
  assert.equal(code, 200);
  const json = JSON.parse(body);
  assert.equal(json.ok, true);
  assert.equal(json.venues.length, US_CEX_VENUES.length);
});

test('handler unknown path -> 404 (no throw)', async () => {
  let code = 0, body = '';
  const res = { writeHead: (c) => { code = c; }, end: (b) => { body = b; } };
  await handler({ method: 'GET', url: '/nope' }, res);
  assert.equal(code, 404);
  assert.equal(JSON.parse(body).ok, false);
});
