// balances.mjs — READ-ONLY multi-chain balance reader. Needs ONLY public addresses, no keys.
// This is the "everything up to the wallet gate" layer (operator 2026-06-01): the moment you
// provide 20 public addresses, this reads the native balance at each across all 20 chains via the
// SAME keyless RPC endpoints multichain.mjs uses. No private keys, no signing, no trading — a
// portfolio watcher that feeds the digest/annals. Trading/sweeping is a separate, key-gated step.
//
// Addresses come from (in order): the `addresses` arg, else .local/wallet-config.json, else env
// MELEK_ADDR_<CHAIN> (e.g. MELEK_ADDR_ETHEREUM). Public addresses only — never put a key here.
//
//   node integrations/chains/balances.mjs                 # balances for every configured address
//   import { allBalances, chainBalance } from './chains/balances.mjs'

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { CHAINS } from './multichain.mjs';

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
const CONFIG_PATH = process.env.MELEK_WALLET_CONFIG || new URL('../../.local/wallet-config.json', import.meta.url).pathname;

async function jsonFetch(url, opts = {}, timeout = 12000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try { const r = await fetch(url, { headers: { 'user-agent': UA, 'content-type': 'application/json' }, signal: ctrl.signal, ...opts });
    if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}
async function rpc(nodes, body) {
  let last; for (const n of nodes) { try { return await jsonFetch(n, { method: 'POST', body: JSON.stringify(body) }); } catch (e) { last = e; } }
  throw last || new Error('all nodes failed');
}
const hexNum = (h) => (typeof h === 'string' && h.startsWith('0x') ? parseInt(h, 16) : +h);

// Load the address map: explicit arg > .local file > env MELEK_ADDR_<CHAIN>.
export async function loadAddresses(explicit) {
  if (explicit) return explicit;
  const out = {};
  if (existsSync(CONFIG_PATH)) {
    try { Object.assign(out, JSON.parse(await readFile(CONFIG_PATH, 'utf8')).addresses || {}); } catch { /* ignore */ }
  }
  for (const name of Object.keys(CHAINS)) {
    const env = process.env[`MELEK_ADDR_${name.toUpperCase()}`];
    if (env && !out[name]) out[name] = env;
  }
  return out;
}

// native balance for one chain+address. Returns { chain, balance, symbol } or { chain, error|needsKey }.
export async function chainBalance(name, address) {
  const c = CHAINS[name];
  if (!c) return { chain: name, error: 'unknown chain' };
  if (!address) return { chain: name, error: 'no address configured' };
  try {
    if (c.kind === 'evm') {
      const r = await rpc(c.rpc, { jsonrpc: '2.0', id: 1, method: 'eth_getBalance', params: [address, 'latest'] });
      return { chain: name, balance: hexNum(r.result) / 1e18 };
    }
    if (c.kind === 'solana') {
      const r = await rpc(c.rpc, { jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address] });
      return { chain: name, balance: (r.result?.value ?? 0) / 1e9 };
    }
    if (c.kind === 'sui') {
      const r = await rpc(c.rpc, { jsonrpc: '2.0', id: 1, method: 'suix_getBalance', params: [address] });
      return { chain: name, balance: (+(r.result?.totalBalance || 0)) / 1e9 };
    }
    if (c.kind === 'tron') {
      const r = await jsonFetch(`${c.trongrid}/v1/accounts/${address}`);
      return { chain: name, balance: (r.data?.[0]?.balance ?? 0) / 1e6 };
    }
    if (c.kind === 'ton') {
      const r = await jsonFetch(`${c.toncenter}/getAddressBalance?address=${encodeURIComponent(address)}`);
      return { chain: name, balance: (+(r.result || 0)) / 1e9 };
    }
    if (c.kind === 'near') {
      const r = await rpc(c.rpc, { jsonrpc: '2.0', id: 1, method: 'query', params: { request_type: 'view_account', finality: 'final', account_id: address } });
      return { chain: name, balance: (+(r.result?.amount || 0)) / 1e24 };
    }
    if (c.kind === 'aptos') {
      const r = await jsonFetch(`${c.rest[0]}/accounts/${address}/resource/0x1::coin::CoinStore%3C0x1::aptos_coin::AptosCoin%3E`);
      return { chain: name, balance: (+(r.data?.coin?.value || 0)) / 1e8 };
    }
    if (c.kind === 'priceonly') {
      // cardano native balance needs a keyed indexer (Blockfrost) — flag, don't fail.
      return { chain: name, needsKey: 'blockfrost (cardano has no keyless balance RPC)' };
    }
  } catch (e) { return { chain: name, error: e.message }; }
  return { chain: name, error: 'unsupported kind' };
}

// balances for every configured chain, in parallel. usdPrices optional -> adds usdValue.
export async function allBalances(addresses, { prices } = {}) {
  const map = await loadAddresses(addresses);
  const names = Object.keys(CHAINS).filter((n) => map[n]);
  const results = await Promise.all(names.map((n) => chainBalance(n, map[n])));
  if (prices) for (const r of results) {
    const px = prices[CHAINS[r.chain]?.cg]?.usd;
    if (r.balance != null && px != null) r.usdValue = +(r.balance * px).toFixed(2);
  }
  return { configured: names.length, totalChains: Object.keys(CHAINS).length, balances: results };
}

if (process.argv[1] && process.argv[1].endsWith('balances.mjs')) {
  const { nativePrices } = await import('./multichain.mjs');
  const prices = await nativePrices().catch(() => null);
  const { configured, totalChains, balances } = await allBalances(undefined, { prices });
  console.log(`Multi-chain balances — read-only, keyless. ${configured}/${totalChains} chains have an address configured.\n` + '─'.repeat(64));
  if (!configured) {
    console.log('No addresses configured yet. Provide public addresses in .local/wallet-config.json');
    console.log('(see integrations/chains/wallet-config.example.json) or MELEK_ADDR_<CHAIN> env vars.');
  } else {
    let totalUsd = 0;
    for (const b of balances) {
      const v = b.error ? `(err: ${b.error.slice(0, 28)})` : b.needsKey ? `(needs ${b.needsKey})` : `${b.balance}`;
      const usd = b.usdValue != null ? `  ≈ $${b.usdValue}` : '';
      if (b.usdValue) totalUsd += b.usdValue;
      console.log(`${b.chain.padEnd(11)} ${String(v).padStart(24)}${usd}`);
    }
    console.log('─'.repeat(64));
    console.log(`portfolio ≈ $${totalUsd.toFixed(2)} (configured chains only)`);
  }
}
