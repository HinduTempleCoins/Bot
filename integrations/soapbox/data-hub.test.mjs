// data-hub.test.mjs — offline suite for the people-usable Data.SoapBox.Community hub.
// Fully offline: token prices via a stubbed RPC fetch, market data via an injected snapshot.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch, __setResourceCenter, hubData, renderHub, handler } from './data-hub.mjs';

// Reuse a minimal RPC stub for the ticker (KULA/WPRANA pool -> KULA=0.5 PRANA).
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');
const KULA = '0x32255d0138f5d645894fa89b5d5b5a68cf9aa631';
const WPRANA = '0xcabcaaebbf7a7312b91a92faa635d7a32af42a34';
function rpcStub() {
  return async (url, opts) => {
    const b = JSON.parse(opts.body);
    if (b.method === 'eth_call') {
      const { data } = b.params[0];
      if (data.startsWith('0xe6a43905')) {
        const a = '0x' + data.slice(10, 74).slice(24), c = '0x' + data.slice(74, 138).slice(24);
        const isKW = [a, c].sort().join() === [KULA, WPRANA].sort().join();
        return { ok: true, json: async () => ({ result: '0x' + addrWord(isKW ? '0x1111111111111111111111111111111111111111' : '0x0000000000000000000000000000000000000000') }) };
      }
      if (data.startsWith('0x0902f1ac')) {
        // token0 = KULA (lower) -> [KULA, WPRANA]
        return { ok: true, json: async () => ({ result: '0x' + word(10000n * 10n ** 18n) + word(5000n * 10n ** 18n) + word(0) }) };
      }
    }
    if (b.method === 'condenser_api.get_witness_by_account') {
      return { ok: true, json: async () => ({ result: { sbd_exchange_rate: { base: '0.000 MBD', quote: '0.000 MELEK' } } }) };
    }
    return { ok: false, json: async () => ({}) };
  };
}

const SNAPSHOT = {
  ts: '2026-09-22T05:00:00.000Z',
  metrics: {
    hiveEngine: {
      totalTokens: 1264, activeMarkets: 300, totalVolumeHive: 45000,
      topVolume: [{ symbol: 'LEO', volume: 12000, change: 3.2 }, { symbol: 'BEE', volume: 8000, change: -1.1 }],
      topGainers: [{ symbol: 'LEO', change: 3.2 }], topLosers: [{ symbol: 'BEE', change: -1.1 }],
    },
    metals: { gold: { price: 2650, change: 0.5 }, silver: { price: 31, change: -0.2 } },
    indices: { dow: { price: 43000, change: 0.3 }, sp500: { price: 5800, change: 0.4 }, nasdaq: { price: 18000, change: -0.1 } },
    forex: [{ pair: 'EUR/USD', rate: 1.085, change: 0.1 }],
    dxy: { price: 104.2, change: -0.1 },
    riskOn: 'risk-on (VIX<20)',
  },
  catalog: [
    { id: 'btc', label: 'BTC spot', value: '$62,000', via: 'CoinGecko', ourUrl: 'https://data.soapbox.community/coins/bitcoin', type: 'crypto' },
    { id: 'fng', label: 'Fear & Greed', value: '55 (Greed)', via: 'Alternative.me', ourUrl: 'https://data.soapbox.community/macro', type: 'sentiment' },
  ],
};

test('hubData: combines live token prices + injected market snapshot', async () => {
  __setFetch(rpcStub());
  __setResourceCenter(async () => SNAPSHOT);
  const d = await hubData();
  assert.ok(d.tokens && Array.isArray(d.tokens.tokens));
  const by = Object.fromEntries(d.tokens.tokens.map((t) => [t.symbol, t]));
  assert.equal(by.KULA.price_in_prana, 0.5);
  assert.equal(by.MELEK.display, 'n/a');
  assert.equal(d.market.metrics.hiveEngine.totalTokens, 1264);
  __setFetch(null); __setResourceCenter(null);
});

test('hubData: soft-fails each source independently', async () => {
  __setFetch(async () => { throw new Error('rpc down'); });
  __setResourceCenter(async () => null);
  const d = await hubData();
  // token feed still returns (numeraire PRANA always available), market null
  assert.ok(d.tokens);
  assert.equal(d.market, null);
  __setFetch(null); __setResourceCenter(null);
});

test('renderHub: valid html, shows our tokens + market, esc-safe', async () => {
  __setFetch(rpcStub());
  __setResourceCenter(async () => SNAPSHOT);
  const html = renderHub(await hubData());
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(html.includes('Data · SoapBox Community'));
  assert.ok(html.includes('KULA'));
  assert.ok(html.includes('0.5'));
  assert.ok(html.includes('n/a'));              // MELEK/APIS honest
  assert.ok(html.includes('1,264'));            // he.totalTokens formatted
  assert.ok(html.includes('LEO'));              // top volume
  assert.ok(html.includes('Fear &amp; Greed')); // catalog datum, esc'd
  assert.ok(html.includes('[img]'));            // ticker BBCode block present
  assert.ok(html.includes('data.soapbox.community/coins/bitcoin')); // catalog ourUrl link
  __setFetch(null); __setResourceCenter(null);
});

test('renderHub: graceful when market snapshot missing', async () => {
  __setFetch(rpcStub());
  __setResourceCenter(async () => null);
  const html = renderHub(await hubData());
  assert.ok(html.includes('being gathered'));   // market placeholder
  assert.ok(html.includes('KULA'));             // tokens still render
  __setFetch(null); __setResourceCenter(null);
});

test('renderHub: graceful when token feed missing', () => {
  const html = renderHub({ asOf: new Date().toISOString(), tokens: null, market: null });
  assert.ok(html.includes('temporarily unavailable'));
});

function mockRes() {
  return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; } };
}

test('handler / renders the dashboard', async () => {
  __setFetch(rpcStub());
  __setResourceCenter(async () => SNAPSHOT);
  const res = mockRes();
  await handler({ url: '/' }, res);
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.body.includes('Our tokens'));
  __setFetch(null); __setResourceCenter(null);
});

test('handler /api/hub.json returns combined json', async () => {
  __setFetch(rpcStub());
  __setResourceCenter(async () => SNAPSHOT);
  const res = mockRes();
  await handler({ url: '/api/hub.json' }, res);
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const j = JSON.parse(res.body);
  assert.ok(j.tokens && j.market);
  __setFetch(null); __setResourceCenter(null);
});

test('handler /health -> ok; unknown -> 404', async () => {
  const h = mockRes(); await handler({ url: '/health' }, h);
  assert.equal(h.body, 'ok');
  const n = mockRes(); await handler({ url: '/nope' }, n);
  assert.equal(n.code, 404);
});
