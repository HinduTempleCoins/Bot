// prana-wallet.mjs — READ-ONLY Markets + PRANA Wallet v1 (task #199).
// A unified, wallet-connect-style portfolio VIEW across the ecosystem chains:
//   • MELEK   — Graphene (the condenser / steemd is its queryable state)
//   • SOAP    — BitShares-family Graphene DEX
//   • PRANA   — EVM (read via the same keyless RPC layer as multichain.mjs)
// plus any of the 20+ general chains balances.mjs already knows about.
//
// It takes PUBLIC ADDRESSES ONLY. It NEVER holds a key, NEVER signs, NEVER
// broadcasts — it reads balances, prices them, and sums them. Trading/sweeping
// is a separate, key-gated step that lives nowhere near this file. This is the
// portfolio pane of a wallet, not the wallet.
//
// Design mirrors integrations/soapbox/macro.mjs + integrations/chains/multichain.mjs:
//   - ESM, __setFetch hook for offline tests
//   - SOFT-FAIL everything: a thrown error from any chain returns a zeroed
//     position for that account, never sinks the whole portfolio, never throws
//     to the caller.
//   - Reuses existing modules (balances.chainBalance, multichain.CHAINS/
//     nativePrices, condenser native price) via DEFENSIVE dynamic import so a
//     missing/renamed export can't break this module.
//
//   import { portfolio, valuePosition, summarize, SUPPORTED_CHAINS } from './prana-wallet.mjs'
//   await portfolio({ accounts: [ { chain:'melek', address:'hathor' }, { chain:'ethereum', address:'0x..' } ] })
//
//   node integrations/prana-wallet.mjs melek:hathor ethereum:0xabc...

let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Test/override hooks for the heavy readers. Tests inject these so nothing
// touches the network; production leaves them null and the defensive dynamic
// imports below supply the real implementations.
let _balanceReader = null;   // async (chain, address) => { chain, balance, symbol?, error? }
let _priceReader = null;     // async (chains:string[]) => { [symbol|chain]: usdPrice }
/** Inject a balance reader: async (chain, address) => { balance, symbol?, error? }. */
export function __setBalanceReader(fn) { _balanceReader = fn || null; }
/** Inject a price reader: async (chains) => { <chain or symbol>: usdPriceNumber }. */
export function __setPriceReader(fn) { _priceReader = fn || null; }

// The ecosystem chains this wallet view understands. `kind` tells the reader how
// to read a balance; `readVia` is a human note on the data path. EVM/general
// chains are delegated to balances.mjs (which already covers 20+); the three
// native ecosystem chains are described here so the view is self-documenting.
export const SUPPORTED_CHAINS = {
  melek:    { kind: 'graphene',  symbol: 'MELEK', readVia: 'MELEK condenser / steemd (Graphene) — get_accounts balance' },
  soap:     { kind: 'bitshares', symbol: 'SOAP',  readVia: 'SOAP BitShares-family DEX (Graphene) — account balances' },
  prana:    { kind: 'evm',       symbol: 'PRANA', readVia: 'PRANA EVM — eth_getBalance via keyless RPC (balances.mjs)' },
  ethereum: { kind: 'evm',       symbol: 'ETH',   readVia: 'EVM — eth_getBalance via keyless RPC (balances.mjs/multichain.mjs)' },
  bitcoin:  { kind: 'esplora',   symbol: 'BTC',   readVia: 'UTXO — Esplora chain_stats (balances.mjs)' },
  solana:   { kind: 'solana',    symbol: 'SOL',   readVia: 'Solana — getBalance via public RPC (balances.mjs)' },
};

// coingecko id per ecosystem chain (for the general chains balances.mjs/multichain
// already map this; here we only need ids for chains whose price isn't in that map,
// or to label the symbol). null = no public USD price source wired yet (priced at 0).
const PRICE_HINTS = {
  melek: { cg: null,        symbol: 'MELEK' },   // native ecosystem token — no public market yet
  soap:  { cg: null,        symbol: 'SOAP' },    // native ecosystem token — no public market yet
  prana: { cg: null,        symbol: 'PRANA' },   // pre-market useful-work token
};

/** Pure helper: amount × priceUsd → valueUsd (2dp). Bad inputs → 0. */
export function valuePosition(amount, priceUsd) {
  const a = Number(amount), p = Number(priceUsd);
  if (!Number.isFinite(a) || !Number.isFinite(p)) return 0;
  return +(a * p).toFixed(2);
}

// --- defensive dynamic loaders ---------------------------------------------
// Each wraps an await import in try/catch so a missing module/export degrades to
// a soft-fail (null reader → zeroed positions) rather than an exception.

async function loadBalanceReader() {
  if (_balanceReader) return _balanceReader;
  try {
    const mod = await import('./chains/balances.mjs');
    if (typeof mod.chainBalance === 'function') {
      return async (chain, address) => mod.chainBalance(chain, address);
    }
  } catch { /* soft-fail */ }
  return null;
}

