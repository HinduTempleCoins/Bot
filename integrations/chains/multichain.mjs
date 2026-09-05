// multichain.mjs — READ-ONLY multi-chain status reader. No keys.
// The "look at 10 high-volume chains the way we look at HIVE" layer: per chain, native-token
// price + chain TVL + latest block/slot + gas, via KEYLESS endpoints (DefiLlama, CoinGecko,
// PublicNode RPC, Solana public RPC). Mirrors chain-explorer (base-chain) + he-client (failover)
// for the EVM/Solana/etc world. Keyed RPC providers (Alchemy/Helius/...) are cataloged in
// CROSSCHAIN_APIS.md for the vault, never hard-coded here.
//
//   node integrations/chains/multichain.mjs            # dashboard across all chains
//   node integrations/chains/multichain.mjs ethereum solana
//   import { chainStatus, chainsTvl } from './chains/multichain.mjs'

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// PRANA — the ecosystem's EVM/Ethereum-clone chain. Registered here as a DORMANT, ready-to-connect
// chain: it carries NO hard-coded RPC (the node is not public yet). The ONE wiring step when the
// PRANA node goes live is to set TWO env vars (NAME only, never a secret in code):
//   PRANA_RPC_URL   — the EVM JSON-RPC endpoint (e.g. https://rpc.prana.<host>); comma-separated
//                     for a failover list. UNSET → the chain soft-fails (returns null/error), never
//                     throws, exactly like any other unconfigured chain.
//   PRANA_CHAIN_ID  — the eip155 chain id (decimal). Used for CAIP addressing (eip155:<id>:<addr>).
//                     Defaults to a placeholder until the genesis chain id is fixed.
// Until PRANA_RPC_URL is set, `prana.rpc` resolves to [] and every reader soft-fails clean.
export const PRANA_RPC_ENV = 'PRANA_RPC_URL';
export const PRANA_CHAIN_ID_ENV = 'PRANA_CHAIN_ID';
const PRANA_CHAIN_ID_PLACEHOLDER = '712217'; // PRANA MAINNET (0xADE19). Testnet/alpha is 108369. Env-overridable via PRANA_CHAIN_ID
// Resolved per-access (a getter, not frozen at import) so setting PRANA_RPC_URL after this module
// loads — or in an offline test — lights the chain up automatically with no code change.
export function pranaRpc() {
  const raw = process.env[PRANA_RPC_ENV];
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
}
export function pranaChainId() {
  return process.env[PRANA_CHAIN_ID_ENV] || PRANA_CHAIN_ID_PLACEHOLDER;
}

