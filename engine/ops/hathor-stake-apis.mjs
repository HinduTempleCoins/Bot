#!/usr/bin/env node
// hathor-stake-apis.mjs — stake Hathor's APIS on MELEK-Engine.
// NET=mainnet is REQUIRED: op-builder defaults to testnet and emits id "mse-testnet-melek",
// which the mainnet engine silently ignores. Checked against /api/status before broadcasting.
process.env.NET = process.env.NET || 'mainnet';
const DRY = process.argv.includes('--dry');
const ENGINE = process.env.ENGINE_API || 'https://engine.melek.salon';
const SIGNER = (process.env.MELEK_SIGNER_URL || 'https://signer.melek.salon').replace(/\/$/, '');
const TOKEN = (process.env.MELEK_SIGNER_TOKEN || '').trim();
const ME = 'hathor';

const bal = await (await fetch(`${ENGINE}/api/balances?account=${ME}`)).json();
const apis = (bal || []).find((b) => b.symbol === 'APIS');
if (!apis) { console.log('no APIS balance'); process.exit(1); }
console.log(`liquid APIS : ${apis.balance}`);
console.log(`staked APIS : ${apis.stake}`);
const qty = apis.balance;
if (!(parseFloat(qty) > 0)) { console.log('nothing to stake'); process.exit(0); }

const { buildEngineOp } = await import(new URL('../lib/op-builder.mjs', import.meta.url).href);
const built = buildEngineOp('stake', { symbol: 'APIS', quantity: qty }, ME);
if (!built.ok) { console.log('build failed:', built.error); process.exit(1); }
const status = await (await fetch(`${ENGINE}/api/status`)).json();
console.log(`op id       : ${built.op[1].id}`);
console.log(`chain id    : ${status.sidechainId}`);
if (built.op[1].id !== status.sidechainId) {
  console.log('REFUSING: op sidechain id does not match the live engine — it would be a silent no-op.');
  process.exit(1);
}
console.log(`summary     : ${built.summary}`);
if (DRY) { console.log('\n--dry: not broadcast'); process.exit(0); }
if (!TOKEN) { console.log('no MELEK_SIGNER_TOKEN in env'); process.exit(1); }

const r = await fetch(`${SIGNER}/v1/broadcast`, {
  method: 'POST', signal: AbortSignal.timeout(60000),
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
  body: JSON.stringify({ chain: 'melek', role: 'active', ops: [built.op], client_ref: `stake-apis-${Date.now()}` }),
});
const txt = await r.text();
console.log(`broadcast   : HTTP ${r.status}`);
console.log(txt.slice(0, 400));
process.exit(r.ok ? 0 : 1);
