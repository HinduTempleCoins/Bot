// token-ticker.test.mjs — offline suite for the embeddable token-price ticker.
// Fully offline: a stub fetch answers eth_call (getPair/getReserves) and the MELEK feed RPC. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, roster, fmtPrice, pairPrice, fetchReserves, fetchMelekFeed, fetchTokenPrices,
  renderJSON, renderSVG, esc, bbcode, bbcodeSvg, htmlEmbed, jsEmbed, embeds, pngProxyUrl,
  imageUrl, handler, embedPage,
} from './token-ticker.mjs';

// ── helpers to build eth_call responses ────────────────────────────────────────────────────────────
const word = (n) => BigInt(n).toString(16).padStart(64, '0');
const addrWord = (a) => a.replace(/^0x/, '').toLowerCase().padStart(64, '0');

// A fake AMM: factory.getPair(a,b) -> a deterministic pair addr; pair.getReserves() -> seeded reserves.
// KULA/WPRANA: 10000 KULA / 5000 WPRANA (both 18 dec) -> 1 KULA = 0.5 PRANA.
// wVKBT/KULA:  2000 wVKBT(8dec) / 1000 KULA(18dec)   -> 1 wVKBT = 0.5 KULA = 0.25 PRANA.
// wCURE/KULA:  pool exists but reserves 0 -> price unavailable (n/a), proves soft-fail per-leg.
const KULA = '0x32255d0138f5d645894fa89b5d5b5a68cf9aa631';
const WPRANA = '0xcabcaaebbf7a7312b91a92faa635d7a32af42a34';
const wVKBT = '0xd915e757662c4234137aff167bf93d588145f75e';
const wCURE = '0x03d613bdaad82ecd6cf36b0fef88fb6af9d977ff';

// pair address per token-set (order-independent) — arbitrary but distinct + non-zero.
const PAIRS = {
  [[KULA, WPRANA].sort().join()]: '0x1111111111111111111111111111111111111111',
  [[wVKBT, KULA].sort().join()]:  '0x2222222222222222222222222222222222222222',
  [[wCURE, KULA].sort().join()]:  '0x3333333333333333333333333333333333333333',
};
// reserves keyed by pair addr, as [reserve0, reserve1] following ADDRESS-SORTED token0/token1.
function reservesFor(pairAddr) {
  if (pairAddr === PAIRS[[KULA, WPRANA].sort().join()]) {
    // token0 = lower addr. KULA(0x32..) < WPRANA(0xca..) -> token0=KULA
    return [10000n * 10n ** 18n, 5000n * 10n ** 18n];
  }
  if (pairAddr === PAIRS[[wVKBT, KULA].sort().join()]) {
    // KULA(0x32..) < wVKBT(0xd9..) -> token0=KULA(18dec), token1=wVKBT(8dec)
    return [1000n * 10n ** 18n, 2000n * 10n ** 8n];
  }
  if (pairAddr === PAIRS[[wCURE, KULA].sort().join()]) {
    return [0n, 0n]; // empty pool -> unavailable
  }
  return [0n, 0n];
}

function makeRpcStub({ melekAlive = false } = {}) {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.method === 'eth_call') {
      const { to, data } = body.params[0];
      if (data.startsWith('0xe6a43905')) { // getPair(address,address)
        const a = '0x' + data.slice(10, 74).slice(24);
        const b = '0x' + data.slice(74, 138).slice(24);
        const key = [a, b].sort().join();
        const pair = PAIRS[key] || '0x0000000000000000000000000000000000000000';
        return { ok: true, json: async () => ({ result: '0x' + addrWord(pair) }) };
      }
      if (data.startsWith('0x0902f1ac')) { // getReserves()
        const [r0, r1] = reservesFor(to);
        return { ok: true, json: async () => ({ result: '0x' + word(r0) + word(r1) + word(0) }) };
      }
    }
    if (body.method === 'condenser_api.get_witness_by_account') {
      const rate = melekAlive
        ? { base: '2.500 MBD', quote: '1.000 MELEK' }
        : { base: '0.000 MBD', quote: '0.000 MELEK' }; // the real dead feed
      return { ok: true, json: async () => ({ result: { sbd_exchange_rate: rate } }) };
    }
    return { ok: false, json: async () => ({ error: 'unhandled' }) };
  };
}

const CFG = { rpcUrl: 'http://rpc.test', factory: '0xFb5B83ed7F54e5fa45ED528dbe2167bB0b93b1E6' };

