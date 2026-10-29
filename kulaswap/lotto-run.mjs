#!/usr/bin/env node
// lotto-run.mjs — drive the NoLossLotto keeper through MELEK-Signer.
// Holds NO key: reads go over plain RPC, writes go to /v1/evm, which signs as the bearer's account.
// The decision logic is kulaswap/lotto-keeper.mjs — this only supplies it a contract shim.
import { tick, decide, loadState, loadMarks } from './lotto-keeper.mjs';

const RPC = process.env.PRANA_RPC_URL || 'https://rpc.prana.melek.salon';
const SIGNER = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/+$/, '');
const TOKEN = process.env.MELEK_SIGNER_TOKEN;
const LOTTO = process.env.KULA_LOTTO_ADDRESS || '0xfE5CC3c2919c893a33690bf6b36d58Ae5A989dB3';
const DRY = process.argv.includes('--dry');

const SEL = { prizePool: '0x719ce73e', depositorCount: '0x277e9d28', drawCommit: '0xa128983f',
  totalDeposits: '0x7d882097', commitDraw: '0x58120a3a', revealDraw: '0x910f94f1',
  clearExpiredDraw: '0xcb0bf476', saltHashOf: '0x3d2c1b42' };

const rpc = async (method, params) => (await (await fetch(RPC, { method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }) })).json()).result;
const call = (data) => rpc('eth_call', [{ to: LOTTO, data }, 'latest']);
const send = async (data) => {
  const j = await (await fetch(`${SIGNER}/v1/evm`, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ tx: { to: LOTTO, data, value: '0x0' } }) })).json();
  if (!j.ok) throw new Error(j.error || 'signer refused');
  return { hash: j.result && j.result.hash };
};
const waitFor = async (hash) => {
  for (let i = 0; i < 60; i += 1) {
    const rc = await rpc('eth_getTransactionReceipt', [hash]);
    if (rc) return rc.status === '0x1';
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
};
const b32 = (s) => String(s).replace(/^0x/, '').padStart(64, '0');

const contract = {
  drawCommit: async () => { const h = String(await call(SEL.drawCommit)).replace(/^0x/, '');
    return [BigInt('0x' + (h.slice(0, 64) || '0')), '0x' + h.slice(64, 128)]; },
  totalDeposits: async () => BigInt(await call(SEL.totalDeposits)),
  prizePool: async () => BigInt(await call(SEL.prizePool)),
  depositorCount: async () => BigInt(await call(SEL.depositorCount)),
  saltHashOf: async (salt) => await call(SEL.saltHashOf + b32(salt)),
  commitDraw: async (h) => { const tx = await send(SEL.commitDraw + b32(h));
    if (!(await waitFor(tx.hash))) throw new Error(`commit reverted (${tx.hash})`); return tx; },
  revealDraw: async (s) => { const tx = await send(SEL.revealDraw + b32(s));
    if (!(await waitFor(tx.hash))) throw new Error(`reveal reverted (${tx.hash})`); return tx; },
  clearExpiredDraw: async () => { const tx = await send(SEL.clearExpiredDraw);
    if (!(await waitFor(tx.hash))) throw new Error(`clear reverted (${tx.hash})`); return tx; },
};
const provider = { getBlockNumber: async () => Number(BigInt(await rpc('eth_blockNumber', []))) };

if (DRY) {
  const [dc, dep, pot, n, bn] = await Promise.all([contract.drawCommit(), contract.totalDeposits(),
    contract.prizePool(), contract.depositorCount(), provider.getBlockNumber()]);
  const mk = loadMarks();
  const d = decide({ commitBlock: Number(dc[0]), blockNumber: bn, totalDeposits: dep, prizePool: pot,
    haveSalt: !!loadState(), lastDrawAt: mk.lastDrawAt || 0 });
  console.log(`block        : ${bn}`);
  console.log(`depositors   : ${n}`);
  console.log(`totalDeposits: ${Number(dep) / 1e18} KULA`);
  console.log(`prizePool    : ${Number(pot) / 1e18} KULA`);
  console.log(`open commit  : ${Number(dc[0]) === 0 ? 'none' : `block ${dc[0]}`}`);
  console.log(`last draw    : ${mk.lastDrawAt ? new Date(mk.lastDrawAt).toISOString() : 'never'}`);
  console.log(`would        : ${d.action.toUpperCase()} — ${d.reason}`);
  process.exit(0);
}
if (!TOKEN) { console.log('no MELEK_SIGNER_TOKEN'); process.exit(1); }

// COMPLETE THE WHOLE DRAW IN ONE RUN. The reveal is legal ~3 blocks after the commit, which at ~10s
// blocks is about half a minute — so a single invocation can commit, wait, and reveal. The earlier
// design relied on a 10-MINUTE TIMER to carry those two steps across separate runs, which meant 1,008
// wake-ups a week to perform two draws. That was a frequent timer compensating for a keeper that
// could not finish its own job. It finishes it here instead, and the timer only has to decide WHEN a
// draw happens, not nurse one along.
const DEADLINE_MS = 8 * 60 * 1000;          // generous: the reveal window is ~43 min at 10s blocks
const started = Date.now();
let r = await tick({ contract, provider });
console.log(JSON.stringify(r));
while (r.ok && (r.action === 'commit' || r.action === 'wait') && Date.now() - started < DEADLINE_MS) {
  await new Promise((s) => setTimeout(s, 15000));
  r = await tick({ contract, provider });
  console.log(JSON.stringify(r));
  if (r.action === 'reveal' || r.action === 'clear') break;
}
process.exit(r.ok ? 0 : 1);
