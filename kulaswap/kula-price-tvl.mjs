// kula-price-tvl.mjs — KulaSwap PRICING + TVL layer, AMM-relative (no external markets yet).
//
// THE PROBLEM: the CDP / lock / borrow UIs (kula-cdp.mjs) all want a "price", but the MELEK/KULA
// tokens have NO external markets yet — there are no USD/BTC/STEEM/BLURT trades against them. So there
// is no honest dollar figure to show. Inventing one would be a lie baked into the UI.
//
// THE SOLUTION (this module):
//   1. The ONLY price we actually have is the KulaSwap AMM pool itself — the KULA/wMELEK pair's reserve
//      ratio. That ratio IS the internal oracle: it tells us how many wMELEK one KULA is worth, right
//      now, in the only market that exists. The CDP doesn't need dollars — it needs the KULA-vs-wMELEK
//      relationship (collateral KULA priced in the wMELEK it borrows), and that is exactly this ratio.
//      So `poolPrice` replaces the USD feed: feed kula-cdp's `kulaPrice`/`melekPrice` the pool ratio
//      (wMELEK-per-KULA for kulaPrice, 1 for melekPrice) and every CDP number becomes wMELEK-denominated.
//   2. TVL is reported in NATIVE UNITS (locked KULA, locked wMELEK, APIS-Hash) plus ONE rolled-up
//      "value" expressed in a chosen numeraire (wMELEK by default) via the pool ratio — NOT dollars.
//   3. External feeds (USD/BTC/STEEM/BLURT) are a clean, pluggable SEAM that returns "unavailable"
//      today. When a real market exists (a CEX listing, a bridge pair, a price API) we flip it on in
//      ONE place and the rest of the UI inherits real fiat without touching this file's callers.
//
// House style (mirrors kula-cdp.mjs / apis-workerbee.mjs / cp-amm.mjs): pure arithmetic, soft-fail to
// safe shapes, NEVER throws, NO deps; the ONE network call (fetchPoolPrice) uses an injectable fetch
// (__setFetch) so tests stay fully offline. esc() all HTML interpolation. node:test offline suite.

import { PAIR_ABI } from './kula-config.mjs'; // referenced for the getReserves() ABI shape (doc/import only)

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const round = (x, d = 8) => { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; };

// Injectable fetch — tests pass a stub via __setFetch; production uses the global.
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── internal oracle: the AMM pool ratio ──────────────────────────────────────────────────────────────
/**
 * poolPrice(reservesKula, reservesWmelek) → the relative price from the KULA/wMELEK pool reserves.
 * This is THE INTERNAL ORACLE — the only price the ecosystem has, and all the CDP needs (a KULA-vs-
 * wMELEK relationship, not a dollar figure).
 *   priceKulaInWmelek = reserveWmelek / reserveKula   (wMELEK you get per 1 KULA)
 *   priceWmelekInKula = reserveKula  / reserveWmelek  (KULA you get per 1 wMELEK; the inverse)
 * Soft-fails to zeros (and ok:false) on empty/garbage reserves — never divides by zero, never throws.
 * Reserves are in whatever unit the caller passes (human or base) — the ratio is unit-agnostic as long
 * as both reserves share the SAME unit (the pair's two reserves always do).
 */
export function poolPrice(reservesKula, reservesWmelek) {
  const rk = nn(reservesKula), rw = nn(reservesWmelek);
  if (rk <= 0 || rw <= 0) {
    return { priceKulaInWmelek: 0, priceWmelekInKula: 0, reservesKula: rk, reservesWmelek: rw, ok: false };
  }
  return {
    priceKulaInWmelek: round(rw / rk, 8),
    priceWmelekInKula: round(rk / rw, 8),
    reservesKula: rk,
    reservesWmelek: rw,
    ok: true,
  };
}

// ── on-chain read: getReserves() over JSON-RPC eth_call ────────────────────────────────────────────────
// We hand-encode the eth_call (no ethers dependency, tests run offline). getReserves() takes no args, so
// the calldata is just the 4-byte selector. Its return is (uint112 reserve0, uint112 reserve1,
// uint32 blockTimestampLast) — three 32-byte words. We read the first two words as the reserves.
//
// IMPORTANT ordering note: a Uniswap-V2 pair stores reserve0/reserve1 by token0()/token1(), which are
// sorted by address, NOT by "KULA then wMELEK". The caller tells us which slot is KULA via `kulaIsToken0`
// (default true). If the deployment has wMELEK as token0, pass kulaIsToken0:false and we swap. (token0()
// can be read separately to determine this; we keep that decision in the caller to stay a pure reader.)
const GET_RESERVES_SELECTOR = '0x0902f1ac'; // keccak256("getReserves()")[:4]

/** Parse a 32-byte hex word (with or without 0x, possibly part of a longer string) to a Number. */
function wordToNum(hex) {
  try {
    const v = BigInt('0x' + String(hex || '').replace(/^0x/, '').slice(0, 64).padStart(1, '0'));
    return Number(v);
  } catch { return 0; }
}