// ── unit: pure helpers ───────────────────────────────────────────────────────────────────────────────
test('fmtPrice: honest n/a and adaptive precision', () => {
  assert.equal(fmtPrice(null), 'n/a');
  assert.equal(fmtPrice(undefined), 'n/a');
  assert.equal(fmtPrice(NaN), 'n/a');
  assert.equal(fmtPrice(0), '0');
  assert.equal(fmtPrice(0.5), '0.5');
  assert.equal(fmtPrice(1234.5678), '1,234.57');
});

test('pairPrice: decimal-aware ratio, soft-fail on empty', () => {
  // 5000 WPRANA / 10000 KULA (both 18) = 0.5
  assert.equal(pairPrice(10000n * 10n ** 18n, 18, 5000n * 10n ** 18n, 18), 0.5);
  // 1000 KULA(18) base? here base=wVKBT(8) 2000, quote=KULA(18) 1000 -> 1000/2000 = 0.5 KULA
  assert.equal(pairPrice(2000n * 10n ** 8n, 8, 1000n * 10n ** 18n, 18), 0.5);
  assert.equal(pairPrice(0n, 18, 5n, 18), 0);
});

test('esc escapes all HTML metacharacters', () => {
  assert.equal(esc(`<a>&"'`), '&lt;a&gt;&amp;&quot;&#39;');
});

test('roster includes the ecosystem tokens', () => {
  const syms = roster().map((t) => t.symbol);
  for (const s of ['MELEK', 'PRANA', 'WPRANA', 'KULA', 'wVKBT', 'wCURE', 'APIS']) assert.ok(syms.includes(s), s);
});

// ── reserves + feed readers ────────────────────────────────────────────────────────────────────────
test('fetchReserves maps address-sorted reserves back to A/B', async () => {
  __setFetch(makeRpcStub());
  const r = await fetchReserves({ ...CFG, tokenA: KULA, tokenB: WPRANA });
  assert.ok(r);
  assert.equal(r.reserveA, 10000n * 10n ** 18n); // KULA reserve
  assert.equal(r.reserveB, 5000n * 10n ** 18n);  // WPRANA reserve
  __setFetch(null);
});

test('fetchReserves soft-fails to null on missing config / no pool', async () => {
  __setFetch(makeRpcStub());
  assert.equal(await fetchReserves({}), null);
  assert.equal(await fetchReserves({ ...CFG, tokenA: '0xdead', tokenB: WPRANA }), null);
  __setFetch(null);
});

test('fetchMelekFeed: dead feed (0/0) -> unavailable, never throws', async () => {
  __setFetch(makeRpcStub({ melekAlive: false }));
  const f = await fetchMelekFeed({ melekRpcUrl: 'http://melek.test' });
  assert.equal(f.available, false);
  // no URL configured -> also unavailable
  assert.equal((await fetchMelekFeed({})).available, false);
  __setFetch(null);
});

test('fetchMelekFeed: live feed -> price', async () => {
  __setFetch(makeRpcStub({ melekAlive: true }));
  const f = await fetchMelekFeed({ melekRpcUrl: 'http://melek.test' });
  assert.equal(f.available, true);
  assert.equal(f.price, 2.5);
  __setFetch(null);
});

// ── aggregate ─────────────────────────────────────────────────────────────────────────────────────
test('fetchTokenPrices: live pools priced in PRANA, dead legs -> n/a', async () => {
  __setFetch(makeRpcStub());
  const data = await fetchTokenPrices({ ...CFG, melekRpcUrl: '' });
  const by = Object.fromEntries(data.tokens.map((t) => [t.symbol, t]));
  assert.equal(data.numeraire, 'PRANA');
  assert.equal(by.PRANA.priceInPrana, 1);
  assert.equal(by.WPRANA.priceInPrana, 1);
  assert.equal(by.KULA.priceInPrana, 0.5);        // 5000/10000
  assert.equal(by.wVKBT.priceInPrana, 0.25);       // 0.5 KULA * 0.5 PRANA/KULA
  assert.equal(by.wCURE.available, false);         // empty pool -> n/a
  assert.equal(by.MELEK.available, false);         // no feed -> n/a
  assert.equal(by.APIS.available, false);          // no market -> n/a
  __setFetch(null);
});

test('fetchTokenPrices: total RPC failure -> all n/a, never throws', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const data = await fetchTokenPrices({ ...CFG });
  const by = Object.fromEntries(data.tokens.map((t) => [t.symbol, t]));
  assert.equal(by.KULA.available, false);
  assert.equal(by.PRANA.priceInPrana, 1); // numeraire is definitional, still available
  __setFetch(null);
});

