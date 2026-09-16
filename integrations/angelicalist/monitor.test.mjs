// monitor.test.mjs — OFFLINE tests for the read-only background monitor. Everything injected: fake
// snapshot, fake on-chain history, fake ledger/analyzer/arb. NO network, NO key. Proves the monitor
// composes the sources and that assess() raises the right signals/anomalies.
//
//   node --test integrations/angelicalist/monitor.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collect, assess, report } from './monitor.mjs';

// fake on-chain ops in the shape tradebot-forensics.reconstruct() reads (operation + data).
const ops = [
  { operation: 'market_buy', data: { symbol: 'SWAP.DOGE', quantity: 1000, quantityHive: 50 } },
  { operation: 'market_sell', data: { symbol: 'SWAP.DOGE', quantity: 1000, quantityHive: 58 } },   // +8 HIVE earner
  { operation: 'market_buy', data: { symbol: 'SWAP.LTC', quantity: 5, quantityHive: 40 } },          // one-way bleed (never sold)
];

const deps = {
  account: 'angelicalist',
  snapshot: async () => ({
    account: 'angelicalist', at: 't',
    tokens: [{ symbol: 'SWAP.HIVE', balance: 5 }, { symbol: 'VKBT', balance: 86992 }, { symbol: 'SWAP.DOGE', balance: 0 }],
    openOrders: [{ side: 'sell', symbol: 'PAY', quantity: 1, price: 0.1 }],
  }),
  history: async () => ops,
  ledgerSummary: async () => ({ trades: 2, markets: 1, volume: 108, fees: 0, netPnl: 8, best: { market: 'SWAP.DOGE', realized: 8 }, worst: null }),
  analyze: async () => ([{ title: 'demo finding', severity: 'low' }]),
  scanArb: async () => ({ opportunities: [{ sym: 'SWAP.BTC', edge: 0.04, execHive: 120 }], rows: [{ sym: 'SWAP.ETH', edge: 1.64, execHive: 50 }] }),
};

test('collect composes all read-only sources without network/keys', async () => {
  const c = await collect(deps);
  assert.equal(c.account, 'angelicalist');
  assert.equal(c.snapshot.tokens.length, 3);
  assert.equal(c.opsCount, 3);
  assert.ok(c.forensics.sym['SWAP.DOGE'], 'forensics reconstructed DOGE');
  assert.equal(c.ledger.netPnl, 8);
});

test('assess computes realized P&L, best earner, worst bleed', async () => {
  const a = assess(await collect(deps));
  assert.equal(a.portfolio.tokenCount, 3);
  assert.equal(a.portfolio.idleHive, 5);
  assert.equal(a.portfolio.openOrders, 1);
  // DOGE: recv 58 − spent 50 = +8 ; LTC: recv 0 − spent 40 = −40
  assert.equal(a.trading.bestEarner.symbol, 'SWAP.DOGE');
  assert.equal(a.trading.bestEarner.net, 8);
  assert.equal(a.trading.worstBleed.symbol, 'SWAP.LTC');
  assert.equal(a.trading.worstBleed.net, -40);
  assert.equal(a.trading.realizedNetHive, -32); // 8 + (−40)
});

test('assess flags one-way accumulation (SWAP.LTC) and dead-book edge (SWAP.ETH 164%)', async () => {
  const a = assess(await collect(deps));
  assert.ok(a.anomalies.some((x) => x.kind === 'one-way-accumulation' && x.symbol === 'SWAP.LTC'), 'LTC one-way bleed flagged');
  assert.ok(a.anomalies.some((x) => x.kind === 'dead-book-edge' && x.symbol === 'SWAP.ETH'), 'ETH phantom edge flagged');
  assert.equal(a.health, 'warn', 'one-way accumulation should set health=warn');
});

test('assess picks the top believable live edge (SWAP.BTC 4%, not the 164% phantom)', async () => {
  const a = assess(await collect(deps));
  assert.ok(a.opportunities.top, 'should have a top opportunity');
  assert.equal(a.opportunities.top.sym, 'SWAP.BTC', 'the 164% ETH edge is rejected as dead-book; BTC 4% wins');
});

test('report renders without throwing and shows the health dot', async () => {
  const c = await collect(deps);
  const r = report(c);
  assert.match(r, /angelicalist monitor/);
  assert.match(r, /Anomalies/);
});

test('soft-fails to a degraded snapshot when the account read errors', async () => {
  const c = await collect({ ...deps, snapshot: async () => { throw new Error('rpc down'); } });
  const a = assess(c);
  assert.equal(a.health, 'degraded');
});

// ─── THE REPORT MUST NOT LIE (2026-09-16) ─────────────────────────────────────────────────────────
//
// Two defects found live: (a) latest.txt said "none actionable right now (0 markets scanned)" while
// latest.json held 9 arb rows — because the deployed timer ran the CLI twice, two independent scans,
// and reported the one that soft-failed; (b) VKBT/CURE were flagged "one-way-accumulation … bleed
// risk" every tick, which is the ratchet's design, not a defect. Reporting intent as a fault teaches
// the reader to skip the anomaly list.

const issuedOps = [
  { operation: 'market_buy', data: { symbol: 'VKBT', quantity: 1e6, quantityHive: 2.78 } },
  { operation: 'market_buy', data: { symbol: 'CURE', quantity: 1000, quantityHive: 5.55 } },
  { operation: 'market_buy', data: { symbol: 'SWAP.LTC', quantity: 5, quantityHive: 40 } },
];

