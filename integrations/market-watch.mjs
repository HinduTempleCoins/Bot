// market-watch.mjs — the MELEK ecosystem's OWN-economy dashboard (the "Market Watch" the operator
// wants to track our economy, and the sanctioned signal lane the trade-watch bots read — see memory
// economy-hud-and-managed-account-health-bot + the RS3 research's first-party price-tracker).
//
// It aggregates the ONLY honest prices our tokens have — the KulaSwap AMM pool ratio — into one board:
//   - KULA↔wMELEK pool price (the internal oracle), from kula-price-tvl.poolPrice/fetchPoolPrice,
//   - TVL in native units + a wMELEK-terms rollup (kula-price-tvl.tvl),
//   - market cap + FDV in wMELEK terms (market-cap.marketCap/fdv), from supply inputs,
// each section soft-failing independently. There are NO external USD markets yet, so we NEVER show a
// dollar figure — every value is in wMELEK/native terms, exactly like kula-price-tvl's own discipline.
//
//   import { economyBoard, headline, renderBoard, handler } from './integrations/market-watch.mjs';
//   const b = await economyBoard();            // live (env) or injected (tests)
//   res.end(renderBoard(b));                    // escaped HTML dashboard
//
// READ-ONLY · NO KEYS · SOFT-FAIL. Tests inject { pool, supply } so the whole board assembles OFFLINE.
//
//   node integrations/market-watch.mjs         # print the headline (live; soft-fails to n/a)

import { poolPrice, fetchPoolPrice, tvl } from '../kulaswap/kula-price-tvl.mjs';
import { marketCap, fdv, format } from './market-cap.mjs';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const round = (n, p = 8) => +num(n).toFixed(p);

// env config (all optional; unset → that section soft-fails to n/a). Redacted-by-env, never hard-coded.
export function config() {
  return {
    rpcUrl: process.env.KULA_RPC_URL || '',
    pairAddr: process.env.KULA_PAIR_ADDR || '',
    kulaIsToken0: process.env.KULA_IS_TOKEN0 !== 'false',
    supplyKula: process.env.KULA_SUPPLY != null ? num(process.env.KULA_SUPPLY) : null,
    maxSupplyKula: process.env.KULA_MAX_SUPPLY != null ? num(process.env.KULA_MAX_SUPPLY) : null,
  };
}
export function configured() { const c = config(); return !!(c.rpcUrl && c.pairAddr); }

/**
 * Build the economy board. Every section soft-fails independently.
 * @param {object} [opts]
 * @param {{reservesKula:number,reservesWmelek:number}} [opts.pool] injected pool reserves (tests); when
 *   omitted, reads live from the KulaSwap pair via env (KULA_RPC_URL + KULA_PAIR_ADDR), else null.
 * @param {{circulating:number,max:number}} [opts.supply] injected supply (tests); else from env.
 * @returns {Promise<object>} board with price/tvl/cap sections + sections.{name}.ok flags.
 */
export async function economyBoard({ pool, supply } = {}) {
  const asOf = new Date().toISOString();
  const cfg = config();

  // 1) price — the KULA/wMELEK pool ratio (the only honest price the ecosystem has).
  let price = null;
  if (pool && pool.reservesKula != null && pool.reservesWmelek != null) {
    price = poolPrice(pool.reservesKula, pool.reservesWmelek);
  } else if (cfg.rpcUrl && cfg.pairAddr) {
    price = await fetchPoolPrice({ rpcUrl: cfg.rpcUrl, pairAddr: cfg.pairAddr, kulaIsToken0: cfg.kulaIsToken0 }).catch(() => null);
  }
  const priceOk = !!(price && price.ok);

  // 2) tvl — native-unit value locked in the pool + a wMELEK-terms rollup.
  let tvlRec = null;
  if (price && price.ok) {
    tvlRec = tvl({ lockedKula: price.reservesKula, lockedWmelek: price.reservesWmelek, priceKulaInWmelek: price.priceKulaInWmelek });
  }
  const tvlOk = !!(tvlRec && tvlRec.totalValueInWmelek != null);

  // 3) cap — market cap + FDV in wMELEK terms (supply × pool price). null when supply not provided.
  const circ = supply && supply.circulating != null ? num(supply.circulating) : cfg.supplyKula;
  const max = supply && supply.max != null ? num(supply.max) : cfg.maxSupplyKula;
  let cap = null;
  if (priceOk && circ != null) {
    const p = price.priceKulaInWmelek;
    const mc = marketCap({ supply: circ, price: p });
    cap = {
      circulating: circ, maxSupply: max,
      priceKulaInWmelek: p,
      marketCapWmelek: mc == null ? null : round(mc, 6),
      fdvWmelek: max == null ? null : (fdv({ maxSupply: max, price: p }) == null ? null : round(fdv({ maxSupply: max, price: p }), 6)),
    };
  }
  const capOk = !!(cap && cap.marketCapWmelek != null);

  return {
    asOf,
    numeraire: 'wMELEK',
    price: priceOk ? {
      priceKulaInWmelek: price.priceKulaInWmelek,
      priceWmelekInKula: price.priceWmelekInKula,
      reservesKula: price.reservesKula,
      reservesWmelek: price.reservesWmelek,
    } : null,
    tvl: tvlOk ? {
      lockedKula: tvlRec.lockedKula, lockedWmelek: tvlRec.lockedWmelek,
      totalValueInWmelek: tvlRec.totalValueInWmelek, priced: tvlRec.priced,
    } : null,
    cap: capOk ? cap : null,
    sections: { price: { ok: priceOk }, tvl: { ok: tvlOk }, cap: { ok: capOk } },
    note: 'All values in wMELEK / native units — there is no external USD market for MELEK/KULA yet, so no dollar figure is shown.',
  };
}

