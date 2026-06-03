// staking-decision.test.mjs — PURE decision-engine math (OFFLINE, no network).
// Feeds injected market rows and asserts the STAKE / TRADE / HOLD recommendations and ranking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, portfolioPlan, stakeScore, tradeScore } from './staking-decision.mjs';

test('high APR + low volatility (liquid) → STAKE', () => {
  const d = decide('STEADY', { stakingApr: 0.25, volatility: 0.05, spreadPct: 0.5, liquidity: 600 });
  assert.equal(d.action, 'STAKE');
  assert.ok(d.scoreStake > d.scoreTrade, 'stake score should dominate');
  assert.match(d.reason, /STAKE/);
});

test('high volatility + good liquidity (tight spread) → TRADE', () => {
  const d = decide('OSC', { stakingApr: 0.02, volatility: 0.8, spreadPct: 0.5, liquidity: 800 });
  assert.equal(d.action, 'TRADE');
  assert.ok(d.scoreTrade > d.scoreStake, 'trade score should dominate');
  assert.match(d.reason, /TRADE/);
});

test('illiquid token → HOLD (sunk, never "trade"), even with a fat headline APR', () => {
  const d = decide('DEADTOKEN', { stakingApr: 0.5, volatility: 0.9, spreadPct: 40, liquidity: 5 });
  assert.equal(d.action, 'HOLD');
  assert.match(d.reason, /illiquid/);
});

test('no yield + no movement → HOLD (nothing actionable)', () => {
  const d = decide('FLAT', { stakingApr: 0, volatility: 0, spreadPct: 0, liquidity: 1000 });
  assert.equal(d.action, 'HOLD');
});

test('too-close-to-call → HOLD and watch', () => {
  // tuned so stake and trade scores land within the margin of each other
  const d = decide('TOSSUP', { stakingApr: 0.07, volatility: 0.22, spreadPct: 0.4, liquidity: 180 });
  assert.equal(d.action, 'HOLD');
  assert.ok(d.scoreStake > 0 && d.scoreTrade > 0);
});

test('stakeScore: higher APR and calmer price both raise the score', () => {
  const lowApr = stakeScore({ stakingApr: 0.05, volatility: 0.1, liquidity: 600 });
  const highApr = stakeScore({ stakingApr: 0.30, volatility: 0.1, liquidity: 600 });
  assert.ok(highApr > lowApr, 'more APR → higher stake score');
  const calm = stakeScore({ stakingApr: 0.20, volatility: 0.05, liquidity: 600 });
  const wild = stakeScore({ stakingApr: 0.20, volatility: 0.95, liquidity: 600 });
  assert.ok(calm > wild, 'calmer token → higher stake score');
});

test('stakeScore: illiquid market damps realisable yield', () => {
  const liquid = stakeScore({ stakingApr: 0.20, volatility: 0.2, liquidity: 600 });
  const dead = stakeScore({ stakingApr: 0.20, volatility: 0.2, liquidity: 5 });
  assert.ok(dead < liquid, 'dead market damps the stake score');
});

test('tradeScore: needs both movement and liquidity; spread is a cost', () => {
  const noLiq = tradeScore({ volatility: 0.8, spreadPct: 0.5, liquidity: 5 });
  assert.equal(noLiq, 0, 'volatile but illiquid → no tradeable edge');
  const tight = tradeScore({ volatility: 0.8, spreadPct: 0.5, liquidity: 800 });
  const wide = tradeScore({ volatility: 0.8, spreadPct: 10, liquidity: 800 });
  assert.ok(tight > wide, 'wider spread eats the trade score');
});

test('portfolioPlan: ranks actionable tokens above HOLD, by winning score', () => {
  const holdings = [
    { symbol: 'DEADTOKEN', balance: 1000 },
    { symbol: 'OSC', balance: 50 },
    { symbol: 'STEADY', balance: 200 },
  ];
  const marketData = {
    DEADTOKEN: { stakingApr: 0.5, volatility: 0.9, spreadPct: 40, liquidity: 5 },
    OSC: { stakingApr: 0.02, volatility: 0.85, spreadPct: 0.4, liquidity: 900 },
    STEADY: { stakingApr: 0.25, volatility: 0.05, spreadPct: 0.5, liquidity: 600 },
  };
  const plan = portfolioPlan(holdings, marketData);
  assert.equal(plan.length, 3);
  // the dead token must rank last (HOLD), the two actionable ones first
  assert.equal(plan[plan.length - 1].symbol, 'DEADTOKEN');
  assert.equal(plan[plan.length - 1].action, 'HOLD');
  const actions = plan.slice(0, 2).map((r) => r.action);
  assert.ok(actions.includes('TRADE') && actions.includes('STAKE'));
  // balances carried through
  assert.equal(plan.find((r) => r.symbol === 'OSC').balance, 50);
});

test('portfolioPlan: accepts bare symbol strings too', () => {
  const plan = portfolioPlan(['STEADY'], { STEADY: { stakingApr: 0.25, volatility: 0.05, spreadPct: 0.5, liquidity: 600 } });
  assert.equal(plan[0].symbol, 'STEADY');
  assert.equal(plan[0].action, 'STAKE');
});
