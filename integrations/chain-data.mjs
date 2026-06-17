// chain-data.mjs — read-only chain/market data for the trade bots, over the operator's free RPC keys
// (operator 2026-06-17: "get that on the Trade Bots"). Keys live in the box server env, never the repo:
//   • Helius  (HELIUS_API_KEY)  — Solana RPC + balances/tokens for the Solana venues
//   • Alchemy (ALCHEMY_API_KEY) — multichain EVM RPC for portfolio + PRANA/bridge reads
//   • Dune    (DUNE_API_KEY)    — on-chain analytics (latest result of a saved query)
//
// READ-ONLY: balances, token accounts, gas, analytics. No signing, no broadcast, no order placement —
// the live executor stays on its own host. Injectable fetch, SOFT-FAIL-NEVER-THROW (missing key /
// network error → a clean { ok:false } so a trade-monitor run never crashes on data).

let _fetch = (...a) => (typeof fetch !== 'undefined' ? fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = fn || ((...a) => fetch(...a)); }

const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || '';
const str = (s) => String(s == null ? '' : s);

async function rpc(url, method, params) {
  try {
    const r = await _fetch(url, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    return j && (j.error ? null : j.result);
  } catch { return null; }
}

// Alchemy EVM hosts by chain key.
const ALCHEMY_HOST = {
  eth: 'eth-mainnet', ethereum: 'eth-mainnet', base: 'base-mainnet', arbitrum: 'arb-mainnet',
  optimism: 'opt-mainnet', polygon: 'polygon-mainnet', matic: 'polygon-mainnet',
};

/** evmBalance(address, chain) — native balance in wei (string) + ether (number). Soft-fail → ok:false. */
export async function evmBalance(address, chain = 'eth') {
  const key = env('ALCHEMY_API_KEY');
  if (!key) return { ok: false, reason: 'no-alchemy' };
  const host = ALCHEMY_HOST[str(chain).toLowerCase()] || 'eth-mainnet';
  if (!/^0x[0-9a-fA-F]{40}$/.test(str(address))) return { ok: false, reason: 'bad-address' };
  const wei = await rpc(`https://${host}.g.alchemy.com/v2/${key}`, 'eth_getBalance', [address, 'latest']);
  if (wei == null) return { ok: false, reason: 'rpc-failed' };
  const ether = Number(BigInt(wei)) / 1e18;
  return { ok: true, chain: host, address, wei: String(wei), ether };
}

/** evmGasPrice(chain) — current gas price in gwei. Soft-fail → ok:false. */
export async function evmGasPrice(chain = 'eth') {
  const key = env('ALCHEMY_API_KEY');
  if (!key) return { ok: false, reason: 'no-alchemy' };
  const host = ALCHEMY_HOST[str(chain).toLowerCase()] || 'eth-mainnet';
  const wei = await rpc(`https://${host}.g.alchemy.com/v2/${key}`, 'eth_gasPrice', []);
  if (wei == null) return { ok: false, reason: 'rpc-failed' };
  return { ok: true, chain: host, gwei: Number(BigInt(wei)) / 1e9 };
}

/** solBalance(address) — SOL balance (lamports + sol) via Helius RPC. Soft-fail → ok:false. */
export async function solBalance(address) {
  const key = env('HELIUS_API_KEY');
  if (!key) return { ok: false, reason: 'no-helius' };
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(str(address))) return { ok: false, reason: 'bad-address' };
  const res = await rpc(`https://mainnet.helius-rpc.com/?api-key=${key}`, 'getBalance', [address]);
  const lamports = res && (typeof res === 'object' ? res.value : res);
  if (lamports == null) return { ok: false, reason: 'rpc-failed' };
  return { ok: true, address, lamports: Number(lamports), sol: Number(lamports) / 1e9 };
}

/** solTokenAccounts(owner) — SPL token balances via Helius. Returns [{mint, amount}]. Soft-fail. */
export async function solTokenAccounts(owner) {
  const key = env('HELIUS_API_KEY');
  if (!key) return { ok: false, reason: 'no-helius', tokens: [] };
  const res = await rpc(`https://mainnet.helius-rpc.com/?api-key=${key}`, 'getTokenAccountsByOwner',
    [owner, { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' }, { encoding: 'jsonParsed' }]);
  const arr = (res && res.value) || [];
  const tokens = arr.map((a) => {
    const info = a?.account?.data?.parsed?.info;
    return { mint: str(info?.mint), amount: Number(info?.tokenAmount?.uiAmount || 0) };
  }).filter((t) => t.mint);
  return { ok: true, owner: str(owner), tokens };
}

/** duneLatest(queryId) — latest cached result rows of a saved Dune query. Soft-fail → ok:false. */
export async function duneLatest(queryId) {
  const key = env('DUNE_API_KEY');
  if (!key) return { ok: false, reason: 'no-dune', rows: [] };
  const id = String(queryId || '').replace(/[^0-9]/g, '');
  if (!id) return { ok: false, reason: 'bad-query-id', rows: [] };
  try {
    const r = await _fetch(`https://api.dune.com/api/v1/query/${id}/results`, { headers: { 'x-dune-api-key': key } });
    if (!r || !r.ok) return { ok: false, reason: 'http-' + (r ? r.status : 'err'), rows: [] };
    const j = await r.json();
    const rows = (j && j.result && j.result.rows) || [];
    return { ok: true, queryId: id, rows };
  } catch { return { ok: false, reason: 'network', rows: [] }; }
}

/** providersConfigured() — which chain-data keys are present. */
export function providersConfigured() {
  return { helius: !!env('HELIUS_API_KEY'), alchemy: !!env('ALCHEMY_API_KEY'), dune: !!env('DUNE_API_KEY') };
}

if (typeof process !== 'undefined' && process.argv && process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  console.log('chain-data providers:', JSON.stringify(providersConfigured()));
}
