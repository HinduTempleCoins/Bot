import { test } from 'node:test';
import assert from 'node:assert/strict';
import { strategyDecisions, recommendedCapHive, momentumTokens } from './strategy-feed.mjs';

test('DEFAULT OFF: no MOMENTUM_TOKENS → empty decisions (loop unchanged)', async () => {
  delete process.env.MOMENTUM_TOKENS;
  assert.deepEqual(momentumTokens(), []);
  assert.deepEqual(await strategyDecisions(), []);
});

test('momentum SELL (exit held inventory) becomes a loop decision in the right shape', async () => {
  const decisions = await strategyDecisions({
    tokens: ['SPS'], strategy: 'momentum',
    // fast below slow → exit signal; inventory present → sell the position (round-trip close)
    getSnapshot: async () => ({ fast: 0.019, slow: 0.021, hePrice: 0.02, mid: 0.02 }),
    getState: async () => ({ inventoryToken: 500 }),
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].action, 'SELL');
  assert.equal(decisions[0].sym, 'SPS');
  assert.equal(decisions[0].strategy, 'momentum');
});

test('momentum ENTER emits a BUY (loop bleed-guard will gate it downstream)', async () => {
  const decisions = await strategyDecisions({
    tokens: ['DEC'], strategy: 'momentum',
    getSnapshot: async () => ({ fast: 0.0022, slow: 0.002, hePrice: 0.0021, mid: 0.0021 }),
    getState: async () => ({ inventoryToken: 0 }),
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].action, 'BUY');
});

test('flat signal → no decision', async () => {
  const decisions = await strategyDecisions({
    tokens: ['SPS'], strategy: 'momentum',
    getSnapshot: async () => ({ fast: 0.02, slow: 0.02, hePrice: 0.02, mid: 0.02 }),
    getState: async () => ({ inventoryToken: 0 }),
  });
  assert.deepEqual(decisions, []);
});

test('unknown strategy name → empty (soft)', async () => {
  const d = await strategyDecisions({ tokens: ['SPS'], strategy: 'nonesuch', getSnapshot: async () => ({ fast: 1, slow: 1, mid: 1 }) });
  assert.deepEqual(d, []);
});

test('a bad snapshot for one token never breaks the tick', async () => {
  const decisions = await strategyDecisions({
    tokens: ['SPS', 'DEC'], strategy: 'momentum',
    getSnapshot: async (s) => (s === 'SPS' ? null : { fast: 0.0022, slow: 0.002, mid: 0.0021 }),
    getState: async () => ({ inventoryToken: 0 }),
  });
  assert.equal(decisions.length, 1, 'DEC still produced a decision despite SPS snapshot failing');
});

test('recommendedCapHive computes a fee-clearing size (advisory)', () => {
  const r = recommendedCapHive({ hiveUsd: 0.05, edgePct: 5, roundTripFeePct: 2, targetNetUsd: 1 });
  assert.ok(r.capHive > 0);
  assert.ok(/HIVE/.test(r.note));
  // no net edge after fees → no size clears
  assert.equal(recommendedCapHive({ hiveUsd: 0.05, edgePct: 1, roundTripFeePct: 2 }).capHive, null);
});

// ─── WHY MOMENTUM_TOKENS=SPS,DEC STILL PRODUCED NOTHING (2026-09-16) ───────────────────────────────
//
// The env was set on 2026-09-16 and every tick still logged "(all HOLD — nothing actionable)". These
// tests pin the actual reason, which is NOT a bug in this module: @angelicalist holds 0 SPS and 0 DEC.
// With no position, the momentum core can only ever emit an ENTRY BUY; the loop's bleed-guard turns a
// BUY with no same-tick SELL leg into WATCH (the −6,424 HIVE SWAP.LTC lesson). So the feed's only
// reachable output is blocked by design, and will stay blocked until a position exists to sell.
//
// Seeding that position is an operator FUNDING decision, not a code change. Do not "fix" this by
// weakening the bleed-guard — that guard is the single most expensive lesson in this repo.

import { runOnce } from './loop.mjs';

test('flat position (the live state): momentum can only emit a BUY entry', async () => {
  const decisions = await strategyDecisions({
    tokens: ['SPS'], strategy: 'momentum',
    getSnapshot: async () => ({ fast: 0.0759, slow: 0.0723, hePrice: 0.0727, mid: 0.0727 }), // +5% signal
    getState: async () => ({ inventoryToken: 0 }),                                           // the real balance
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].action, 'BUY');
  assert.equal(decisions[0].sym, 'SPS');
});

test('THE BLOCKAGE: that lone BUY is bleed-guarded to WATCH, so nothing is ever placed', async () => {
  const placed = [];
  const r = await runOnce({
    mode: () => ({ live: false, hasKey: false, flagLive: false, account: 'angelicalist', sweepTo: 'kalivankush' }),
    decisions: async () => [],
    arb: async () => ({ opportunities: [], rows: [] }),
    balances: async () => [{ symbol: 'SWAP.HIVE', balance: 102.41 }],   // the real balance: no SPS, no DEC
    strategyDecisions: async () => ([{ action: 'BUY', sym: 'SPS', reason: 'momentum entry', strategy: 'momentum' }]),
    broadcaster: { placeOrder: async (o) => { placed.push(o); return { txId: 'x' }; } },
    ptRecord: () => {},
  });
  assert.equal(placed.length, 0, 'nothing reaches the broadcaster');
  assert.equal(r.summary.placed, 0);
  assert.equal(r.blocked.length, 1);
  assert.match(r.blocked[0].blocked, /no-selling-leg/);
});

test('WITH a position, momentum produces the SELL that actually realizes profit', async () => {
  const decisions = await strategyDecisions({
    tokens: ['SPS'], strategy: 'momentum',
    getSnapshot: async () => ({ fast: 0.0700, slow: 0.0723, hePrice: 0.0719, mid: 0.0719 }), // signal crossed down
    getState: async () => ({ inventoryToken: 1400 }),                                        // a seeded position
  });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0].action, 'SELL', 'this is the leg the bleed-guard permits');
  assert.equal(decisions[0].heldBalance, 1400);
});

test('recommendedCapHive states the size a target net actually needs (HE fee is 1%/side)', () => {
  // SPS: 1.07% spread + 2% round-trip fee = 3.07% of cost. A 5% gross capture nets 1.93%.
  const r = recommendedCapHive({ hiveUsd: 0.050582, edgePct: 5, roundTripFeePct: 3.07, targetNetUsd: 1 });
  assert.equal(r.netEdgePct, 1.93);
  assert.ok(r.capHive > 1000, `netting $1 per round trip needs >1000 HIVE of size, got ${r.capHive}`);
});

test('recommendedCapHive refuses to invent a size when no net edge survives the fees', () => {
  const r = recommendedCapHive({ hiveUsd: 0.050582, edgePct: 2, roundTripFeePct: 3.07 });
  assert.equal(r.capHive, null);
  assert.match(r.note, /no net edge after fees/);
});
