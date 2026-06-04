// server.mjs — Directory.SoapBox.Community. The crypto/markets resource directory as its own subdomain
// (operator 2026-06-02), with a "submit your URL for us to crawl" box. Same slim-sticky-bar pattern as
// Data/Search (◈ SoapBox directory + links to Data + Search), but no big category nav. Submissions are
// SSRF-checked, best-effort crawled for a title, and queued to a moderation file — never auto-published.
//
//   PORT=8094 BASE_URL=https://directory.soapbox.community node site/directory/server.mjs

import { createServer } from 'node:http';
import { DIRECTORY } from '../soapbox/directory.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { insights, normDomain, trancoRank } from '../../integrations/soapbox/domain-insights.mjs';
import { SubmissionStore, curatedEligibility, safeUrl, CURATED_MAX_RANK, CURATED_MIN_AGE_YEARS } from '../../integrations/soapbox/submissions.mjs';
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
// Only the operator (who knows the token) can approve/reject/promote a community submission.
// DIRECTORY_TOKEN is preferred; STATS_TOKEN is accepted as a fallback so the operator can reuse one
// secret across sites. Never hard-coded — if unset, the moderation surface 404s (doesn't exist).
const DIR_TOKEN = process.env.DIRECTORY_TOKEN || process.env.STATS_TOKEN || '';

// The persistent submission queue + trust-tier model (#138/#139) — see integrations/soapbox/submissions.mjs.
const store = new SubmissionStore(SUBMISSIONS);

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

// ── Community submissions + trust tiers (#138/#139) ──────────────────────────
// The curated DIRECTORY above is hand-picked by the editor. The community layer is everything the public
// POSTed to /submit. The store (integrations/soapbox/submissions.mjs) is the single source of truth — a
// persistent append-only JSONL — and this server only RENDERS from it. Trust ladder:
//   submitted ─approve▶ community ─promote(Tranco rank + RDAP age + approved)▶ curated   (reject ▶ hidden)
// Approval/rejection/promotion is MANUAL via the token-gated /moderate admin view; nothing auto-publishes.

// Per-tier trust badge surfaced on each community listing (#139).
const TIER_BADGE = {
  curated: '<span class="bdg us-full" title="Promoted to curated — ranked, aged, and approved">★ curated</span>',
  community: '<span class="bdg us-partial" title="Community-submitted, moderator-approved">✓ community</span>',
  submitted: '<span class="bdg us-unknown" title="Awaiting review">⏳ submitted</span>',
  rejected: '<span class="bdg us-no" title="Rejected">✗ rejected</span>',
};
const tierBadge = (s) => TIER_BADGE[s.tier === 'curated' ? 'curated' : (s.status === 'rejected' ? 'rejected' : s.tier)] || TIER_BADGE.submitted;