/**
 * fetchPoolPrice({ rpcUrl, pairAddr, kulaIsToken0=true }, fetch?) → the poolPrice() result, read LIVE
 * from the KulaSwap pair's getReserves() via a JSON-RPC eth_call. SOFT-FAILS to null on any error (no
 * rpcUrl/pairAddr, network/HTTP failure, RPC error object, empty/garbage result) — never throws.
 * Pass a fetch impl as the 2nd arg, or set one via __setFetch (tests do the latter).
 */
export async function fetchPoolPrice({ rpcUrl, pairAddr, kulaIsToken0 = true } = {}, fetch) {
  const f = typeof fetch === 'function' ? fetch : _fetch;
  if (!rpcUrl || !pairAddr) return null;
  try {
    const body = {
      jsonrpc: '2.0', id: 1, method: 'eth_call',
      params: [{ to: String(pairAddr), data: GET_RESERVES_SELECTOR }, 'latest'],
    };
    const res = await f(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res || (typeof res.ok === 'boolean' && !res.ok)) return null;
    const json = typeof res.json === 'function' ? await res.json() : res;
    if (!json || json.error || typeof json.result !== 'string') return null;

    const hex = json.result.replace(/^0x/, '');
    if (hex.length < 128) return null; // need at least two 32-byte words
    const reserve0 = wordToNum(hex.slice(0, 64));
    const reserve1 = wordToNum(hex.slice(64, 128));
    const reservesKula = kulaIsToken0 ? reserve0 : reserve1;
    const reservesWmelek = kulaIsToken0 ? reserve1 : reserve0;
    return poolPrice(reservesKula, reservesWmelek);
  } catch {
    return null; // soft-fail-never-throw
  }
}

// ── TVL in native units (+ one numeraire roll-up) ──────────────────────────────────────────────────────
/**
 * tvl({ lockedKula, lockedWmelek, apisHashTotal, priceKulaInWmelek }) → native-unit TVL.
 * Returns each token's locked amount AND a single rolled-up `value` in a chosen numeraire (wMELEK terms
 * by default) — NOT dollars. The numeraire value uses the pool ratio:
 *   totalValueInWmelek = lockedWmelek + lockedKula × priceKulaInWmelek
 * `priceKulaInWmelek` should come from poolPrice()/fetchPoolPrice(); if omitted/zero, only the wMELEK leg
 * counts toward value (KULA can't be valued without the ratio) and `priced:false` flags that. APIS-Hash
 * is reported in native units only (no market relationship to wMELEK), never folded into value.
 * Soft-fails to zeros, never throws.
 */
export function tvl({ lockedKula = 0, lockedWmelek = 0, apisHashTotal = 0, priceKulaInWmelek = 0 } = {}) {
  const k = nn(lockedKula), w = nn(lockedWmelek), h = nn(apisHashTotal), p = nn(priceKulaInWmelek);
  const kulaValueInWmelek = round(k * p, 8);
  const totalValueInWmelek = round(w + kulaValueInWmelek, 8);
  return {
    lockedKula: round(k, 8),
    lockedWmelek: round(w, 8),
    apisHashTotal: round(h, 8),
    priceKulaInWmelek: round(p, 8),
    kulaValueInWmelek,
    totalValueInWmelek,
    numeraire: 'wMELEK',
    priced: p > 0, // false → KULA leg uncounted (no pool ratio supplied)
  };
}

// ── external feed seam (USD/BTC/STEEM/BLURT) — OFF until a real market exists ─────────────────────────────
// THE SEAM: every external (non-pool) price flows through externalRef(). Today there is NO external
// market for MELEK/KULA, so every symbol returns { available:false }. When a real source exists, wire it
// into EXTERNAL_FEEDS (a map of symbol → async/sync resolver returning a number) — in this ONE place —
// and flip available:true; every caller (badge, CDP fiat overlay, portfolio) inherits real fiat with no
// other change. Intended future sources (documented, not yet live):
//   • USD   — a CEX listing (the token trading against USDT/USDC), or a price API (CoinGecko/CMC) once
//             the token is listed there.
//   • BTC   — same CEX/API once a BTC pair exists, or derived USD÷BTCUSD.
//   • STEEM — a bridge pair (MELEK↔STEEM via the Graphene-side bridge) or a STEEM-Engine market.
//   • BLURT — a bridge pair / BLURT-side market (MELEK is Blurt-lineage; a BLURT market is the likeliest
//             first external price).
const EXTERNAL_FEEDS = Object.freeze({
  // symbol(UPPER): { source, resolve } — all empty today (no live markets). Fill to flip a feed on.
  USD:   { source: 'CEX listing or CoinGecko/CMC once listed', resolve: null },
  BTC:   { source: 'CEX BTC pair, or USD÷BTCUSD',              resolve: null },
  STEEM: { source: 'MELEK↔STEEM bridge pair / STEEM-Engine',   resolve: null },
  BLURT: { source: 'MELEK↔BLURT bridge pair / BLURT market',   resolve: null },
});

