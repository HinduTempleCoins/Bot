// solana-venues.test.mjs — FULLY OFFLINE. Injects a fake fetch; never hits the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SOLANA_VENUES, collectSolanaVenues, handler, __setFetch,
  parseDexScreenerPairs, parsePacifica, parseDrift,
  llamaDexVolume, llamaTvl, jupRefPrice, esc,
} from './solana-venues.mjs';

// ── fake-fetch harness: route by URL substring to a JSON body or an error ──────────────────────
function jsonRes(body, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) };
}
function routerFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [needle, val] of routes) {
      if (u.includes(needle)) {
        if (val instanceof Error) throw val;
        return val;
      }
    }
    // default: a not-found-style response (ok:false) so unmatched URLs soft-fail
    return jsonRes({ error: 'no route' }, false, 404);
  };
}

// canonical mocked bodies
const DS_PAIRS = [
  { dexId: 'raydium', pairAddress: 'P1', baseToken: { symbol: 'SOL', address: 'So111' }, quoteToken: { symbol: 'USDC', address: 'EPj' }, priceUsd: '150.5', liquidity: { usd: 5000000 }, volume: { h24: 9000000 }, priceChange: { h24: 1.2 } },
  { dexId: 'raydium', pairAddress: 'P2', baseToken: { symbol: 'BONK', address: 'Dez' }, quoteToken: { symbol: 'SOL', address: 'So111' }, priceUsd: '0.000022', liquidity: { usd: 800000 }, volume: { h24: 1200000 } },
  { dexId: 'orca', pairAddress: 'P3', baseToken: { symbol: 'SOL', address: 'So111' }, quoteToken: { symbol: 'USDC', address: 'EPj' }, priceUsd: '150.7', liquidity: { usd: 4000000 }, volume: { h24: 7000000 } },
];
const LLAMA_VOL = { name: 'Raydium', total24h: 75094555, total7d: 899518997, chains: ['Solana'] };
const JUP = { 'So11111111111111111111111111111111111111112': { usdPrice: 152.0 } };
const PACIFICA = { success: true, data: [
  { symbol: 'SOL', mark: '151.2', oracle: '151.0', funding: '0.0000125', open_interest: '10000', volume_24h: '50000' },
  { symbol: 'ETH', mark: '2500', oracle: '2499', funding: '0.00001', open_interest: '500', volume_24h: '2000' },
] };
const DRIFT = [
  { ticker_id: 'SOL-PERP', last_price: '151.5', quote_volume: '20000000', open_interest: '8000000', funding_rate: '0.00001' },
  { ticker_id: 'BTC-PERP', last_price: '65000', quote_volume: '10000000', open_interest: '5000000' },
];

test('registry has all nine venues with the right shape', () => {
  assert.equal(SOLANA_VENUES.length, 9);
  const names = SOLANA_VENUES.map((v) => v.name);
  for (const n of ['Raydium', 'PumpSwap', 'Orca', 'Jupiter', 'Meteora', 'Drift', 'Pacifica', 'Lifinity', 'Saros']) {
    assert.ok(names.includes(n), `missing ${n}`);
  }
  for (const v of SOLANA_VENUES) {
    assert.ok(['S', 'P', 'A'].includes(v.kind), `${v.name} bad kind`);
    assert.equal(v.chain, 'solana');
    assert.equal(v.dexscreenerChain, 'solana');
    assert.equal(typeof v.read, 'function');
  }
});

test('parseDexScreenerPairs filters by dexId and sorts by liquidity', () => {
  const rays = parseDexScreenerPairs([DS_PAIRS], 'raydium');
  assert.equal(rays.length, 2);
  assert.equal(rays[0].pair, 'SOL/USDC');      // highest liq first
  assert.equal(rays[0].liqUsd, 5000000);
  assert.equal(rays[0].priceUsd, 150.5);
  const orca = parseDexScreenerPairs([DS_PAIRS], 'orca');
  assert.equal(orca.length, 1);
  assert.equal(orca[0].pair, 'SOL/USDC');
});

test('parsePacifica computes USD volume/OI and a mark-vs-oracle basis edge', () => {
  const r = parsePacifica(PACIFICA);
  assert.ok(r.volume24hUsd > 0);
  assert.ok(r.oiUsd > 0);
  assert.equal(r.markets, 2);
  const sol = r.topPairs.find((p) => p.pair === 'SOL-PERP');
  assert.ok(sol);
  assert.equal(sol.priceUsd, 151.2);
  assert.ok(sol.basisPct != null);              // (151.2-151.0)/151.0
  assert.ok(Math.abs(sol.basisPct - (0.2 / 151.0)) < 1e-6);
});

test('parseDrift sums quote volume and exposes funding', () => {
  const r = parseDrift(DRIFT);
  assert.equal(r.markets, 2);
  assert.equal(r.volume24hUsd, 30000000);
  const sol = r.topPairs.find((p) => p.pair === 'SOL-PERP');
  assert.equal(sol.funding, 0.00001);
});

test('llamaDexVolume + llamaTvl + jupRefPrice parse mocked bodies', async () => {
  __setFetch(routerFetch([
    ['summary/dexs/raydium', jsonRes(LLAMA_VOL)],
    ['tvl/raydium', jsonRes(815243179.05)],
    ['price/v3', jsonRes(JUP)],
  ]));
  const vol = await llamaDexVolume('raydium');
  assert.equal(vol.volume24hUsd, 75094555);
  assert.equal(vol.volume7dUsd, 899518997);
  const tvl = await llamaTvl('raydium');
  assert.equal(tvl, 815243179.05);
  const ref = await jupRefPrice();
  assert.equal(ref, 152.0);
  __setFetch(null);
});

