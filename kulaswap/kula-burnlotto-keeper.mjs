#!/usr/bin/env node
// kula-burnlotto-keeper — run a draw on the BurnLotto, twice a week.
//
// The draw is permissionless on this contract: no DRAW_ROLE, no privileged key. This keeper exists
// only so draws happen on a predictable cadence rather than whenever a stranger feels like it —
// anyone else may run one at any time and the result is identical.
//
// ONE RUN COMPLETES A DRAW. Commit, wait ~3 blocks, reveal. The earlier keeper needed a 10-minute
// timer to carry those two steps between runs; carrying them inside one invocation is why this one
// can be scheduled at 6h instead.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { ethers } from 'ethers';

const RPC = 'https://rpc.prana.melek.salon';
const SIGNER = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/+$/, '');
const TOKEN = process.env.MELEK_SIGNER_TOKEN;
const LOTTO = process.env.KULA_BURNLOTTO || '0x01e6a59A305c48D614C97c1033c9d191948Fc07a';
const STATE = process.env.BURNLOTTO_STATE || '/var/lib/melek-bot/burnlotto.json';
const INTERVAL_MS = Number(process.env.BURNLOTTO_INTERVAL_MS || 3.5 * 24 * 3600 * 1000);  // 2x/week
const DRY = process.argv.includes('--dry');

const p = new ethers.JsonRpcProvider(RPC);
const I = new ethers.Interface([
  'function prizePool() view returns (uint256)','function ticketCount() view returns (uint256)',
  'function playerCount() view returns (uint256)','function roundId() view returns (uint256)',
  'function totalBurned() view returns (uint256)','function drawCommit() view returns (uint256,bytes32)',
  'function saltHashOf(bytes32) view returns (bytes32)','function commitDraw(bytes32)',
  'function revealDraw(bytes32) returns (address)','function clearExpiredDraw()']);
const WINDOW = 256, DELAY = 3;

const call = async (fn, a = []) => I.decodeFunctionResult(fn, await p.call({ to: LOTTO, data: I.encodeFunctionData(fn, a) }));
const state = (() => { try { return JSON.parse(readFileSync(STATE, 'utf8')); } catch { return {}; } })();
const save = (s) => { try { mkdirSync(dirname(STATE), { recursive: true }); writeFileSync(STATE, JSON.stringify(s), { mode: 0o600 }); } catch {} };
const post = async (path, body) => {
  const j = await (await fetch(SIGNER + path, { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })).json();
  if (!j.ok) throw new Error(j.error || 'signer refused'); return j;
};
const send = async (label, fn, args = []) => {
  const h = (await post('/v1/evm', { tx: { to: LOTTO, data: I.encodeFunctionData(fn, args), value: '0x0' } })).result.hash;
  for (let i = 0; i < 90; i += 1) {
    const rc = await p.getTransactionReceipt(h);
    if (rc) { console.log(`  ${label}: ${rc.status === 1 ? 'ok' : 'FAILED'} ${h}`); return rc.status === 1; }
    await new Promise((r) => setTimeout(r, 2500));
  }
  return false;
};

const pot = (await call('prizePool'))[0];
const tickets = (await call('ticketCount'))[0];
const players = (await call('playerCount'))[0];
const round = (await call('roundId'))[0];
const burned = (await call('totalBurned'))[0];
const [cb] = await call('drawCommit');
const bn = await p.getBlockNumber();
const since = Date.now() - (state.lastDrawAt || 0);

console.log(`lotto     : ${LOTTO}`);
console.log(`round     : ${round}  block ${bn}`);
console.log(`players   : ${players}  tickets ${tickets}`);
console.log(`pot       : ${ethers.formatEther(pot)} KULA`);
console.log(`burned    : ${ethers.formatEther(burned)} MWALI all-time`);
console.log(`last draw : ${state.lastDrawAt ? new Date(state.lastDrawAt).toISOString() : 'never'}`);

if (cb > 0n) {
  const age = bn - Number(cb);
  if (age > WINDOW) { console.log(`  stale commit (${age} blocks) — clearing`); if (!DRY) await send('clearExpiredDraw', 'clearExpiredDraw'); process.exit(0); }
  console.log(`  a commit is already open at block ${cb}; another runner holds the salt. Leaving it.`);
  process.exit(0);
}
if (tickets === 0n || pot === 0n) { console.log(`  nothing to draw (tickets ${tickets}, pot ${ethers.formatEther(pot)})`); process.exit(0); }
if (state.lastDrawAt && since < INTERVAL_MS) {
  console.log(`  not due — next in ~${Math.round((INTERVAL_MS - since) / 3600000)}h`); process.exit(0);
}
if (DRY) { console.log('  would COMMIT then REVEAL'); process.exit(0); }

const salt = ethers.hexlify(ethers.randomBytes(32));
const hash = (await call('saltHashOf', [salt]))[0];
if (!(await send('commitDraw', 'commitDraw', [hash]))) process.exit(1);
const start = await p.getBlockNumber();
while ((await p.getBlockNumber()) < start + DELAY + 1) await new Promise((r) => setTimeout(r, 3000));
if (!(await send('revealDraw', 'revealDraw', [salt]))) process.exit(1);
save({ ...state, lastDrawAt: Date.now(), round: Number(round) });
console.log(`  pot after : ${ethers.formatEther((await call('prizePool'))[0])} KULA`);
