// cex-arb.test.js — the cross-exchange spread math (pure, no ccxt/network).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestCrossExchange } from './cex-arb.mjs';

test('finds a real arb: high bid on A vs low ask on B, net of fees', () => {
  const best = bestCrossExchange([
    { exchange: 'cheap', bid: 99, ask: 100, takerFee: 0.001 },
    { exchange: 'rich', bid: 110, ask: 111, takerFee: 0.001 },
  ]);
  // buy on cheap @100, sell on rich @110 -> ~+9.8% net of 0.1% each side
  assert.equal(best.buyOn, 'cheap');
  assert.equal(best.sellOn, 'rich');
  assert.ok(best.netEdgePct > 9 && best.netEdgePct < 10);
});

test('no arb when spreads are within fees', () => {
  const best = bestCrossExchange([
    { exchange: 'a', bid: 100.0, ask: 100.1, takerFee: 0.001 },
    { exchange: 'b', bid: 100.05, ask: 100.15, takerFee: 0.001 },
  ]);
  assert.ok(best.edge < 0); // fees eat the tiny spread
});

test('fees flip a nominal spread into a loss', () => {
  // bid 100.5 vs ask 100.0 looks like +0.5%, but 1% taker each side kills it
  const best = bestCrossExchange([
    { exchange: 'a', bid: 100.5, ask: 100.6, takerFee: 0.01 },
    { exchange: 'b', bid: 100.4, ask: 100.0, takerFee: 0.01 },
  ]);
  assert.ok(best.netEdgePct < 0);
});

test('returns null with fewer than two valid venues', () => {
  assert.equal(bestCrossExchange([{ exchange: 'a', bid: 1, ask: 2 }]), null);
  assert.equal(bestCrossExchange([{ exchange: 'a', bid: 0, ask: 0 }, { exchange: 'b', bid: 1, ask: 2 }]), null);
});

test('never pairs an exchange with itself', () => {
  const best = bestCrossExchange([
    { exchange: 'a', bid: 200, ask: 100, takerFee: 0 }, // crossed book on one venue — must not self-arb
    { exchange: 'b', bid: 100, ask: 101, takerFee: 0 },
  ]);
  assert.notEqual(best.buyOn, best.sellOn);
});
