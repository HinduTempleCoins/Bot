// server.mjs — Directory.SoapBox.Community. The crypto/markets resource directory as its own subdomain
// (operator 2026-06-02), with a "submit your URL for us to crawl" box. Same slim-sticky-bar pattern as
// Data/Search (◈ SoapBox directory + links to Data + Search), but no big category nav. Submissions are
// SSRF-checked, best-effort crawled for a title, and queued to a moderation file — never auto-published.
//
//   PORT=8094 BASE_URL=https://directory.soapbox.community node site/directory/server.mjs

import { createServer } from 'node:http';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { DIRECTORY } from '../soapbox/directory.mjs';
import { insights, normDomain, trancoRank } from '../../integrations/soapbox/domain-insights.mjs';
// Resource Center catalogs (plain data + helpers) — surfaced as Directory sections below the
// curated listing (#175/#177/#182/#183/#185 consolidation).
import * as markets from '../../integrations/soapbox/markets-catalog.mjs';
import * as govtech from '../../integrations/soapbox/govtech-catalog.mjs';
import * as wikis from '../../integrations/soapbox/wikis-catalog.mjs';
import * as scams from '../../integrations/soapbox/scam-registry.mjs';

const PORT = +(process.env.PORT || 8094);
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
const STOCKS = process.env.STOCKS_SITE || 'https://stocks.soapbox.community';
const SUBMISSIONS = process.env.DIRECTORY_SUBMISSIONS || new URL('../../data/directory-submissions.jsonl', import.meta.url).pathname;
// Moderation gate — reuse the STATS_TOKEN-style opaque-token pattern (see site/soapbox/server.mjs).
// Only the operator (who knows the token) can promote/approve a community submission. DIRECTORY_TOKEN
// is preferred; STATS_TOKEN is accepted as a fallback so the operator can reuse one secret across sites.
const DIR_TOKEN = process.env.DIRECTORY_TOKEN || process.env.STATS_TOKEN || '';
const TRUST_STATUSES = ['pending', 'approved', 'featured'];

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const CATS = DIRECTORY.map((g) => g.cat);

// ── Top Sites leaderboard ────────────────────────────────────────────────────
// The Alexa-top-sites equivalent. Tranco's full top-list is a downloadable CSV; for a keyless surface we
// curate small well-known domain sets per category and resolve each domain's LIVE Tranco rank at request
// time, then sort by rank. Same every load → cached hard (LEADERBOARD_TTL). Categories are tabs.
const LEADERBOARD = {
  Overall: ['google.com', 'youtube.com', 'facebook.com', 'wikipedia.org', 'amazon.com', 'reddit.com', 'instagram.com', 'x.com', 'tiktok.com', 'linkedin.com', 'netflix.com', 'microsoft.com', 'apple.com', 'bing.com', 'github.com', 'cloudflare.com'],
  Crypto: ['coinbase.com', 'binance.com', 'coingecko.com', 'coinmarketcap.com', 'tradingview.com', 'etherscan.io', 'kraken.com', 'crypto.com', 'blockchain.com', 'opensea.io', 'uniswap.org', 'bitcoin.org'],
  Search: ['google.com', 'bing.com', 'duckduckgo.com', 'yandex.com', 'baidu.com', 'ecosia.org', 'brave.com', 'startpage.com'],
  Social: ['facebook.com', 'instagram.com', 'tiktok.com', 'x.com', 'reddit.com', 'linkedin.com', 'pinterest.com', 'snapchat.com', 'discord.com', 'tumblr.com'],
  News: ['nytimes.com', 'cnn.com', 'bbc.com', 'reuters.com', 'theguardian.com', 'wsj.com', 'bloomberg.com', 'foxnews.com', 'washingtonpost.com', 'apnews.com'],
};
const LB_CATS = Object.keys(LEADERBOARD);
const LEADERBOARD_TTL = +(process.env.LEADERBOARD_TTL_MS || 6 * 60 * 60 * 1000); // 6h — Tranco updates daily
const lbCache = new Map(); // cat → { at, rows:[{domain,rank,date}] }

