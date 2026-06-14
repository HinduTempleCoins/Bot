// markets-surface.mjs — READ-ONLY multi-market intelligence surface. No keys. No execution, ever.
//
// One unified, confidence-scored view across the markets that matter to MELEK / SoapBox:
//   • crypto   — top symbols, priced multi-source the way price-oracle.mjs already does
//   • FX       — major pairs (EUR/USD, GBP/USD, USD/JPY, …)
//   • metals   — gold / silver (XAU/USD, XAG/USD)
//   • commodities — oil / natural gas (WTI, NATGAS)
//
// This module does NOT reinvent the readers — it composes them:
//   - integrations/multimarket.mjs   → getMultiMarket() for FX/metals/commodities (already
//                                       confidence-scored; has its own __setFetch).
//   - integrations/price-oracle.mjs  → robustMedian() for the crypto confidence math.
//   - integrations/multimarket.mjs   → scoreQuotes() for the named "Clarity" band + 0-100 score.
// Crypto USD quotes are gathered here through ONE injectable fetch (keyless coingecko + coinbase +
// coinpaprika + coincap), so the whole surface — including the crypto side — stays fully offline in
// tests. Every source is soft-failed independently: a dead feed is dropped, confidence falls, and
// the page still renders. Nothing here throws to the caller.
//
//   import { buildMarketsView } from './markets-surface.mjs'
//   await buildMarketsView()                 // default symbol set
//   await buildMarketsView({ crypto:['bitcoin','ethereum'], fx:['EUR/USD'] })
//
// HTTP:  GET /api/markets  → buildMarketsView() as JSON  (handler(req,res), injectable fetch)

import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { robustMedian } from './price-oracle.mjs';
import { scoreQuotes, SYMBOLS } from './multimarket.mjs';

const UA = 'MELEK-Bot/1.0 (read-only markets surface)';

// Injectable fetch — house __setFetch convention. EVERY source on this surface (crypto AND the FX /
// metals / commodity feeds) is pulled through this one fetch, so the whole view is fully offline in
// tests and a single fake can stub the lot. We deliberately gather FX/metals/commodities here via
// this fetch rather than calling multimarket.getMultiMarket(): that path also queries Frankfurter
// through free-apis' non-injectable global fetch, which would leak to the network. We reuse
// multimarket's pure pieces instead — its SYMBOLS map + scoreQuotes math.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) {
  _fetch = fn || ((...a) => globalThis.fetch(...a));
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const n = (x) => { const v = +x; return Number.isFinite(v) && v > 0 ? v : null; };

// ── crypto symbol map: coingecko id → how each keyless source names the same asset ──
// Mirrors price-oracle.mjs XREF but kept local so we can drive it through our injectable fetch.
export const CRYPTO = {
  bitcoin:   { label: 'BTC',  paprika: 'btc-bitcoin',   cap: 'bitcoin',  coinbase: 'BTC-USD' },
  ethereum:  { label: 'ETH',  paprika: 'eth-ethereum',  cap: 'ethereum', coinbase: 'ETH-USD' },
  solana:    { label: 'SOL',  paprika: 'sol-solana',    cap: 'solana',   coinbase: 'SOL-USD' },
  litecoin:  { label: 'LTC',  paprika: 'ltc-litecoin',  cap: 'litecoin', coinbase: 'LTC-USD' },
  dogecoin:  { label: 'DOGE', paprika: 'doge-dogecoin', cap: 'dogecoin', coinbase: 'DOGE-USD' },
  hive:      { label: 'HIVE', paprika: 'hive-hive',     cap: 'hive',     coinbase: 'HIVE-USD' },
};

const DEFAULTS = {
  crypto: ['bitcoin', 'ethereum', 'solana', 'hive'],
  fx: ['EUR/USD', 'GBP/USD', 'USD/JPY'],
  metals: ['XAU/USD', 'XAG/USD'],
  commodities: ['WTI', 'NATGAS'],
};

