// kulaswap-executor.test.mjs — OFFLINE: calldata, quote decoding, and the profit-only rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { units, fromUnits, encodeApprove, encodeSwap, encodeGetAmountsOut, decodeUintArray, planArb, ROUTER } from './kulaswap-executor.mjs';

test('units round-trip for 8 and 18 decimals', () => {
  assert.equal(units('400', 8), 40000000000n);
  assert.equal(units('1.5', 18), 1500000000000000000n);
  assert.equal(fromUnits(40000000000n, 8), 400);
});

test('calldata selectors and layout', () => {
  assert.equal(encodeApprove(ROUTER, 5n).slice(0, 10), '0x095ea7b3');
  const s = encodeSwap(100n, 99n, ['0x' + '11'.repeat(20), '0x' + '22'.repeat(20)], '0x' + '33'.repeat(20), 1000);
  assert.equal(s.slice(0, 10), '0x38ed1739');
  assert.equal((s.length - 10) / 64, 5 + 1 + 2, 'five head words, array length, two addresses');
  assert.equal(encodeGetAmountsOut(1n, ['0x' + '11'.repeat(20)]).slice(0, 10), '0xd06ca61f');
});

test('decode a uint256[] return', () => {
  const hex = '0x' + (32).toString(16).padStart(64, '0') + '2'.padStart(64, '0') + 'a'.padStart(64, '0') + 'b'.padStart(64, '0');
  assert.deepEqual(decodeUintArray(hex), [10n, 11n]);
  assert.deepEqual(decodeUintArray('0x'), []);
});

test('profit only: refuse below the minimum, pin amountOutMin above break-even', () => {
  assert.equal(planArb({ amountIn: 1000n, quotedOut: 1005n, minProfitBps: 100 }).trade, false);
  assert.equal(planArb({ amountIn: 1000n, quotedOut: 900n }).trade, false);
  const p = planArb({ amountIn: 1000n, quotedOut: 1160n, minProfitBps: 100, slippageBps: 30 });
  assert.equal(p.trade, true);
  assert.ok(p.amountOutMin >= 1010n, 'never below break-even + minimum profit');
  assert.ok(p.amountOutMin <= 1160n);
});

test('rebalance: only past the band, and the swap restores the target', async () => {
  const { planRebalance } = await import('./kulaswap-executor.mjs');
  assert.equal(planRebalance({ balA: 100, balB: 100, price: 1 }).trade, false);
  const p = planRebalance({ balA: 1000, balB: 10, price: 0.74, target: 0.5 });
  assert.equal(p.trade, true); assert.equal(p.side, 'sellA');
  const afterA = 1000 - p.amount, afterB = 10 + p.amount * 0.74;
  assert.ok(Math.abs((afterA * 0.74) / (afterA * 0.74 + afterB) - 0.5) < 1e-9);
});

test('grid: first run sets the level, then buy on a fall, sell on a rise after a buy', async () => {
  const { planGrid } = await import('./kulaswap-executor.mjs');
  assert.equal(planGrid({ price: 18, last: null }).record, 18);
  assert.equal(planGrid({ price: 18.2, last: 18 }).trade, false);
  assert.equal(planGrid({ price: 17.4, last: 18 }).side, 'buy');
  assert.equal(planGrid({ price: 18.6, last: 18, lastSide: 'buy' }).side, 'sell');
  assert.equal(planGrid({ price: 18.6, last: 18, lastSide: 'sell' }).trade, false, 'no sell right after a sell');
});

// ── the balance guard ───────────────────────────────────────────────────────────────────────────────────
// Three of the four trading modes used to swap without checking the balance first. That is not a cheap
// failure: the router's transferFrom reverts ON-CHAIN, so the signer broadcasts a doomed transaction and
// the gas is spent for nothing — daily, unattended, for as long as the timer runs. These tests assert the
// refusal happens BEFORE anything reaches the signer, which is the only part that costs money.
const OWNER = '0x' + 'ab'.repeat(20);
const SEL = { amountsOut: '0xd06ca61f', balanceOf: '0x70a08231', allowance: '0xdd62ed3e' };
const hexWord = (v) => BigInt(v).toString(16).padStart(64, '0');
const uintArray = (vals) => '0x' + hexWord(32) + hexWord(vals.length) + vals.map(hexWord).join('');
const jsonRes = (o) => ({ json: async () => o });

