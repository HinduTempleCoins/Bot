#!/usr/bin/env node
// seed-pairs.mjs — create + seed KulaSwap pairs with amounts DERIVED AT RUN TIME.
//
// WHY THIS REPLACES HARDCODED SEEDS. create-pairs.mjs carried fixed amounts computed from one
// snapshot of balances and prices. Both move constantly — a deposit, a trade, a curation payout or
// an emission changes who holds how much, and the USD prices move with every swap. A stale seed is
// not a cosmetic problem: a new pair's first addLiquidity SETS its price, so seeding off-market
// opens the pool arbitrageable and it gets drained. So this script reads everything live:
//
//   BALANCES  erc20.balanceOf(signer) for every token, at its own decimals()
//   PRICES    VKBT/CURE  — Hive-Engine last trade x the HIVE median feed (the only USD anchors)
//             HIVE/STEEM/BLURT — their SWAP market price x the HIVE feed
//             KULA/WPRANA/wMELEK — derived through the live KulaSwap reserve ratios
//   SEEDS     equal USD value on both sides, each asset's budget split across the pairs using it,
//             capped at a configurable fraction of balance, and skipped if either side is short.
//
//   node seed-pairs.mjs                 # derive + print the table, create nothing
//   node seed-pairs.mjs --live          # create every pair the live balances can fund
//   node seed-pairs.mjs --budget=0.5    # use 50% of each balance (default 0.9)
import { ethers } from 'ethers';

const RPC = process.env.PRANA_RPC || 'https://rpc.prana.melek.salon';
const HE = process.env.HE_RPC || 'https://api.hive-engine.com/rpc/contracts';
const HIVE_RPC = process.env.HIVE_RPC || 'https://api.hive.blog';
const SIGNER = process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon';
const TOKEN = process.env.MELEK_SIGNER_TOKEN || '';
const LIVE = process.argv.includes('--live');
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const BUDGET = Math.min(Math.max(parseFloat(arg('budget', '0.9')) || 0.9, 0.01), 1);

const ck = (x) => ethers.getAddress(x.toLowerCase());
const ROUTER = ck('0x24e53792B7f6609c85Bd3a3179A90638c9Dbc8B5');
const FACTORY = ck('0xFb5B83ed7F54e5fa45ED528dbe2167bB0b93b1E6');
const TOK = {
  KULA:   ck('0x32255d0138f5d645894fa89b5d5b5a68cf9aa631'),
  WPRANA: ck('0xcabcaaebbf7a7312b91a92faa635d7a32af42a34'),
  wVKBT:  ck('0xd915e757662c4234137aff167bf93d588145f75e'),
  wCURE:  ck('0x03d613bdaad82ecd6cf36b0fef88fb6af9d977ff'),
  wMELEK: ck('0xf6d9be2859191b45820df3a3b3b321b1b2589ab9'),
  wHIVE:  ck('0xe87080cee4d57fbe71ce3b902ae271b7b1d10983'),
  wSTEEM: ck('0x972646339417b695bcf781324e08c6811e9a9796'),
  wBLURT: ck('0x82a1bb49652db421f6262bc06793f5c141b7c2ba'),
};
// every pair worth having, in priority order; amounts are computed, not stated
const PAIRS = [
  ['wHIVE', 'wSTEEM'], ['wHIVE', 'wBLURT'], ['wSTEEM', 'wBLURT'],
  ['KULA', 'wHIVE'], ['KULA', 'wSTEEM'], ['KULA', 'wBLURT'],
  ['KULA', 'wMELEK'], ['WPRANA', 'wMELEK'], ['wMELEK', 'wVKBT'], ['wMELEK', 'wCURE'],
  ['WPRANA', 'wHIVE'], ['WPRANA', 'wSTEEM'], ['WPRANA', 'wBLURT'],
];

