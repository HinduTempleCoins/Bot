// data-hub.mjs — the PEOPLE-USABLE face of Data.SoapBox.Community.
//
// THE GAP THIS FILLS: the Resource Center engine (integrations/resource-center.mjs) already gathers a
// rich 24/7 market snapshot (Hive-Engine token/chain stats, metals, indices, forex, a live data
// catalog) and writes it to latest.json — but nothing renders that snapshot as a page a normal person
// can open and use. And our OWN ecosystem token prices (KULA/WPRANA/… from the live KulaSwap pools)
// weren't surfaced anywhere a visitor sees. This module is that surface: one legible dashboard that
// puts OUR token prices next to the wider-market data, with an embeddable ticker people can take away.
//
// It does NOT duplicate the big CMC-style aggregator (site/soapbox/server.mjs). It is the focused
// "data hub" landing tool: our tokens (live) + the resource-center digest + the ticker embed.
//
// House style: server-rendered HTML, esc() ALL interpolation, soft-fail-never-throw, keyless, no
// custody, handler(req,res) exported for tests. Both data sources are INJECTABLE so the whole thing
// tests fully offline: __setResourceCenter(fn) supplies the snapshot; the token prices use the ticker
// module's __setFetch. No new deps.

import {
  fetchTokenPrices, renderJSON as tickerJSON, fmtPrice, esc, imageUrl, embeds,
  __setFetch as setTickerFetch,
} from '../../kulaswap/token-ticker.mjs';
import { CHAINS } from '../../kulaswap/kula-config.mjs';

// Re-export the ticker fetch hook so a test can drive BOTH data sources from one place.
export const __setFetch = setTickerFetch;

// ── injectable resource-center snapshot source ──────────────────────────────────────────────────────
// Default: lazily import resource-center and read its persisted latest() snapshot (never runs a live
// pass here — the pass is a separate cron; the hub only DISPLAYS). Soft-fails to null.
let _snapshotSource = null;
/** Test/wiring hook — inject an async () => snapshot (or null). Pass nothing to restore the default. */
export function __setResourceCenter(fn) { _snapshotSource = typeof fn === 'function' ? fn : null; }

async function getSnapshot() {
  try {
    if (_snapshotSource) return await _snapshotSource();
    const rc = await import('../resource-center.mjs');
    if (rc && typeof rc.latest === 'function') return await rc.latest();
  } catch { /* soft-fail */ }
  return null;
}

const num = (x, d = 2) => {
  const v = +x;
  if (!Number.isFinite(v)) return 'n/a';
  return v.toLocaleString('en-US', { maximumFractionDigits: d });
};
const pct = (x) => {
  const v = +x;
  if (!Number.isFinite(v)) return 'n/a';
  const s = v >= 0 ? '+' : '';
  return `${s}${v.toFixed(2)}%`;
};
const trimBase = (b) => String(b || '').replace(/\/$/, '');

// ── config ────────────────────────────────────────────────────────────────────────────────────────
const PRANA = CHAINS.prana || {};
const RPC_URL = process.env.RPC_URL || PRANA.rpcUrl;
const FACTORY = process.env.FACTORY || PRANA.factory;
const MELEK_RPC = process.env.MELEK_RPC || '';
const BASE_URL = trimBase(process.env.BASE_URL || 'https://data.soapbox.community');
const TICKER_URL = trimBase(process.env.TICKER_URL || `${BASE_URL}/tools/ticker`);
const PORT = +(process.env.PORT || process.env.HUB_PORT || 8141);

// ── data assembly ───────────────────────────────────────────────────────────────────────────────────
/**
 * hubData() → { asOf, tokens, market } where `tokens` is the live ecosystem token feed (ticker JSON)
 * and `market` is the resource-center snapshot (or null). Both soft-fail independently, so a dead RPC
 * still shows the wider-market data and a missing snapshot still shows our token prices. Never throws.
 */
export async function hubData() {
  let tokens = null;
  try { tokens = tickerJSON(await fetchTokenPrices({ rpcUrl: RPC_URL, factory: FACTORY, melekRpcUrl: MELEK_RPC })); } catch { tokens = null; }
  const market = await getSnapshot();
  return { asOf: new Date().toISOString(), tokens, market };
}

// ── render: HTML dashboard ──────────────────────────────────────────────────────────────────────────
function tokenRows(tokens) {
  const list = (tokens && tokens.tokens) || [];
  if (!list.length) return '<tr><td colspan="3" class="dim">Token prices temporarily unavailable — try again shortly.</td></tr>';
  return list.map((t) => `<tr><td class="sym">${esc(t.symbol)}</td><td class="dim">${esc(t.name)}</td>`
    + `<td class="num">${t.available ? esc(t.display) + ' <span class="dim">PRANA</span>' : '<span class="na">n/a</span>'}</td></tr>`).join('');
}

