// Offline tests for autovote/tradebots.mjs — the live run-on-your-account layer behind /bots.
// No network: every read goes through __setFetch with a fake that answers Hive-Engine RPC,
// CoinGecko and PRANA eth_call from fixtures.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AbiCoder, Interface } from 'ethers';
import {
  __setFetch, loadConfig, planTick, applyGuards, heCustomJson, feeFor, hivesignerLink, kulaTxs,
  readKulaSwap, sanitizeParams, publicConfig, handler, amountOut, KULA, HE_PEGS,
} from './tradebots.mjs';

const abi = AbiCoder.defaultAbiCoder();
const T = KULA.tokens;
const PAIRS = { // pair address → [token0, token1, reserve0Raw, reserve1Raw]
  '0x00000000000000000000000000000000000000a1': [T.wVKBT.address, T.wCURE.address, 3300n * 10n ** 8n, 100n * 10n ** 8n],
  '0x00000000000000000000000000000000000000a2': [T.wVKBT.address, T.KULA.address, 20000n * 10n ** 8n, 880n * 10n ** 18n],
  '0x00000000000000000000000000000000000000a3': [T.wCURE.address, T.KULA.address, 1000n * 10n ** 8n, 1000n * 10n ** 18n],
};
const FACTORY = new Interface(['function getPair(address,address) view returns (address)']);
const low = (a) => a.toLowerCase();

function fakeFetch({ he = {}, usd = {}, balances = {}, allowance = 0n, throwAll = false } = {}) {
  const calls = [];
  const reply = (obj) => ({ ok: true, json: async () => obj });
  const fn = async (url, opts = {}) => {
    calls.push({ url, body: opts.body });
    if (throwAll) throw new Error('offline');
    if (String(url).includes('coingecko')) return reply(usd);
    const body = opts.body ? JSON.parse(opts.body) : {};
    if (body.method === 'eth_call') {
      const { to, data } = body.params[0];
      const sel = data.slice(0, 10);
      if (low(to) === low(KULA.factory)) {
        const [a, b] = FACTORY.decodeFunctionData('getPair', data).map(low);
        const hit = Object.entries(PAIRS).find(([, p]) => new Set([low(p[0]), low(p[1])]).has(a) && new Set([low(p[0]), low(p[1])]).has(b));
        return reply({ result: abi.encode(['address'], [hit ? hit[0] : '0x' + '0'.repeat(40)]) });
      }
      const pair = PAIRS[low(to)];
      if (pair && sel === '0x0902f1ac') return reply({ result: abi.encode(['uint112', 'uint112', 'uint32'], [pair[2], pair[3], 1]) });
      if (pair && sel === '0x0dfe1681') return reply({ result: abi.encode(['address'], [pair[0]]) });
      if (sel === '0x70a08231') return reply({ result: abi.encode(['uint256'], [balances[low(to)] || 0n]) });
      if (sel === '0xdd62ed3e') return reply({ result: abi.encode(['uint256'], [allowance]) });
      return reply({ result: '0x' });
    }
    const p = body.params || {};
    if (p.table === 'tokens') return reply({ result: he.token === undefined ? { symbol: p.query.symbol, precision: 8 } : he.token });
    if (p.table === 'buyBook') return reply({ result: he.buyBook || [] });
    if (p.table === 'sellBook') return reply({ result: he.sellBook || [] });
    if (p.table === 'metrics') return reply({ result: he.metrics || null });
    if (p.table === 'balances') return reply({ result: he.balances || [] });
    return reply({ result: null });
  };
  fn.calls = calls;
  return fn;
}

afterEach(() => __setFetch(null));
const CFG = loadConfig({});
const CFG_FEE = loadConfig({ TRADEBOTS_FEE_ACCOUNT: 'feeacct', TRADEBOTS_FEE_BPS: '25' });