/** A fake chain + signer. `balance` is what every balanceOf returns. Records whether a tx was sent. */
function harness({ balance = 0n, quoteOut = 10n ** 18n } = {}) {
  const sent = [];
  const fetch = async (url, opts) => {
    const u = String(url);
    const body = JSON.parse(opts.body);
    if (u.endsWith('/v1/evm/address')) return jsonRes({ ok: true, address: OWNER });
    if (u.includes('/v1/evm')) { sent.push(body); return jsonRes({ ok: true, result: { hash: '0xfeed' } }); }
    if (body.method === 'eth_getTransactionReceipt') return jsonRes({ result: { status: '0x1', gasUsed: '0x5208' } });
    const data = String(body.params?.[0]?.data || '');
    if (data.startsWith(SEL.amountsOut)) return jsonRes({ result: uintArray([1n, quoteOut]) });
    if (data.startsWith(SEL.balanceOf)) return jsonRes({ result: '0x' + hexWord(balance) });
    if (data.startsWith(SEL.allowance)) return jsonRes({ result: '0x' + hexWord(0) });
    return jsonRes({ result: '0x' });
  };
  return { fetch, sent };
}

test('checkBalance passes when covered and refuses when short', async () => {
  const { checkBalance, __setFetch } = await import('./kulaswap-executor.mjs');
  const h = harness({ balance: units('100', 18) });
  __setFetch(h.fetch);
  assert.equal(await checkBalance(OWNER, 'KULA', units('10', 18)), null, 'covered → null');
  assert.equal(await checkBalance(OWNER, 'KULA', units('100', 18)), null, 'exactly covered → null');
  const short = await checkBalance(OWNER, 'KULA', units('101', 18));
  assert.equal(short.ok, false);
  assert.equal(short.traded, false);
  assert.match(short.reason, /insufficient KULA/);
  assert.equal(short.have, 100);
  assert.equal(short.need, 101);
  await assert.rejects(() => checkBalance(OWNER, 'NOPE', 1n), /unknown token/);
  __setFetch(null);
});

test('runDca refuses a swap it cannot fund, and broadcasts nothing', async () => {
  const { runDca, __setFetch } = await import('./kulaswap-executor.mjs');
  const h = harness({ balance: 0n });               // this is kulabot-b's actual state: 0.0 KULA
  __setFetch(h.fetch);
  const r = await runDca({ token: 't', from: 'KULA', to: 'WPRANA', amount: 10 });
  assert.equal(r.ok, false, 'must not report ok');
  assert.equal(r.traded, false);
  assert.match(r.reason, /insufficient KULA/);
  assert.equal(h.sent.length, 0, 'NOTHING may reach the signer — a sent tx here is burnt gas');
  assert.equal(r.route, 'KULA→WPRANA', 'the view is still reported so the log says what was attempted');
  __setFetch(null);
});

test('runDca still trades when the balance covers it', async () => {
  const { runDca, __setFetch } = await import('./kulaswap-executor.mjs');
  const h = harness({ balance: units('1000', 18) });
  __setFetch(h.fetch);
  const r = await runDca({ token: 't', from: 'KULA', to: 'WPRANA', amount: 10 });
  assert.ok(h.sent.length > 0, 'the guard must not block a funded swap');
  assert.equal(r.traded, true);
  __setFetch(null);
});

test('runGrid refuses an unfundable buy — the amount is chunk*price, so it outruns balance easily', async () => {
  const { runGrid, __setFetch } = await import('./kulaswap-executor.mjs');
  const h = harness({ balance: units('1', 18), quoteOut: units('20', 18) });
  __setFetch(h.fetch);
  const sf = `${process.env.TMPDIR || '.'}/grid-guard-test-${process.pid}.json`;
  const fs = await import('node:fs');
  // a prior level well above the current price forces the BUY branch
  fs.writeFileSync(sf, JSON.stringify({ last: 100, lastSide: 'sell' }));
  const r = await runGrid({ token: 't', base: 'KULA', quoteSym: 'WPRANA', chunk: 20, stateFile: sf });
  assert.equal(r.ok, false);
  assert.equal(r.traded, false);
  assert.match(r.reason, /insufficient/);
  assert.equal(h.sent.length, 0, 'no tx may be broadcast for a buy we cannot fund');
  fs.unlinkSync(sf);
  __setFetch(null);
});

test('runArb refuses when the start token is short, after the profit test passes', async () => {
  const { runArb, __setFetch } = await import('./kulaswap-executor.mjs');
  // quoteOut far above amountIn so planArb says trade; balance 0 so the guard must stop it
  const h = harness({ balance: 0n, quoteOut: units('1000', 8) });
  __setFetch(h.fetch);
  const r = await runArb({ token: 't', amount: 50, minProfitBps: 100 });
  assert.equal(r.traded, false);
  assert.equal(h.sent.length, 0, 'a profitable-looking arb we cannot fund must still broadcast nothing');
  __setFetch(null);
});