// ── per-source crypto fetchers (each → finite positive number or null; never throws) ──
async function jget(url) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function gatherCrypto(id) {
  const x = CRYPTO[id] || {};
  const jobs = [
    jget(`https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd`)
      .then((d) => ['coingecko', n(d?.[id]?.usd)]),
  ];
  if (x.paprika) jobs.push(jget(`https://api.coinpaprika.com/v1/tickers/${encodeURIComponent(x.paprika)}`).then((d) => ['coinpaprika', n(d?.quotes?.USD?.price)]));
  if (x.cap) jobs.push(jget(`https://api.coincap.io/v2/assets/${encodeURIComponent(x.cap)}`).then((d) => ['coincap', n(d?.data?.priceUsd)]));
  if (x.coinbase) jobs.push(jget(`https://api.coinbase.com/v2/prices/${encodeURIComponent(x.coinbase)}/spot`).then((d) => ['coinbase', n(d?.data?.amount)]));
  const settled = await Promise.all(jobs.map((p) => p.catch(() => null)));
  return settled.filter((r) => r && r[1] != null);
}

// One confidence-scored crypto entry. Reuses robustMedian (outlier rejection, price-oracle.mjs) for
// the price, and scoreQuotes (multimarket.mjs) for the named Clarity band + 0-100 score, so crypto
// reads with the SAME confidence vocabulary as FX/metals. Total source failure → zeroed, not thrown.
async function cryptoEntry(id, asOf) {
  const quotes = await gatherCrypto(id);
  const vals = quotes.map((q) => q[1]);
  const rm = robustMedian(vals);
  const sc = scoreQuotes(vals);
  return {
    symbol: (CRYPTO[id]?.label) || id.toUpperCase(),
    id,
    market: 'crypto',
    price: rm.usd,
    unit: 'USD',
    confidence: sc.confidence,
    score: sc.score,
    confident: rm.confident,
    sources: rm.sources,
    sourceNames: quotes.map((q) => q[0]),
    spreadPct: rm.spreadPct,
    asOf,
  };
}

// ── traditional-market gather (FX / metals / commodities), all through OUR injectable fetch ──
// Yahoo chart is the keyless breadth source for every symbol; for FX we add open.er-api as a second
// independent feed so a major pair can actually reach "confident". Each source soft-fails to null.
async function yahooQuote(sym) {
  const d = await jget(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}`);
  return n(d?.chart?.result?.[0]?.meta?.regularMarketPrice);
}
async function openErApiFx(base, quote) {
  const d = await jget(`https://open.er-api.com/v6/latest/${encodeURIComponent(base)}`);
  return n(d?.rates?.[quote]);
}
async function gatherMarket(spec) {
  const jobs = [];
  if (spec.yahoo) jobs.push(yahooQuote(spec.yahoo).then((p) => ['yahoo', p]));
  if (spec.market === 'forex' && spec.fx) {
    jobs.push(openErApiFx(spec.fx.base, spec.fx.quote).then((p) => ['open.er-api', p]));
  }
  const settled = await Promise.all(jobs.map((p) => p.catch(() => null)));
  return settled.filter((r) => r && r[1] != null);
}

// One confidence-scored traditional-market entry, reusing multimarket's SYMBOLS map + scoreQuotes.
// Unknown symbol or total source failure → zeroed, unconfident; never throws.
async function marketEntry(symbol, asOf) {
  const key = String(symbol || '').trim().toUpperCase();
  const spec = SYMBOLS[key];
  if (!spec) return { symbol: key, market: 'unknown', price: 0, unit: null, confidence: 'none', score: 0, confident: false, sources: 0, sourceNames: [], spreadPct: null, asOf };
  const quotes = await gatherMarket(spec);
  const sc = scoreQuotes(quotes.map((q) => q[1]));
  return {
    symbol: key,
    market: spec.market,
    price: sc.price,
    unit: spec.unit,
    confidence: sc.confidence,
    score: sc.score,
    confident: sc.confident,
    sources: sc.sources,
    sourceNames: quotes.map((q) => q[0]),
    spreadPct: sc.spreadPct,
    asOf,
  };
}

