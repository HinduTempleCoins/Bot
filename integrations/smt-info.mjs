// smt-info.mjs — read-only reader for SMT / NAI state on the MELEK chain (testnet today).
//
// SMTs are the chain-LEVEL native token primitive (Steem-fork "Smart Media Token"). On this
// fork SMT support is compiled AND hardfork-active (HF 0.23 = the SMT hardfork; the NAI pool
// is live — CLAUDE.md Status). This module gives the Bot its FIRST SMT-aware surface: it reads
// the NAI pool (the pre-minted asset-id namespace creators draw from) and lists any SMTs that
// have been created. It validates the HF23 claim live — point MELEK_RPC_URL at the testnet node
// (reachable from the ops box) and the readers return real data; in tests inject fixtures.
//
// See TOKEN_INFRA.md for how this layer (native SMTs) relates to MELEK-Engine side-tokens and
// to PRANA-as-its-own-chain.
//
// DESIGN RULES (house style; mirrors integrations/melek-chain.mjs):
//   • READ-ONLY. No keys, no broadcast, ever. Standard database_api / condenser_api calls only.
//     SMT *creation* is a standard Graphene op (smt_create / smt_setup) signed elsewhere — NOT
//     here. No custom chain ops (CLAUDE.md "No custom chain ops for AI").
//   • Env-gated: MELEK_RPC_URL names the endpoint. Unset → every reader soft-fails to a
//     documented empty result; nothing fake, nothing thrown.
//   • NETWORK IS A FIRST-CLASS FIELD. MELEK_NETWORK=testnet|mainnet (default testnet). Every
//     payload carries `network` + `label`; testnet is labeled "[TestNet not MELEK]".
//   • Injectable fetch (__setFetch) so every test runs offline.
//
// Exports:
//   configured()            -> boolean (MELEK_RPC_URL set?)
//   network() / networkLabel()
//   naiPool()               -> { nais:[...], count, available, network, label }
//   listSmtTokens(limit)    -> { tokens:[{nai,decimals,controlAccount,phase,maxSupply}], count, ... }
//   smtSummary(limit)       -> combined { hardforkActive, naiPoolSize, tokenCount, tokens, ... }
//   __setFetch(fn)          -> inject fetch for tests

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export function rpcUrl() { return process.env.MELEK_RPC_URL || ''; }
export function configured() { return !!rpcUrl(); }

/** testnet | mainnet — from env, defaulting to testnet (the live network today). */
export function network() {
  const n = String(process.env.MELEK_NETWORK || 'testnet').toLowerCase();
  return n === 'mainnet' ? 'mainnet' : 'testnet';
}

/** The permanent network label carried in every chain-tied payload. */
export function networkLabel() {
  return network() === 'mainnet' ? '[MELEK]' : '[TestNet not MELEK]';
}

const stamp = () => ({ network: network(), label: networkLabel() });

async function rpc(method, params = [], timeout = 12000) {
  const url = rpcUrl();
  if (!url) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await _fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: ctrl.signal,
    });
    if (!r || !r.ok) return null;
    const d = await r.json();
    if (!d || d.error) return null;
    return d.result;
  } catch { return null; } finally { clearTimeout(t); }
}

/**
 * Normalize a NAI value. The chain represents an asset symbol as either a bare NAI
 * string ("@@422838704") or an object {nai, decimals/precision}. We keep both views.
 * @returns {{nai:string|null, decimals:number|null}}
 */
function normNai(v) {
  if (v == null) return { nai: null, decimals: null };
  if (typeof v === 'string') return { nai: v, decimals: null };
  if (typeof v === 'object') {
    const nai = v.nai != null ? String(v.nai) : null;
    const dec = v.decimals != null ? +v.decimals
      : v.precision != null ? +v.precision : null;
    return { nai, decimals: Number.isFinite(dec) ? dec : null };
  }
  return { nai: String(v), decimals: null };
}

