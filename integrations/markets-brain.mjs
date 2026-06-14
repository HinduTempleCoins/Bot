// markets-brain.mjs — READ-ONLY markets brain extension: stocks, bonds, futures.
// No keys. No execution, no trading, ever. Reading only.
//
// markets-surface.mjs already gives a unified, confidence-scored view across crypto / FX / metals /
// commodities. This module EXTENDS that brain into the three asset classes the SoapBox verticals
// still needed — equities (stocks/indices), government BONDS (treasury yields), and FUTURES
// (index + commodity futures) — using the SAME confidence vocabulary so every number reads the same
// way across the whole brain:
//
//   scoreQuotes() (multimarket.mjs) → 0-100 `score` + named `confidence` band (high/moderate/limited/low/none)
//   + `confident` boolean (>=2 independent sources agreeing within 5%). A lone surviving feed can
//   never exceed "low" — one source is unverifiable by definition.
//
// Keyless sources, each soft-failed independently (a dead feed is dropped, confidence falls, the
// page still renders, nothing throws to the caller):
//   - Yahoo Finance chart API  — breadth workhorse for equities, ^index quotes, treasury-yield
//                                 indices (^TNX/^FVX/^TYX) and futures (ES=F, CL=F, …). Unofficial, keyless.
//   - Stooq CSV (stooq.com/q/l/) — independent second feed for stocks/indices/futures and bond yields
//                                   (10us.b etc.). Keyless CSV, our cross-check so an instrument can
//                                   actually reach "confident".
//
// Everything is pulled through ONE injectable fetch (house __setFetch convention) so the whole brain
// — including stocks/bonds/futures — is fully offline in tests; one fake stubs the lot.
//
//   import { buildBrainView, buildSubdomainView } from './markets-brain.mjs'
//   await buildBrainView()                       // all sections, default symbol sets
//   await buildSubdomainView('stocks')           // one SoapBox vertical's bundle
//
// HTTP:  GET /api/markets-brain            → full brain as JSON
//        GET /api/markets-brain/:subdomain → one subdomain bundle as JSON
//        GET (anything else)               → HTML dashboard

import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { scoreQuotes } from './multimarket.mjs';
import { buildMarketsView, esc, __setFetch as __setSurfaceFetch } from './markets-surface.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0 read-only markets brain)';

// Injectable fetch — house convention. Every new source on this brain is pulled through this one
// fetch so the whole thing is offline-testable and a single fake can stub it all.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) {
  _fetch = fn || ((...a) => globalThis.fetch(...a));
  // The crypto/FX/metals/commodities side composes markets-surface.mjs; route its fetch too so the
  // entire brain (old surface + new sections) stays offline behind one __setFetch call.
  __setSurfaceFetch(fn);
}

const n = (x) => { const v = +x; return Number.isFinite(v) && v > 0 ? v : null; };

// ── symbol maps: canonical label → how each keyless source names the same instrument ──
// market is the section key; unit is informational; yahoo + stooq are the two independent feeds.
// Treasury yields are quoted in PERCENT: Yahoo's ^TNX etc. report 10× the yield (e.g. 42.1 = 4.21%),
// so we scale them down; Stooq's bond-yield tickers (10us.b) report the percent directly.
export const STOCKS = {
  'SPX':  { label: 'S&P 500',     unit: 'index', yahoo: '%5EGSPC', stooq: '^spx' },
  'NDX':  { label: 'Nasdaq 100',  unit: 'index', yahoo: '%5ENDX',  stooq: '^ndx' },
  'DJI':  { label: 'Dow Jones',   unit: 'index', yahoo: '%5EDJI',  stooq: '^dji' },
  'AAPL': { label: 'Apple',       unit: 'USD',   yahoo: 'AAPL',    stooq: 'aapl.us' },
  'MSFT': { label: 'Microsoft',   unit: 'USD',   yahoo: 'MSFT',    stooq: 'msft.us' },
  'NVDA': { label: 'NVIDIA',      unit: 'USD',   yahoo: 'NVDA',    stooq: 'nvda.us' },
};
export const BONDS = {
  'US2Y':  { label: 'US 2Y yield',  unit: '% yield', yahoo: '%5EFVX', yahooScale: 0.1, stooq: '2us.b' },
  'US5Y':  { label: 'US 5Y yield',  unit: '% yield', yahoo: '%5EFVX', yahooScale: 0.1, stooq: '5us.b' },
  'US10Y': { label: 'US 10Y yield', unit: '% yield', yahoo: '%5ETNX', yahooScale: 0.1, stooq: '10us.b' },
  'US30Y': { label: 'US 30Y yield', unit: '% yield', yahoo: '%5ETYX', yahooScale: 0.1, stooq: '30us.b' },
};
export const FUTURES = {
  'ES':  { label: 'S&P 500 (ES)',  unit: 'index pts', yahoo: 'ES%3DF', stooq: 'es.f' },
  'NQ':  { label: 'Nasdaq (NQ)',   unit: 'index pts', yahoo: 'NQ%3DF', stooq: 'nq.f' },
  'CL':  { label: 'Crude (CL)',    unit: 'USD/bbl',   yahoo: 'CL%3DF', stooq: 'cl.f' },
  'GC':  { label: 'Gold (GC)',     unit: 'USD/oz',    yahoo: 'GC%3DF', stooq: 'gc.f' },
};

