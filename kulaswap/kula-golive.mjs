#!/usr/bin/env node
// Bring the KULA lotto loop live: stake the LP so MWALI starts minting, and seed the KULA prize pot.
// Signs through MELEK-Signer; holds no key.
import { ethers } from 'ethers';
const RPC = 'https://rpc.prana.melek.salon';
const SIGNER = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/+$/, '');
const TOKEN = process.env.MELEK_SIGNER_TOKEN;
const DRY = process.argv.includes('--dry');

// SUPERSEDED — this is the one-shot that brought the FIRST gauge/lotto pair up, and both of its
// targets are dead ends now. 0x704751bc… is the single-pair gauge, replaced by the five-pool
// MwaliMultiGauge at 0x98d0AF33…, whose stake() takes a pool id this script does not pass. 0x01e6a59A…
// is the earlier BurnLotto, still holding its own 10,000 KULA against an earlier MWALI. Running this
// today would approve and stake LP into a contract nothing reads and seed a pot nobody draws, so it
// refuses unless you really mean it. Live staking is stake(pid, amount) on the multi-gauge.
if (!process.env.I_MEAN_IT) {
  console.log('kula-golive.mjs is superseded and its gauge/lotto addresses are dead.');
  console.log('The live gauge is 0x98d0AF33C78133Ae7791330B7a28034ce85AbB59 — stake(pid, amount).');
  console.log('The live lottery is 0x85E69FA632E1a56f47eAD5B6cc977561B7eb18aD.');
  console.log('Set I_MEAN_IT=1 only if you are deliberately touching the retired pair.');
  process.exit(0);
}

const LP = '0x3fC307dEa06667f5a7a640Ec0aBb950EacC4B8C2';
const KULA = '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631';
const GAUGE = '0x704751bc51f694a59A514aeF267bD6898ec986B4';
const LOTTO = '0x01e6a59A305c48D614C97c1033c9d191948Fc07a';
const STAKE_LP = ethers.parseEther(process.env.STAKE_LP || '5000');
const SEED_KULA = ethers.parseEther(process.env.SEED_KULA || '10000');

const p = new ethers.JsonRpcProvider(RPC);
const post = async (path, body) => {
  const j = await (await fetch(SIGNER + path, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })).json();
  if (!j.ok) throw new Error(j.error || 'signer refused'); return j;
};
const send = async (label, to, data) => {
  if (DRY) { console.log(`  [dry] ${label}`); return; }
  const h = (await post('/v1/evm', { tx: { to, data, value: '0x0' } })).result.hash;
  for (let i = 0; i < 80; i += 1) {
    const rc = await p.getTransactionReceipt(h);
    if (rc) { console.log(`  ${label}: ${rc.status === 1 ? 'ok' : 'FAILED'}  ${h}`); if (rc.status !== 1) process.exit(1); return; }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`${label}: no receipt`);
};
const erc = new ethers.Interface(['function approve(address,uint256)','function allowance(address,address) view returns (uint256)','function balanceOf(address) view returns (uint256)']);
const gauge = new ethers.Interface(['function stake(uint256)','function earned(address) view returns (uint256)','function totalStaked() view returns (uint256)']);
const lotto = new ethers.Interface(['function fundPrize(uint256)','function prizePool() view returns (uint256)']);
const call = async (to, iface, fn, args = []) => iface.decodeFunctionResult(fn, await p.call({ to, data: iface.encodeFunctionData(fn, args) }))[0];

const { address: me } = await post('/v1/evm/address', {});
console.log('account   :', me);
const lpBal = await call(LP, erc, 'balanceOf', [me]);
const kBal = await call(KULA, erc, 'balanceOf', [me]);
console.log('LP        :', ethers.formatEther(lpBal), '-> staking', ethers.formatEther(STAKE_LP));
console.log('KULA      :', ethers.formatEther(kBal), '-> seeding pot', ethers.formatEther(SEED_KULA));
if (lpBal < STAKE_LP) { console.log('not enough LP'); process.exit(1); }
if (kBal < SEED_KULA) { console.log('not enough KULA'); process.exit(1); }
if (DRY) { console.log('--dry'); process.exit(0); }

if (await call(LP, erc, 'allowance', [me, GAUGE]) < STAKE_LP)
  await send('approve LP -> gauge', LP, erc.encodeFunctionData('approve', [GAUGE, ethers.MaxUint256]));
await send('stake LP', GAUGE, gauge.encodeFunctionData('stake', [STAKE_LP]));

if (await call(KULA, erc, 'allowance', [me, LOTTO]) < SEED_KULA)
  await send('approve KULA -> lotto', KULA, erc.encodeFunctionData('approve', [LOTTO, ethers.MaxUint256]));
await send('fund prize pot', LOTTO, lotto.encodeFunctionData('fundPrize', [SEED_KULA]));

console.log('\n--- live state ---');
console.log('gauge totalStaked :', ethers.formatEther(await call(GAUGE, gauge, 'totalStaked')));
console.log('lotto prizePool   :', ethers.formatEther(await call(LOTTO, lotto, 'prizePool')), 'KULA');
await new Promise((r) => setTimeout(r, 12000));
console.log('MWALI earned 12s  :', ethers.formatEther(await call(GAUGE, gauge, 'earned', [me])));
