// arb-facade.test.mjs — OFFLINE tests for scanAllArb(): the four arb detectors are INJECTED (no
// network), and we verify dedup, ranking by net edge, and independent soft-fail of each detector.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanAllArb } from './arb-facade.mjs';

// fake detector outputs in each module's native shape.
const fakeScanArb = async () => ({
  opportunities: [
    { sym: 'SWAP.DOGE', edge: 0.04, execHive: 120, side: 'buy', signal: 'BUY SWAP.DOGE on HE' },
    { sym: 'SWAP.LTC', edge: 0.06, execHive: 80, side: 'sell', signal: 'SELL SWAP.LTC on HE' },
  ],
});
const fakeCrossVenue = async () => ({
  edges: [
    { token: 'SWAP.BTC', netPct: 1.2, chain: 'Bitcoin', usVenue: { name: 'Coinbase' } },
    { token: 'SWAP.DOGE', netPct: 2.5, chain: 'Dogecoin', usVenue: { name: 'Kraken' } },
  ],
});
const fakeScanSymbol = async (sym) => ({
  symbol: sym,
  best: sym === 'BTC/USDT' ? { netEdgePct: 0.3, buyOn: 'kraken', buyAsk: 100, sellOn: 'binance', sellBid: 100.3 } : null,
});
const fakeCrossChain = async (q) => ({
  query: q,
  opportunity: q === 'PEPE' ? { spreadPct: 7.5, buyOn: 'eth/uni', buyUsd: 1, sellOn: 'base/aero', sellUsd: 1.075, verified: true } : null,
});

const inject = {
  scanArb: fakeScanArb,
  crossVenueEdges: fakeCrossVenue,
  scanSymbol: fakeScanSymbol,
  crossChainSpread: fakeCrossChain,
  cexPairs: ['BTC/USDT', 'ETH/USDT'],
  xchainQueries: ['PEPE', 'NOTHING'],
};

test('returns ONE combined feed over all four detectors', async () => {
  const { rows, sources } = await scanAllArb(inject);
  // arb-scanner=2, cross-venue=2, cex=1 (only BTC had a best), crosschain=1 (only PEPE)
  assert.equal(sources['arb-scanner'], 2);
  assert.equal(sources['cross-venue'], 2);
  assert.equal(sources['cex-arb'], 1);
  assert.equal(sources['crosschain'], 1);
  assert.equal(rows.length, 6);
});

test('ranked by net edge percentage, descending', async () => {
  const { rows } = await scanAllArb(inject);
  const pcts = rows.map((r) => r.netEdgePct);
  const sorted = [...pcts].sort((a, b) => b - a);
  assert.deepEqual(pcts, sorted);
  // crosschain PEPE 7.5% should be the top row
  assert.equal(rows[0].source, 'crosschain');
  assert.equal(rows[0].netEdgePct, 7.5);
});

test('the same token from DIFFERENT detectors is kept separately (different route)', async () => {
  const { rows } = await scanAllArb(inject);
  const doge = rows.filter((r) => r.market === 'SWAP.DOGE');
  assert.equal(doge.length, 2, 'SWAP.DOGE appears once per detector (arb-scanner + cross-venue)');
  assert.deepEqual([...new Set(doge.map((r) => r.source))].sort(), ['arb-scanner', 'cross-venue']);
});

test('dedup WITHIN a source keeps the strongest net edge for a repeated market', async () => {
  const dupScanArb = async () => ({
    opportunities: [
      { sym: 'SWAP.X', edge: 0.03, execHive: 50, side: 'buy', signal: 'a' },
      { sym: 'SWAP.X', edge: 0.09, execHive: 50, side: 'buy', signal: 'b' }, // stronger, same source+market
    ],
  });
  const { rows } = await scanAllArb({ ...inject, scanArb: dupScanArb, crossVenueEdges: async () => ({ edges: [] }), scanSymbol: async () => ({ best: null }), crossChainSpread: async () => ({ opportunity: null }) });
  const xs = rows.filter((r) => r.market === 'SWAP.X');
  assert.equal(xs.length, 1);
  assert.equal(xs[0].netEdgePct, 9); // the 0.09 edge → 9%, kept over the 3%
});

test('one detector throwing does NOT sink the others (independent soft-fail)', async () => {
  const boom = async () => { throw new Error('detector exploded'); };
  const { rows, sources, errors } = await scanAllArb({ ...inject, scanArb: boom });
  assert.equal(sources['arb-scanner'], 0);
  assert.match(errors['arb-scanner'], /exploded/);
  // the other three still produced rows
  assert.ok(rows.length >= 4);
  assert.equal(sources['cross-venue'], 2);
});