test('config: fee is off without a fee account, disclosed with one', () => {
  assert.equal(publicConfig(CFG).fee.bps, 0);
  assert.match(publicConfig(CFG).fee.hiveEngine, /No bot fee/);
  const pc = publicConfig(CFG_FEE);
  assert.equal(pc.fee.bps, 25);
  assert.match(pc.fee.hiveEngine, /0\.25%.*@feeacct/);
  assert.match(pc.fee.kulaswap, /No bot fee on KulaSwap/);
  assert.equal(loadConfig({ TRADEBOTS_FEE_ACCOUNT: 'Bad Name!' }).feeAccount, '');
  assert.equal(loadConfig({ TRADEBOTS_FEE_BPS: '9999' }).feeBps, 25, 'absurd fee rejected');
});

test('buy-wall on Hive-Engine: unsigned market.buy, fee bundled in the same custom_json', async () => {
  __setFetch(fakeFetch({ he: { buyBook: [{ price: '0.00002', quantity: '10' }], sellBook: [{ price: '0.0005', quantity: '100' }], metrics: { lastPrice: '0.0004' } } }));
  const r = await planTick({ bot: 'wall', venue: 'hive-engine', symbol: 'VKBT', params: { floor: 0.0003, wallSize: 1000 } }, CFG_FEE);
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'simulate');
  assert.equal(r.ops.length, 1);
  const cj = r.ops[0].customJson;
  assert.equal(cj.id, 'ssc-mainnet-hive');
  assert.deepEqual(cj.json[0], { contractName: 'market', contractAction: 'buy', contractPayload: { symbol: 'VKBT', quantity: '1000', price: '0.0003' } });
  assert.equal(cj.json[1].contractAction, 'transfer');
  assert.equal(cj.json[1].contractPayload.to, 'feeacct');
  assert.equal(cj.json[1].contractPayload.quantity, '0.00075'); // 0.3 HIVE × 0.25%
  assert.equal(r.fee, 0.00075);
  for (const o of r.orders) { assert.equal(o.dryRun, true); assert.equal(o.signer, null); }
});

test('no fee account → no transfer action', () => {
  const cj = heCustomJson({ side: 'buy', symbol: 'VKBT', price: 0.001, qtyToken: 10, qtyHive: 0.01 }, { precision: 8 }, CFG);
  assert.equal(cj.json.length, 1);
  assert.equal(cj.fee, 0);
  assert.equal(feeFor({ qtyHive: 100 }, CFG), 0);
  assert.equal(feeFor({ qtyHive: 100 }, CFG_FEE), 0.25);
});

test('guards: VKBT/CURE never sold below 1 HIVE; wrapped twins buy-only on KulaSwap; per-order cap', () => {
  const he = { venue: 'hive-engine', balances: { token: 1e9, hive: 1e9 } };
  const g1 = applyGuards([{ side: 'sell', symbol: 'VKBT', price: 0.5, qtyToken: 1, qtyHive: 0.5 },
    { side: 'sell', symbol: 'CURE', price: 1, qtyToken: 1, qtyHive: 1 }], he, CFG);
  assert.equal(g1.blocked.length, 1);
  assert.match(g1.blocked[0].why, /never sold below 1 HIVE/);
  assert.equal(g1.keep.length, 1, 'a CURE ask at 1 HIVE is allowed');
  const g2 = applyGuards([{ side: 'sell', symbol: 'wVKBT', price: 1, qtyToken: 1, qtyHive: 1 }], { venue: 'kulaswap' }, CFG);
  assert.match(g2.blocked[0].why, /buy-side only/);
  const g3 = applyGuards([{ side: 'buy', symbol: 'SWAP.BTC', price: 1, qtyToken: 1000, qtyHive: 1000 }], he, CFG);
  assert.match(g3.blocked[0].why, /per-order cap/);
});

