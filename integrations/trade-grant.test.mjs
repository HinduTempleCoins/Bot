import { test } from 'node:test';
import assert from 'node:assert';
import { createTradeGrant, authorize, recordFill, resetDaily, isForbidden } from './trade-grant.mjs';

const MARKET = 'SWAP.BTC:SWAP.HIVE';
const grant = () => createTradeGrant({ market: MARKET, dailyCap: 100, perOrderCap: 25 });

test('createTradeGrant: builds a market-scoped grant with NO withdrawal permission', () => {
  const g = grant();
  assert.equal(g.kind, 'trade-grant');
  assert.equal(g.market, MARKET);
  assert.equal(g.dailyCap, 100);
  assert.equal(g.perOrderCap, 25);
  assert.equal(g.canWithdraw, false);
  assert.equal(g.spentToday, 0);
});

test('createTradeGrant: rejects bad input', () => {
  assert.throws(() => createTradeGrant({ dailyCap: 100, perOrderCap: 10 }), /market/);
  assert.throws(() => createTradeGrant({ market: MARKET, dailyCap: 0, perOrderCap: 10 }), /dailyCap/);
  assert.throws(() => createTradeGrant({ market: MARKET, dailyCap: 100, perOrderCap: -1 }), /perOrderCap/);
});

test('in-market capped order is allowed', () => {
  const r = authorize(grant(), { market: MARKET, side: 'buy', cost: 20 });
  assert.equal(r.allowed, true);
});

test('over per-order cap is rejected', () => {
  const r = authorize(grant(), { market: MARKET, side: 'buy', cost: 26 });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /per-order cap/);
});

test('per-order cap also works via quantity * price', () => {
  // 3 * 10 = 30 > 25
  assert.equal(authorize(grant(), { market: MARKET, side: 'buy', quantity: 3, price: 10 }).allowed, false);
  // 2 * 10 = 20 <= 25
  assert.equal(authorize(grant(), { market: MARKET, side: 'buy', quantity: 2, price: 10 }).allowed, true);
});

test('wrong-market order is rejected', () => {
  const r = authorize(grant(), { market: 'SWAP.DOGE:SWAP.HIVE', side: 'buy', cost: 5 });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /wrong market/);
});

test('withdrawal is ALWAYS rejected (the invariant) — many shapes', () => {
  const g = grant();
  const forbidden = [
    { action: 'withdraw', amount: 1 },
    { action: 'withdrawal', cost: 1 },
    { action: 'transfer', market: MARKET, cost: 1 },
    { type: 'transfer_out', market: MARKET, cost: 1 },
    { action: 'send', market: MARKET, cost: 1 },
    { withdraw: true, market: MARKET, side: 'buy', cost: 1 },
    { transfer: true, market: MARKET, side: 'buy', cost: 1 },
    { action: 'owner', market: MARKET, cost: 1 },
    { action: 'active', market: MARKET, cost: 1 },
    { side: 'withdraw', market: MARKET, cost: 1 }, // bogus side
  ];
  for (const o of forbidden) {
    const r = authorize(g, o);
    assert.equal(r.allowed, false, `should reject ${JSON.stringify(o)}`);
    assert.match(r.reason, /forbidden/);
  }
});

test('withdrawal rejected even when amount is within all caps', () => {
  // cost 1 is well under perOrderCap(25) and dailyCap(100) — still rejected because it is a withdrawal
  const r = authorize(grant(), { action: 'withdraw', market: MARKET, cost: 1 });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /forbidden/);
});

test('isForbidden: trades pass, custody actions fail, unknown shapes fail-closed', () => {
  assert.equal(isForbidden({ side: 'buy', cost: 1 }), false);
  assert.equal(isForbidden({ side: 'sell', cost: 1 }), false);
  assert.equal(isForbidden({ action: 'trade', cost: 1 }), false);
  assert.equal(isForbidden({ action: 'withdraw' }), true);
  assert.equal(isForbidden(null), true);
  assert.equal(isForbidden('nope'), true);
});

test('daily-cap accumulation: recordFill accrues and pushes orders over the daily cap', () => {
  const g = grant();
  recordFill(g, { market: MARKET, side: 'buy', cost: 40 });
  assert.equal(g.spentToday, 40);
  recordFill(g, { market: MARKET, side: 'buy', cost: 40 });
  assert.equal(g.spentToday, 80);
  // 80 spent + a 25 order = 105 > dailyCap(100) -> rejected
  let r = authorize(g, { market: MARKET, side: 'buy', cost: 25 });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /daily cap/);
  // but a 20 order = 100 exactly -> allowed (boundary)
  r = authorize(g, { market: MARKET, side: 'buy', cost: 20 });
  assert.equal(r.allowed, true);
});

test('recordFill refuses forbidden actions and wrong markets; resetDaily clears', () => {
  const g = grant();
  assert.throws(() => recordFill(g, { action: 'withdraw', cost: 5 }), /forbidden/);
  assert.throws(() => recordFill(g, { market: 'SWAP.DOGE:SWAP.HIVE', side: 'buy', cost: 5 }), /market mismatch/);
  recordFill(g, { market: MARKET, side: 'buy', cost: 30 });
  assert.equal(g.spentToday, 30);
  resetDaily(g);
  assert.equal(g.spentToday, 0);
});

test('authorize is PURE — does not mutate the grant', () => {
  const g = grant();
  authorize(g, { market: MARKET, side: 'buy', cost: 20 });
  assert.equal(g.spentToday, 0, 'authorize must not accrue');
});

test('a grant carrying canWithdraw=true is treated as a hard violation', () => {
  const g = grant();
  g.canWithdraw = true; // tamper
  assert.throws(() => authorize(g, { market: MARKET, side: 'buy', cost: 1 }), /INVARIANT VIOLATED/);
});