// 10 high-token-traffic chains. rpc = keyless public endpoints (failover order); cg = coingecko
// id for the native token; llama = DefiLlama chain name (TVL); kind drives how we read height.
export const CHAINS = {
  ethereum: { kind: 'evm', cg: 'ethereum', llama: 'Ethereum', rpc: ['https://ethereum-rpc.publicnode.com', 'https://eth.llamarpc.com', 'https://1rpc.io/eth'] },
  bsc:      { kind: 'evm', cg: 'binancecoin', llama: 'BSC', rpc: ['https://bsc-rpc.publicnode.com', 'https://binance.llamarpc.com'] },
  polygon:  { kind: 'evm', cg: 'matic-network', llama: 'Polygon', rpc: ['https://polygon-bor-rpc.publicnode.com', 'https://polygon.llamarpc.com'] },
  base:     { kind: 'evm', cg: 'ethereum', llama: 'Base', rpc: ['https://base-rpc.publicnode.com', 'https://base.llamarpc.com'] },
  arbitrum: { kind: 'evm', cg: 'ethereum', llama: 'Arbitrum', rpc: ['https://arbitrum-one-rpc.publicnode.com', 'https://arbitrum.llamarpc.com'] },
  avalanche:{ kind: 'evm', cg: 'avalanche-2', llama: 'Avalanche', rpc: ['https://avalanche-c-chain-rpc.publicnode.com', 'https://1rpc.io/avax/c'] },
  optimism: { kind: 'evm', cg: 'ethereum', llama: 'OP Mainnet', rpc: ['https://optimism-rpc.publicnode.com', 'https://optimism.llamarpc.com'] },
  solana:   { kind: 'solana', cg: 'solana', llama: 'Solana', rpc: ['https://api.mainnet-beta.solana.com', 'https://solana-rpc.publicnode.com'] },
  tron:     { kind: 'tron', cg: 'tron', llama: 'Tron', trongrid: 'https://api.trongrid.io' },
  sui:      { kind: 'sui', cg: 'sui', llama: 'Sui', rpc: ['https://fullnode.mainnet.sui.io', 'https://sui-rpc.publicnode.com'] },
  // --- 10 more (20 total) ---
  cronos:   { kind: 'evm', cg: 'crypto-com-chain', llama: 'Cronos', rpc: ['https://cronos-evm-rpc.publicnode.com', 'https://evm.cronos.org'] },
  mantle:   { kind: 'evm', cg: 'mantle', llama: 'Mantle', rpc: ['https://mantle-rpc.publicnode.com', 'https://rpc.mantle.xyz'] },
  linea:    { kind: 'evm', cg: 'ethereum', llama: 'Linea', rpc: ['https://linea-rpc.publicnode.com', 'https://rpc.linea.build'] },
  scroll:   { kind: 'evm', cg: 'ethereum', llama: 'Scroll', rpc: ['https://scroll-rpc.publicnode.com', 'https://rpc.scroll.io'] },
  sei:      { kind: 'evm', cg: 'sei-network', llama: 'Sei', rpc: ['https://sei-evm-rpc.publicnode.com', 'https://evm-rpc.sei-apis.com'] },
  gnosis:   { kind: 'evm', cg: 'xdai', llama: 'Gnosis', rpc: ['https://gnosis-rpc.publicnode.com', 'https://rpc.gnosischain.com'] },
  ton:      { kind: 'ton', cg: 'the-open-network', llama: 'TON', toncenter: 'https://toncenter.com/api/v2' },
  near:     { kind: 'near', cg: 'near', llama: 'Near', rpc: ['https://rpc.mainnet.near.org'] },
  aptos:    { kind: 'aptos', cg: 'aptos', llama: 'Aptos', rest: ['https://fullnode.mainnet.aptoslabs.com/v1'] },
  cardano:  { kind: 'priceonly', cg: 'cardano', llama: 'Cardano' },
  // UTXO chains via the Esplora API (chain_stats funded-spent). explorer is a failover list.
  bitcoin:  { kind: 'esplora', cg: 'bitcoin', llama: 'Bitcoin', explorer: ['https://blockstream.info/api', 'https://mempool.space/api'] },
  litecoin: { kind: 'esplora', cg: 'litecoin', llama: 'Litecoin', explorer: ['https://litecoinspace.org/api'] },
  // --- ecosystem EVM chain (DORMANT until PRANA_RPC_URL is set) ---
  // Native symbol PRANA. cg:null = no public USD market yet (priced at 0 by the wallet view).
  // `rpc` is a getter resolving env PRANA_RPC_URL per-access: [] when unset → readers soft-fail
  // (rpcFailover/rpc throw 'all nodes failed', caught into {error}/null), never throw to the caller.
  prana:    { kind: 'evm', cg: null, symbol: 'PRANA', llama: 'PRANA', get rpc() { return pranaRpc(); }, get chainId() { return pranaChainId(); } },
};

