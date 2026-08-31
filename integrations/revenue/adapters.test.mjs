import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hiveEngineAdapter, payboxMoonxAdapter, ccxtCexAdapter, pickAdapter, adapterStatus, DEFAULT_ADAPTERS } from './adapters.mjs';

test('every adapter stages by default (nothing broadcasts)', async () => {
  const orders = {
    'hive-engine': { venue: 'hive-engine', symbol: 'SPS', side: 'buy', qty: 10, price: 0.02 },
    'paybox-moonx': { venue: 'paybox-moonx', inputMint: 'EPjF...', outputMint: 'native', amount: 2 },
    'cex': { venue: 'cex', exchange: 'binance', symbol: 'BTC/USDT', side: 'buy', qty: 0.001 },
  };
  for (const a of DEFAULT_ADAPTERS) {
    const conf = await a.execute(orders[a.venue], { live: false });
    assert.notEqual(conf.status, 'FILLED', `${a.venue} must not fill when not live`);
    assert.ok(conf.call, `${a.venue} builds the exact call it WOULD make`);
  }
});

test('hive-engine adapter stays staged when live but auth flag unset', async () => {
  delete process.env.REVENUE_LIVE_HIVE_ENGINE;
  const conf = await hiveEngineAdapter.execute({ venue: 'hive-engine', symbol: 'SPS', side: 'sell', qty: 5, price: 0.02 }, { live: true });
  assert.equal(conf.status, 'STAGED', 'no auth flag → still staged even with live:true');
});

test('paybox adapter is the keyless authorized path and never signs locally', async () => {
  assert.equal(payboxMoonxAdapter.keyless, true);
  process.env.REVENUE_LIVE_PAYBOX = 'true';
  const conf = await payboxMoonxAdapter.execute({ venue: 'paybox-moonx', inputMint: 'A', outputMint: 'native', amount: 2 }, { live: true });
  assert.equal(conf.status, 'STAGED', 'authorized keyless path emits the MCP call for the runtime, does not fill here');
  assert.equal(conf.call.tool, 'mcp__claude_ai_Paybox__request_swap');
  delete process.env.REVENUE_LIVE_PAYBOX;
});

test('pickAdapter routes by venue and returns null for unroutable', () => {
  assert.equal(pickAdapter({ venue: 'hive-engine', side: 'buy', qty: 1, price: 1 }).venue, 'hive-engine');
  assert.equal(pickAdapter({ venue: 'nonesuch' }), null);
});

test('adapterStatus reports authorization per venue', () => {
  delete process.env.REVENUE_LIVE_CEX;
  const st = adapterStatus();
  const cex = st.find((s) => s.venue === 'cex');
  assert.equal(cex.authorized, false);
});

test('cex supports() rejects malformed orders (soft)', () => {
  assert.ok(!ccxtCexAdapter.supports({ venue: 'cex' }));
});