const SECTION_MAPS = { stocks: STOCKS, bonds: BONDS, futures: FUTURES };

const DEFAULTS = {
  stocks: ['SPX', 'NDX', 'AAPL'],
  bonds: ['US2Y', 'US10Y', 'US30Y'],
  futures: ['ES', 'CL', 'GC'],
};

// ── per-source fetchers (each → finite positive number or null; never throws) ──
async function yahooQuote(sym, scale = 1) {
  try {
    const r = await _fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}`, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!r || !r.ok) return null;
    const m = (await r.json())?.chart?.result?.[0]?.meta;
    const p = n(m?.regularMarketPrice);
    return p == null ? null : p * scale;
  } catch { return null; }
}

// Stooq light CSV: header row + one data row, comma-separated. Close is column index 6
// (Symbol,Date,Time,Open,High,Low,Close,Volume). "N/D" rows mean no data → null.
async function stooqQuote(sym) {
  try {
    const r = await _fetch(`https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlcv&h&e=csv`, { headers: { 'user-agent': UA } });
    if (!r || !r.ok) return null;
    const text = await r.text();
    const lines = String(text).trim().split(/\r?\n/);
    if (lines.length < 2) return null;
    const cols = lines[1].split(',');
    return n(cols[6]);
  } catch { return null; }
}

async function gather(spec) {
  const jobs = [];
  if (spec.yahoo) jobs.push(yahooQuote(spec.yahoo, spec.yahooScale || 1).then((p) => ['yahoo', p]));
  if (spec.stooq) jobs.push(stooqQuote(spec.stooq).then((p) => ['stooq', p]));
  const settled = await Promise.all(jobs.map((p) => p.catch(() => null)));
  return settled.filter((r) => r && r[1] != null);
}

// One confidence-scored entry for a stock / bond / future, in the SAME shape + vocabulary as the
// markets-surface entries. Unknown symbol or total source failure → zeroed, unconfident; never throws.
async function entry(section, sym, asOf) {
  const map = SECTION_MAPS[section] || {};
  const key = String(sym || '').trim().toUpperCase();
  const spec = map[key];
  if (!spec) {
    return { symbol: key, label: key, market: section, price: 0, unit: null, confidence: 'none', score: 0, confident: false, sources: 0, sourceNames: [], spreadPct: null, asOf };
  }
  const quotes = await gather(spec);
  const sc = scoreQuotes(quotes.map((q) => q[1]));
  return {
    symbol: key,
    label: spec.label,
    market: section,
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

async function sectionEntries(section, list, asOf) {
  try { return await Promise.all(list.map((s) => entry(section, s, asOf))); }
  catch { return []; }
}

// ── plain-language "what the bots see" note per section, derived from the live numbers ──
// Deterministic, defensible, no advice: it just states agreement + the spread of yields/prices.
function botNote(section, entries) {
  const live = entries.filter((e) => e.price > 0);
  if (!live.length) return 'No live reads right now — every free source for this section soft-failed. Nothing to say until a feed returns.';
  const confident = live.filter((e) => e.confident).length;
  const agree = `${confident}/${live.length} reads cross-confirmed by two or more independent free sources`;
  if (section === 'bonds') {
    // Tenor order is implied by symbol (US2Y < US5Y < US10Y < US30Y). If a shorter tenor's yield is
    // ABOVE a longer one, the curve is (partly) inverted — a plainly-defensible factual read.
    const byTenor = [...live].sort((a, b) => a.symbol.localeCompare(b.symbol, undefined, { numeric: true }));
    const inverted = byTenor.some((e, i) => i > 0 && e.price < byTenor[i - 1].price);
    const prices = live.map((e) => e.price);
    const span = Math.max(...prices) - Math.min(...prices);
    return `Treasury yields read ${live.map((e) => `${esc(e.label)} ${e.price.toFixed(2)}%`).join(', ')}. ` +
      `${agree}. Yields span ${span.toFixed(2)} points across the tenors shown` +
      `${inverted ? ' — a shorter tenor sits above a longer one (curve partly inverted)' : ''}. Read-only; not advice.`;
  }
  return `The bots cross-check ${live.length} ${section} from free public feeds: ${agree}. ` +
    `Confidence here means sources AGREE on the number right now, not that it is "right" or a buy/sell signal. ` +
    `Reading only — no orders, no execution.`;
}

const CLARITY_NOTE =
  'Confidence = how well free, independent sources AGREE on this number right now — not investment ' +
  'advice and not a claim the price is "correct". More agreeing sources within a tight band → higher ' +
  'score. A lone surviving source can never exceed "low": one feed is unverifiable by definition.';

/**
 * Build the stocks/bonds/futures extension of the brain (the NEW asset classes only). Each section
 * is independently soft-failed. Returns { ok, asOf, sections:[{key,title,entries,note}], summary }.
 * opts: { stocks:[syms], bonds:[syms], futures:[syms], asOf?:ISO, fetch?:fn }
 */
export async function buildExtensionView(opts = {}) {
  if (typeof opts.fetch === 'function') __setFetch(opts.fetch);
  const asOf = opts.asOf || new Date().toISOString();
  const want = {
    stocks: Array.isArray(opts.stocks) ? opts.stocks : DEFAULTS.stocks,
    bonds: Array.isArray(opts.bonds) ? opts.bonds : DEFAULTS.bonds,
    futures: Array.isArray(opts.futures) ? opts.futures : DEFAULTS.futures,
  };
  const [stocks, bonds, futures] = await Promise.all([
    sectionEntries('stocks', want.stocks, asOf),
    sectionEntries('bonds', want.bonds, asOf),
    sectionEntries('futures', want.futures, asOf),
  ]);
  const sections = [
    { key: 'stocks', title: 'Stocks & indices', entries: stocks, note: botNote('stocks', stocks) },
    { key: 'bonds', title: 'Bonds (treasury yields)', entries: bonds, note: botNote('bonds', bonds) },
    { key: 'futures', title: 'Futures (index & commodity)', entries: futures, note: botNote('futures', futures) },
  ];
  const all = sections.flatMap((s) => s.entries);
  return {
    ok: true, asOf, readOnly: true, clarityNote: CLARITY_NOTE,
    summary: { sections: sections.length, entries: all.length, confident: all.filter((e) => e.confident).length },
    sections,
  };
}

/**
 * The FULL markets brain: the existing surface (crypto/FX/metals/commodities) PLUS the new
 * stocks/bonds/futures sections, normalised into one section list with the same shape + a per-section
 * plain-language note. Both halves run through the one injectable fetch, so the whole thing is offline
 * in tests. Soft-fails per source and per section; never throws.
 *
 * opts: passes through to both halves; { crypto, fx, metals, commodities, stocks, bonds, futures, asOf, fetch }
 */
export async function buildBrainView(opts = {}) {
  if (typeof opts.fetch === 'function') __setFetch(opts.fetch);
  const asOf = opts.asOf || new Date().toISOString();
  const safe = async (fn, fallback) => { try { return await fn(); } catch { return fallback; } };

  const [surface, ext] = await Promise.all([
    safe(() => buildMarketsView({ ...opts, asOf }), { sections: [] }),
    safe(() => buildExtensionView({ ...opts, asOf }), { sections: [] }),
  ]);

  // Surface sections carry no per-section note; synthesise one in the same voice for parity.
  const surfaceSections = (surface.sections || []).map((s) => ({
    ...s, note: s.note || botNote(s.key, s.entries || []),
  }));
  const sections = [...surfaceSections, ...(ext.sections || [])];
  const all = sections.flatMap((s) => s.entries || []);
  return {
    ok: true, asOf, readOnly: true, clarityNote: CLARITY_NOTE,
    summary: { sections: sections.length, entries: all.length, confident: all.filter((e) => e.confident).length },
    sections,
  };
}

// Which brain section each SoapBox subdomain maps to. A few friendly aliases included.
const SUBDOMAIN_SECTION = {
  stocks: 'stocks', equities: 'stocks', shares: 'stocks',
  bonds: 'bonds', treasuries: 'bonds', yields: 'bonds', rates: 'bonds',
  futures: 'futures',
  crypto: 'crypto', coins: 'crypto',
  fx: 'fx', forex: 'fx', currencies: 'fx',
  metals: 'metals', gold: 'metals',
  commodities: 'commodities', energy: 'commodities',
};

/**
 * One SoapBox subdomain's bundle: the relevant brain section + a short plain-language "what the bots
 * see" note, ready for a per-subdomain page AND a future MELEK discussion post. Unknown subdomain →
 * an ok:false bundle naming the valid subdomains (soft-fail, never throws).
 *
 * opts: passes through to buildBrainView (symbol overrides, asOf, fetch).
 */
export async function buildSubdomainView(subdomain, opts = {}) {
  const key = String(subdomain || '').trim().toLowerCase();
  const sectionKey = SUBDOMAIN_SECTION[key];
  const brain = await buildBrainView(opts);
  if (!sectionKey) {
    return {
      ok: false, subdomain: key, readOnly: true, asOf: brain.asOf,
      error: 'unknown subdomain',
      validSubdomains: Object.keys(SUBDOMAIN_SECTION),
      section: null, note: 'Unknown subdomain — nothing to show.', clarityNote: CLARITY_NOTE,
    };
  }
  const section = (brain.sections || []).find((s) => s.key === sectionKey)
    || { key: sectionKey, title: sectionKey, entries: [], note: botNote(sectionKey, []) };
  return {
    ok: true, subdomain: key, section: sectionKey, title: section.title,
    readOnly: true, asOf: brain.asOf,
    note: section.note || botNote(sectionKey, section.entries || []),
    clarityNote: CLARITY_NOTE,
    entries: section.entries || [],
    summary: { entries: (section.entries || []).length, confident: (section.entries || []).filter((e) => e.confident).length },
  };
}

// ── HTML dashboard (per-subdomain and whole-brain) ──
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
    <td class="sym">${esc(e.label || e.symbol)}</td>
    <td class="px">${esc(priceStr(e))}</td>
    <td class="unit">${esc(e.unit || '')}</td>
    <td class="conf">${badge(e)}</td>
    <td class="src">${esc(String(e.sources || 0))} src${e.sourceNames?.length ? ` <span class="srcnames">(${esc(e.sourceNames.join(', '))})</span>` : ''}</td>
    <td class="spread">${e.spreadPct == null ? '—' : esc(String(e.spreadPct)) + '%'}</td>
  </tr>`;
}
function sectionHtml(s) {
  const rows = (s.entries || []).length
    ? s.entries.map(rowHtml).join('\n')
    : `<tr><td colspan="6" class="empty">no data right now (sources unavailable — soft-failed)</td></tr>`;
  return `<section>
    <h2>${esc(s.title || s.key)}</h2>
    ${s.note ? `<p class="botnote">${esc(s.note)}</p>` : ''}
    <table>
      <thead><tr><th>Instrument</th><th>Price</th><th>Unit</th><th>Confidence</th><th>Sources</th><th>Spread</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </section>`;
}