// ── renderers ─────────────────────────────────────────────────────────────────────────────────────
test('renderJSON: honest nulls + display strings', async () => {
  __setFetch(makeRpcStub());
  const j = renderJSON(await fetchTokenPrices({ ...CFG }));
  const by = Object.fromEntries(j.tokens.map((t) => [t.symbol, t]));
  assert.equal(by.KULA.price_in_prana, 0.5);
  assert.equal(by.KULA.display, '0.5');
  assert.equal(by.MELEK.price_in_prana, null);
  assert.equal(by.MELEK.display, 'n/a');
  __setFetch(null);
});

test('renderSVG: valid svg, esc-safe, shows n/a for dead tokens', async () => {
  __setFetch(makeRpcStub());
  const svg = renderSVG(await fetchTokenPrices({ ...CFG }), { theme: 'dark' });
  assert.ok(svg.startsWith('<svg'));
  assert.ok(svg.trim().endsWith('</svg>'));
  assert.ok(svg.includes('0.5 PRANA'));
  assert.ok(svg.includes('n/a'));       // MELEK/APIS/wCURE
  assert.ok(svg.includes('KulaSwap'));
  assert.ok(!svg.includes('<script'));  // no scripts in the image
  __setFetch(null);
});

test('renderSVG never throws on empty data', () => {
  const svg = renderSVG({ tokens: [] }, {});
  assert.ok(svg.startsWith('<svg'));
});

// ── embeds ────────────────────────────────────────────────────────────────────────────────────────
test('bbcode: Bitcointalk-safe PNG via proxy, wrapped in url', () => {
  const b = bbcode('https://data.soapbox.community/tools/ticker');
  assert.ok(b.startsWith('[url='));
  assert.ok(b.includes('[img]'));
  assert.ok(b.includes('images.weserv.nl'));
  assert.ok(b.includes('output=png'));
});

test('pngProxyUrl encodes the svg url and keeps proxy slash', () => {
  const u = pngProxyUrl('https://data.soapbox.community/tools/ticker');
  assert.ok(u.startsWith('https://images.weserv.nl/?url='));
  assert.ok(u.includes(encodeURIComponent('data.soapbox.community/tools/ticker/ticker.svg')));
});

test('htmlEmbed + jsEmbed: esc-safe embeds', () => {
  const h = htmlEmbed('https://x.test/t');
  assert.ok(h.includes('<img'));
  assert.ok(h.includes('ticker.svg'));
  const j = jsEmbed('https://x.test/t');
  assert.ok(j.includes('<script'));
  assert.ok(j.includes('ticker.json'));
});

test('embeds bundles every snippet', () => {
  const e = embeds('https://x.test/t');
  for (const k of ['bbcode', 'bbcodeSvg', 'htmlImg', 'jsWidget', 'imageUrl', 'pngUrl', 'jsonUrl']) assert.ok(e[k], k);
});

// ── handler ───────────────────────────────────────────────────────────────────────────────────────
function mockRes() {
  return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; } };
}

test('handler /ticker.json returns json api', async () => {
  __setFetch(makeRpcStub());
  const res = mockRes();
  await handler({ url: '/ticker.json' }, res);
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const j = JSON.parse(res.body);
  assert.equal(j.numeraire, 'PRANA');
  assert.ok(Array.isArray(j.tokens));
  __setFetch(null);
});

test('handler /ticker.svg returns svg image', async () => {
  __setFetch(makeRpcStub());
  const res = mockRes();
  await handler({ url: '/ticker.svg?theme=light' }, res);
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /image\/svg/);
  assert.ok(res.body.startsWith('<svg'));
  __setFetch(null);
});

test('handler /ticker.png redirects to proxy', async () => {
  const res = mockRes();
  await handler({ url: '/ticker.png' }, res);
  assert.equal(res.code, 302);
  assert.ok(res.headers.location.includes('images.weserv.nl'));
});

test('handler / renders embed page with copy-paste snippets', async () => {
  const res = mockRes();
  await handler({ url: '/' }, res);
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.ok(res.body.includes('MELEK ecosystem price ticker'));
  assert.ok(res.body.includes('[img]'));
});

test('embedPage is esc-safe html', () => {
  const p = embedPage('https://x.test/t');
  assert.ok(p.startsWith('<!doctype html>'));
  assert.ok(p.includes('<textarea'));
});