// Resolve a domain's rank, retrying once after a short backoff (Tranco rate-limits bursts).
async function rankRow(domain) {
  let r = await trancoRank(domain).catch(() => null);
  if (!r) { await new Promise((s) => setTimeout(s, 250)); r = await trancoRank(domain).catch(() => null); }
  return { domain, rank: r?.rank ?? null, date: r?.date ?? null };
}

// Resolve a category's domains to live Tranco ranks (small worker pool so we don't trip the rate limit),
// sort by rank, cache. Domains shared across cached tabs are reused to cut total requests.
async function leaderboard(cat) {
  const domains = LEADERBOARD[cat] || LEADERBOARD.Overall;
  const hit = lbCache.get(cat);
  if (hit && Date.now() - hit.at < LEADERBOARD_TTL) return hit.rows;
  // reuse fresh ranks already resolved for any other cached category
  const known = new Map();
  for (const v of lbCache.values()) if (Date.now() - v.at < LEADERBOARD_TTL) for (const row of v.rows) if (row.rank != null) known.set(row.domain, row);
  const todo = domains.filter((d) => !known.has(d));
  const CONC = 2;
  const out = [];
  for (let i = 0; i < todo.length; i += CONC) {
    if (i) await new Promise((s) => setTimeout(s, 150)); // gentle pacing — Tranco rate-limits bursts; result is cached 6h
    out.push(...await Promise.all(todo.slice(i, i + CONC).map(rankRow)));
  }
  const byDomain = new Map(out.map((r) => [r.domain, r]));
  const rows = domains.map((d) => known.get(d) || byDomain.get(d) || { domain: d, rank: null, date: null })
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity));
  lbCache.set(cat, { at: Date.now(), rows });
  return rows;
}

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:900px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 8px} .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:16px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px}
  .it{padding:8px 0;border-bottom:1px solid var(--line)} .it:last-child{border-bottom:0}
  .it .n{font-weight:600} .it .b{color:var(--mut);font-size:13px} .star{color:var(--gold)}
  form.sub{display:grid;gap:10px;max-width:560px}
  input,select,textarea{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:10px 12px;font:inherit;width:100%}
  input:focus,select:focus,textarea:focus{outline:none;border-color:var(--blue)}
  button{cursor:pointer;background:var(--blue);border:0;border-radius:8px;color:#06101f;font-weight:700;padding:11px 22px;font-size:15px;justify-self:start}
  .hp{position:absolute;left:-9999px}
  .ok{background:#3fb95022;border:1px solid var(--up);border-radius:8px;padding:14px 16px;color:var(--fg)}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:28px;margin-top:24px}
  /* Hero rankings box — the big gray panel at the top */
  .hero{background:linear-gradient(180deg,#1b2230,#161b22);border:1px solid var(--line2);border-radius:12px;padding:22px 22px 20px;margin:16px 0}
  .hero h1{font-size:24px;margin:0 0 4px} .hero .sub{color:var(--mut);margin:0 0 14px;font-size:14px}
  .bigform{display:flex;gap:10px;max-width:640px;margin:0 0 6px}
  .bigform input{flex:1;font-size:16px;padding:13px 15px}
  .bigform button{font-size:15px;padding:0 22px}
  /* tabs + leaderboard */
  .tabs{display:flex;gap:6px;flex-wrap:wrap;margin:18px 0 12px}
  .tabs a{font-size:13px;font-weight:700;padding:6px 13px;border:1px solid var(--line2);border-radius:20px;color:var(--mut)}
  .tabs a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .tabs a.on{background:var(--blue);border-color:var(--blue);color:#06101f}
  .lb{display:grid;grid-template-columns:1fr;gap:0}
  .lb .row{display:flex;align-items:center;gap:12px;padding:9px 4px;border-bottom:1px solid var(--line)} .lb .row:last-child{border-bottom:0}
  .lb .pos{width:26px;text-align:right;color:var(--mut);font-variant-numeric:tabular-nums;font-weight:700}
  .lb .dom{flex:1;font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .lb .rk{color:var(--up);font-weight:700;font-variant-numeric:tabular-nums}
  .lb .rk.un{color:var(--mut);font-weight:400;font-size:12px}
  .lb .lk{font-size:12px;color:var(--mut)}
  .spark{vertical-align:middle}
  .trend-up{color:var(--up);font-weight:700} .trend-dn{color:#f85149;font-weight:700} .trend-flat{color:var(--mut)}
  /* Resource Center — catalog sections (collapsible) */
  .rc{margin:26px 0 6px}
  details.rcg{background:var(--panel);border:1px solid var(--line2);border-radius:10px;margin:12px 0;overflow:hidden}
  details.rcg>summary{cursor:pointer;list-style:none;padding:14px 18px;font-weight:700;font-size:16px;display:flex;align-items:center;gap:10px}
  details.rcg>summary::-webkit-details-marker{display:none}
  details.rcg>summary::before{content:'▸';color:var(--mut);font-size:12px}
  details.rcg[open]>summary::before{content:'▾'}
  details.rcg>summary .ct{margin-left:auto;color:var(--mut);font-weight:400;font-size:12px}
  .rcg-body{padding:4px 18px 16px}
  .rcsub{font-weight:700;color:var(--mut);font-size:12px;text-transform:uppercase;letter-spacing:.04em;margin:14px 0 6px;padding-top:8px;border-top:1px solid var(--line)}
  .rcsub:first-child{border-top:0;padding-top:0}
  .lrow{display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--line);flex-wrap:wrap} .lrow:last-child{border-bottom:0}
  .lrow .ln{font-weight:600} .lrow .ld{color:var(--mut);font-size:12.5px;flex:1;min-width:120px}
  .bdg{font-size:10.5px;font-weight:700;padding:2px 7px;border-radius:20px;border:1px solid var(--line2);color:var(--mut);white-space:nowrap}
  .bdg.us-full{color:var(--up);border-color:#3fb95066} .bdg.us-partial{color:var(--gold);border-color:#d2992266}
  .bdg.us-no{color:#f85149;border-color:#f8514966} .bdg.us-unknown{color:var(--mut)}
  .bdg.kind{color:var(--blue);border-color:#58a6ff44}
</style>`;

const page = (title, body) => `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name=description content="SoapBox Directory — a curated directory of crypto, markets, and data resources. Submit your site for review.">
<meta name=robots content="index,follow"><link rel=canonical href="${BASE_URL}/">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">◈ SoapBox <span>directory</span></a>
  <div class=topbar-r><a href="${DATA}" title="Markets, macro, commodities, forex">Data</a><a href="${SEARCH}" title="SoapBox Search">Search</a><a href="${WIKI}" title="Library of Ashurbanipal">Wiki</a><a href="${STOCKS}" title="Stocks &amp; equities">Stocks</a></div></header>
<main class=wrap>${body}</main>
<footer>SoapBox Directory · site rankings &amp; a curated crypto directory + community submissions (moderated). <a href="${DATA}">Data</a> · <a href="${SEARCH}">Search</a> · <a href="${WIKI}">Wiki</a> · <a href="${STOCKS}">Stocks</a></footer></body></html>`;

const submitForm = (msg = '') => `<div class=card id=submit>
  <h2>Submit a site for the Directory</h2>
  <p class=muted>Got a useful crypto / markets / data resource? Drop the URL and we'll crawl it and review it for the directory. Nothing is published automatically.</p>
  ${msg}
  <form class=sub method=post action="/submit">
    <input type=url name=url placeholder="https://your-site.com" required autocomplete=off>
    <input type=text name=name placeholder="Site name (optional)" autocomplete=off>
    <select name=category><option value="">Suggest a category…</option>${CATS.map((c) => `<option>${esc(c)}</option>`).join('')}<option>Other / new category</option></select>
    <textarea name=note rows=2 placeholder="One line: what is it? (optional)"></textarea>
    <input type=text name=website class=hp tabindex=-1 autocomplete=off aria-hidden=true>
    <button type=submit>Submit for review</button>
  </form></div>`;

function listing() {
  return DIRECTORY.map((g) => `<div class=card><h2>${esc(g.cat)}</h2><div class=grid>${g.items.map((it) => `<div class=it>
    <div class=n><a href="${esc(it.url)}" rel="noopener" target=_blank>${esc(it.name)}</a>${it.ours ? ' <span class=star title="ecosystem">⭐</span>' : ''}</div>
    <div class=b>${esc(it.blurb)}</div></div>`).join('')}</div></div>`).join('');
}

// ── Community submissions tier (#138/#139) ───────────────────────────────────
// The curated DIRECTORY above is hand-picked. This tier is the community-submitted layer: every entry
// the public POSTed to /submit lands in the SUBMISSIONS JSONL, and we render the ones that have earned
// visibility (pending + approved + featured) as a separate "Community submissions" list. It's a
// read-only render from the JSONL — never a second source of truth. Trust is a small per-submission
// model: a `status` ('pending'|'approved'|'featured') and a `trust` counter that grows as a site earns
// it. Promotion is MANUAL — only the operator, via the token-gated /api/moderate endpoint, moves a
// submission up the ladder. Best-effort throughout: a missing/empty/corrupt JSONL yields an empty list,
// never an error.

// Read + parse the submissions JSONL into objects, newest first, deduped by url (last write wins so a
// moderation update supersedes the original submission line). Best-effort — returns [] on any failure.
async function readSubmissions() {
  let txt;
  try { txt = await readFile(SUBMISSIONS, 'utf8'); } catch { return []; }
  const byUrl = new Map();
  for (const line of txt.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let o; try { o = JSON.parse(s); } catch { continue; }
    if (!o || typeof o.url !== 'string') continue;
    if (!TRUST_STATUSES.includes(o.status)) o.status = 'pending';
    if (typeof o.trust !== 'number' || !isFinite(o.trust)) o.trust = 0;
    byUrl.set(o.url, o); // later lines (incl. moderation rewrites) win
  }
  // newest first by submission timestamp, then featured/approved float up
  const rank = { featured: 0, approved: 1, pending: 2 };
  return [...byUrl.values()].sort((a, b) =>
    (rank[a.status] - rank[b.status]) || ((b.ts_unix || 0) - (a.ts_unix || 0)));
}

const STATUS_BADGE = {
  featured: '<span class="bdg us-full">★ featured</span>',
  approved: '<span class="bdg us-full">✓ approved</span>',
  pending: '<span class="bdg us-partial">⏳ pending</span>',
};

// The community-submissions section: a read-only list of pending + approved + featured submissions,
// plus the "how trust grows" explainer and the manual-moderation note (#139).
function communitySection(subs) {
  const shown = subs.filter((s) => TRUST_STATUSES.includes(s.status));
  const rows = shown.length ? shown.map((s) => {
    const title = (s.crawl_title || '').trim();
    const name = (s.name || '').trim() || title || s.url.replace(/^https?:\/\//, '');
    const trust = s.trust > 0 ? ` <span class=b title="trust earned">· trust ${s.trust}</span>` : '';
    return `<div class=lrow>
      <span class=ln><a href="${esc(s.url)}" rel="noopener nofollow" target=_blank>${esc(name)}</a></span>
      ${STATUS_BADGE[s.status] || STATUS_BADGE.pending}
      <span class=ld>${esc(title || s.url)}${trust}</span></div>`;
  }).join('') : '<p class=muted>No community submissions yet — be the first to submit a site above.</p>';
  return `<details class=rcg id=community${shown.length ? ' open' : ''}>
    <summary>🌱 Community submissions<span class=ct>${shown.length} entries</span></summary>
    <div class=rcg-body>
      <p class=muted style="margin-top:4px">Sites the community submitted, separate from the curated directory above.
      <b>Approval is manual</b> — a human (the operator) reviews every submission before it's marked approved or featured;
      nothing here is auto-published. <b>Trust grows as sites earn it:</b> a submission starts <i>pending</i>, becomes
      <i>approved</i> once it checks out, and can be <i>featured</i> once it's proven genuinely useful — the trust counter
      reflects that earned standing. Outbound links open in a new tab; do your own research.</p>
      ${rows}
    </div></details>`;
}

// ── Moderation endpoint (#139) ────────────────────────────────────────────────
// /api/moderate?token=…&url=…&status=approved[&trust=N] — token-gated (STATS_TOKEN-style). Rewrites the
// matching submission's status/trust by appending an updated line (JSONL is append-only on disk; the
// reader dedupes last-write-wins). Returns JSON. 404 (not 401) when the token is absent/wrong, so the
// endpoint's existence isn't revealed — same posture as the soapbox /stats gate.
async function handleModerate(req, res, url) {
  const want = DIR_TOKEN;
  const got = url.searchParams.get('token') || '';
  if (!want || got !== want) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404'); }
  const target = (url.searchParams.get('url') || '').trim();
  const status = (url.searchParams.get('status') || '').trim();
  const trustParam = url.searchParams.get('trust');
  if (!target) return sendJson(res, 400, { ok: false, error: 'url required' });
  if (status && !TRUST_STATUSES.includes(status)) return sendJson(res, 400, { ok: false, error: 'status must be pending|approved|featured' });
  const subs = await readSubmissions();
  const entry = subs.find((s) => s.url === target);
  if (!entry) return sendJson(res, 404, { ok: false, error: 'submission not found' });
  if (status) entry.status = status;
  if (trustParam != null) {
    const t = Number(trustParam);
    if (Number.isFinite(t)) entry.trust = t;
  } else if (status === 'approved' || status === 'featured') {
    entry.trust = Math.max(entry.trust || 0, status === 'featured' ? 2 : 1); // trust grows as it's promoted
  }
  entry.moderated_unix = Math.floor(Date.now() / 1000);
  try { await appendFile(SUBMISSIONS, JSON.stringify(entry) + '\n'); }
  catch (e) { return sendJson(res, 500, { ok: false, error: 'write failed' }); }
  return sendJson(res, 200, { ok: true, url: entry.url, status: entry.status, trust: entry.trust });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// Site Insights — the "Alexa rankings" surface: popularity rank + domain age + on-page SEO for any site.
const bigForm = (domain = '') => `<form class=bigform method=get action="/">
  <input type=text name=domain value="${esc(domain)}" placeholder="Enter a domain — e.g. github.com — for rank, trend, age &amp; SEO" autocomplete=off autofocus>
  <button type=submit>Get insights</button></form>`;

// Tiny inline SVG sparkline of Tranco rank over time. Ranks are inverted (lower rank = higher on chart).
function sparkline(points, w = 120, h = 28) {
  if (!points || points.length < 2) return '';
  const ranks = points.map((p) => p.rank);
  const min = Math.min(...ranks), max = Math.max(...ranks), span = max - min || 1;
  const dx = w / (points.length - 1);
  // invert: a smaller rank number is "better" → plot it higher (smaller y)
  const xy = points.map((p, i) => [Math.round(i * dx), Math.round(((p.rank - min) / span) * (h - 4) + 2)]);
  const path = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ');
  const [lx, ly] = xy[xy.length - 1];
  return `<svg class=spark width=${w} height=${h} viewBox="0 0 ${w} ${h}" aria-hidden=true><path d="${path}" fill=none stroke=var(--blue) stroke-width=1.5/><circle cx=${lx} cy=${ly} r=2 fill=var(--blue)/></svg>`;
}

// Hero rankings box: big lookup + the Top Sites leaderboard (tabbed by category). Always at the top.
function heroBox(rows, activeCat) {
  const tabs = LB_CATS.map((c) => `<a href="/?top=${encodeURIComponent(c)}#top"${c === activeCat ? ' class=on' : ''}>${esc(c)}</a>`).join('');
  const lb = rows.map((r, i) => `<div class=row>
    <div class=pos>${i + 1}</div>
    <div class=dom><a href="/?domain=${encodeURIComponent(r.domain)}">${esc(r.domain)}</a></div>
    ${r.rank ? `<div class=rk>#${r.rank.toLocaleString()}</div>` : '<div class="rk un">unranked</div>'}
    <a class=lk href="/?domain=${encodeURIComponent(r.domain)}">insights →</a></div>`).join('');
  return `<section class=hero id=top>
    <h1>Site Rankings &amp; Insights</h1>
    <p class=sub>The keyless alternative to Alexa top-sites — popularity rank (Tranco), rank trend, domain age &amp; on-page SEO for any domain.</p>
    ${bigForm()}
    <div class=tabs>${tabs}</div>
    <div class=lb>${lb}</div>
    <p class=muted style="font-size:11px;margin-top:10px">Top Sites: a curated set of well-known domains resolved to their live <b>Tranco</b> rank (manipulation-resistant academic top-list, updated daily, cached). Click any site for full insights.</p>
  </section>`;
}

function insightsCard(d) {
  if (!d || d.error) return `<div class=card><h2>📊 Site Insights</h2>
    <p class=muted>Look up any site's popularity rank, trend, domain age, and on-page SEO. ${d?.error ? `<span style="color:var(--gold)">Enter a valid domain.</span>` : ''}</p>${bigForm()}</div>`;
  const rank = d.rank ? `<b>#${d.rank.rank.toLocaleString()}</b> <span class=muted>Tranco (${d.rank.date})</span>` : '<span class=muted>unranked (outside the top list)</span>';
  const age = d.age?.registered ? `<b>${d.age.ageYears}y</b> <span class=muted>(since ${d.age.registered.slice(0, 10)}${d.age.registrar ? ' · ' + esc(d.age.registrar) : ''})</span>` : '<span class=muted>unknown</span>';
  const seo = d.seo ? `<b style="color:${d.seo.score >= 90 ? 'var(--up)' : d.seo.score >= 70 ? 'var(--gold)' : 'var(--blue)'}">${d.seo.score}/100</b> <span class=muted>(${d.seo.fails} fails, ${d.seo.warns} warns)</span>` : '<span class=muted>n/a</span>';
  // Trend: delta>0 means rank number fell over the window = climbing in popularity.
  let trend = '<span class=muted>n/a</span>';
  if (d.trend?.points?.length >= 2) {
    const dl = d.trend.delta;
    const arrow = dl > 0 ? `<span class=trend-up>▲ +${dl}</span>` : dl < 0 ? `<span class=trend-dn>▼ ${dl}</span>` : '<span class=trend-flat>— flat</span>';
    trend = `${sparkline(d.trend.points)} ${arrow} <span class=muted style="font-size:11px">over ${d.trend.points.length}d</span>`;
  }
  const cat = d.category ? `<div><div class=b>Category</div><b>${esc(d.category)}</b></div>` : '';
  return `<div class=card><h2>📊 Site Insights — ${esc(d.domain)}</h2>
    <div class=grid style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr))">
      <div><div class=b>Popularity rank</div>${rank}</div>
      <div><div class=b>Rank trend</div>${trend}</div>
      <div><div class=b>Domain age</div>${age}</div>
      <div><div class=b>On-page SEO</div>${seo}</div>
      ${cat}
    </div>
    <p class=muted style="font-size:11px;margin-top:8px">Rank &amp; trend: Tranco (manipulation-resistant academic top-list). Age: RDAP registry data. SEO: our on-page audit. Category: heuristic guess. All keyless — informational.</p>
    ${bigForm(d.domain)}</div>`;
}

// ── Resource Center sections ──────────────────────────────────────────────────
// Data-driven from the catalog modules so they stay in sync. Each renders compact link rows;
// every outbound link is rel=noopener target=_blank.
const olink = (url, name) => `<a href="${esc(url)}" rel="noopener" target=_blank>${esc(name)}</a>`;
const rcGroup = (id, title, count, body) =>
  `<details class=rcg id="rc-${id}"><summary>${esc(title)}<span class=ct>${count} entries</span></summary><div class=rcg-body>${body}</div></details>`;
const linkRow = (name, url, desc, badges = '') =>
  `<div class=lrow><span class=ln>${olink(url, name)}</span>${badges}<span class=ld>${esc(desc || '')}</span></div>`;

const US_LABEL = { full: 'US ✓', partial: 'US partial', no: 'US ✗', unknown: 'US ?' };
const usBadge = (us) => `<span class="bdg us-${us || 'unknown'}">${US_LABEL[us] || US_LABEL.unknown}</span>`;

// 1) Markets & Exchanges — crypto grouped by US-availability, then tradfi by asset class.
function marketsSection() {
  const ex = markets.allExchanges();
  const crypto = ex.filter((e) => e.asset === 'crypto');
  const order = ['full', 'partial', 'no', 'unknown'];
  const head = { full: 'Crypto — US-friendly', partial: 'Crypto — partial US access', no: 'Crypto — US-restricted', unknown: 'Crypto — unverified US status' };
  let body = '';
  for (const us of order) {
    const rows = crypto.filter((e) => e.us === us);
    if (!rows.length) continue;
    body += `<div class=rcsub>${esc(head[us])} · ${rows.length}</div>` +
      rows.map((e) => linkRow(e.name, e.url, e.note, usBadge(e.us) + `<span class="bdg kind">${esc(e.type)}</span>`)).join('');
  }
  for (const asset of ['stocks', 'forex', 'bonds', 'commodities']) {
    const rows = ex.filter((e) => e.asset === asset);
    if (!rows.length) continue;
    body += `<div class=rcsub>${esc(asset)} · ${rows.length}</div>` +
      rows.map((e) => linkRow(e.name, e.url, e.note, usBadge(e.us) + `<span class="bdg kind">${esc(e.type)}</span>`)).join('');
  }
  return rcGroup('markets', '📈 Markets & Exchanges', ex.length, body);
}

// 2) Wikis & Encyclopedias — by category.
function wikisSection() {
  const cats = wikis.categories();
  const body = cats.map((c) => {
    const rows = wikis.byCategory(c);
    return `<div class=rcsub>${esc(c)} · ${rows.length}</div>` +
      rows.map((w) => linkRow(w.name, w.url, w.notes, `<span class="bdg kind">${esc(w.engine)}</span>`)).join('');
  }).join('');
  return rcGroup('wikis', '📚 Wikis & Encyclopedias', wikis.WIKIS.length, body);
}

// 3) Government Data & APIs — by category, with a kind badge.
function govtechSection() {
  const body = govtech.CATEGORIES.map((c) => {
    const rows = govtech.byCategory(c);
    if (!rows.length) return '';
    return `<div class=rcsub>${esc(c)} · ${rows.length}</div>` +
      rows.map((g) => linkRow(g.name, g.url, g.notes, `<span class="bdg kind">${esc(g.kind)}</span>` + (g.keyless ? '<span class="bdg us-full">keyless</span>' : ''))).join('');
  }).join('');
  return rcGroup('govtech', '🏛️ Government Data & APIs', govtech.GOVTECH.length, body);
}

// 4) Crypto Scam Trackers — gov sources, then community.
function scamsSection() {
  const groups = [['Government fraud trackers', scams.govSources()], ['Community / reputation registries', scams.byKind('community')]];
  const total = groups.reduce((n, [, rows]) => n + rows.length, 0);
  const body = groups.map(([label, rows]) => {
    if (!rows.length) return '';
    return `<div class=rcsub>${esc(label)} · ${rows.length}</div>` +
      rows.map((s) => linkRow(s.name, s.url, s.coverage, `<span class="bdg kind">${esc(s.agency)}</span>` + (s.keyless ? '<span class="bdg us-full">keyless</span>' : ''))).join('');
  }).join('');
  return rcGroup('scams', '🛡️ Crypto Scam Trackers', total, body);
}

function resourceCenter() {
  return `<h2 class=rc>Resource Center</h2>
  <p class=muted>Curated link catalogs across markets, knowledge, government data, and fraud signals — data-driven from our reference modules. Outbound links open in a new tab; do your own research.</p>
  ${marketsSection()}${wikisSection()}${govtechSection()}${scamsSection()}`;
}

const homeBody = (msg, hero, insights = '', community = '') => `${hero}
  ${insights ? `<div style="margin:16px 0">${insights}</div>` : ''}
  <h2 style="margin:26px 0 6px">Crypto Resources Directory</h2>
  <p class=muted>A curated directory of useful crypto, markets, and data resources. Ecosystem items marked ⭐. We deliberately also list <b>useful low-traffic crypto resources</b> — niche tools and docs that won't rank near the top but earn their place. Outbound links; do your own research.</p>
  ${submitForm(msg)}
  ${listing()}
  ${community}
  ${resourceCenter()}`;

// SSRF guard: only public http(s) hosts (we crawl what's submitted).
function safeUrl(raw) {
  let u; try { u = new URL(String(raw).trim()); } catch { return null; }
  if (!/^https?:$/.test(u.protocol)) return null;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return null;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|255\.)/.test(h)) return null;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return null;
  if (h.startsWith('[')) return null; // skip raw IPv6 (incl ::1, fc00::/7)
  return u.toString();
}

// best-effort crawl: grab the page <title> for the moderator (5s cap, SSRF already checked).
async function crawlTitle(url) {
  try {
    const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (compatible; SoapBox-Directory/1.0)' }, redirect: 'follow', signal: AbortSignal.timeout(5000) });
    const html = (await r.text()).slice(0, 20000);
    const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
    return { status: r.status, title: m ? m[1].trim() : '' };
  } catch { return { status: 0, title: '' }; }
}

async function handleSubmit(req, res) {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 8000) break; }
  const f = new URLSearchParams(raw);
  if (f.get('website')) { res.writeHead(302, { location: '/#submit' }); return res.end(); } // honeypot tripped → silently drop
  const hero = heroBox(await leaderboard('Overall').catch(() => []), 'Overall');
  const url = safeUrl(f.get('url'));
  if (!url) return send(res, page('Submit — SoapBox Directory', homeBody('<div class=ok style="border-color:var(--gold)">Please enter a valid public http(s) URL.</div>', hero, '', communitySection(await readSubmissions()))), 400);
  const crawl = await crawlTitle(url);
  const entry = { url, name: (f.get('name') || '').slice(0, 120), category: (f.get('category') || '').slice(0, 60), note: (f.get('note') || '').slice(0, 280), crawl_status: crawl.status, crawl_title: crawl.title.slice(0, 200), status: 'pending', trust: 0, ip_hash: 'redacted', ts_unix: Math.floor(Date.now() / 1000) };
  try { await mkdir(dirname(SUBMISSIONS), { recursive: true }); await appendFile(SUBMISSIONS, JSON.stringify(entry) + '\n'); } catch (e) { /* never fail the user on a write error */ }
  const okMsg = `<div class=ok>✓ Thanks — <b>${esc(url)}</b> is queued for review${crawl.title ? ` (we found: “${esc(crawl.title)}”)` : ''}. We crawl + check submissions before adding them.</div>`;
  return send(res, page('Submitted — SoapBox Directory', homeBody(okMsg, hero, '', communitySection(await readSubmissions()))));
}

function send(res, html, code = 200) { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`); }
    if (url.pathname === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${BASE_URL}/</loc></url></urlset>`); }
    if (req.method === 'POST' && url.pathname === '/submit') return handleSubmit(req, res);
    if (url.pathname === '/api/moderate') return handleModerate(req, res, url);
    if (url.pathname !== '/') { res.writeHead(302, { location: '/' }); return res.end(); }
    const domain = url.searchParams.get('domain');
    const topReq = url.searchParams.get('top');
    const activeCat = LB_CATS.includes(topReq) ? topReq : 'Overall';
    const [rows, card, subs] = await Promise.all([
      leaderboard(activeCat).catch(() => []),
      domain ? insights(domain).then(insightsCard).catch(() => insightsCard({ domain: '', error: 'lookup failed' })) : Promise.resolve(''),
      readSubmissions().catch(() => []),
    ]);
    const hero = heroBox(rows, activeCat);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': domain ? 'no-store' : 'public, max-age=300' });
    res.end(page(domain ? `${normDomain(domain) || 'Insights'} — SoapBox Directory` : 'SoapBox Directory — site rankings & crypto resources', homeBody('', hero, card, communitySection(subs))));
  } catch (e) { res.writeHead(500); res.end('error: ' + e.message); }
}).listen(PORT, HOST, () => console.log(`SoapBox Directory on ${BASE_URL} (bound ${HOST}:${PORT})`));
