// Proves the depth-aware guard that kills phantom arbitrage: a huge top-of-book edge backed by
// almost no size must NOT read as a real, sizeable opportunity.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executableBuy, executableSell } from './arb-scanner.mjs';

const HIVE_USD = 0.06;       // $/HIVE
const REAL_ETH = 1981;        // real ETH/USD

test('phantom: a thin underpriced ask yields tiny executable HIVE', () => {
  // mirrors the live SWAP.ETH phantom: a deeply-underpriced ask (~31% of real => 200%+ edge)
  // but only a fraction of a token deep, so only a few HIVE are actually executable.
  const pricePerToken = (REAL_ETH / HIVE_USD) * 0.31; // HIVE per token, far below fair
  const asks = [{ price: pricePerToken, quantity: 7 / pricePerToken }]; // ~7 HIVE of depth
  const { execHive, edge } = executableBuy(asks, REAL_ETH, HIVE_USD);
  assert.ok(edge > 0.5, 'edge is large at top of book');
  assert.ok(execHive < 20, `executable HIVE should be tiny (was ${execHive})`);
});

test('real opportunity: deep underpriced asks accumulate executable HIVE', () => {
  const cheap = REAL_ETH / HIVE_USD * 0.9; // 10% underpriced, in HIVE/token
  const asks = [
    { price: cheap, quantity: 1 },
    { price: cheap * 1.01, quantity: 2 },
    { price: cheap * 1.02, quantity: 3 },
  ];
  const { execHive, edge } = executableBuy(asks, REAL_ETH, HIVE_USD);
  assert.ok(edge >= 0.03, 'edge above threshold');
  assert.ok(execHive > 20, `should accumulate real depth (was ${execHive})`);
});

test('executableBuy stops once the book has caught up to real price', () => {
  const fair = REAL_ETH / HIVE_USD;        // exactly fair
  const asks = [
    { price: fair * 0.9, quantity: 5 },    // 10% under — executable
    { price: fair * 1.0, quantity: 100 },  // fair — must be ignored
    { price: fair * 1.1, quantity: 100 },  // over — ignored
  ];
  const { execHive } = executableBuy(asks, REAL_ETH, HIVE_USD);
  const onlyFirst = fair * 0.9 * 5;
  assert.ok(Math.abs(execHive - onlyFirst) < 1e-6, 'only the underpriced level counts');
});

test('executableSell mirrors: only bids above real price count', () => {
  const fair = REAL_ETH / HIVE_USD;
  const bids = [
    { price: fair * 1.1, quantity: 4 },    // 10% over real — sell into it
    { price: fair * 1.0, quantity: 50 },   // fair — ignored
  ];
  const { execHive, edge } = executableSell(bids, REAL_ETH, HIVE_USD);
  assert.ok(edge >= 0.03);
  assert.ok(Math.abs(execHive - fair * 1.1 * 4) < 1e-6);
});

test('empty / zero-quantity book yields no executable edge', () => {
  assert.equal(executableBuy([], REAL_ETH, HIVE_USD).execHive, 0);
  assert.equal(executableBuy([{ price: 0, quantity: 0 }], REAL_ETH, HIVE_USD).execHive, 0);
});
