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
