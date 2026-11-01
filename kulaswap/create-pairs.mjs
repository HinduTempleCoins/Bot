#!/usr/bin/env node
// create-pairs.mjs — create and seed the missing KulaSwap pairs on PRANA mainnet.
//
// WHY. Factory.allPairsLength was 5 of a possible 10 across KULA/WPRANA/wMELEK/wVKBT/wCURE. The
// missing pairs could not all be seeded because wMELEK's ENTIRE supply (0.9) sits inside pool 4, so
// only the WPRANA-quoted pairs are fundable from Hathor's balances. This creates those.
//
// PRICE CONSISTENCY. A new pair's first addLiquidity SETS its price, so each pair is seeded at the
// ratio implied by the existing pools — otherwise it opens arbitrageable against pool 0/1/2:
//   1 WPRANA = 1.559267 KULA  (pool 0: 16,626.438270 KULA : 10,661.996445 WPRANA, inverted)
//   1 KULA   = 17.504966 wVKBT (pool 1)      -> 1 WPRANA = 27.2944 wVKBT
//   1 KULA   = 0.426672 wCURE  (pool 2)      -> 1 WPRANA = 0.665289 wCURE
//
// Signing is via MELEK-Signer /v1/evm (scope evm_send). No key on this box.
//   node create-pairs.mjs            # dry run: prints amounts, balances, encoded calls
//   node create-pairs.mjs --live
import { ethers } from 'ethers';

const RPC = process.env.PRANA_RPC || 'https://rpc.prana.melek.salon';
const SIGNER = process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon';
const TOKEN = process.env.MELEK_SIGNER_TOKEN || '';
const LIVE = process.argv.includes('--live');

// addresses normalised with getAddress from the lowercase forms read off-chain — kula-config.mjs
// carries a WPRANA/factory casing that ethers rejects as a bad checksum (the file notes this).
const ck = (x) => ethers.getAddress(x.toLowerCase());
const ROUTER = ck('0x24e53792B7f6609c85Bd3a3179A90638c9Dbc8B5');
const FACTORY = ck('0xFb5B83ed7F54e5fa45ED528dbe2167bB0b93b1E6');
const TOK = {
  KULA:   { a: ck('0x32255d0138f5d645894fa89b5d5b5a68cf9aa631'), d: 18 },
  WPRANA: { a: ck('0xcabcaaebbf7a7312b91a92faa635d7a32af42a34'), d: 18 },
  wVKBT:  { a: ck('0xd915e757662c4234137aff167bf93d588145f75e'), d: 8 },
  wCURE:  { a: ck('0x03d613bdaad82ecd6cf36b0fef88fb6af9d977ff'), d: 8 },
  wMELEK: { a: ck('0xf6d9be2859191b45820df3a3b3b321b1b2589ab9'), d: 18 },
  wHIVE:  { a: ck('0xe87080cee4d57fbe71ce3b902ae271b7b1d10983'), d: 8 },
  wSTEEM: { a: ck('0x972646339417b695bcf781324e08c6811e9a9796'), d: 8 },
  wBLURT: { a: ck('0x82a1bb49652db421f6262bc06793f5c141b7c2ba'), d: 6 },
};