const subName = (s) => (s.name || '').trim() || (s.crawl_title || '').trim() || s.url.replace(/^https?:\/\//, '');

// One community/curated listing row.
function subRow(s) {
  const title = (s.crawl_title || '').trim();
  const trust = s.trust > 0 ? ` <span class=b title="trust earned">· trust ${s.trust}</span>` : '';
  return `<div class=lrow>
    <span class=ln><a href="${esc(s.url)}" rel="noopener nofollow" target=_blank>${esc(subName(s))}</a></span>
    ${tierBadge(s)}
    <span class=ld>${esc(title || s.url)}${trust}</span></div>`;
}

// The community section: curated-promoted submissions FIRST (visually flagged), then plain community
// ones — always BELOW the editor-curated directory in homeBody (operator: curated stays on top). `subs`
// is store.visible() (community + curated tiers; rejected + still-submitted are excluded from the public view).
function communitySection(subs) {
  const curated = subs.filter((s) => s.tier === 'curated');
  const community = subs.filter((s) => s.tier === 'community');
  const shown = curated.length + community.length;
  let body = '';
  if (curated.length) body += `<div class=rcsub>Promoted to curated · ${curated.length}</div>` + curated.map(subRow).join('');
  if (community.length) body += `<div class=rcsub>Community · ${community.length}</div>` + community.map(subRow).join('');
  if (!shown) body = '<p class=muted>No community submissions yet — be the first to submit a site above.</p>';
  return `<details class=rcg id=community${shown ? ' open' : ''}>
    <summary>🌱 Community submissions<span class=ct>${shown} entries</span></summary>
    <div class=rcg-body>
      <p class=muted style="margin-top:4px">Sites the community submitted, kept <b>below and separate from</b> the editor-curated directory above.
      <b>Approval is manual</b> — a human reviews every submission before it shows here; nothing is auto-published.
      A submission starts <i>submitted</i>, becomes <i>community</i> once approved, and can be promoted to <i>curated</i>
      once it independently checks out (a real popularity rank, a domain at least ${CURATED_MIN_AGE_YEARS}y old, and an approved flag).
      The badge on each row shows its tier. Outbound links open in a new tab; do your own research.</p>
      ${body}
    </div></details>`;
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// ── Moderation admin view (#138/#139) ─────────────────────────────────────────
// GET  /moderate?token=…              → HTML review queue (pending) + already-decided lists.
// POST /moderate  {token,key,action}  → approve | reject | promote | demote, then redirect back.
// Token-gated (STATS_TOKEN-style): a missing/wrong token 404s so the surface's existence isn't revealed.
// `promote` is criteria-checked server-side (Tranco rank + RDAP age + approved flag) before it's allowed.
function modAuthed(token) { return !!DIR_TOKEN && token === DIR_TOKEN; }

const modPage = (body) => page('Moderation — SoapBox Directory', `<h1>Submission review</h1>
  <p class=muted>Token-gated moderation queue. Approve a submission to publish it to the Community tier; promote to Curated once it meets the criteria
  (Tranco rank ≤ ${CURATED_MAX_RANK.toLocaleString()}, domain age ≥ ${CURATED_MIN_AGE_YEARS}y, approved). Reject to hide.</p>${body}`);

// Render one moderation row with action buttons. Curated-eligibility is shown so the moderator knows
// whether "Promote" will be accepted.
function modRow(s, token, elig) {
  const act = (action, label, style = '') => `<form method=post action="/moderate" style="display:inline">
    <input type=hidden name=token value="${esc(token)}"><input type=hidden name=key value="${esc(s.dedupe || s.url)}">
    <input type=hidden name=action value="${action}">
    <button type=submit style="padding:5px 12px;font-size:13px;${style}">${label}</button></form>`;
  const meta = [];
  if (s.category) meta.push(esc(s.category));
  if (s.crawl_status) meta.push(`HTTP ${s.crawl_status}`);
  if (s.note) meta.push(esc(s.note));
  let eligLine = '';
  if (elig) {
    const r = elig.reasons;
    eligLine = `<div class=b style="margin-top:4px">curated check: rank ${r.rank ? '✓' : '✗'}${elig.rank != null ? ` (#${elig.rank.toLocaleString()})` : ''} ·
      age ${r.age ? '✓' : '✗'}${elig.ageYears != null ? ` (${elig.ageYears}y)` : ''} · approved ${r.approved ? '✓' : '✗'} →
      <b style="color:${elig.eligible ? 'var(--up)' : 'var(--mut)'}">${elig.eligible ? 'eligible to promote' : 'not yet eligible'}</b></div>`;
  }
  return `<div class=lrow style="align-items:flex-start">
    <span class=ln style="min-width:200px"><a href="${esc(s.url)}" rel="noopener nofollow" target=_blank>${esc(subName(s))}</a> ${tierBadge(s)}</span>
    <span class=ld>${esc(s.crawl_title || s.url)}${meta.length ? `<br><span class=b>${meta.join(' · ')}</span>` : ''}${eligLine}</span>
    <span style="display:flex;gap:6px;flex-wrap:wrap">
      ${s.status === 'submitted' ? act('approve', 'Approve', 'background:var(--up);color:#06101f') : ''}
      ${s.status !== 'rejected' && s.tier !== 'curated' ? act('promote', 'Promote', 'background:var(--gold);color:#06101f') : ''}
      ${s.tier === 'curated' ? act('demote', 'Demote') : ''}
      ${s.status !== 'rejected' ? act('reject', 'Reject', 'background:#f85149;color:#fff') : ''}
    </span></div>`;
}

async function handleModerateGet(req, res, url) {
  const token = url.searchParams.get('token') || '';
  if (!modAuthed(token)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404'); }
  const all = await store.all();
  const pending = all.filter((s) => s.status === 'submitted');
  const community = all.filter((s) => s.status === 'community');
  const rejected = all.filter((s) => s.status === 'rejected');
  // resolve curated-eligibility for pending + community rows (best-effort, in parallel, capped)
  const checkable = [...pending, ...community];
  const eligBy = new Map();
  await Promise.all(checkable.map(async (s) => { try { eligBy.set(s.dedupe || s.url, await curatedEligibility(s, insights)); } catch { /* skip */ } }));
  const section = (label, rows) => `<div class=card><h2>${esc(label)} <span class=muted>(${rows.length})</span></h2>${rows.length ? rows.map((s) => modRow(s, token, eligBy.get(s.dedupe || s.url))).join('') : '<p class=muted>none</p>'}</div>`;
  const msg = url.searchParams.get('msg');
  const banner = msg ? `<div class=ok>${esc(msg)}</div>` : '';
  return send(res, modPage(`${banner}${section('Pending review', pending)}${section('Community (approved)', community)}${section('Rejected', rejected)}`));
}

async function handleModeratePost(req, res) {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 8000) break; }
  const f = new URLSearchParams(raw);
  const token = f.get('token') || '';
  if (!modAuthed(token)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404'); }
  const key = (f.get('key') || '').trim();
  const action = (f.get('action') || '').trim();
  if (!key || !['approve', 'reject', 'promote', 'demote'].includes(action)) {
    res.writeHead(302, { location: `/moderate?token=${encodeURIComponent(token)}&msg=${encodeURIComponent('bad request')}` }); return res.end();
  }
  let msg;
  if (action === 'promote') {
    // gate promotion on the live criteria (#139): rank + age + approved must all hold
    const entry = await store.find(key);
    if (!entry) msg = 'submission not found';
    else {
      const elig = await curatedEligibility(entry, insights);
      if (!elig.eligible) {
        const r = elig.reasons;
        msg = `not promoted — criteria not met (rank ${r.rank ? 'ok' : 'fail'}, age ${r.age ? 'ok' : 'fail'}, approved ${r.approved ? 'ok' : 'fail'})`;
      } else {
        const out = await store.moderate(key, 'promote', { by: 'operator' });
        msg = out.ok ? `promoted ${entry.url} to curated` : `promote failed: ${out.error}`;
      }
    }
  } else {
    const out = await store.moderate(key, action, { by: 'operator' });
    msg = out.ok ? `${action}d ${out.record.url}` : `${action} failed: ${out.error}`;
  }
  res.writeHead(302, { location: `/moderate?token=${encodeURIComponent(token)}&msg=${encodeURIComponent(msg)}` });
  return res.end();
}

// JSON moderation API (back-compat + scripting): /api/moderate?token=…&key=…&action=approve|reject|promote|demote.
// Same token gate + same promote criteria check as the HTML view.
async function handleModerateApi(req, res, url) {
  const token = url.searchParams.get('token') || '';
  if (!modAuthed(token)) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('404'); }
  const key = (url.searchParams.get('key') || url.searchParams.get('url') || '').trim();
  const action = (url.searchParams.get('action') || '').trim();
  if (!key) return sendJson(res, 400, { ok: false, error: 'key (or url) required' });
  if (!['approve', 'reject', 'promote', 'demote'].includes(action)) return sendJson(res, 400, { ok: false, error: 'action must be approve|reject|promote|demote' });
  if (action === 'promote') {
    const entry = await store.find(key);
    if (!entry) return sendJson(res, 404, { ok: false, error: 'not found' });
    const elig = await curatedEligibility(entry, insights);
    if (!elig.eligible) return sendJson(res, 409, { ok: false, error: 'criteria not met', eligibility: elig });
  }
  const out = await store.moderate(key, action, { by: 'api' });
  if (!out.ok) return sendJson(res, out.error === 'not_found' ? 404 : 500, out);
  return sendJson(res, 200, { ok: true, url: out.record.url, status: out.record.status, tier: out.record.tier, trust: out.record.trust });
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

// SSRF guard (safeUrl) + dedupe + tier model all live in integrations/soapbox/submissions.mjs.

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
  // validate first so we don't waste a crawl on garbage
  const safe = safeUrl(f.get('url'));
  if (!safe) {
    const subs = await store.visible().catch(() => []);
    return send(res, page('Submit — SoapBox Directory', homeBody('<div class=ok style="border-color:var(--gold)">Please enter a valid public http(s) URL.</div>', hero, '', communitySection(subs))), 400);
  }
  const crawl = await crawlTitle(safe);
  const result = await store.submit({
    url: safe, name: f.get('name'), category: f.get('category'), note: f.get('note'),
    crawl_status: crawl.status, crawl_title: crawl.title,
  });
  const subs = await store.visible().catch(() => []);
  let msg;
  if (result.duplicate) {
    msg = `<div class=ok style="border-color:var(--gold)">Already in the queue — <b>${esc(safe)}</b> was submitted before, so we won't add it twice.</div>`;
  } else if (!result.ok) {
    const why = result.error === 'too_large' ? 'that submission is too large' : 'we couldn’t accept that submission';
    msg = `<div class=ok style="border-color:var(--gold)">Sorry, ${why}. Please try again with a shorter note.</div>`;
  } else {
    msg = `<div class=ok>✓ Thanks — <b>${esc(safe)}</b> is queued for review${crawl.title ? ` (we found: “${esc(crawl.title)}”)` : ''}. A human reviews + checks submissions before they appear in the Community tier.</div>`;
  }
  return send(res, page(result.ok ? 'Submitted — SoapBox Directory' : 'Submit — SoapBox Directory', homeBody(msg, hero, '', communitySection(subs))));
}

function send(res, html, code = 200) { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); }

export const handler = async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (url.pathname === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, [{ path: '/', lastmod: today, changefreq: 'daily', priority: '1.0' }]));
    }
    if (url.pathname === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
    }
    if (url.pathname === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: 'SoapBox Directory', baseUrl: BASE_URL,
        summary: 'A curated, ranked directory of crypto + data resources with a Clarity transparency rating.',
        links: [{ label: 'Directory home & rankings', path: '/' }],
      }));
    }
    if (req.method === 'POST' && url.pathname === '/submit') return handleSubmit(req, res);
    if (url.pathname === '/moderate') return req.method === 'POST' ? handleModeratePost(req, res) : handleModerateGet(req, res, url);
    if (url.pathname === '/api/moderate') return handleModerateApi(req, res, url);
    if (url.pathname !== '/') { res.writeHead(302, { location: '/' }); return res.end(); }
    const domain = url.searchParams.get('domain');
    const topReq = url.searchParams.get('top');
    const activeCat = LB_CATS.includes(topReq) ? topReq : 'Overall';
    const [rows, card, subs] = await Promise.all([
      leaderboard(activeCat).catch(() => []),
      domain ? insights(domain).then(insightsCard).catch(() => insightsCard({ domain: '', error: 'lookup failed' })) : Promise.resolve(''),
      store.visible().catch(() => []),
    ]);
    const hero = heroBox(rows, activeCat);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': domain ? 'no-store' : 'public, max-age=300' });
    res.end(page(domain ? `${normDomain(domain) || 'Insights'} — SoapBox Directory` : 'SoapBox Directory — site rankings & crypto resources', homeBody('', hero, card, communitySection(subs))));
  } catch (e) { res.writeHead(500); res.end('error: ' + e.message); }
};

// CLI guard: bind a socket only when run directly, not when imported by a unit test.
if (import.meta.url === `file://${process.argv[1]}`) {
  createServer(handler).listen(PORT, HOST, () => console.log(`SoapBox Directory on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
