// kulaswap-market.mjs — READ-ONLY, gated market panel for an engine token's PRANA (KulaSwap) pair.
//
// The MELEK-Engine layer deliberately has NO market and NO price logic (engine/contracts/seams.mjs:
// "No price/match logic on the engine — market is on PRANA"). Price discovery + the AMM live on PRANA
// (KulaSwap, kula.money). This module is the small, soft-failing READER the token-manage front-end
// uses to SHOW a token's market facts when PRANA is live — exactly like integrations/akasha-connect.mjs:
// env-gated on PRANA_RPC_URL, injectable fetch, degrades to a shaped-empty panel, never throws, never
// fabricates a number. It holds NO key, signs NOTHING, and places NO orders (honouring seams.mjs).
//
//   import { marketPanel, isLive, __setFetch } from './kulaswap-market.mjs'
//   const panel = await marketPanel('MYTOK')   // { live, symbol, wsymbol, note, price, ... }
//
// Route B of a buyback (bridge -> KulaSwap swap -> burn/PoL) is gated on PRANA; until then this reader
// renders an honest "market on KulaSwap — live when PRANA is up" placeholder, never a fake price.

const PRANA_RPC_ENV = 'PRANA_RPC_URL';
const KULASWAP_URL = 'https://kula.money';

let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

/** True only when PRANA is configured (PRANA_RPC_URL set) — otherwise the market is gated OFF. */
export function isLive() {
  return !!(process.env[PRANA_RPC_ENV] && String(process.env[PRANA_RPC_ENV]).trim());
}

/** The wrapped-symbol convention: an engine token SYMBOL trades on PRANA as wSYMBOL. */
export function wrappedSymbol(symbol) {
  return 'w' + String(symbol || '').toUpperCase();
}

/**
 * The KulaSwap link a "Buy on KulaSwap" step points at. Always safe to render
 * (a plain external link), independent of whether the reader is live.
 */
export function kulaswapLink(symbol) {
  const w = wrappedSymbol(symbol);
  return `${KULASWAP_URL}/#/swap?outputCurrency=${encodeURIComponent(w)}`;
}

/** A shaped-empty panel — the honest placeholder rendered until PRANA is up. */
function gatedPanel(symbol) {
  return {
    live: false,
    symbol: String(symbol || '').toUpperCase(),
    wsymbol: wrappedSymbol(symbol),
    price: null,
    liquidity: null,
    volume24h: null,
    link: kulaswapLink(symbol),
    note: 'Market lives on KulaSwap (PRANA) — read-only price/liquidity appear here when PRANA is live.',
  };
}

/**
 * marketPanel(symbol) — read the KulaSwap pair facts for wSYMBOL. Soft-fails to
 * a shaped-empty (gated) panel when PRANA_RPC_URL is unset or the read fails.
 * READ-ONLY: price/liquidity/24h volume only; NO orderbook, NO match logic here.
 * @param {string} symbol engine token symbol
 * @param {object} [opts] { rpcUrl? } override (else env PRANA_RPC_URL)
 */
export async function marketPanel(symbol, opts = {}) {
  const rpcUrl = opts.rpcUrl || process.env[PRANA_RPC_ENV] || '';
  if (!rpcUrl || !String(rpcUrl).trim()) return gatedPanel(symbol);
  const w = wrappedSymbol(symbol);
  try {
    // The KulaSwap reader endpoint shape (subgraph-style) — kept minimal + defensive.
    const res = await _fetch(`${String(rpcUrl).replace(/\/$/, '')}/pair?symbol=${encodeURIComponent(w)}`, {
      headers: { accept: 'application/json' },
    });
    if (!res || !res.ok) return gatedPanel(symbol);
    const data = await res.json();
    const num = (v) => (v == null || Number.isNaN(Number(v)) ? null : String(v));
    return {
      live: true,
      symbol: String(symbol || '').toUpperCase(),
      wsymbol: w,
      price: num(data.price),
      liquidity: num(data.liquidity),
      volume24h: num(data.volume24h),
      link: kulaswapLink(symbol),
      note: 'Read-only KulaSwap market facts (PRANA). This page places no orders.',
    };
  } catch {
    // soft-fail: never throw, never a fake number
    return gatedPanel(symbol);
  }
}