/** One plain-English line, e.g. "1 KULA = 0.05 wMELEK · TVL 62,000 wMELEK · cap 50,000 wMELEK". */
export function headline(board) {
  if (!board) return 'Market Watch unavailable.';
  const parts = [];
  if (board.price) parts.push(`1 KULA = ${round(board.price.priceKulaInWmelek, 8)} wMELEK`);
  if (board.tvl) parts.push(`TVL ${Number(board.tvl.totalValueInWmelek).toLocaleString()} wMELEK`);
  if (board.cap) parts.push(`cap ${Number(board.cap.marketCapWmelek).toLocaleString()} wMELEK`);
  if (!parts.length) return 'No live market data — the KulaSwap pool is unconfigured or empty.';
  return parts.join(' · ');
}

// ── renderBoard: escaped HTML dashboard ─────────────────────────────────────────────────────────────
function card(title, ok, inner) {
  const flag = ok ? '' : ' <span class="mw-down">(no data)</span>';
  return `<section class="mw-card"><h3>${esc(title)}${flag}</h3>${inner}</section>`;
}
export function renderBoard(board) {
  if (!board) return `<div class="market-watch"><p>Market Watch unavailable.</p></div>`;
  const p = board.price, t = board.tvl, c = board.cap;
  const priceHtml = p
    ? `<p><strong>1 KULA = ${esc(round(p.priceKulaInWmelek, 8))} wMELEK</strong></p>`
      + `<p>1 wMELEK = ${esc(round(p.priceWmelekInKula, 8))} KULA</p>`
      + `<p class=mw-mut>Reserves: ${esc(Number(p.reservesKula).toLocaleString())} KULA · ${esc(Number(p.reservesWmelek).toLocaleString())} wMELEK</p>`
    : `<p class=mw-mut>Pool price unavailable (KulaSwap pair unconfigured or empty).</p>`;
  const tvlHtml = t
    ? `<p><strong>${esc(Number(t.totalValueInWmelek).toLocaleString())} wMELEK</strong> total value locked</p>`
      + `<p class=mw-mut>${esc(Number(t.lockedWmelek).toLocaleString())} wMELEK + ${esc(Number(t.lockedKula).toLocaleString())} KULA</p>`
    : `<p class=mw-mut>TVL unavailable.</p>`;
  const capHtml = c
    ? `<p><strong>${esc(Number(c.marketCapWmelek).toLocaleString())} wMELEK</strong> market cap</p>`
      + (c.fdvWmelek != null ? `<p class=mw-mut>FDV ${esc(Number(c.fdvWmelek).toLocaleString())} wMELEK (max supply)</p>` : '')
      + `<p class=mw-mut>Circulating ${esc(Number(c.circulating).toLocaleString())} KULA</p>`
    : `<p class=mw-mut>Market cap unavailable (supply not configured).</p>`;
  const S = board.sections || {};
  return `<div class="market-watch">`
    + `<h2>MELEK Economy — Market Watch <span class=mw-num>wMELEK terms</span></h2>`
    + `<p class="mw-headline">${esc(headline(board))}</p>`
    + `<p class="mw-note">${esc(board.note)}</p>`
    + card('KULA / wMELEK price', S.price?.ok, priceHtml)
    + card('Total Value Locked', S.tvl?.ok, tvlHtml)
    + card('Market Cap', S.cap?.ok, capHtml)
    + `</div>`;
}

const PAGE_CSS = `.market-watch{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:720px;margin:0 auto;padding:16px;color:#e8e8ea}
.market-watch h2{font-size:1.3rem;margin:0 0 4px}.mw-num{font-size:.7rem;opacity:.6;font-weight:400}
.mw-headline{font-size:1rem;opacity:.9;margin:.2rem 0}.mw-note{font-size:.75rem;opacity:.6;margin:.2rem 0 1rem}
.mw-card{background:#17171b;border:1px solid #2a2a30;border-radius:10px;padding:12px 14px;margin:10px 0}
.mw-card h3{font-size:.95rem;margin:0 0 8px;opacity:.85}.mw-mut{opacity:.65;font-size:.85rem;margin:.2rem 0}
.mw-down{color:#f85149;font-size:.7rem;font-weight:400}a{color:#58a6ff}`;

/** HTTP handler. GET /api (or Accept: json) → JSON board; else the HTML dashboard. Read-only. */
export async function handler(req, res) {
  try {
    const u = new URL(req.url, `http://${req.headers?.host || 'localhost'}`);
    const wantsJson = u.pathname.endsWith('/api') || String(req.headers?.accept || '').includes('application/json');
    const board = await economyBoard();
    if (wantsJson) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(JSON.stringify(board));
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(`<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">`
      + `<title>MELEK Market Watch</title><style>body{background:#0b0b0d}${PAGE_CSS}</style></head><body>${renderBoard(board)}</body></html>`);
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('market-watch error');
  }
}

// CLI (guarded)
if (process.argv[1] && process.argv[1].endsWith('market-watch.mjs')) {
  const board = await economyBoard();
  console.log('MELEK ECONOMY — MARKET WATCH (wMELEK terms, read-only)\n' + '─'.repeat(56));
  console.log(headline(board));
  for (const [k, s] of Object.entries(board.sections)) console.log(`  ${k.padEnd(8)} ${s.ok ? 'ok' : 'no data'}`);
  if (!configured()) console.log('\n(KULA_RPC_URL + KULA_PAIR_ADDR unset — live pool read soft-fails to n/a.)');
  void format; // reserved for a future USD overlay when an external market exists
}