// each: [tokenA, amountA, tokenB, amountB] — A is WPRANA, ratios from the live pools above
// Done 2026-10-30: WPRANA/wVKBT and WPRANA/wCURE (factory went 7 -> 9).
//
// ⚠️ SEEDS ARE USD-BALANCED, NOT TOKEN-BALANCED. A new pair's first addLiquidity SETS its price, and
// the two sides of this ecosystem differ by ~5 orders of magnitude per unit (live 30 Oct 2026):
//
//   wHIVE  $0.0480000000     WPRANA  $0.0000005372
//   wSTEEM $0.0489600000     KULA    $0.0000003445
//   wBLURT $0.0007834435     wCURE   $0.0000010656
//                            wVKBT   $0.0000000197
//                            wMELEK  $0.0000000400
//
// Seeding WPRANA/wHIVE at 2.5 : 2.5 — which an earlier revision of this file did — would declare
// 1 WPRANA = 1 wHIVE, i.e. ~89,000x WPRANA's real price, and the pool would be drained by arbitrage
// against KULA/WPRANA almost immediately. So every amount below is derived by matching USD value on
// both sides, capped by whichever side is scarcer.
//
// The binding constraint is the PRANA side: all the KULA we hold is ~$0.057 and all the WPRANA is
// ~$0.0000589, against ~$11.36 of wHIVE once both accounts' SWAP.HIVE is bridged. So any pair that
// puts a HIVE-side asset against KULA or WPRANA is capped by the PRANA side and stays tiny — that
// is the price math, not a misconfiguration.
//
// Which is why the HIVE-side assets are paired with EACH OTHER first: wHIVE/wSTEEM/wBLURT are all
// within an order of magnitude per unit, so those pools carry ~$0.39-$0.57 a side instead of $0.017.
// Even then ~$10.29 of wHIVE is left unpaired, because every counter-asset is exhausted.
const PLAN = [
  // ── HIVE-side pairs: the ones that can carry real size ──────────────────────────────────────
  // wHIVE/wSTEEM/wBLURT have comparable USD per unit, so pairs AMONG THEMSELVES hold ~$0.39-$0.57
  // per side — roughly 30x the KULA pairs below, which are capped by KULA's total $0.057. This is
  // also the cross-chain graph: HIVE <-> STEEM <-> BLURT, tradeable on PRANA.
  { name: 'wHIVE/wSTEEM',  a: 'wHIVE',  amtA: '11.2200',   b: 'wSTEEM', amtB: '11.0' },
  { name: 'wHIVE/wBLURT',  a: 'wHIVE',  amtA: '10.2223',   b: 'wBLURT', amtB: '626.3' },
  { name: 'wSTEEM/wBLURT', a: 'wSTEEM', amtA: '8.0',       b: 'wBLURT', amtB: '500.0' },
  // KULA hub pairs — the meaningful ones at ~$0.0171 per side
  { name: 'KULA/wHIVE',    a: 'KULA',   amtA: '49572.522', b: 'wHIVE',  amtB: '0.35578375' },
  { name: 'KULA/wSTEEM',   a: 'KULA',   amtA: '49572.522', b: 'wSTEEM', amtB: '0.34880759' },
  { name: 'KULA/wBLURT',   a: 'KULA',   amtA: '49572.522', b: 'wBLURT', amtB: '21.798150' },
  // WPRANA pairs — ~$0.0000177 per side; WPRANA's entire balance is only worth ~$0.0000589
  { name: 'WPRANA/wHIVE',  a: 'WPRANA', amtA: '32.8695459', b: 'wHIVE',  amtB: '0.00036787' },
  { name: 'WPRANA/wSTEEM', a: 'WPRANA', amtA: '32.8695459', b: 'wSTEEM', amtB: '0.00036066' },
  { name: 'WPRANA/wBLURT', a: 'WPRANA', amtA: '32.8695459', b: 'wBLURT', amtB: '0.02253892' },
  // wMELEK — blocked until MELEK is bridged (supply 0.9, all inside the KULA/wMELEK pool).
  // Ratios from the live pools: 1 wMELEK = 0.11614441 KULA = 2.033104 wVKBT = 0.049556 wCURE.
  { name: 'WPRANA/wMELEK', a: 'WPRANA', amtA: '2.5',  b: 'wMELEK', amtB: '33.5662' },
  { name: 'wMELEK/wVKBT',  a: 'wMELEK', amtA: '7',    b: 'wVKBT',  amtB: '14.232' },
  { name: 'wMELEK/wCURE',  a: 'wMELEK', amtA: '1.6',  b: 'wCURE',  amtB: '0.07928' },
];

const p = new ethers.JsonRpcProvider(RPC);
const erc20 = new ethers.Interface([
  'function approve(address,uint256) returns (bool)',
  'function allowance(address,address) view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
]);
const router = new ethers.Interface([
  'function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns (uint256,uint256,uint256)',
]);
const factory = new ethers.Interface([
  'function getPair(address,address) view returns (address)',
  'function allPairsLength() view returns (uint256)',
]);

