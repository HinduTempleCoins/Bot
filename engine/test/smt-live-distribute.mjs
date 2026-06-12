#!/usr/bin/env node
// smt-live-distribute.mjs — TESTNET-ONLY live MELEK-Engine (SMT) test: create a token, issue supply,
// and DISTRIBUTE it to real testnet accounts, then verify the engine node reflected it in its state.
// Exercises the custom_json (id=mse-testnet-melek) -> tokens contract lifecycle on the live chain.
//
// Broadcasts as @initminer (the genesis APIS holder, controlled by the public testnet genesis key,
// provided via env MELEK_GENESIS_WIF — kept in .local, never committed). --live to broadcast.

import * as dhive from '@hiveio/dhive';

const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = 'TST';
const SIDECHAIN = 'mse-testnet-melek';
const ENGINE_API = process.env.MELEK_ENGINE_API || 'http://127.0.0.1:8098';
const ACCT = 'initminer';
const SYMBOL = process.env.SMT_SYMBOL || 'TEMPLE';
const RECIPIENTS = (process.env.SMT_RECIPIENTS || 'melekvankush,hathorfan,angelnetwork,vankushfam,alphatester34').split(',').map((s) => s.trim()).filter(Boolean);
const live = process.argv.includes('--live');

const WIF = (process.env.MELEK_GENESIS_WIF || '').trim();
if (!WIF) { console.error('FATAL: set MELEK_GENESIS_WIF (public testnet genesis key, from .local)'); process.exit(1); }
const key = dhive.PrivateKey.fromString(WIF);
const client = new dhive.Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function bc(action, payload) {
  const op = ['custom_json', { required_auths: [ACCT], required_posting_auths: [], id: SIDECHAIN,
    json: JSON.stringify({ contractName: 'tokens', contractAction: action, contractPayload: payload }) }];
  const r = await client.broadcast.sendOperations([op], key).catch((e) => ({ error: String(e.message || e).slice(0, 120) }));
  console.log(`  ${action} ${SYMBOL}${payload.to ? ' -> @' + payload.to : ''}: ${r.error ? 'ERR ' + r.error : 'tx ' + (r.id || r.trx_id)}`);
  return r;
}
async function api(path) { try { const r = await fetch(`${ENGINE_API}${path}`); return await r.json(); } catch { return null; } }

(async () => {
  console.log(`SMT live test: token ${SYMBOL} as @${ACCT}, distribute to ${RECIPIENTS.join(', ')}`);
  if (!live) { console.log('(dry — pass --live to broadcast)'); return; }

  // 1. create (burns APIS) -> 2. issue supply to initminer -> 3. distribute to recipients
  await bc('create', { symbol: SYMBOL, name: 'Temple Token', precision: 3, maxSupply: '1000000' });
  await wait(4500);
  await bc('issue', { symbol: SYMBOL, to: ACCT, quantity: '100000' });
  await wait(4500);
  for (const to of RECIPIENTS) { await bc('transfer', { symbol: SYMBOL, to, quantity: '25' }); await wait(3500); }

  // let the engine node stream + process the ops
  console.log('waiting for the engine to process…');
  await wait(8000);

  // verify in engine state
  const tokens = await api('/api/tokens');
  const tok = Array.isArray(tokens) ? tokens.find((t) => t.symbol === SYMBOL) : null;
  console.log('\n=== engine state ===');
  console.log('token:', tok ? `${tok.symbol} issuer=${tok.issuer} supply=${tok.supply}` : 'MISSING');
  let held = 0;
  for (const to of RECIPIENTS) {
    const b = await api(`/api/balances?account=${to}&symbol=${SYMBOL}`);
    const bal = Array.isArray(b) && b[0] ? b[0].balance : '0';
    console.log(`  @${to}: ${bal} ${SYMBOL}`);
    if (parseFloat(bal) > 0) held++;
  }
  console.log(`\n${tok && held === RECIPIENTS.length ? '✓' : '✗'} token created + distributed to ${held}/${RECIPIENTS.length} accounts`);
  process.exit(tok && held === RECIPIENTS.length ? 0 : 2);
})();
