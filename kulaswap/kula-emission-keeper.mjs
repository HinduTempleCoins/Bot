#!/usr/bin/env node
// kula-emission-keeper — call EmissionScheduler.mintDue(). The CONTRACT decides the amount from its
// own schedule and sends it to its own recipient(). Nothing here passes an amount or a destination:
// there is no manual minting in this system and this keeper must not invent one. It is a crank.
const RPC = 'https://rpc.prana.melek.salon';
const SIGNER = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/+$/, '');
const TOKEN = process.env.MELEK_SIGNER_TOKEN;
const E = '0x611Ad02Ebe7F3FfE2050449Def20d6775E875323';
const KULA = '0x32255D0138f5D645894FA89b5D5B5a68cF9Aa631';
const DRY = process.argv.includes('--dry');
const SEL = { mintDue: '0x5dcf72e2', recipient: '0x66d003ac', totalMinted: '0xa2309ff8',
  currentEpoch: '0x76671808', perEpoch: '0x7b2bac68', lastEpoch: '0x8c6b1c52' };

const rpc = async (m, p) => (await (await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jsonrpc: '2.0', method: m, params: p, id: 1 }) })).json()).result;
const call = (to, d, from) => rpc('eth_call', [from ? { from, to, data: d } : { to, data: d }, 'latest']);
const f = (x) => (Number(x) / 1e18).toFixed(4);

const recipient = '0x' + String(await call(E, SEL.recipient)).slice(-40);
const due = BigInt(await call(E, SEL.mintDue, recipient));
const minted = BigInt(await call(E, SEL.totalMinted));
console.log(`recipient  : ${recipient}`);
console.log(`epoch      : ${BigInt(await call(E, SEL.currentEpoch))} (last minted ${BigInt(await call(E, SEL.lastEpoch))})`);
console.log(`perEpoch   : ${f(await call(E, SEL.perEpoch))} KULA/h`);
console.log(`totalMinted: ${f(minted)}`);
console.log(`due now    : ${f(due)} KULA`);
if (due <= 0n) { console.log('nothing due'); process.exit(0); }
if (DRY) { console.log('--dry'); process.exit(0); }
if (!TOKEN) { console.log('no token'); process.exit(1); }

const before = BigInt(await call(KULA, '0x70a08231' + recipient.slice(2).padStart(64, '0')));
const j = await (await fetch(`${SIGNER}/v1/evm`, { method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ tx: { to: E, data: SEL.mintDue, value: '0x0' } }) })).json();
if (!j.ok) { console.log('signer: ' + j.error); process.exit(1); }
const hash = j.result.hash;
let ok = false;
for (let i = 0; i < 60; i += 1) {
  const rc = await rpc('eth_getTransactionReceipt', [hash]);
  if (rc) { ok = rc.status === '0x1'; break; }
  await new Promise((r) => setTimeout(r, 2500));
}
console.log(`mintDue    : ${hash} ${ok ? 'ok' : 'FAILED'}`);
const after = BigInt(await call(KULA, '0x70a08231' + recipient.slice(2).padStart(64, '0')));
console.log(`recipient KULA ${f(before)} -> ${f(after)}  (+${f(after - before)})`);
console.log(`totalMinted    ${f(minted)} -> ${f(BigInt(await call(E, SEL.totalMinted)))}`);