test('issued tokens are NOT flagged as a bleed — the ratchet never sells our own issue', async () => {
  const c = await collect({ ...deps, history: async () => issuedOps });
  const a = assess(c);
  const kinds = Object.fromEntries(a.anomalies.map((x) => [x.symbol, x.kind]));
  assert.equal(kinds.VKBT, 'issued-token-accumulation');
  assert.equal(kinds.CURE, 'issued-token-accumulation');
  assert.equal(kinds['SWAP.LTC'], 'one-way-accumulation', 'a genuine third-party bleed still warns');
  assert.match(a.anomalies.find((x) => x.symbol === 'VKBT').detail, /working as designed/);
});

test('issued-token accumulation alone does not degrade the health dot', async () => {
  const c = await collect({ ...deps, history: async () => issuedOps.slice(0, 2) });
  assert.equal(assess(c).health, 'ok');
});

test('a genuine one-way bleed still turns the health dot yellow', async () => {
  const c = await collect({ ...deps, history: async () => issuedOps.slice(2) });
  assert.equal(assess(c).health, 'warn');
});

test('report never says "0 markets scanned" when rows were scanned', async () => {
  // the real 2026-09-16 scan: 10 rows, the only non-zero edge is the known SWAP.ETH phantom.
  const c = await collect({ ...deps, scanArb: async () => ({
    opportunities: [{ sym: 'SWAP.ETH', edge: 3.756, execHive: 2647, suspect: true, suspectReason: 'both legs far off real (stale comparand)' }],
    rows: [{ sym: 'SWAP.BTC', edge: 0, execHive: 0 }, { sym: 'SWAP.LTC', edge: 0, execHive: 0 }],
  }) });
  const a = assess(c);
  const txt = report(c, a);
  assert.equal(a.opportunities.scanned, 3, 'three distinct markets');
  assert.doesNotMatch(txt, /0 markets scanned/);
  assert.match(txt, /3 market\(s\) scanned/);
});

test('report NAMES the phantom edge and says why it is not an opportunity', async () => {
  const c = await collect({ ...deps, scanArb: async () => ({
    opportunities: [{ sym: 'SWAP.ETH', edge: 3.756, execHive: 2647, suspect: true, suspectReason: 'both legs far off real (stale comparand)' }],
    rows: [],
  }) });
  const txt = report(c, assess(c));
  assert.match(txt, /rejected: SWAP\.ETH shows 376%/);
  assert.match(txt, /stale comparand/);
  assert.match(txt, /SWAP\.ETH trap, not an opportunity/);
});

test('a scanner that returned NOTHING is reported as a scanner failure, not a quiet market', async () => {
  const c = await collect({ ...deps, scanArb: async () => ({ opportunities: [], rows: [] }) });
  const txt = report(c, assess(c));
  assert.match(txt, /THE SCAN RETURNED NOTHING/);
  assert.match(txt, /the scanner failed/);
});

test('a real, believable edge is still surfaced as the top edge', async () => {
  const c = await collect({ ...deps, scanArb: async () => ({ opportunities: [{ sym: 'SWAP.DOGE', edge: 0.06, execHive: 300 }], rows: [] }) });
  const txt = report(c, assess(c));
  assert.match(txt, /Top live edge: SWAP\.DOGE 6\.0%/);
});

// ─── REALIZED NET IS NOT TRADING PROFIT ───────────────────────────────────────────────────────────
//
// The real 2026-09-16 decomposition: 17 tokens sold with zero buys (+122.83 HIVE of bags the account
// already held), VKBT+CURE bought and never sold (−8.33, the ratchet), and NOTHING bought-then-sold.
// One headline number hid that for months. "Selling is not profit — buy first" is a standing rule.

const mixedOps = [
  { operation: 'market_sell', data: { symbol: 'SPS', quantity: 1000, quantityHive: 76.02 } },   // liquidation
  { operation: 'market_sell', data: { symbol: 'BBH', quantity: 5000, quantityHive: 17.62 } },   // liquidation
  { operation: 'market_buy', data: { symbol: 'VKBT', quantity: 1e6, quantityHive: 2.78 } },     // accumulation
  { operation: 'market_buy', data: { symbol: 'SWAP.DOGE', quantity: 1000, quantityHive: 50 } }, // a REAL round trip
  { operation: 'market_sell', data: { symbol: 'SWAP.DOGE', quantity: 1000, quantityHive: 58 } },
];

test('realized net is split into trading profit vs liquidation vs accumulation', async () => {
  const a = assess(await collect({ ...deps, history: async () => mixedOps }));
  assert.equal(a.trading.pnl.roundTripHive, 8, 'only the bought-then-sold token counts as profit');
  assert.equal(a.trading.pnl.roundTripTokens, 1);
  assert.equal(a.trading.pnl.liquidationHive, 93.64, 'SPS + BBH were bags, not trades');
  assert.equal(a.trading.pnl.liquidationTokens, 2);
  assert.equal(a.trading.pnl.accumulationHive, -2.78);
});

test('the live case: zero round trips is reported as zero, not hidden inside the headline', async () => {
  const a = assess(await collect({ ...deps, history: async () => mixedOps.slice(0, 3) }));
  assert.equal(a.trading.pnl.roundTripHive, 0);
  assert.equal(a.trading.pnl.roundTripTokens, 0);
  assert.ok(a.trading.realizedNetHive > 90, 'while the headline still looks like a profit');
});

test('report states the trading-profit line explicitly', async () => {
  const c = await collect({ ...deps, history: async () => mixedOps.slice(0, 3) });
  const txt = report(c, assess(c));
  assert.match(txt, /of which TRADING PROFIT \(bought, then sold higher\): 0 HIVE across 0 token\(s\)/);
  assert.match(txt, /liquidation of bags we already held \(not profit\): 93\.64 HIVE/);
});
