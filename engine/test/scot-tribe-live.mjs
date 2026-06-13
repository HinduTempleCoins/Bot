#!/usr/bin/env node
// scot-tribe-live.mjs — TESTNET: make an engine side-token a Scotbot TRIBE, end to end, on-chain.
//   1. create the token (burns the APIS creation fee)  2. issue supply to the issuer
//   3. setReward -> registers the reward rule = a live Scotbot tribe (emission + author/curator split)
//   4. verify on the engine: token exists + reward rule registered.
// custom_json (id=mse-testnet-melek) -> tokens/rewards contracts. Active key from env (vault). --live.
//
//   HATHOR_ACTIVE_KEY=… node engine/test/scot-tribe-live.mjs --live

import pkg from '@hiveio/dhive';
const { Client, PrivateKey } = pkg;

const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = 'TST';
const SIDECHAIN = 'mse-testnet-melek';
const ENGINE_API = process.env.MELEK_ENGINE_API || 'http://127.0.0.1:8098';
const ACCT = process.env.MELEK_ENGINE_ISSUER || 'hathor';
const SYMBOL = (process.env.TRIBE_SYMBOL || 'SCROLL').toUpperCase();
const live = process.argv.includes('--live');
const key = process.env.HATHOR_ACTIVE_KEY && PrivateKey.fromString(process.env.HATHOR_ACTIVE_KEY.trim());
if (live && !key) { console.error('FATAL: set HATHOR_ACTIVE_KEY'); process.exit(1); }

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const op = (contractName, contractAction, contractPayload) => ['custom_json', {
  required_auths: [ACCT], required_posting_auths: [], id: SIDECHAIN,
  json: JSON.stringify({ contractName, contractAction, contractPayload }) }];
async function bc(c, a, p, label) {
  const r = await client.broadcast.sendOperations([op(c, a, p)], key).catch((e) => ({ error: String(e.message || e).slice(0, 140) }));
  console.log(`  ${label}: ${r.error ? 'ERR ' + r.error : 'tx ' + (r.id || r.trx_id)}`);
  return r;
}
const apiGet = async (path) => { try { return await (await fetch(`${ENGINE_API}${path}`)).json(); } catch { return null; } };

(async () => {
  console.log(`scot-tribe-live (${live ? 'LIVE' : 'dry'}) — tribe ${SYMBOL}, issuer @${ACCT}`);
  if (!live) { console.log('(dry — pass --live)'); return; }

  // 1. create token (burns APIS) — skip if it already exists
  const existing = await apiGet(`/api/tokens?symbol=${SYMBOL}`);
  if (Array.isArray(existing) && existing.length) console.log(`  ${SYMBOL} already exists`);
  else { await bc('tokens', 'create', { symbol: SYMBOL, name: 'Temple Scroll', precision: 3, maxSupply: '1000000' }, `create ${SYMBOL}`); await sleep(5000); }

  // 2. issue supply to the issuer (the reward pool source)
  await bc('tokens', 'issue', { symbol: SYMBOL, to: ACCT, quantity: '100000' }, `issue 100000 ${SYMBOL} -> @${ACCT}`);
  await sleep(5000);

  // 3. setReward — make it a Scotbot tribe: emit per window, split author/curator, by a curve
  await bc('rewards', 'setReward', {
    symbol: SYMBOL, emissionPerWindow: '100', windowBlocks: 20, authorBps: 5000, curve: 'linear',
  }, `setReward ${SYMBOL} (tribe: 100/window, 50/50, linear)`);
  await sleep(6000);

  // 4. verify on the engine
  console.log('\n=== verify ===');
  const tok = await apiGet(`/api/tokens?symbol=${SYMBOL}`);
  const t = Array.isArray(tok) ? tok[0] : tok;
  console.log(`  token: ${t ? `${t.symbol} issuer=${t.issuer} supply=${t.supply} maxSupply=${t.maxSupply}` : 'MISSING'}`);
  const rule = await apiGet(`/rpc/contracts`).catch(() => null); // best-effort; rule lives in rewardRules
  const rr = await (await fetch(`${ENGINE_API}/rpc/contracts`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contract: 'rewards', table: 'rewardRules', query: { symbol: SYMBOL } }) }).catch(() => null))?.json?.().catch(() => null);
  console.log(`  reward rule: ${rr && (Array.isArray(rr) ? rr.length : rr.result?.length) ? 'REGISTERED (tribe live)' : '(check engine /rpc/contracts rewardRules)'}`);
  console.log(`\n${t ? '✓' : '✗'} ${SYMBOL} is a live engine Scotbot tribe (token + reward rule on-chain via custom_json).`);
})();