const CLARITY_NOTE =
  'Confidence = how well free, independent sources AGREE on this number right now — not investment ' +
  'advice and not a claim the price is "correct". More agreeing sources within a tight band → higher ' +
  'score. A lone surviving source can never exceed "low": one feed is unverifiable by definition.';

/**
 * Build the unified read-only markets view. Sections: crypto, fx, metals, commodities. Each entry is
 * { symbol, market, price, unit, confidence, score, confident, sources, sourceNames, spreadPct, asOf }.
 * Soft-fails per source AND per section: a dead source lowers confidence; a section that errors out
 * entirely comes back as []. Never throws.
 *
 * opts: { crypto:[ids], fx:[pairs], metals:[syms], commodities:[syms], asOf?:ISO, fetch?:fn }
 */
export async function buildMarketsView(opts = {}) {
  if (typeof opts.fetch === 'function') __setFetch(opts.fetch);
  const asOf = opts.asOf || new Date().toISOString();
  const want = {
    crypto: Array.isArray(opts.crypto) ? opts.crypto : DEFAULTS.crypto,
    fx: Array.isArray(opts.fx) ? opts.fx : DEFAULTS.fx,
    metals: Array.isArray(opts.metals) ? opts.metals : DEFAULTS.metals,
    commodities: Array.isArray(opts.commodities) ? opts.commodities : DEFAULTS.commodities,
  };

  // Each section is independently soft-failed: a thrown reader collapses to [] for that section only.
  const safe = async (fn) => { try { return await fn(); } catch { return []; } };

  const [crypto, fx, metals, commodities] = await Promise.all([
    safe(async () => Promise.all(want.crypto.map((id) => cryptoEntry(id, asOf)))),
    safe(async () => Promise.all(want.fx.map((s) => marketEntry(s, asOf)))),
    safe(async () => Promise.all(want.metals.map((s) => marketEntry(s, asOf)))),
    safe(async () => Promise.all(want.commodities.map((s) => marketEntry(s, asOf)))),
  ]);

  const sections = [
    { key: 'crypto', title: 'Crypto', entries: crypto },
    { key: 'fx', title: 'ForEx (major pairs)', entries: fx },
    { key: 'metals', title: 'Precious metals', entries: metals },
    { key: 'commodities', title: 'Commodities', entries: commodities },
  ];

  const all = sections.flatMap((s) => s.entries);
  const confidentCount = all.filter((e) => e.confident).length;

  return {
    ok: true,
    asOf,
    clarityNote: CLARITY_NOTE,
    readOnly: true,
    summary: { sections: sections.length, entries: all.length, confident: confidentCount },
    sections,
  };
}

