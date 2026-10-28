// kulaswap-addliq.test.mjs — OFFLINE. Pure encoding + ratio math, no chain.
import { test } from 'node:test';
import assert from 'node:assert';
import { encodeAddLiquidity, encodeGetReserves, matchAmount, units, fromUnits, TOKENS } from './kulaswap-executor.mjs';

test('addLiquidity encodes to the router selector with eight packed words', () => {
  const d = encodeAddLiquidity(TOKENS.KULA.address, TOKENS.WPRANA.address, 1n, 2n, 3n, 4n, TOKENS.KULA.address, 5n);
  assert.ok(d.startsWith('0xe8e33700'), 'addLiquidity selector');
  assert.equal((d.length - 10) / 64, 8, 'eight 32-byte arguments');
  assert.doesNotMatch(d, /[^0-9a-fx]/);
});

test('getReserves is the bare selector', () => {
  assert.equal(encodeGetReserves(), '0x0902f1ac');
});

test('⚠ the matching amount comes from the pool, so adding liquidity does NOT move the price', () => {
  // reserves 1000 A : 4000 B  =>  adding 100 A must pair with exactly 400 B
  const m = matchAmount({ reserveA: 1000n, reserveB: 4000n, amountA: 100n });
  assert.equal(m, 400n);
  // the ratio after the add is unchanged: (1000+100)/(4000+400) === 1000/4000
  assert.equal((1000n + 100n) * 4000n, (4000n + 400n) * 1000n);
});

test('⚠ an EMPTY pool returns null — seeding one sets the price and must be an explicit decision', () => {
  assert.equal(matchAmount({ reserveA: 0n, reserveB: 0n, amountA: 100n }), null);
  assert.equal(matchAmount({ reserveA: 1000n, reserveB: 0n, amountA: 100n }), null);
  assert.equal(matchAmount({ reserveA: 0n, reserveB: 4000n, amountA: 100n }), null);
});

test('a zero or missing amount yields null rather than a zero-value add', () => {
  assert.equal(matchAmount({ reserveA: 10n, reserveB: 10n, amountA: 0n }), null);
  assert.equal(matchAmount({}), null);
});

test('mixed decimals survive the round trip — wVKBT is 8, KULA is 18', () => {
  assert.equal(units('1.5', 8), 150000000n);
  assert.equal(units('1.5', 18), 1500000000000000000n);
  assert.equal(fromUnits(150000000n, 8), 1.5);
  assert.equal(TOKENS.wVKBT.decimals, 8);
  assert.equal(TOKENS.wCURE.decimals, 8);
});

test('the matching amount respects a real 8-vs-18-decimal pool', () => {
  // KULA/wVKBT live reserves: 1002.8990 KULA (18dec) : 17555.7132 wVKBT (8dec)
  const rA = units('1002.8990', 18), rB = units('17555.7132', 8);
  const m = matchAmount({ reserveA: rA, reserveB: rB, amountA: units('100', 18) });
  const got = fromUnits(m, 8);
  assert.ok(Math.abs(got - 1750.78) < 1, `100 KULA should pair with about 1750 wVKBT, got ${got}`);
});
