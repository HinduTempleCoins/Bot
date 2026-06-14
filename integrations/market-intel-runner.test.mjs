// market-intel-runner.test.mjs — FULLY OFFLINE. No network: collectAll runs against MOCKED readers
// passed via opts.readers (or __setReaders). Asserts: composition, a dead/throwing reader → that
// section null + sources[].ok=false (others still populate), the fused feed is included, garbage
// soft-fails to a valid empty snapshot, and the handler returns 200 JSON.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectAll, handler, __setReaders } from './market-intel-runner.mjs';

// A full set of healthy mocked readers — NONE of them touch the network.
function goodReaders() {
  return {
    brain: async () => ({
      ok: true,
      sections: [
        { key: 'crypto', title: 'Crypto', entries: [{ symbol: 'BTC', confident: true, sources: ['cg'] }, { symbol: 'ETH', confident: false, sources: [] }] },
        { key: 'fx', title: 'FX', entries: [{ symbol: 'EURUSD', confident: true }] },
        { key: 'metals', title: 'Metals', entries: [{ symbol: 'XAU', confident: true }] },
        { key: 'commodities', title: 'Commodities', entries: [{ symbol: 'WTI', confident: false }] },
        { key: 'stocks', title: 'Stocks', entries: [{ symbol: 'SPY', confident: true }] },
        { key: 'bonds', title: 'Bonds', entries: [{ symbol: 'US10Y', confident: true }] },
        { key: 'futures', title: 'Futures', entries: [{ symbol: 'ES', confident: false }] },
      ],
    }),
    sol: async () => ({
      quotes: [{ market: 'USDC/USDT', price: 0.99, confidence: 0.9 }],
      intentions: [{ coin: 'solana', market: 'USDC/USDT', side: 'buy', size: 3, price: 0.99, edgePct: 0.04, dryRun: true, signer: null }],
    }),
    polygon: async () => ({
      quotes: [{ market: 'USDC/DAI', price: 1.0 }],
      intentions: [{ coin: 'polygon', market: 'USDC/DAI', side: 'sell', size: 2, price: 1.0, edgePct: 0.02, dryRun: true, signer: null }],
    }),
    multichain: async () => ({ nativePrices: { ethereum: { usd: 3000 } }, tvl: { Ethereum: 5e10 } }),
    scraped: async () => ({ hits: [{ title: 'BTC up', url: 'https://example.com/a' }, { title: 'ETH news', url: 'https://example.com/b' }] }),
  };
}

test('collectAll composes mocked readers into a full normalized snapshot', async () => {
  const snap = await collectAll({ readers: goodReaders() });

  // every market slot present, brain sections split out correctly
  for (const k of ['crypto', 'fx', 'metals', 'commodities', 'stocks', 'bonds', 'futures', 'sol', 'polygon', 'multichain']) {
    assert.ok(k in snap.markets, `markets.${k} slot exists`);
  }
  assert.equal(snap.markets.crypto.length, 2);
  assert.equal(snap.markets.stocks[0].symbol, 'SPY');
  assert.equal(snap.markets.sol.intentions.length, 1);
  assert.equal(snap.markets.polygon.quotes[0].market, 'USDC/DAI');
  assert.deepEqual(snap.markets.multichain.nativePrices.ethereum, { usd: 3000 });

  // scraped section normalized to a flat array
  assert.equal(snap.scraped.length, 2);
  assert.equal(snap.scraped[0].url, 'https://example.com/a');

  // every reader reported ok in sources[]
  assert.ok(snap.sources.length >= 5);
  assert.ok(snap.sources.every((s) => s.ok === true), 'all sources ok');
  assert.equal(snap.confidence, 1);
  assert.equal(snap.readOnly, true);
  assert.ok(snap.asOf);
});