test('live mode: orders beyond the wallet balance are refused, and an account is required', async () => {
  const g = applyGuards([{ side: 'buy', symbol: 'X', price: 1, qtyToken: 5, qtyHive: 5 }], { venue: 'hive-engine', balances: { hive: 1 } }, CFG, { live: true });
  assert.match(g.blocked[0].why, /not enough balance/);
  __setFetch(fakeFetch());
  const r = await planTick({ bot: 'dca', venue: 'hive-engine', symbol: 'CURE', mode: 'live' }, CFG);
  assert.equal(r.ok, false);
  assert.match(r.error, /Hive account/);
});

test('peg-arb on Hive-Engine buys a SWAP token trading under its real price; SWAP.LTC is not offered', async () => {
  assert.equal(HE_PEGS['SWAP.LTC'], undefined);
  // HE 1 BTC = 1,000,000 HIVE × $0.06 = $60k; real $66k → +10% edge → BUY
  __setFetch(fakeFetch({ he: { metrics: { lastPrice: '1000000' }, buyBook: [{ price: '999000', quantity: '1' }], sellBook: [{ price: '1001000', quantity: '1' }] },
    usd: { hive: { usd: 0.06 }, bitcoin: { usd: 66000 } } }));
  const r = await planTick({ bot: 'peg-arb', venue: 'hive-engine', symbol: 'SWAP.BTC', params: { tradeHive: 10 } }, CFG);
  assert.equal(r.ok, true);
  assert.equal(r.orders[0].side, 'buy');
  assert.equal(r.ops[0].customJson.json[0].contractAction, 'buy');
  const bad = await planTick({ bot: 'peg-arb', venue: 'hive-engine', symbol: 'SWAP.LTC' }, CFG);
  assert.equal(bad.ok, false);
});

test('KulaSwap reader orients reserves and derives the KULA-implied cross rate', async () => {
  __setFetch(fakeFetch());
  const s = await readKulaSwap('wVKBT/wCURE', null, CFG);
  assert.equal(s.ok, true);
  assert.ok(Math.abs(s.hePrice - 100 / 3300) < 1e-12);
  // wVKBT per KULA… price wVKBT in KULA = 880/20000 = 0.044; wCURE in KULA = 1; implied = 0.044
  assert.ok(Math.abs(s.implied - 0.044) < 1e-12);
});

test('peg-arb on KulaSwap: direct pool cheaper than the implied rate → buy wVKBT, approve + swap built', async () => {
  const addr = '0x1111111111111111111111111111111111111111';
  __setFetch(fakeFetch({ balances: { [low(T.wCURE.address)]: 50n * 10n ** 8n }, allowance: 0n }));
  const r = await planTick({ bot: 'peg-arb', venue: 'kulaswap', market: 'wVKBT/wCURE', address: addr, mode: 'live', params: { threshold: 0.03, tradeHive: 1, maxInventoryHive: 10 } }, CFG);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.orders[0].side, 'buy');
  const txs = r.ops[0].txs;
  assert.equal(txs.length, 2);
  assert.equal(low(txs[0].to), low(T.wCURE.address));
  assert.equal(txs[0].data.slice(0, 10), '0x095ea7b3');
  assert.equal(low(txs[1].to), low(KULA.router));
  const ROUTER = new Interface(['function swapExactTokensForTokens(uint256,uint256,address[],address,uint256)']);
  const [amountIn, minOut, path, to] = ROUTER.decodeFunctionData('swapExactTokensForTokens', txs[1].data);
  assert.equal(amountIn, 1n * 10n ** 8n);
  assert.deepEqual(path.map(low), [low(T.wCURE.address), low(T.wVKBT.address)]);
  assert.equal(low(to), low(addr));
  const expected = amountOut(amountIn, 100n * 10n ** 8n, 3300n * 10n ** 8n);
  assert.equal(minOut, (expected * 9900n) / 10000n, '1% default slippage floor');
  assert.equal(r.fee, 0);
});