const PAGE_CSS = `
  :root { color-scheme: dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; background: #0d0f14; color: #e6e8ee; }
  .wrap { max-width: 980px; margin: 0 auto; padding: 24px 18px 64px; }
  h1 { font-size: 1.5rem; margin: 0 0 4px; }
  .lede { color: #aab; margin: 0 0 6px; }
  .note { background: #141822; border: 1px solid #232a38; border-radius: 8px; padding: 10px 14px; color: #c7cbd6; font-size: 0.9rem; margin: 14px 0 22px; }
  .botnote { background: #101620; border-left: 3px solid #355; border-radius: 4px; padding: 8px 12px; color: #b8c4d0; font-size: 0.9rem; margin: 6px 0 12px; }
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
  footer { color: #667; font-size: 0.8rem; margin-top: 30px; border-top: 1px solid #1a1f2b; padding-top: 14px; }`;

export function renderBrainHtml(view) {
  const sections = (view?.sections || []).map(sectionHtml).join('\n');
  const sum = view?.summary || { sections: 0, entries: 0, confident: 0 };
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MELEK · Markets Brain (read-only)</title>
<style>${PAGE_CSS}</style>
</head><body><div class="wrap">
  <h1>Markets Brain</h1>
  <p class="lede">What the bots see across crypto, ForEx, metals, commodities, stocks, bonds and futures — from free, keyless sources. Reading only.</p>
  <div class="note">${esc(view?.clarityNote || CLARITY_NOTE)}</div>
  <p class="meta">As of ${esc(view?.asOf || '')} · ${esc(String(sum.entries))} instruments across ${esc(String(sum.sections))} sections · ${esc(String(sum.confident))} confident · reading only — no trading, no execution.</p>
  ${sections}
  <footer>MELEK / SoapBox markets brain. Confidence = agreement across free public sources, not investment advice. No keys, no orders, no execution — reading only.</footer>
</div></body></html>`;
}

export function renderSubdomainHtml(bundle) {
  const sec = bundle?.section
    ? sectionHtml({ key: bundle.section, title: bundle.title, entries: bundle.entries, note: bundle.note })
    : `<p class="botnote">${esc(bundle?.note || 'Unknown subdomain.')}</p>`;
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>MELEK · ${esc(bundle?.title || bundle?.subdomain || 'Markets')} (read-only)</title>
<style>${PAGE_CSS}</style>
</head><body><div class="wrap">
  <h1>${esc(bundle?.title || bundle?.subdomain || 'Markets')}</h1>
  <p class="lede">What the bots see on the ${esc(bundle?.subdomain || '')} desk — free, keyless sources, reading only.</p>
  <div class="note">${esc(bundle?.clarityNote || CLARITY_NOTE)}</div>
  <p class="meta">As of ${esc(bundle?.asOf || '')} · reading only — no trading, no execution.</p>
  ${sec}
  <footer>MELEK / SoapBox · ${esc(bundle?.subdomain || '')} desk. Confidence = agreement across free public sources, not investment advice. No keys, no orders, no execution.</footer>
</div></body></html>`;
}