/**
 * externalRef(symbol) → a pluggable external (fiat/crypto) price reference for MELEK/KULA.
 * TODAY: returns { available:false, reason:'no external market yet', ... } for EVERY symbol — there are
 * no external markets. This is the deliberate seam: when a feed is wired into EXTERNAL_FEEDS, this flips
 * to { available:true, price } for that symbol and nothing else in the UI has to change.
 * Soft-fails to unavailable for unknown symbols too. Never throws.
 */
export function externalRef(symbol) {
  const sym = String(symbol || '').toUpperCase();
  const feed = EXTERNAL_FEEDS[sym];
  if (!feed || typeof feed.resolve !== 'function') {
    return {
      symbol: sym,
      available: false,
      reason: 'no external market yet',
      source: feed ? feed.source : 'unknown symbol',
    };
  }
  // Seam for the future: a wired resolver returns a number price.
  try {
    const price = +feed.resolve();
    if (!Number.isFinite(price) || price <= 0) {
      return { symbol: sym, available: false, reason: 'feed returned no price', source: feed.source };
    }
    return { symbol: sym, available: true, price: round(price, 8), source: feed.source };
  } catch {
    return { symbol: sym, available: false, reason: 'feed error', source: feed.source };
  }
}

// ── UI: TVL badge (native units, "USD coming soon") ──────────────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * renderTvlBadge({ lockedKula, lockedWmelek, positions, priceKulaInWmelek }) → an esc()'d HTML fragment
 * for the lock/borrow screen. Shows TVL in NATIVE UNITS plus the wMELEK-terms roll-up and a small
 * "USD coming soon" note — NO fake dollars:
 *   "Total Value Locked — X wMELEK · Y KULA (≈ Z wMELEK) · N positions"
 * `positions` is the open-position count (informational). PURE: figures via tvl(). Never throws.
 */
export function renderTvlBadge({ lockedKula = 0, lockedWmelek = 0, positions = 0, priceKulaInWmelek = 0 } = {}) {
  const t = tvl({ lockedKula, lockedWmelek, priceKulaInWmelek });
  const n = Math.max(0, Math.trunc(nn(positions)));
  const approx = t.priced
    ? `(≈ ${esc(t.totalValueInWmelek)} wMELEK)`
    : '(≈ — wMELEK · pool price unavailable)';

  return [
    '<div class="kula-tvl" data-kula-tvl>',
    '<span class="tvl-label">Total Value Locked</span> ',
    '<span class="tvl-figure" data-tvl-wmelek>', esc(t.lockedWmelek), ' wMELEK</span> · ',
    '<span class="tvl-figure" data-tvl-kula>', esc(t.lockedKula), ' KULA</span> ',
    '<span class="tvl-approx" data-tvl-approx>', approx, '</span> · ',
    '<span class="tvl-positions" data-tvl-positions>', esc(n), ' positions</span>',
    '<span class="tvl-usd-soon" data-tvl-usd-soon> · USD coming soon</span>',
    '</div>',
  ].join('');
}

// CLI demo (guarded) — worked example of the pool-ratio oracle, native-unit TVL, and the external seam.
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('kula-price-tvl.mjs')) {
  // Pool: 1,000,000 KULA / 50,000 wMELEK → 1 KULA = 0.05 wMELEK (the only price that exists).
  const pp = poolPrice(1_000_000, 50_000);
  console.log('PAIR_ABI getReserves() ref:', PAIR_ABI[0]);
  console.log(`poolPrice: 1 KULA = ${pp.priceKulaInWmelek} wMELEK  |  1 wMELEK = ${pp.priceWmelekInKula} KULA`);

  // TVL: 200,000 KULA + 12,000 wMELEK locked across positions, valued in wMELEK terms.
  const t = tvl({ lockedKula: 200_000, lockedWmelek: 12_000, priceKulaInWmelek: pp.priceKulaInWmelek });
  console.log(`TVL: ${t.lockedWmelek} wMELEK + ${t.lockedKula} KULA  → ${t.totalValueInWmelek} wMELEK total`
    + ` (KULA leg = ${t.kulaValueInWmelek} wMELEK)`);

  // External feeds — all off today.
  for (const s of ['USD', 'BTC', 'STEEM', 'BLURT']) {
    const r = externalRef(s);
    console.log(`externalRef(${s}): available=${r.available} — ${r.reason} (future: ${r.source})`);
  }

  console.log('\nbadge:\n' + renderTvlBadge({ lockedKula: 200_000, lockedWmelek: 12_000, positions: 7, priceKulaInWmelek: pp.priceKulaInWmelek }));
}