test('a spot venue read() parses DefiLlama + DexScreener + Jupiter ref', async () => {
  __setFetch(routerFetch([
    ['summary/dexs/raydium', jsonRes(LLAMA_VOL)],
    ['tvl/raydium', jsonRes(800000000)],
    ['token-pairs/v1/solana', jsonRes(DS_PAIRS)],
    ['price/v3', jsonRes(JUP)],
  ]));
  const raydium = SOLANA_VENUES.find((v) => v.name === 'Raydium');
  const r = await raydium.read();
  assert.equal(r.venue, 'Raydium');
  assert.equal(r.kind, 'S');
  assert.equal(r.volume24hUsd, 75094555);
  assert.equal(r.tvlUsd, 800000000);
  assert.ok(r.topPairs.length >= 1);
  assert.ok(r.sources.includes('defillama-dexs'));
  assert.ok(r.sources.includes('dexscreener'));
  assert.ok(r.depth && r.depth.pairCount >= 1);
  assert.ok(r.edgeSignals && r.edgeSignals.refUsd === 152.0);
  __setFetch(null);
});

test('a perp venue read() (Pacifica) parses native API into vol/OI/basis', async () => {
  __setFetch(routerFetch([
    ['pacifica.fi', jsonRes(PACIFICA)],
    ['tvl/pacifica', jsonRes(1234567)],
  ]));
  const pac = SOLANA_VENUES.find((v) => v.name === 'Pacifica');
  const r = await pac.read();
  assert.equal(r.kind, 'P');
  assert.ok(r.volume24hUsd > 0);
  assert.ok(r.depth && r.depth.openInterestUsd > 0);
  assert.ok(r.sources.includes('pacifica-api'));
  assert.ok(r.edgeSignals && r.edgeSignals.kind === 'perp-basis');
  __setFetch(null);
});

test('collectSolanaVenues returns a slot per venue; dead source → alive:false (never throws)', async () => {
  // route ONLY raydium's sources; everything else 404s → those venues become alive:false slots
  __setFetch(routerFetch([
    ['summary/dexs/raydium', jsonRes(LLAMA_VOL)],
    ['tvl/raydium', jsonRes(800000000)],
    ['token-pairs/v1/solana', jsonRes(DS_PAIRS.filter((p) => p.dexId === 'raydium'))],
    ['price/v3', jsonRes(JUP)],
  ]));
  const { asOf, venues } = await collectSolanaVenues();
  assert.ok(asOf);
  assert.equal(venues.length, 9);                 // every slot present
  const ray = venues.find((v) => v.venue === 'Raydium');
  assert.equal(ray.alive, true);
  assert.ok(ray.data.volume24hUsd > 0);
  // Lifinity got no matching routes → dead slot, not a throw
  const lif = venues.find((v) => v.venue === 'Lifinity');
  assert.equal(lif.alive, false);
  assert.equal(lif.data, null);
  __setFetch(null);
});

test('total network failure soft-fails to all-dead slots, never throws', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const { venues } = await collectSolanaVenues();
  assert.equal(venues.length, 9);
  assert.ok(venues.every((v) => v.alive === false));
  __setFetch(null);
});

test('garbage bodies soft-fail (no throw, null fields)', async () => {
  __setFetch(routerFetch([
    ['summary/dexs', jsonRes('not an object')],
    ['tvl/', jsonRes({ junk: true })],
    ['token-pairs', jsonRes({ not: 'an array' })],
    ['price/v3', jsonRes(null)],
    ['pacifica.fi', jsonRes({ garbage: 1 })],
  ]));
  assert.equal(await llamaDexVolume('raydium'), null);
  assert.equal(await llamaTvl('raydium'), null);
  assert.deepEqual(parseDexScreenerPairs({ not: 'array' }, 'raydium'), []);
  assert.equal(parsePacifica({ garbage: 1 }), null);
  assert.equal(parseDrift('nope'), null);
  const { venues } = await collectSolanaVenues();
  assert.ok(venues.every((v) => v.alive === false));   // no usable data anywhere
  __setFetch(null);
});

test('handler GET /api/venues/solana returns ok shape; 404 on other paths', async () => {
  __setFetch(routerFetch([
    ['summary/dexs/orca', jsonRes({ total24h: 110968298, total7d: 700000000, chains: ['Solana'] })],
    ['tvl/orca', jsonRes(300000000)],
    ['token-pairs/v1/solana', jsonRes(DS_PAIRS.filter((p) => p.dexId === 'orca'))],
    ['price/v3', jsonRes(JUP)],
  ]));
  const mk = (url) => {
    let code, body;
    const res = { writeHead: (c) => { code = c; }, end: (b) => { body = b; } };
    return { run: async () => { await handler({ url, headers: { host: 'x' } }, res); return { code, body: body && JSON.parse(body) }; } };
  };
  const ok = await mk('/api/venues/solana').run();
  assert.equal(ok.code, 200);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.venues.length, 9);
  const nf = await mk('/nope').run();
  assert.equal(nf.code, 404);
  assert.equal(nf.body.ok, false);
  __setFetch(null);
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});