function marketSection(market) {
  if (!market || !market.metrics) {
    return '<p class="dim">Wider-market data is being gathered — check back shortly. '
      + '(The Resource Center refreshes on a schedule.)</p>';
  }
  const m = market.metrics;
  const parts = [];
  if (m.hiveEngine) {
    const he = m.hiveEngine;
    parts.push('<h3>Token markets (Hive-Engine / TribalDEX)</h3>');
    parts.push(`<p><b>${esc(num(he.totalTokens, 0))}</b> tokens · <b>${esc(num(he.activeMarkets, 0))}</b> active markets · <b>${esc(num(he.totalVolumeHive, 0))}</b> HIVE 24h volume</p>`);
    if (he.topVolume && he.topVolume.length) {
      parts.push('<table class="mini"><thead><tr><th>Top volume</th><th class="num">24h vol</th><th class="num">Δ</th></tr></thead><tbody>'
        + he.topVolume.map((r) => `<tr><td class="sym">${esc(r.symbol)}</td><td class="num">${esc(num(r.volume, 0))}</td><td class="num ${(+r.change >= 0) ? 'up' : 'down'}">${esc(pct(r.change))}</td></tr>`).join('')
        + '</tbody></table>');
    }
  }
  const macroBits = [];
  const metal = (k, label) => { const v = m.metals && m.metals[k]; if (v && v.price != null) macroBits.push(`${label} $${esc(num(v.price))} <span class="${(+v.change >= 0) ? 'up' : 'down'}">${esc(pct(v.change))}</span>`); };
  metal('gold', 'Gold'); metal('silver', 'Silver');
  const idx = (k, label) => { const v = m.indices && m.indices[k]; if (v && v.price != null) macroBits.push(`${label} ${esc(num(v.price))} <span class="${(+v.change >= 0) ? 'up' : 'down'}">${esc(pct(v.change))}</span>`); };
  idx('dow', 'Dow'); idx('sp500', 'S&P'); idx('nasdaq', 'Nasdaq');
  if (macroBits.length) parts.push('<h3>Macro</h3><p>' + macroBits.join(' · ') + '</p>');
  if (m.forex && m.forex.length) {
    parts.push('<h3>Forex</h3><p>' + m.forex.slice(0, 6).map((p) => `${esc(p.pair)} ${esc(num(p.rate, 4))}`).join(' · ')
      + (m.dxy ? ` · <b>DXY</b> ${esc(num(m.dxy.price))}` : '') + '</p>');
  }
  // the live data catalog — real fetched facts, each linking back to our own record
  if (Array.isArray(market.catalog) && market.catalog.length) {
    parts.push('<h3>Live data feeds</h3><ul class="catalog">'
      + market.catalog.slice(0, 12).map((c) => {
        const label = esc(c.label || c.id || 'datum');
        const value = esc(String(c.value == null ? '' : c.value));
        const url = c.ourUrl && /^https?:\/\//.test(c.ourUrl) ? esc(c.ourUrl) : '';
        const via = c.via ? ` <span class="dim">via ${esc(c.via)}</span>` : '';
        return `<li>${url ? `<a href="${url}">${label}</a>` : label}: <b>${value}</b>${via}</li>`;
      }).join('') + '</ul>');
  }
  const ts = market.ts ? esc(String(market.ts).replace('T', ' ').slice(0, 16) + ' UTC') : '';
  if (ts) parts.push(`<p class="dim src">Market snapshot: ${ts}</p>`);
  return parts.join('\n');
}