async function jsonFetch(url, opts = {}, timeout = 10000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try { const r = await fetch(url, { headers: { 'user-agent': UA, 'content-type': 'application/json' }, signal: ctrl.signal, ...opts });
    if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}
async function rpcFailover(nodes, body) {
  let last; for (const n of nodes) { try { return await jsonFetch(n, { method: 'POST', body: JSON.stringify(body) }); } catch (e) { last = e; } }
  throw last || new Error('all nodes failed');
}
const hexNum = (h) => (typeof h === 'string' && h.startsWith('0x') ? parseInt(h, 16) : +h);

// latest block height (+ gas for EVM) per chain
export async function chainStatus(name) {
  const c = CHAINS[name]; if (!c) return null;
  try {
    if (c.kind === 'evm') {
      const [bn, gp] = await Promise.all([
        rpcFailover(c.rpc, { jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
        rpcFailover(c.rpc, { jsonrpc: '2.0', id: 1, method: 'eth_gasPrice', params: [] }).catch(() => null),
      ]);
      return { chain: name, kind: c.kind, height: hexNum(bn.result), gasGwei: gp ? +(hexNum(gp.result) / 1e9).toFixed(2) : null };
    }
    if (c.kind === 'solana') {
      const slot = await rpcFailover(c.rpc, { jsonrpc: '2.0', id: 1, method: 'getSlot', params: [] });
      return { chain: name, kind: c.kind, height: slot.result, gasGwei: null };
    }
    if (c.kind === 'sui') {
      const r = await rpcFailover(c.rpc, { jsonrpc: '2.0', id: 1, method: 'sui_getLatestCheckpointSequenceNumber', params: [] });
      return { chain: name, kind: c.kind, height: +r.result, gasGwei: null };
    }
    if (c.kind === 'tron') {
      const r = await jsonFetch(`${c.trongrid}/wallet/getnowblock`, { method: 'POST', body: '{}' });
      return { chain: name, kind: c.kind, height: r.block_header?.raw_data?.number ?? null, gasGwei: null };
    }
    if (c.kind === 'ton') {
      const r = await jsonFetch(`${c.toncenter}/getMasterchainInfo`);
      return { chain: name, kind: c.kind, height: r.result?.last?.seqno ?? null, gasGwei: null };
    }
    if (c.kind === 'near') {
      const r = await rpcFailover(c.rpc, { jsonrpc: '2.0', id: 1, method: 'block', params: { finality: 'final' } });
      return { chain: name, kind: c.kind, height: r.result?.header?.height ?? null, gasGwei: null };
    }
    if (c.kind === 'aptos') {
      const r = await jsonFetch(c.rest[0]);
      return { chain: name, kind: c.kind, height: +(r.block_height ?? r.ledger_version) || null, gasGwei: null };
    }
    if (c.kind === 'priceonly') {
      return { chain: name, kind: c.kind, height: null, gasGwei: null }; // price+TVL only (no easy keyless height)
    }
    if (c.kind === 'esplora') {
      const explorers = Array.isArray(c.explorer) ? c.explorer : [c.explorer];
      for (const base of explorers) {
        try { const h = await jsonFetch(`${base}/blocks/tip/height`); return { chain: name, kind: c.kind, height: +h || null, gasGwei: null }; }
        catch { /* next */ }
      }
      return { chain: name, kind: c.kind, height: null, gasGwei: null };
    }
  } catch (e) { return { chain: name, kind: c.kind, error: e.message }; }
  return null;
}

// TVL for every chain in one keyless DefiLlama call -> { llamaName: tvlUsd }
export async function chainsTvl() {
  const arr = await jsonFetch('https://api.llama.fi/v2/chains').catch(() => []);
  return Object.fromEntries(arr.map(c => [c.name, c.tvl]));
}

// native token prices for all listed chains in one coingecko call
export async function nativePrices() {
  // skip chains with no coingecko id (e.g. PRANA — no public market yet) so the request stays clean
  const ids = [...new Set(Object.values(CHAINS).map(c => c.cg).filter(Boolean))].join(',');
  return jsonFetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`).catch(() => ({}));
}

if (process.argv[1] && process.argv[1].endsWith('multichain.mjs')) {
  const names = process.argv.slice(2).filter(Boolean);
  const targets = names.length ? names : Object.keys(CHAINS);
  console.log('Multi-chain status — read-only, keyless\n' + '─'.repeat(76));
  const [tvl, prices] = await Promise.all([chainsTvl(), nativePrices()]);
  const statuses = await Promise.all(targets.map(chainStatus));
  console.log('chain       native $       TVL          latest block      gas');
  console.log('─'.repeat(76));
  for (const s of statuses) {
    if (!s) continue;
    const c = CHAINS[s.chain];
    const px = prices[c.cg]?.usd;
    const t = tvl[c.llama];
    const tvlStr = t ? `$${(t / 1e9).toFixed(2)}B` : '—';
    const pxStr = px != null ? `$${px < 1 ? px.toFixed(4) : px.toFixed(2)}` : '—';
    const h = s.error ? `(err: ${s.error.slice(0, 20)})` : (s.height?.toLocaleString() ?? '—');
    console.log(`${s.chain.padEnd(11)} ${pxStr.padStart(10)}  ${tvlStr.padStart(9)}   ${String(h).padStart(15)}   ${s.gasGwei != null ? s.gasGwei + ' gwei' : ''}`);
  }
  console.log('─'.repeat(76));
  console.log('Keyless price/TVL/RPC. Token-level market data: GeckoTerminal/DEXScreener/Jupiter (see CROSSCHAIN_APIS.md).');
}