test('kulaTxs skips approve when allowance already covers the input', () => {
  const snap = { market: 'wVKBT/KULA', allowance: 10n ** 30n, pool: { rawA: 20000n * 10n ** 8n, rawB: 880n * 10n ** 18n } };
  const txs = kulaTxs({ side: 'buy', qtyHive: 5, qtyToken: 100 }, snap, '0x1111111111111111111111111111111111111111', { nowSec: 1 });
  assert.equal(txs.length, 1);
  assert.match(txs[0].label, /swap 5 KULA/);
});

test('hivesigner link carries active authority, the account and the payload', () => {
  const u = new URL(hivesignerLink('alice', { id: 'ssc-mainnet-hive', json: [{ a: 1 }] }));
  assert.equal(u.hostname, 'hivesigner.com');
  assert.equal(u.searchParams.get('authority'), 'active');
  assert.equal(u.searchParams.get('required_auths'), '["alice"]');
  assert.equal(u.searchParams.get('json'), '[{"a":1}]');
});

test('soft-fail: a dead network returns ok:false, never throws', async () => {
  __setFetch(fakeFetch({ throwAll: true }));
  const a = await planTick({ bot: 'dca', venue: 'hive-engine', symbol: 'VKBT' }, CFG);
  assert.equal(a.ok, false);
  const b = await planTick({ bot: 'dca', venue: 'kulaswap', market: 'wVKBT/KULA' }, CFG);
  assert.equal(b.ok, false);
  const c = await planTick({ bot: 'nope', venue: 'hive-engine' }, CFG);
  assert.equal(c.ok, false);
  const d = await planTick({ bot: 'wall', venue: 'kulaswap' }, CFG);
  assert.match(d.error, /not offered/);
});

test('sanitizeParams keeps only known non-negative numbers and never a sell-wall ceiling', () => {
  assert.deepEqual(sanitizeParams({ threshold: '0.05', ceiling: 2, evil: 1, tradeHive: -3, floor: 'x', wif: '5K...' }), { threshold: 0.05 });
  assert.deepEqual(sanitizeParams(null), {});
});

function fakeRes() {
  return { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; Object.assign(this.headers, h); }, end(b) { this.body = b || ''; } };
}

test('handler: /trade redirects to the picker; config + plan answer JSON', async () => {
  let res = fakeRes();
  assert.equal(await handler({ url: '/trade', method: 'GET' }, res), true);
  assert.equal(res.code, 302);
  assert.equal(res.headers.Location, '/bots');
  res = fakeRes();
  await handler({ url: '/api/trade/config', method: 'GET' }, res);
  assert.equal(res.code, 200);
  assert.ok(JSON.parse(res.body).bots['peg-arb']);
  __setFetch(fakeFetch({ he: { metrics: { lastPrice: '0.001' } } }));
  res = fakeRes();
  await handler({ url: '/api/trade/plan', method: 'POST', body: { bot: 'dca', venue: 'hive-engine', symbol: 'VKBT' } }, res);
  assert.equal(res.code, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.orders[0].side, 'buy');
  assert.equal(await handler({ url: '/elsewhere', method: 'GET' }, fakeRes()), false);
});

test('the picker page carries the run-on-your-account panel and never asks for a key', () => {
  const html = readFileSync(new URL('../integrations/bot-picker.html', import.meta.url), 'utf8');
  assert.match(html, /Run it on your account/);
  assert.match(html, /\/api\/trade\/plan/);
  assert.match(html, /requestCustomJson/);
  assert.match(html, /eth_sendTransaction/);
  assert.match(html, /Risk\./);
  assert.doesNotMatch(html, /type="password"|posting key|private key"|wif/i);
});

test('the auto portal mounts /bots and /api/trade before the session gate', () => {
  const src = readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  const bots = src.indexOf("path === '/bots'");
  const gate = src.indexOf('const sess = sessionOf(req);');
  assert.ok(bots > 0 && bots < gate);
  assert.ok(src.indexOf("path.startsWith('/api/trade/')") < gate);
  assert.match(readFileSync(new URL('./views.js', import.meta.url), 'utf8'), /href="\/bots">Trade bots/);
});