// ── HTML dashboard ──
function badge(e) {
  const band = esc(e.confidence || 'none');
  return `<span class="badge ${band}">${band.toUpperCase()} · ${esc(String(e.score ?? 0))}/100</span>`;
}
function priceStr(e) {
  const p = +e.price || 0;
  if (!p) return '—';
  const dp = p < 1 ? 6 : p < 100 ? 4 : 2;
  return p.toFixed(dp);
}
function rowHtml(e) {
  return `<tr>
    <td class="sym">${esc(e.symbol)}</td>
    <td class="px">${esc(priceStr(e))}</td>
    <td class="unit">${esc(e.unit || '')}</td>
    <td class="conf">${badge(e)}</td>
    <td class="src">${esc(String(e.sources || 0))} src${e.sourceNames?.length ? ` <span class="srcnames">(${esc(e.sourceNames.join(', '))})</span>` : ''}</td>
    <td class="spread">${e.spreadPct == null ? '—' : esc(String(e.spreadPct)) + '%'}</td>
    <td class="asof">${esc(e.asOf || '')}</td>
  </tr>`;
}
function sectionHtml(s) {
  const rows = s.entries.length
    ? s.entries.map(rowHtml).join('\n')
    : `<tr><td colspan="7" class="empty">no data right now (sources unavailable — soft-failed)</td></tr>`;
  return `<section>
    <h2>${esc(s.title)}</h2>
    <table>
      <thead><tr><th>Symbol</th><th>Price</th><th>Unit</th><th>Confidence</th><th>Sources</th><th>Spread</th><th>As of (UTC)</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

export function renderMarketsHtml(view) {
  const sections = (view?.sections || []).map(sectionHtml).join('\n');
  const sum = view?.summary || { sections: 0, entries: 0, confident: 0 };
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MELEK · Markets Intelligence (read-only)</title>
<style>
  :root { color-scheme: dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; background: #0d0f14; color: #e6e8ee; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 24px 18px 64px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .lede { color: #aab; margin: 0 0 6px; }
  .note { background: #141822; border: 1px solid #232a38; border-radius: 8px; padding: 10px 14px; color: #c7cbd6; font-size: 0.9rem; margin: 14px 0 22px; }
  .meta { color: #889; font-size: 0.82rem; margin-bottom: 18px; }
  section { margin: 0 0 26px; }
  h2 { font-size: 1.05rem; border-bottom: 1px solid #232a38; padding-bottom: 6px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid #1a1f2b; }
  th { color: #99a; font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; }
  td.sym { font-weight: 600; }
  td.px { font-variant-numeric: tabular-nums; }
  td.empty { color: #778; font-style: italic; }
  .srcnames { color: #778; font-size: 0.82rem; }
  .badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 0.74rem; font-weight: 700; letter-spacing: 0.03em; }
  .badge.high { background: #143a22; color: #6ee79a; }
  .badge.moderate { background: #3a3514; color: #e7d56e; }
  .badge.limited { background: #3a2a14; color: #e7b06e; }
  .badge.low, .badge.none { background: #3a1a1a; color: #e78a8a; }
  footer { color: #667; font-size: 0.8rem; margin-top: 30px; border-top: 1px solid #1a1f2b; padding-top: 14px; }
</style>
</head><body><div class="wrap">
  <h1>Markets Intelligence</h1>
  <p class="lede">Read-only market intelligence across crypto, ForEx, metals and commodities — from free, keyless sources.</p>
  <div class="note">${esc(view?.clarityNote || CLARITY_NOTE)}</div>
  <p class="meta">As of ${esc(view?.asOf || '')} · ${esc(String(sum.entries))} instruments across ${esc(String(sum.sections))} sections · ${esc(String(sum.confident))} confident · reading only — no trading, no execution.</p>
  ${sections}
  <footer>MELEK / SoapBox markets surface. Confidence = agreement across free public sources, not investment advice. No keys, no orders, no execution — reading only.</footer>
</div></body></html>`;
}

// ── HTTP handler: GET /api/markets → JSON; GET (anything else) → HTML dashboard ──
export async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);
    const view = await buildMarketsView();
    if (url.pathname === '/api/markets' || (url.searchParams.get('format') === 'json')) {
      const body = JSON.stringify(view);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' });
      res.end(body);
      return;
    }
    const html = renderMarketsHtml(view);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' });
    res.end(html);
  } catch {
    // Soft-fail even the transport: never crash the server.
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, sections: [], summary: { sections: 0, entries: 0, confident: 0 } }));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = +(process.env.PORT || 8097);
  const arg = process.argv[2];
  if (arg === 'serve') {
    createServer(handler).listen(PORT, () => console.log(`markets surface on http://localhost:${PORT}/api/markets`));
  } else {
    const view = await buildMarketsView();
    console.log(`MELEK markets surface — read-only, ${view.summary.entries} instruments, ${view.summary.confident} confident\n` + '─'.repeat(72));
    for (const s of view.sections) {
      console.log(`\n${s.title}`);
      for (const e of s.entries) {
        const flag = e.confident ? '✓' : '⚠';
        console.log(`  ${flag} ${e.symbol.padEnd(9)} ${String(priceStr(e)).padStart(12)} ${(e.unit || '').padEnd(10)} ${String(e.score).padStart(3)}/100 ${e.confidence.padEnd(9)} (${e.sources} src)`);
      }
    }
    console.log('\n' + view.clarityNote);
  }
}