// ── HTTP handler: GET /api/markets-brain[/:subdomain] → JSON; else → HTML ──
export async function handler(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers?.host || 'localhost'}`);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const json = (status, obj) => {
      res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=60' });
      res.end(JSON.stringify(obj));
    };

    // /api/markets-brain/:subdomain
    const m = path.match(/^\/api\/markets-brain\/([A-Za-z][\w-]*)$/);
    if (m) { json(200, await buildSubdomainView(m[1])); return; }

    if (path === '/api/markets-brain' || url.searchParams.get('format') === 'json') {
      json(200, await buildBrainView()); return;
    }

    // /:subdomain HTML page (e.g. /stocks) — anything else is the whole-brain dashboard
    const sub = path.match(/^\/([A-Za-z][\w-]*)$/);
    if (sub) {
      const bundle = await buildSubdomainView(sub[1]);
      if (bundle.ok) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' });
        res.end(renderSubdomainHtml(bundle));
        return;
      }
    }
    const html = renderBrainHtml(await buildBrainView());
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' });
    res.end(html);
  } catch {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, sections: [], summary: { sections: 0, entries: 0, confident: 0 } }));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = +(process.env.PORT || 8098);
  const arg = process.argv[2];
  if (arg === 'serve') {
    createServer(handler).listen(PORT, () => console.log(`markets brain on http://localhost:${PORT}/api/markets-brain`));
  } else if (arg && SUBDOMAIN_SECTION[arg.toLowerCase()]) {
    const b = await buildSubdomainView(arg);
    console.log(`MELEK markets brain — ${b.title} (read-only)\n` + '─'.repeat(72));
    console.log(b.note + '\n');
    for (const e of b.entries) {
      const flag = e.confident ? '✓' : '⚠';
      console.log(`  ${flag} ${(e.label || e.symbol).padEnd(16)} ${String(priceStr(e)).padStart(12)} ${(e.unit || '').padEnd(10)} ${String(e.score).padStart(3)}/100 ${e.confidence}`);
    }
  } else {
    const view = await buildBrainView();
    console.log(`MELEK markets brain — read-only, ${view.summary.entries} instruments, ${view.summary.confident} confident\n` + '─'.repeat(72));
    for (const s of view.sections) {
      console.log(`\n${s.title}`);
      for (const e of s.entries) {
        const flag = e.confident ? '✓' : '⚠';
        console.log(`  ${flag} ${(e.label || e.symbol).padEnd(16)} ${String(priceStr(e)).padStart(12)} ${(e.unit || '').padEnd(10)} ${String(e.score).padStart(3)}/100 ${e.confidence}`);
      }
    }
    console.log('\n' + view.clarityNote);
  }
}