/**
 * The NAI pool — the namespace of available asset-ids a creator draws from to make an SMT.
 * A non-empty pool is direct evidence the SMT hardfork is active. Tries condenser_api first
 * (Steem-fork name), then database_api as a fallback. Soft-empty on any failure.
 * @returns {Promise<{nais:string[], count:number, available:boolean, network, label}>}
 */
export async function naiPool() {
  let res = await rpc('condenser_api.get_nai_pool', []);
  if (res == null) res = await rpc('database_api.get_nai_pool', {});
  // Shapes seen across forks: ["@@..","@@.."]  |  {nai_pool:[...]}  |  {nais:[...]}
  let arr = [];
  if (Array.isArray(res)) arr = res;
  else if (res && Array.isArray(res.nai_pool)) arr = res.nai_pool;
  else if (res && Array.isArray(res.nais)) arr = res.nais;
  const nais = arr.map((x) => normNai(x).nai).filter(Boolean);
  return { nais, count: nais.length, available: nais.length > 0, ...stamp() };
}

/**
 * List SMTs that have been created on the chain (database_api.list_smt_tokens, ordered by
 * symbol). Returns a normalized token view. Soft-empty if the call fails or returns nothing.
 * @param {number} [limit=100]  1..1000
 * @returns {Promise<{tokens:object[], count:number, network, label}>}
 */
export async function listSmtTokens(limit = 100) {
  const lim = Math.max(1, Math.min(1000, Number(limit) || 100));
  const res = await rpc('database_api.list_smt_tokens', {
    start: {}, limit: lim, order: 'by_symbol',
  });
  const raw = (res && Array.isArray(res.tokens)) ? res.tokens : [];
  const tokens = raw.map((t) => {
    const n = normNai(t.liquid_symbol || (t.market_maker && t.market_maker.token_balance) || t.nai || t);
    return {
      nai: n.nai,
      decimals: n.decimals,
      controlAccount: t.control_account || t.controlAccount || null,
      phase: t.phase != null ? t.phase : null,           // 0=setup ... emission phases
      maxSupply: t.max_supply != null ? String(t.max_supply) : null,
    };
  }).filter((t) => t.nai || t.controlAccount);
  return { tokens, count: tokens.length, ...stamp() };
}

/**
 * Combined SMT/NAI snapshot for status surfaces. `hardforkActive` is inferred from live
 * evidence: a non-empty NAI pool OR at least one created token means SMT ops are active.
 * Never throws; soft-fails to a fully-shaped empty snapshot when unconfigured/unreachable.
 * @param {number} [limit=100]
 * @returns {Promise<object>}
 */
export async function smtSummary(limit = 100) {
  if (!configured()) {
    return {
      configured: false, hardforkActive: null,
      naiPoolSize: 0, tokenCount: 0, tokens: [], nais: [],
      note: 'MELEK_RPC_URL unset — soft-empty; point it at the testnet node to validate HF23 live.',
      ...stamp(),
    };
  }
  let pool, list;
  try { pool = await naiPool(); } catch { pool = { nais: [], count: 0, available: false }; }
  try { list = await listSmtTokens(limit); } catch { list = { tokens: [], count: 0 }; }
  const evidence = (pool.count > 0) || (list.count > 0);
  return {
    configured: true,
    // true when we have positive evidence; null when both came back empty (can't distinguish
    // "no SMTs yet" from "endpoint not exposing the call" without asserting falsely).
    hardforkActive: evidence ? true : null,
    naiPoolSize: pool.count,
    nais: pool.nais.slice(0, 20),
    tokenCount: list.count,
    tokens: list.tokens,
    ...stamp(),
  };
}

// ---- CLI -------------------------------------------------------------------

async function runCli() {
  const out = await smtSummary();
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}

if (process.argv[1] && process.argv[1].endsWith('smt-info.mjs')) {
  runCli();
}