const call = async (to, data) => p.call({ to, data });
async function post(path, body) {
  const r = await fetch(`${SIGNER}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(`signer ${r.status}: ${j.error || JSON.stringify(j).slice(0, 180)}`);
  return j;
}
const send = async (to, data) => (await post('/v1/evm', { tx: { to, data, value: '0x0' } })).result.hash;
async function wait(h, label) {
  for (let i = 0; i < 90; i += 1) {
    const rc = await p.getTransactionReceipt(h);
    if (rc) { console.log(`    ${label}: ${rc.status === 1 ? 'ok' : 'FAILED'} ${h}`); return rc.status === 1; }
    await new Promise((r) => setTimeout(r, 2500));
  }
  console.log(`    ${label}: TIMEOUT ${h}`);
  return false;
}

const me = ck(LIVE || TOKEN ? (await post('/v1/evm/address', {})).address : '0x026d69cB54B82a805b6aaE60718C4877124D8d11');
console.log(`signer address : ${me}`);
console.log(`factory pairs  : ${factory.decodeFunctionResult('allPairsLength', await call(FACTORY, factory.encodeFunctionData('allPairsLength')))[0]}`);
console.log('');

for (const step of PLAN) {
  const A = TOK[step.a], B = TOK[step.b];
  const wa = ethers.parseUnits(step.amtA, A.d), wb = ethers.parseUnits(step.amtB, B.d);
  const existing = factory.decodeFunctionResult('getPair', await call(FACTORY, factory.encodeFunctionData('getPair', [A.a, B.a])))[0];
  const balA = erc20.decodeFunctionResult('balanceOf', await call(A.a, erc20.encodeFunctionData('balanceOf', [me])))[0];
  const balB = erc20.decodeFunctionResult('balanceOf', await call(B.a, erc20.encodeFunctionData('balanceOf', [me])))[0];
  console.log(`${step.name}`);
  console.log(`  existing pair : ${existing === ethers.ZeroAddress ? 'none — will be created' : existing}`);
  console.log(`  seed          : ${step.amtA} ${step.a} + ${step.amtB} ${step.b}`);
  console.log(`  balance ${step.a.padEnd(6)}: ${ethers.formatUnits(balA, A.d)}`);
  console.log(`  balance ${step.b.padEnd(6)}: ${ethers.formatUnits(balB, B.d)}`);
  if (balA < wa || balB < wb) { console.log('  SKIP: insufficient balance'); continue; }
  if (existing !== ethers.ZeroAddress) { console.log('  SKIP: pair already exists'); continue; }
  if (!LIVE) { console.log('  (dry run — would approve x2 then addLiquidity)\n'); continue; }
  for (const [t, amt, nm] of [[A, wa, step.a], [B, wb, step.b]]) {
    const cur = erc20.decodeFunctionResult('allowance', await call(t.a, erc20.encodeFunctionData('allowance', [me, ROUTER])))[0];
    if (cur >= amt) { console.log(`    approve ${nm}: already sufficient`); continue; }
    if (!await wait(await send(t.a, erc20.encodeFunctionData('approve', [ROUTER, amt])), `approve ${nm}`)) { console.log('  ABORT'); process.exit(1); }
  }
  const deadline = Math.floor(Date.now() / 1000) + 1800;
  // first mint on a new pair takes the full amounts, so mins equal desired
  const data = router.encodeFunctionData('addLiquidity', [A.a, B.a, wa, wb, wa, wb, me, deadline]);
  if (!await wait(await send(ROUTER, data), 'addLiquidity')) { console.log('  ABORT'); process.exit(1); }
  const made = factory.decodeFunctionResult('getPair', await call(FACTORY, factory.encodeFunctionData('getPair', [A.a, B.a])))[0];
  console.log(`  created       : ${made}\n`);
}
console.log(`factory pairs now: ${factory.decodeFunctionResult('allPairsLength', await call(FACTORY, factory.encodeFunctionData('allPairsLength')))[0]}`);