async function loadPriceReader() {
  if (_priceReader) return _priceReader;
  try {
    const mc = await import('./chains/multichain.mjs');
    if (typeof mc.nativePrices === 'function' && mc.CHAINS) {
      // nativePrices() returns { <coingeckoId>: { usd } }; remap to per-chain.
      return async (chains) => {
        const prices = await mc.nativePrices().catch(() => ({}));
        const out = {};
        for (const name of chains) {
          const cg = mc.CHAINS?.[name]?.cg || PRICE_HINTS[name]?.cg;
          const usd = cg ? prices?.[cg]?.usd : null;
          if (usd != null && Number.isFinite(+usd)) out[name] = +usd;
        }
        return out;
      };
    }
  } catch { /* soft-fail */ }
  return null;
}

// symbol for a chain: prefer the live balance row's symbol, else our hint/table.
function symbolFor(chain, balRow) {
  return (balRow && balRow.symbol)
    || PRICE_HINTS[chain]?.symbol
    || SUPPORTED_CHAINS[chain]?.symbol
    || chain.toUpperCase();
}

// Read one account → a normalized position. Soft-fails to a zeroed position
// (amount 0, valueUsd 0) carrying an `error` note — never throws.
async function readAccount(acc, reader, prices) {
  const chain = String(acc?.chain || '').toLowerCase();
  const address = acc?.address;
  const base = { chain, address: address ?? null, symbol: symbolFor(chain, null), amount: 0, priceUsd: 0, valueUsd: 0 };
  if (!chain || !address) return { ...base, error: 'missing chain or address' };
  if (!reader) return { ...base, error: 'no balance reader available' };
  let row;
  try {
    row = await reader(chain, address);
  } catch (e) {
    return { ...base, error: e?.message || 'balance read failed' };
  }
  if (!row || row.error || row.needsKey) {
    return { ...base, symbol: symbolFor(chain, row), error: row?.error || row?.needsKey || 'no balance' };
  }
  const amount = Number(row.balance);
  if (!Number.isFinite(amount)) return { ...base, symbol: symbolFor(chain, row), error: 'non-numeric balance' };
  const symbol = symbolFor(chain, row);
  const priceUsd = Number(prices?.[chain]) || 0;
  return { chain, address, symbol, amount, priceUsd, valueUsd: valuePosition(amount, priceUsd) };
}

/**
 * Read-only portfolio across the given public accounts.
 * @param {{ accounts?: Array<{chain:string,address:string}> }} opts
 * @returns {Promise<{positions:Array,totalUsd:number,byChain:Object,updatedAt:string}>}
 * Each account is read INDEPENDENTLY and soft-fails on its own; one failing
 * chain never sinks the rest. NEVER throws.
 */
export async function portfolio({ accounts } = {}) {
  const updatedAt = new Date().toISOString();
  const list = Array.isArray(accounts) ? accounts.filter(Boolean) : [];
  if (!list.length) return { positions: [], totalUsd: 0, byChain: {}, updatedAt };

  let reader = null, prices = {};
  try { reader = await loadBalanceReader(); } catch { reader = null; }
  try {
    const priceReader = await loadPriceReader();
    if (priceReader) {
      const chains = [...new Set(list.map((a) => String(a?.chain || '').toLowerCase()).filter(Boolean))];
      prices = await priceReader(chains).catch(() => ({})) || {};
    }
  } catch { prices = {}; }

  const positions = await Promise.all(list.map((acc) => readAccount(acc, reader, prices)));

  let totalUsd = 0;
  const byChain = {};
  for (const p of positions) {
    const v = Number(p.valueUsd) || 0;
    totalUsd += v;
    byChain[p.chain] = +((byChain[p.chain] || 0) + v).toFixed(2);
  }
  return { positions, totalUsd: +totalUsd.toFixed(2), byChain, updatedAt };
}

/** A short human one-liner for a Telegram/Discord reply. Never throws. */
export function summarize(pf) {
  const p = pf || {};
  const positions = Array.isArray(p.positions) ? p.positions : [];
  if (!positions.length) return 'PRANA Wallet: no accounts to show.';
  const total = Number(p.totalUsd) || 0;
  const usd = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const lines = positions.map((pos) => {
    const amt = Number(pos.amount) || 0;
    const tail = pos.error ? ` (${pos.error})` : ` ≈ ${usd(pos.valueUsd)}`;
    return `${(pos.symbol || pos.chain || '?')}: ${amt.toLocaleString('en-US', { maximumFractionDigits: 6 })}${tail}`;
  });
  return `PRANA Wallet — total ≈ ${usd(total)}\n` + lines.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('prana-wallet.mjs')) {
  // argv accounts as "chain:address" pairs, e.g. melek:hathor ethereum:0xabc
  const accounts = process.argv.slice(2).map((s) => {
    const i = s.indexOf(':');
    return i > 0 ? { chain: s.slice(0, i), address: s.slice(i + 1) } : null;
  }).filter(Boolean);
  if (!accounts.length) {
    console.log('usage: node integrations/prana-wallet.mjs <chain>:<address> [<chain>:<address> ...]');
    console.log('read-only portfolio view. public addresses only — never signs, never broadcasts.');
    console.log('chains:', Object.keys(SUPPORTED_CHAINS).join(', '), '(+ any chain balances.mjs knows)');
  } else {
    const pf = await portfolio({ accounts });
    console.log(summarize(pf));
    console.log('\nby chain:', JSON.stringify(pf.byChain));
    console.log('updated:', pf.updatedAt);
  }
}
