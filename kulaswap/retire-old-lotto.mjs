#!/usr/bin/env node
// Retire the old NoLossLotto: draw the pot back to Hathor (she is the only depositor), then
// withdraw her deposit. Leaves the contract empty and abandoned. Signs via MELEK-Signer, no key.
import { ethers } from 'ethers';
const RPC = 'https://rpc.prana.melek.salon';
const SIGNER = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/+$/, '');
const TOKEN = process.env.MELEK_SIGNER_TOKEN;
const OLD = '0xfE5CC3c2919c893a33690bf6b36d58Ae5A989dB3';
const KULA = '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631';
const p = new ethers.JsonRpcProvider(RPC);
const I = new ethers.Interface([
  'function prizePool() view returns (uint256)','function totalDeposits() view returns (uint256)',
  'function depositorCount() view returns (uint256)','function drawCommit() view returns (uint256,bytes32)',
  'function deposits(address) view returns (uint256)','function saltHashOf(bytes32) view returns (bytes32)',
  'function commitDraw(bytes32)','function revealDraw(bytes32) returns (address)',
  'function clearExpiredDraw()','function withdraw(uint256)']);
const E = new ethers.Interface(['function balanceOf(address) view returns (uint256)']);
const post = async (path, body) => {
  const j = await (await fetch(SIGNER + path, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })).json();
  if (!j.ok) throw new Error(j.error || 'signer refused'); return j;
};
const call = async (to, iface, fn, a = []) => iface.decodeFunctionResult(fn, await p.call({ to, data: iface.encodeFunctionData(fn, a) }));
const send = async (label, fn, args = []) => {
  const h = (await post('/v1/evm', { tx: { to: OLD, data: I.encodeFunctionData(fn, args), value: '0x0' } })).result.hash;
  for (let i = 0; i < 90; i += 1) {
    const rc = await p.getTransactionReceipt(h);
    if (rc) { console.log(`  ${label}: ${rc.status === 1 ? 'ok' : 'FAILED'}  ${h}`); return rc.status === 1; }
    await new Promise((r) => setTimeout(r, 2500));
  }
  console.log(`  ${label}: no receipt`); return false;
};
const { address: me } = await post('/v1/evm/address', {});
const before = (await call(KULA, E, 'balanceOf', [me]))[0];
let pot = (await call(OLD, I, 'prizePool'))[0];
let dep = (await call(OLD, I, 'totalDeposits'))[0];
console.log(`account   : ${me}`);
console.log(`KULA now  : ${ethers.formatEther(before)}`);
console.log(`old pot   : ${ethers.formatEther(pot)}`);
console.log(`deposits  : ${ethers.formatEther(dep)}  (depositors ${(await call(OLD, I, 'depositorCount'))[0]})`);

// 1. pay the pot out to the only depositor
if (pot > 0n) {
  // An orphaned commit (salt lost when a previous run was killed) blocks a new one until it
  // expires — 256 blocks. Wait it out rather than failing: the pot is not going anywhere.
  let open = (await call(OLD, I, 'drawCommit'))[0];
  if (open > 0n) {
    let bn = await p.getBlockNumber();
    const need = Number(open) + 257;
    if (bn < need) {
      console.log(`  orphaned commit at ${open}; waiting ${need - bn} blocks for it to expire`);
      while (bn < need) { await new Promise((r) => setTimeout(r, 10000)); bn = await p.getBlockNumber(); }
    }
    console.log('  clearing the expired commit');
    if (!(await send('clearExpiredDraw', 'clearExpiredDraw'))) process.exit(1);
  }
  const salt = ethers.hexlify(ethers.randomBytes(32));
  const hash = (await call(OLD, I, 'saltHashOf', [salt]))[0];
  if (!(await send('commitDraw', 'commitDraw', [hash]))) process.exit(1);
  const start = await p.getBlockNumber();
  while ((await p.getBlockNumber()) < start + 4) await new Promise((r) => setTimeout(r, 3000));
  if (!(await send('revealDraw', 'revealDraw', [salt]))) process.exit(1);
}
// 2. take the deposit back
const mine = (await call(OLD, I, 'deposits', [me]))[0];
if (mine > 0n) await send(`withdraw ${ethers.formatEther(mine)}`, 'withdraw', [mine]);

const after = (await call(KULA, E, 'balanceOf', [me]))[0];
console.log('\n--- after ---');
console.log(`old pot      : ${ethers.formatEther((await call(OLD, I, 'prizePool'))[0])}`);
console.log(`old deposits : ${ethers.formatEther((await call(OLD, I, 'totalDeposits'))[0])}`);
console.log(`old balance  : ${ethers.formatEther((await call(KULA, E, 'balanceOf', [OLD]))[0])} KULA left in the dead contract`);
console.log(`Hathor KULA  : ${ethers.formatEther(after)}  (+${ethers.formatEther(after - before)})`);
