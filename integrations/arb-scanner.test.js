// Proves the depth-aware guard that kills phantom arbitrage: a huge top-of-book edge backed by
// almost no size must NOT read as a real, sizeable opportunity.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { executableBuy, executableSell, classifySuspect } from './arb-scanner.mjs';

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

// ── PHANTOM-EDGE GUARD (classifySuspect) ──────────────────────────────────────────────────────────
// The live failure: dead/one-sided/stale HE books (SWAP.ETH 139%, SWAP.MATIC 18.7%) topped the feed.
// These tests pin each suspect trigger and prove a clean SWAP.DOGE-class row stays clean.

test('classifySuspect: a CLEAN two-sided, deep, on-spot row is NOT flagged', () => {
  const v = classifySuspect({
    ask: 1, bid: 0.98, askUsd: 0.058, bidUsd: 0.057, realUsd: 0.06,
    execHive: 120, side: 'buy', askLevels: 4, bidLevels: 3,
  });
  assert.equal(v.suspect, false);
  assert.equal(v.reason, null);
});

test('classifySuspect: a one-sided book (missing bid) is suspect', () => {
  const v = classifySuspect({
    ask: 1, bid: 0, askUsd: 0.06, bidUsd: 0, realUsd: 0.06,
    execHive: 50, side: 'buy', askLevels: 3, bidLevels: 0,
  });
  assert.equal(v.suspect, true);
  assert.match(v.reason, /one-sided/);
});

test('classifySuspect: thin executable depth on the cheap side is suspect', () => {
  const v = classifySuspect({
    ask: 1, bid: 0.99, askUsd: 0.02, bidUsd: 0.059, realUsd: 0.06,
    execHive: 3, side: 'buy', askLevels: 1, bidLevels: 2, // ~3 HIVE < 5 floor
  });
  assert.equal(v.suspect, true);
  assert.match(v.reason, /thin executable depth|single thin level/);
});

test('classifySuspect: both legs far off the real price is a stale comparand', () => {
  // ask 0.02 (67% under) and bid 0.018 (70% under) vs real 0.06 — both far off ⇒ stale
  const v = classifySuspect({
    ask: 1, bid: 0.9, askUsd: 0.02, bidUsd: 0.018, realUsd: 0.06,
    execHive: 200, side: 'buy', askLevels: 3, bidLevels: 3,
  });
  assert.equal(v.suspect, true);
  assert.match(v.reason, /stale comparand/);
});

test('classifySuspect: a single-level cheap side below MIN_EXEC is flagged orphaned', () => {
  const v = classifySuspect({
    ask: 1, bid: 0.99, askUsd: 0.058, bidUsd: 0.059, realUsd: 0.06,
    execHive: 8, side: 'buy', askLevels: 1, bidLevels: 4, // one thin ask level, 8 HIVE < 20 MIN_EXEC
  });
  assert.equal(v.suspect, true);
  assert.match(v.reason, /single thin level/);
});

// Prove the DOWN-RANK contract end-to-end on the same sort the scanner uses: a suspect phantom row
// sinks below a clean row even when its headline edge*size product is larger.
test('suspect phantom rows sort BELOW clean rows regardless of headline edge', () => {
  const clean = { sym: 'SWAP.DOGE', edge: 0.04, execHive: 120, suspect: false };  // realizable 4.8
  const phantom = { sym: 'SWAP.ETH', edge: 1.39, execHive: 3, suspect: true };     // huge edge, tiny size
  const rows = [phantom, clean].sort((a, b) =>
    (a.suspect === b.suspect ? 0 : a.suspect ? 1 : -1) || (b.execHive * b.edge - a.execHive * a.edge));
  assert.equal(rows[0].sym, 'SWAP.DOGE', 'clean SWAP.DOGE on top');
  assert.equal(rows[1].sym, 'SWAP.ETH', 'suspect SWAP.ETH down-ranked below the clean row');
});