const p = new ethers.JsonRpcProvider(RPC);
const erc = new ethers.Interface(['function balanceOf(address) view returns (uint256)','function decimals() view returns (uint8)','function approve(address,uint256) returns (bool)','function allowance(address,address) view returns (uint256)']);
const fac = new ethers.Interface(['function getPair(address,address) view returns (address)','function allPairsLength() view returns (uint256)']);
const pair = new ethers.Interface(['function token0() view returns (address)','function getReserves() view returns (uint112,uint112,uint32)']);
const rtr = new ethers.Interface(['function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns (uint256,uint256,uint256)']);
const call = (to, data) => p.call({ to, data });
const dec = async (fn, to, args = []) => erc.decodeFunctionResult(fn, await call(to, erc.encodeFunctionData(fn, args)))[0];

async function post(path, body) {
  const r = await fetch(`${SIGNER}${path}`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json();
  if (!j.ok) throw new Error(`signer ${r.status}: ${j.error || JSON.stringify(j).slice(0, 180)}`);
  return j;
}
const send = async (to, data) => (await post('/v1/evm', { tx: { to, data, value: '0x0' } })).result.hash;
async function wait(h, label) {
  for (let i = 0; i < 120; i += 1) {
    const rc = await p.getTransactionReceipt(h);
    if (rc) { console.log(`    ${label}: ${rc.status === 1 ? 'ok' : 'FAILED'} ${h}`); return rc.status === 1; }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
}
async function rpcPost(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}

// ── live prices ────────────────────────────────────────────────────────────────────────────────
async function hiveUsd() {
  const j = await rpcPost(HIVE_RPC, { jsonrpc: '2.0', id: 1, method: 'condenser_api.get_current_median_history_price', params: [] });
  return parseFloat(j.result.base) / parseFloat(j.result.quote);
}
async function heLast(symbols) {
  const j = await rpcPost(HE, { jsonrpc: '2.0', id: 1, method: 'find', params: { contract: 'market', table: 'metrics', query: { symbol: { $in: symbols } }, limit: 20 } });
  return Object.fromEntries((j.result || []).map((m) => [m.symbol, parseFloat(m.lastPrice)]));
}
async function reserveRatio(a, b) { // units of b per 1 a, from the live pool
  const pr = fac.decodeFunctionResult('getPair', await call(FACTORY, fac.encodeFunctionData('getPair', [TOK[a], TOK[b]])))[0];
  if (pr === ethers.ZeroAddress) return null;
  const t0 = pair.decodeFunctionResult('token0', await call(pr, pair.encodeFunctionData('token0')))[0];
  const r = pair.decodeFunctionResult('getReserves', await call(pr, pair.encodeFunctionData('getReserves')));
  const [da, db] = [Number(await dec('decimals', TOK[a])), Number(await dec('decimals', TOK[b]))];
  const aFirst = ck(t0) === TOK[a];
  const ra = Number(aFirst ? r[0] : r[1]) / 10 ** da;
  const rb = Number(aFirst ? r[1] : r[0]) / 10 ** db;
  return ra > 0 && rb > 0 ? rb / ra : null;
}

const me = ck(TOKEN ? (await post('/v1/evm/address', {})).address : '0x026d69cB54B82a805b6aaE60718C4877124D8d11');
const H = await hiveUsd();
const he = await heLast(['VKBT', 'CURE', 'SWAP.STEEM', 'SWAP.BLURT']);
const USD = {
  wVKBT: he.VKBT * H,
  wCURE: he.CURE * H,
  wHIVE: H,
  wSTEEM: (he['SWAP.STEEM'] || 1) * H,
  wBLURT: (he['SWAP.BLURT'] || 0) * H,
};
// PRANA-side prices come through the wrapped anchors
const kulaPerVkbt = await reserveRatio('wVKBT', 'KULA');   // KULA per wVKBT
if (kulaPerVkbt) USD.KULA = USD.wVKBT / kulaPerVkbt;
const wpranaPerKula = await reserveRatio('KULA', 'WPRANA');
if (wpranaPerKula && USD.KULA) USD.WPRANA = USD.KULA / wpranaPerKula;
const kulaPerMelek = await reserveRatio('wMELEK', 'KULA');
if (kulaPerMelek && USD.KULA) USD.wMELEK = USD.KULA * kulaPerMelek;

console.log(`signer ${me}   HIVE $${H.toFixed(4)}   budget ${(BUDGET * 100).toFixed(0)}%`);
console.log(`factory pairs: ${fac.decodeFunctionResult('allPairsLength', await call(FACTORY, fac.encodeFunctionData('allPairsLength')))[0]}\n`);
console.log('asset     USD each         balance            total USD   (all live)');
const BAL = {}, DP = {};
for (const [s, a] of Object.entries(TOK)) {
  DP[s] = Number(await dec('decimals', a));
  BAL[s] = Number(await dec('balanceOf', a, [me])) / 10 ** DP[s];
  console.log(`${s.padEnd(8)} ${(USD[s] ?? 0).toExponential(6).padStart(14)} ${BAL[s].toFixed(8).padStart(18)} ${((USD[s] ?? 0) * BAL[s]).toFixed(8).padStart(14)}`);
}
console.log('');

// split each asset's budget across the pairs that still need creating
const need = [];
for (const [a, b] of PAIRS) {
  const ex = fac.decodeFunctionResult('getPair', await call(FACTORY, fac.encodeFunctionData('getPair', [TOK[a], TOK[b]])))[0];
  const r = await reserveRatio(a, b);
  if (ex !== ethers.ZeroAddress && r !== null) continue; // already a real market
  need.push([a, b, ex]);
}
const uses = {};
for (const [a, b] of need) { uses[a] = (uses[a] || 0) + 1; uses[b] = (uses[b] || 0) + 1; }

console.log(`${need.length} pair(s) to create:`);
const plan = [];
for (const [a, b, ex] of need) {
  if (!USD[a] || !USD[b]) { console.log(`  ${(a + '/' + b).padEnd(16)} SKIP: no live price for ${!USD[a] ? a : b}`); continue; }
  const usdA = (BAL[a] * BUDGET / uses[a]) * USD[a];
  const usdB = (BAL[b] * BUDGET / uses[b]) * USD[b];
  const usd = Math.min(usdA, usdB);
  const amtA = usd / USD[a], amtB = usd / USD[b];
  if (!(usd > 0) || amtA <= 0 || amtB <= 0) { console.log(`  ${(a + '/' + b).padEnd(16)} SKIP: no balance on ${usdA <= usdB ? a : b}`); continue; }
  console.log(`  ${(a + '/' + b).padEnd(16)} ${amtA.toFixed(8)} ${a} : ${amtB.toFixed(8)} ${b}   ($${usd.toFixed(8)}/side)${ex !== ethers.ZeroAddress ? '  [empty pair exists]' : ''}`);
  plan.push({ a, b, amtA, amtB });
}
if (!LIVE) { console.log('\n(dry run — pass --live to create)'); process.exit(0); }

for (const s of plan) {
  const wa = ethers.parseUnits(s.amtA.toFixed(DP[s.a]), DP[s.a]);
  const wb = ethers.parseUnits(s.amtB.toFixed(DP[s.b]), DP[s.b]);
  console.log(`\n${s.a}/${s.b}`);
  for (const [sym, amt] of [[s.a, wa], [s.b, wb]]) {
    const cur = await dec('allowance', TOK[sym], [me, ROUTER]);
    if (cur >= amt) { console.log(`    approve ${sym}: sufficient`); continue; }
    if (!await wait(await send(TOK[sym], erc.encodeFunctionData('approve', [ROUTER, amt])), `approve ${sym}`)) process.exit(1);
  }
  const dl = Math.floor(Date.now() / 1000) + 1800;
  const data = rtr.encodeFunctionData('addLiquidity', [TOK[s.a], TOK[s.b], wa, wb, wa, wb, me, dl]);
  if (!await wait(await send(ROUTER, data), 'addLiquidity')) process.exit(1);
  const made = fac.decodeFunctionResult('getPair', await call(FACTORY, fac.encodeFunctionData('getPair', [TOK[s.a], TOK[s.b]])))[0];
  console.log(`    pair: ${made}`);
}
console.log(`\nfactory pairs now: ${fac.decodeFunctionResult('allPairsLength', await call(FACTORY, fac.encodeFunctionData('allPairsLength')))[0]}`);
