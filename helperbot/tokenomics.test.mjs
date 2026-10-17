// tokenomics.test.mjs — every figure in the tokenomics replies comes from the (faked) live reads, and an
// unreachable source yields the honest "unavailable" placeholder — never a number. Offline.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { __setFetch } from './live.mjs';
import { tokenomicsCommand, melekInflation, pairPrice } from './tokenomics.mjs';
import { PRANA } from './addresses.mjs';
import { baseState, fakeFetch, wei } from './test-fakes.mjs';

const lc = (a) => a.toLowerCase();
const PAIR1 = '0x3fc307dea06667f5a7a640ec0abb950eacc4b8c2';
const PAIR2 = '0xe3e01d327bc2bee7a5754c1e7ff23158e017688e';
let st;

function seed() {
  st = baseState();
  const m = st.prana.mainnet;
  m.supply[lc(PRANA.KULA)] = wei(231621);
  m.cap[lc(PRANA.KULA)] = wei(11000000);
  m.bal[lc(PRANA.KULA)] = { [lc(PRANA.veKULA)]: wei(600) };
  m.native[lc(PRANA.hathorFeeTreasury)] = wei(5090);
  m.supply[lc(PRANA.wVKBT)] = wei(23298, 8);
  m.supply[lc(PRANA.wCURE)] = wei(599, 8);
  m.supply[lc(PRANA.wMELEK)] = wei(0.9);
  m.pairs[[lc(PRANA.KULA), lc(PRANA.WPRANA)].sort().join('|')] = PAIR1;
  m.token0[PAIR1] = PRANA.KULA;
  m.reserves[PAIR1] = [wei(10100), wei(4950)]; // KULA / WPRANA
  m.pairs[[lc(PRANA.KULA), lc(PRANA.wVKBT)].sort().join('|')] = PAIR2;
  m.token0[PAIR2] = PRANA.KULA;
  m.reserves[PAIR2] = [wei(880), wei(20000, 8)];
  st.scan.tokens[lc(PRANA.KULA)] = { holders_count: '11' };
  st.scan.tokens[lc(PRANA.wVKBT)] = { holders_count: '2' };
  st.he.tokens.VKBT = { symbol: 'VKBT', name: 'Van Kush Beauty Token', supply: '2333640', maxSupply: '500000000', circulatingSupply: '2318137', totalStaked: '976077' };
  st.he.metrics.VKBT = { lastPrice: '0.00010730', highestBid: '0.00002200', lowestAsk: '0.00010730', volume: '0.0387' };
  st.he.balances = [{ symbol: 'VKBT', account: 'kula-bridge', balance: '23298', stake: '0' }, { symbol: 'VKBT', account: 'alice', balance: '5', stake: '0' }];
  st.engine.tokens = [{ symbol: 'WMELEK', name: 'Wrapped MELEK', issuer: 'hathor', supply: '1.000', circulatingSupply: '1.000', maxSupply: '9007199254740991.000' }, { symbol: 'APIS', name: 'Apis', issuer: 'hathor', supply: '0.000', circulatingSupply: '0.000', maxSupply: '9007199254740991.000' }];
  __setFetch(fakeFetch(st));
}
beforeEach(seed);

test('!prana reports live height, treasury, pool price and labels protocol params', async () => {
  const t = await tokenomicsCommand('prana');
  assert.match(t, /Chain 712217/);
  assert.match(t, /height 167,000/);
  assert.match(t, /334,000 PRANA/); // 167000 × 2
  assert.match(t, /5,090 PRANA/);
  assert.match(t, /1 PRANA = 2\.04 KULA/); // 10100/4950
  assert.match(t, /protocol parameters/);
  assert.match(t, /NOT pinned/);
});

test('!kula reads supply, cap, holders, veKULA lock and price live', async () => {
  const t = await tokenomicsCommand('kula');
  assert.match(t, /231,621 KULA of cap 11,000,000 KULA/);
  assert.match(t, /holders 11/);
  assert.match(t, /600 KULA/);
  assert.match(t, /1 KULA = 0\.49/);
});

test('pairPrice orients by live token0 and corrects decimals (8-dec wVKBT)', async () => {
  const p = await pairPrice(PRANA.wVKBT, 8, PRANA.KULA, 18);
  assert.ok(Math.abs(p.price - 880 / 20000) < 1e-9);
  assert.equal(await pairPrice(PRANA.wCURE, 8, PRANA.KULA, 18), null, 'no pair → null, not a number');
});

test('!melek derives inflation from live config (no hard-coded rate)', async () => {
  const t = await tokenomicsCommand('melek');
  assert.match(t, /2000000\.000 MELEK/);
  // head 1,000,000 / 250,000 = 4 → 978-4 = 974 bp = 9.74%
  assert.match(t, /9\.74%\/yr/);
  assert.match(t, /25% witnesses/);
  assert.match(t, /0\.900 MELEK/);
  assert.match(t, /no live MELEK market/);
  const inf = melekInflation(st.melek.mainnet.dgp, { ...st.melek.mainnet.cfg, STEEM_INFLATION_NARROWING_PERIOD: 1 });
  assert.equal(inf.ratePct, 0.95, 'floors at the stop rate');
});

test('!vkbt reads Hive-Engine supply/price/holders and the wrapped custody', async () => {
  const t = await tokenomicsCommand('vkbt');
  assert.match(t, /2,333,640 \/ max 500,000,000/);
  assert.match(t, /last 0\.00010730 HIVE/);
  assert.match(t, /Holders \(live\): 2/);
  assert.match(t, /23,298 minted/);
  assert.match(t, /custody holds 23,298 VKBT/);
});

test('!wvkbt, !wmelek, !apis, !tokenomics answer from live reads', async () => {
  assert.match(await tokenomicsCommand('wvkbt'), /1 wVKBT = 0\.044 KULA/);
  const w = await tokenomicsCommand('wmelek');
  assert.match(w, /Supply \(live\): 1\.000/);
  assert.match(w, /no fixed cap set/);
  assert.match(await tokenomicsCommand('wmelek', ['prana']), /wMELEK/);
  assert.match(await tokenomicsCommand('apis'), /no APIS has been minted yet/);
  const o = await tokenomicsCommand('tokenomics');
  assert.match(o, /KULA: 231,621/);
  assert.match(o, /WMELEK 1\.000 · APIS 0\.000/);
  assert.match(await tokenomicsCommand('tokenomics', ['kula']), /veKULA/);
  assert.equal(await tokenomicsCommand('nope'), null);
});

test('unreachable sources → "unavailable", never an invented number, never a throw', async () => {
  st.down.add('rpc.prana.melek.salon');
  st.down.add('pranascan.soapbox.community');
  const t = await tokenomicsCommand('kula');
  assert.match(t, /unavailable right now/);
  assert.ok(!/231,621/.test(t));
  st.down.add('melek.salon'); st.down.add('wallet.melek.salon'); st.down.add('api.hive-engine.com'); st.down.add('engine.melek.salon');
  for (const c of ['prana', 'melek', 'vkbt', 'cure', 'wvkbt', 'wcure', 'wmelek', 'apis', 'tokenomics']) {
    const r = await tokenomicsCommand(c);
    assert.equal(typeof r, 'string', c);
    assert.match(r, /unavailable|not listed|n\/a/, c);
  }
});