test('a single cex pair failing is soft-failed per-pair, others still scan', async () => {
  const flaky = async (sym) => { if (sym === 'ETH/USDT') throw new Error('rate limited'); return { best: { netEdgePct: 1, buyOn: 'a', buyAsk: 1, sellOn: 'b', sellBid: 1.01 } }; };
  const { sources, errors } = await scanAllArb({ ...inject, scanSymbol: flaky, scanArb: async () => ({ opportunities: [] }), crossVenueEdges: async () => ({ edges: [] }), crossChainSpread: async () => ({ opportunity: null }) });
  assert.equal(sources['cex-arb'], 1, 'BTC/USDT scanned even though ETH/USDT failed');
  assert.match(errors['cex-arb:ETH/USDT'], /rate limited/);
});

test('all-empty detectors → empty feed, no throw (the common, correct result)', async () => {
  const empty = {
    scanArb: async () => ({ opportunities: [] }),
    crossVenueEdges: async () => ({ edges: [] }),
    scanSymbol: async () => ({ best: null }),
    crossChainSpread: async () => ({ opportunity: null }),
    cexPairs: ['BTC/USDT'], xchainQueries: [],
  };
  const { rows, errors } = await scanAllArb(empty);
  assert.deepEqual(rows, []);
  assert.deepEqual(errors, {});
});

test('rows carry a feesApplied flag (net vs gross) and source/market/detail', async () => {
  const { rows } = await scanAllArb(inject);
  for (const r of rows) {
    assert.ok(typeof r.source === 'string' && r.source);
    assert.ok(typeof r.market === 'string' && r.market);
    assert.ok(typeof r.netEdgePct === 'number');
    assert.ok(typeof r.feesApplied === 'boolean');
    assert.ok(typeof r.detail === 'string');
  }
  // cross-venue + cex are fee-netted; arb-scanner + crosschain are gross
  assert.equal(rows.find((r) => r.source === 'cross-venue').feesApplied, true);
  assert.equal(rows.find((r) => r.source === 'arb-scanner').feesApplied, false);
});

// PHANTOM-EDGE GUARD propagates into the combined feed: a suspect arb-scanner row (flagged by
// classifySuspect upstream) carries its flag and is DOWN-RANKED below clean rows even though its
// headline net edge is the largest in the feed.
test('a suspect phantom arb-scanner row is flagged and ranked BELOW clean rows', async () => {
  const phantomScanArb = async () => ({
    opportunities: [
      // huge headline edge but flagged suspect by the scanner's phantom guard (one-sided/thin/stale)
      { sym: 'SWAP.ETH', edge: 1.39, execHive: 3, side: 'buy', signal: 'BUY SWAP.ETH on HE', suspect: true, suspectReason: 'one-sided HE book (missing bid or ask); thin executable depth (3.0 < 5 HIVE)' },
      // clean, proven SWAP.DOGE-class edge
      { sym: 'SWAP.DOGE', edge: 0.05, execHive: 150, side: 'buy', signal: 'BUY SWAP.DOGE on HE', suspect: false },
    ],
  });
  const { rows } = await scanAllArb({
    ...inject, scanArb: phantomScanArb,
    crossVenueEdges: async () => ({ edges: [] }), scanSymbol: async () => ({ best: null }), crossChainSpread: async () => ({ opportunity: null }),
  });
  const eth = rows.find((r) => r.market === 'SWAP.ETH');
  const doge = rows.find((r) => r.market === 'SWAP.DOGE');
  // the suspect row is preserved (NOT deleted) and carries the flag + reason
  assert.ok(eth, 'suspect SWAP.ETH row is kept, not dropped');
  assert.equal(eth.suspect, true);
  assert.match(eth.suspectReason, /one-sided|thin/);
  assert.match(eth.detail, /SUSPECT/);
  // and it ranks BELOW the clean SWAP.DOGE row despite a 139% vs 5% headline edge
  assert.ok(rows.indexOf(doge) < rows.indexOf(eth), 'clean SWAP.DOGE ranks above suspect SWAP.ETH');
  assert.equal(rows[0].market, 'SWAP.DOGE', 'clean row tops the feed');
  // a clean arb-scanner row leaves suspect false
  assert.equal(doge.suspect, false);
});