/** renderHub(data, {baseUrl,tickerUrl}) → the full HTML dashboard page. esc() on every value. */
export function renderHub(data, { baseUrl = BASE_URL, tickerUrl = TICKER_URL } = {}) {
  const tokens = data && data.tokens;
  const asOf = tokens && tokens.asOf ? esc(String(tokens.asOf).replace('T', ' ').slice(0, 16) + ' UTC') : '';
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>Data · SoapBox Community</title>',
    '<meta name="description" content="Live prices for the MELEK ecosystem tokens, plus market data — one legible, no-signup data hub.">',
    '<style>',
    ':root{--bg:#faf6ea;--card:#fff;--ink:#2a2519;--dim:#6f6650;--gold:#a67c00;--line:#e3dcc7;--up:#1a7f37;--down:#b3261e;--na:#9a8f76}',
    '@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#12100c;--card:#1b1710;--ink:#f4ecd8;--dim:#b7a980;--gold:#e8b923;--line:#33302a;--up:#4ac26b;--down:#e06a5e;--na:#8a7f66}}',
    'body{font-family:system-ui,-apple-system,sans-serif;max-width:840px;margin:0 auto;padding:24px 16px;line-height:1.5;color:var(--ink);background:var(--bg)}',
    'h1{font-family:Georgia,serif;margin:0 0 4px}h2{font-family:Georgia,serif;border-bottom:2px solid var(--gold);padding-bottom:4px;margin-top:32px}h3{margin:18px 0 6px}',
    'a{color:var(--gold)}.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px;margin:12px 0}',
    'table{width:100%;border-collapse:collapse}td,th{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left}',
    'th{font-size:12px;color:var(--dim);text-transform:uppercase;letter-spacing:.04em}',
    '.num{text-align:right;font-family:ui-monospace,Menlo,Consolas,monospace}.sym{font-weight:700;color:var(--gold)}',
    '.dim{color:var(--dim)}.na{color:var(--na)}.up{color:var(--up)}.down{color:var(--down)}',
    'table.mini td,table.mini th{padding:4px 8px;font-size:13px}.catalog{margin:6px 0;padding-left:18px}.catalog li{margin:3px 0}',
    '.src{font-size:12px;margin-top:8px}.tools a{display:inline-block;margin-right:14px}',
    '.embed{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px;font-family:ui-monospace,monospace;font-size:12px;overflow:auto}',
    '</style></head><body>',
    '<h1>Data · SoapBox Community</h1>',
    '<p class="dim">Live prices for our ecosystem tokens and the wider market. No signup, no custody, keyless — every number links back to its source.</p>',

    '<h2>Our tokens</h2>',
    '<div class="card"><table><thead><tr><th>Token</th><th>Name</th><th class="num">Price</th></tr></thead>',
    `<tbody>${tokenRows(tokens)}</tbody></table>`,
    `<p class="dim src">Priced in PRANA from the live KulaSwap AMM pools. MELEK (witness feed) and APIS have no market yet, shown honestly as n/a. ${asOf ? 'Updated ' + asOf : ''}</p></div>`,

    '<h2>Take the ticker with you</h2>',
    '<div class="card">',
    `<p>Drop this live ticker onto a forum signature, a Bitcointalk post, or a blog. <a href="${esc(tickerUrl)}">Full embed page &amp; formats →</a></p>`,
    `<p><img src="${esc(imageUrl(tickerUrl))}" alt="MELEK ecosystem token prices" width="460" style="max-width:100%;border-radius:12px"></p>`,
    `<p class="dim">Forum BBCode (works where JavaScript is banned):</p>`,
    `<div class="embed">${esc(embeds(tickerUrl).bbcode)}</div>`,
    '</div>',

    '<h2>Markets</h2>',
    `<div class="card">${marketSection(data && data.market)}</div>`,

    '<h2>More data</h2>',
    '<div class="card tools">',
    `<a href="${esc(baseUrl)}/coins">Coins</a><a href="${esc(baseUrl)}/chains">Chains</a>`,
    `<a href="${esc(baseUrl)}/macro">Macro</a><a href="${esc(baseUrl)}/forex">Forex</a>`,
    `<a href="${esc(baseUrl)}/commodities">Commodities</a><a href="${esc(baseUrl)}/news">News</a>`,
    '</div>',
    `<p class="dim src">Data hub · data.soapbox.community · rendered ${asOf}</p>`,
    '</body></html>',
  ].join('\n');
}

// ── HTTP handler ────────────────────────────────────────────────────────────────────────────────────
/**
 * handler(req,res) — routes:
 *   GET / or /hub        → the HTML data-hub dashboard
 *   GET /api/hub.json    → the combined JSON (tokens + market snapshot)
 *   GET /health          → "ok"
 * Everything soft-fails; a dead RPC / missing snapshot degrades gracefully, never a 500. For tests.
 */
export async function handler(req, res) {
  const send = (code, type, body, extra = {}) => { res.writeHead(code, { 'content-type': type, ...extra }); res.end(body); };
  let path = '/';
  try { path = (new URL(req.url, BASE_URL)).pathname.replace(/\/+$/, '') || '/'; } catch { path = '/'; }
  try {
    if (path === '/health') return send(200, 'text/plain; charset=utf-8', 'ok');
    if (path === '/api/hub.json') {
      const data = await hubData();
      return send(200, 'application/json; charset=utf-8', JSON.stringify(data), { 'access-control-allow-origin': '*' });
    }
    if (path === '/' || path === '/hub') {
      const data = await hubData();
      return send(200, 'text/html; charset=utf-8', renderHub(data));
    }
    return send(404, 'text/plain; charset=utf-8', 'not found');
  } catch {
    return send(200, 'text/html; charset=utf-8', renderHub({ asOf: new Date().toISOString(), tokens: null, market: null }));
  }
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────────
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('data-hub.mjs')) {
  const arg = process.argv[2] || 'render';
  if (arg === 'serve') {
    const http = await import('node:http');
    http.createServer(handler).listen(PORT, () => process.stdout.write(`data-hub on :${PORT}\n`));
  } else if (arg === 'json') {
    process.stdout.write(JSON.stringify(await hubData(), null, 2) + '\n');
  } else {
    process.stdout.write(renderHub(await hubData()) + '\n');
  }
}