test('the fused ACT/WATCH/REJECT feed is included', async () => {
  const snap = await collectAll({ readers: goodReaders() });
  assert.ok(snap.feed, 'feed present');
  assert.ok(Array.isArray(snap.feed.signals));
  assert.ok(snap.feed.counts && typeof snap.feed.counts.ACT === 'number');
  assert.ok(snap.feed.generatedAt);
  // the two DEX dry-run intentions were fed in as signals → at least the verdicted count is non-zero
  const total = snap.feed.counts.ACT + snap.feed.counts.WATCH + snap.feed.counts.REJECT;
  assert.ok(total >= 1, 'DEX intentions produced at least one fused signal');
});

test('a dead/throwing reader yields a null section + sources[].ok=false; others still populate', async () => {
  const readers = goodReaders();
  readers.sol = async () => { throw new Error('jupiter timeout'); };       // throws
  readers.multichain = undefined;                                          // missing entirely

  const snap = await collectAll({ readers });

  // the broken sections are null, NOT thrown
  assert.equal(snap.markets.sol, null);
  assert.equal(snap.markets.multichain, null);

  // their source lines report the failure
  const sol = snap.sources.find((s) => s.name === 'chains/sol-bot');
  const mc = snap.sources.find((s) => s.name === 'chains/multichain');
  assert.equal(sol.ok, false);
  assert.match(sol.note, /jupiter timeout/);
  assert.equal(mc.ok, false);

  // the healthy readers STILL populated
  assert.equal(snap.markets.crypto.length, 2);
  assert.equal(snap.markets.polygon.quotes[0].market, 'USDC/DAI');
  assert.equal(snap.scraped.length, 2);

  // confidence reflects the partial failure (not 0, not 1)
  assert.ok(snap.confidence > 0 && snap.confidence < 1);

  // and the feed is STILL produced from the survivors
  assert.ok(Array.isArray(snap.feed.signals));
});

test('garbage / a totally broken reader set soft-fails to a valid empty snapshot', async () => {
  // readers whose every entry throws at call time
  const boom = new Proxy({}, { get: () => async () => { throw new Error('boom'); } });
  const snap = await collectAll({ readers: boom });

  assert.equal(snap.readOnly, true);
  assert.ok(snap.asOf);
  // valid shape: every market slot present and null
  for (const k of ['crypto', 'sol', 'polygon', 'fx', 'metals', 'commodities', 'stocks', 'bonds', 'futures', 'multichain']) {
    assert.equal(snap.markets[k], null);
  }
  assert.deepEqual(snap.scraped, []);
  assert.equal(snap.confidence, 0);
  // feed is a valid empty feed, never undefined
  assert.deepEqual(snap.feed.counts, { ACT: 0, WATCH: 0, REJECT: 0 });
  assert.deepEqual(snap.feed.signals, []);
});

test('__setReaders override path works (no opts.readers needed)', async () => {
  __setReaders(goodReaders());
  try {
    const snap = await collectAll();
    assert.equal(snap.markets.crypto.length, 2);
    assert.ok(snap.sources.every((s) => s.ok));
  } finally {
    __setReaders(null);
  }
});

test('handler GET /api/intel returns 200 JSON snapshot+feed', async () => {
  __setReaders(goodReaders());
  try {
    let code, body, headers;
    const res = {
      writeHead(c, h) { code = c; headers = h; },
      end(b) { body = b; },
    };
    const out = await handler({ method: 'GET', url: '/api/intel' }, res);
    assert.equal(code, 200);
    assert.equal(headers['Content-Type'], 'application/json');
    const parsed = JSON.parse(body);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.readOnly, true);
    assert.ok(parsed.markets && 'crypto' in parsed.markets);
    assert.ok(parsed.feed && Array.isArray(parsed.feed.signals));
    assert.equal(out.ok, true);
  } finally {
    __setReaders(null);
  }
});

test('handler rejects non-GET and unknown paths without throwing', async () => {
  const mk = () => { let code, body; return { res: { writeHead(c) { code = c; }, end(b) { body = b; } }, get: () => ({ code, body }) }; };

  const a = mk();
  await handler({ method: 'POST', url: '/api/intel' }, a.res);
  assert.equal(a.get().code, 405);

  const b = mk();
  await handler({ method: 'GET', url: '/nope' }, b.res);
  assert.equal(b.get().code, 404);
});
