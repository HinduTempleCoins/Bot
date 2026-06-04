// server.mjs — Hemp.SoapBox.Community. The hemp/cannabis vertical as a standalone, zero-dependency HTTP
// service in the SoapBox house style (mirrors site/law/server.mjs). It fronts the keyless cannabis
// module (integrations/soapbox/cannabis.mjs) and binds its readers into ONE cross-linked surface:
//   - the hemp-vs-marijuana explainer grounded in US statute (7 U.S.C. § 1639o / 21 U.S.C. § 802),
//   - the reform-organizations + cannabis/entheogen churches registry (facts + links, right-of-reply),
//   - a retail FLOWER price index (our own derived median, provenance-tagged), and
//   - a SEED / strain price index + SeedFinder-style lineage link-outs.
//
//   PORT=8101 BASE_URL=https://hemp.soapbox.community node site/hemp/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            portal home — section cards + a THC classifier box ("is 0.25% THC hemp?")
//   /law         hemp-vs-marijuana explainer (US statute) + classifyByThc + legalStatus(state)
//   /orgs        reform organizations + cannabis/entheogen churches registry (facts + links)
//   /flower      retail flower price index (derived median, provenance-tagged)
//   /seeds       seed-bank price index + SeedFinder-style strain/lineage lookup
//   /health      liveness probe
//   /robots.txt /sitemap.xml
//
// ── DISCIPLINE (inherited from the readers + Law.SoapBox) ─────────────────────────────────────────
//   FACTS, NOT VERDICTS. We state the statutory line and cite it; we never give legal advice, and we
//   pass NO judgment on any organization's or church's legitimacy. Prices are OUR OWN derived median
//   index over aggregated listings, provenance-tagged, never a single vendor's number echoed as truth.
//   Right of reply: corrections route to the entity's own contact path. Soft-fail: every route renders
//   even when a price source / web scour returns nothing — the page never breaks or throws. esc() on
//   every interpolated value. Educational only — not legal advice.

import { createServer } from 'node:http';

import * as cannabis from '../../integrations/soapbox/cannabis.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';

const PORT = +(process.env.PORT || 8101);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const LAW = process.env.LAW_SITE || 'https://law.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';

// ── shared house-style helpers (same dark theme as Law/Stocks/Search) ─────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const q = (s) => encodeURIComponent(String(s == null ? '' : s));
const num = (n) => (n == null || !Number.isFinite(+n) ? '—' : (+n).toLocaleString(undefined, { maximumFractionDigits: 2 }));

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:920px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)} .up{color:var(--up)} .down{color:var(--down)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  form.hsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q,select.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px}
  input.q{flex:1 1 220px;min-width:160px;max-width:420px} input.q:focus,select.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .rec{padding:12px 0;border-bottom:1px solid var(--line)} .rec:last-child{border-bottom:0}
  .rec .nm{font-weight:600;font-size:15px} .rec .meta{color:var(--mut);font-size:13px;margin-top:2px}
  .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 7px;margin-left:6px}
  .badge.hemp{background:#3fb95033;color:var(--up)} .badge.mj{background:#f8514933;color:var(--down)} .badge.ch{background:#d2992233;color:var(--gold)}
  table{width:100%;border-collapse:collapse} td,th{padding:7px 8px;border-bottom:1px solid var(--line);text-align:left;font-size:14px}
  code{background:#0b0f14;border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:12px}
  .empty{color:var(--mut);padding:14px 0}
  .idx{display:flex;gap:18px;flex-wrap:wrap;margin:10px 0}
  .idx .v{font-size:22px;font-weight:800} .idx .l{color:var(--mut);font-size:12px}
  blockquote{border-left:3px solid var(--line2);margin:8px 0;padding:2px 0 2px 12px;color:var(--mut);font-size:13px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// Facts-not-verdicts footer — on EVERY page. Names the educational-not-advice posture, the derived-index
// provenance, and the right-of-reply path.
const FOOTER = `<footer>
  <b>Facts, not verdicts.</b> Hemp.SoapBox states the public statutory record — the federal hemp/marijuana
  line and its citations — and never a legal-advice judgment. We pass <b>no judgment</b> on any
  organization's or church's legitimacy; entries are descriptive, with a <b>right of reply</b> routed to the
  entity's own contact. Price figures are <b>our own derived median index</b> over aggregated listings,
  provenance-tagged — never a single vendor's number presented as truth. Educational only —
  <b>not legal advice</b>; for advice, consult a licensed attorney, and verify current law with the
  official sources linked on each page.
  <div style="margin-top:8px"><a href="/">Hemp</a> · <a href="${esc(LAW)}">Law</a> · <a href="${esc(DATA)}">Data</a> · <a href="${esc(SEARCH)}">Search</a> · <a href="${esc(WIKI)}">Library</a></div>
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'Hemp.SoapBox — the US hemp/marijuana legal line, cannabis reform organizations and churches, and our own derived flower & seed price indexes. Facts, not verdicts. Educational, not legal advice.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=robots content="${esc(robots)}">
<link rel=canonical href="${esc(canonical)}">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">🌿 SoapBox <span>hemp</span></a>
  <div class=topbar-r><a href="/law">US Law</a><a href="/orgs">Reform &amp; Churches</a><a href="/flower">Flower Prices</a><a href="/seeds">Seeds &amp; Strains</a><a href="${esc(LAW)}">Law</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

function searchForm(action, { value = '', placeholder = 'Search…', label = 'Search', extra = '', name = 'q' } = {}) {
  return `<form class=hsearch method=get action="${esc(action)}"><div class=row>
    <input class=q name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete=off aria-label="${esc(label)}">
    ${extra}<button type=submit>${esc(label)}</button>
  </div></form>`;
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const sections = [
    ['/law', 'US Law: hemp vs marijuana', 'The federal 0.3% delta-9 THC line (7 U.S.C. § 1639o), the CSA, the Schedule III reschedule, and how state law varies.'],
    ['/orgs', 'Reform &amp; Churches', 'Cannabis reform organizations (NORML, MPP, DPA, SSDP…) and cannabis/entheogen churches — facts and links, right of reply.'],
    ['/flower', 'Flower Price Index', 'Our own derived median retail flower price index — provenance-tagged, computed from aggregated listings.'],
    ['/seeds', 'Seeds &amp; Strains', 'A seed-bank price index plus SeedFinder-style strain / lineage / breeder lookup link-outs.'],
  ];
  const body = `<h1>SoapBox Hemp <span class=muted style="font-size:14px">· the cannabis public record</span></h1>
    <p class=muted>Where the law actually draws the line, who works on reform, and what flower and seeds really cost —
      keyless, source-linked, and honest about what we don't know. Start with the THC line:</p>
    ${searchForm('/law', {
      placeholder: 'Delta-9 THC % to classify, e.g. 0.25', label: 'Classify', name: 'thc',
      extra: '<input class=q name=state placeholder="State (optional)" aria-label="State" style="flex:0 0 150px;max-width:150px">',
    })}
    <p class=muted style="font-size:13px;margin-top:-6px">Enter a delta-9 THC percentage to see whether it's hemp or marijuana under federal law.</p>
    <div class=grid style="margin-top:18px">
      ${sections.map(([href, t, d]) => `<a class=sec href="${esc(href)}"><div class=t>${t}</div><div class=d>${d}</div></a>`).join('')}
    </div>
    <div class=card style="margin-top:18px"><h2>The line, in one sentence</h2>
      <p class=muted style="font-size:14px">Federally, <b>hemp</b> is Cannabis sativa L. with <b>≤0.3% delta-9 THC on a dry-weight basis</b>
      (<code>7 U.S.C. § 1639o</code>); above that line it is <b>marihuana</b>, a Schedule I controlled substance
      (<code>21 U.S.C. § 802</code>). A Schedule III reschedule is proposed but not final, and state law varies widely.
      We cite the statute and link the official sources — we never give legal advice.</p></div>`;
  return page('SoapBox Hemp — US cannabis law, reform, and price indexes', body, { canonical: `${BASE_URL}/` });
}

// ── /law — hemp-vs-marijuana classifier + explainer ──────────────────────────────────────────────
export function lawView(thc, state) {
  const thcRaw = String(thc == null ? '' : thc).trim();
  const st = String(state == null ? '' : state).trim();
  const extra = `<input class=q name=state value="${esc(st)}" placeholder="State (optional)" aria-label="State" style="flex:0 0 150px;max-width:150px">`;
  const form = searchForm('/law', { value: thcRaw, placeholder: 'Delta-9 THC %, e.g. 0.25', label: 'Classify', name: 'thc', extra });

  let result = '';
  if (thcRaw) {
    const r = cannabis.classifyByThc(Number(thcRaw));
    if (!r) {
      result = `<div class=card><p class=empty>“${esc(thcRaw)}” isn't a valid delta-9 THC percentage. Enter a number, e.g. <code>0.25</code> or <code>18</code>.</p></div>`;
    } else {
      const cls = r.classification === 'hemp' ? 'hemp' : 'mj';
      result = `<div class=card><h2>Classification</h2>
        <p>At <b>${esc(num(r.delta9Pct))}%</b> delta-9 THC (limit ${esc(num(r.limitPct))}%, dry-weight basis):
          <span class="badge ${cls}">${esc(r.classification.toUpperCase())}</span></p>
        <blockquote>${esc(r.note)}</blockquote>
        <p class=muted style="font-size:13px">Cites <a href="${esc(r.citation.hempUrl)}">${esc(r.citation.hemp)}</a> (hemp) ·
          <a href="${esc(r.citation.csaUrl)}">${esc(r.citation.csa)}</a> (CSA).</p></div>`;
    }
  }

  // legalStatus block (federal line + state-varies note + official sources).
  const ls = cannabis.legalStatus(st);
  const statusCard = `<div class=card><h2>Legal status${st ? ` — ${esc(st)}` : ''}</h2>
    <p>${esc(ls.federal.line)}</p>
    <blockquote>${esc(ls.stateNote)}</blockquote>
    <h3 style="margin-top:12px">Official sources (we link, never fabricate per-state specifics)</h3>
    ${ls.sources.map(([nm, url, dsc]) => `<div class=rec><div class=nm><a href="${esc(url)}">${esc(nm)}</a></div><div class=meta>${esc(dsc)}</div></div>`).join('')}
    <p class=muted style="font-size:12px;margin-top:8px">${esc(ls.disclaimer)}</p></div>`;

  // the nuances, as encoded data.
  const notesCard = `<div class=card><h2>Nuances that trip people up</h2>
    ${cannabis.LAW_NOTES.map(([t, body, url]) => `<div class=rec><div class=nm>${esc(t)}</div><div class=meta>${esc(body)}</div>${url ? `<div style="font-size:13px;margin-top:3px"><a href="${esc(url)}">source →</a></div>` : ''}</div>`).join('')}</div>`;

  return `<h1>US Law: hemp vs marijuana</h1>
    <p class=muted>Enter a delta-9 THC percentage to classify cannabis material under the federal line
      (≤0.3% dry-weight = hemp, ${cannabis.STATUTES.hempDefinition[0]}). Optionally add a state for the legal-status note.
      Facts and citations only — never legal advice.</p>
    ${form}${result}${statusCard}${notesCard}`;
}

// ── /orgs — reform organizations + churches ──────────────────────────────────────────────────────
function orgRow(o) {
  const badge = o.type === 'church' ? '<span class="badge ch">church</span>' : '<span class=badge>reform org</span>';
  return `<div class=rec>
    <div class=nm><a href="${esc(o.url)}">${esc(o.name)}</a>${badge}</div>
    <div class=meta>${esc(o.focus)}</div>
    ${o.note ? `<blockquote>${esc(o.note)}</blockquote>` : ''}
    <div class=meta style="font-size:12px">Right of reply: <a href="${esc(o.rightOfReply)}">${esc(o.rightOfReply)}</a></div>
  </div>`;
}

export function orgsView() {
  const orgs = cannabis.organizations('reform-org');
  const churches = cannabis.organizations('church');
  return `<h1>Reform organizations &amp; churches</h1>
    <p class=muted>Cannabis-law reform organizations and cannabis/entheogen churches. <b>Facts and links only</b> — we pass
      no judgment on any entity's legitimacy. Every entry carries a right-of-reply path so the entity can correct its own record.</p>
    <div class=card><h2>Reform &amp; advocacy organizations</h2>${orgs.map(orgRow).join('')}</div>
    <div class=card><h2>Cannabis / entheogen churches</h2>
      <p class=muted style="font-size:13px">Listed descriptively. Whether a given church's sacramental-use claim is lawful is
        jurisdiction-dependent and has been litigated — that is a legal question, not a verdict we render.</p>
      ${churches.map(orgRow).join('')}</div>`;
}

// ── price-index rendering ─────────────────────────────────────────────────────────────────────────
// A single derived-index card (Q1 / median / Q3 + provenance). `subtitle` carries the legal basis label.
function singleIndexCard(title, subtitle, idx, unit) {
  if (!idx || idx.value == null || idx.value.median == null) {
    return `<div class=card><h3>${esc(title)}</h3>
      ${subtitle ? `<p class=muted style="font-size:12px;margin-top:-4px">${esc(subtitle)}</p>` : ''}
      <p class=empty>No listings fall on this side of the 0.3% delta-9 line in what we currently aggregate — nothing to derive,
        and we never fabricate a price.</p></div>`;
  }
  const v = idx.value;
  return `<div class=card><h3>${esc(title)}</h3>
    ${subtitle ? `<p class=muted style="font-size:12px;margin-top:-4px">${esc(subtitle)}</p>` : ''}
    <div class=idx>
      <div><div class=v>$${esc(num(v.low))}</div><div class=l>low (Q1)</div></div>
      <div><div class=v style="color:var(--gold)">$${esc(num(v.median))}</div><div class=l>median ${esc(unit)}</div></div>
      <div><div class=v>$${esc(num(v.high))}</div><div class=l>high (Q3)</div></div>
      <div><div class=v>${esc(v.n)}</div><div class=l>listings</div></div>
    </div>
    <p class=muted style="font-size:13px">Our own derived median index (Q1/median/Q3) over aggregated listings ·
      confidence ${esc(num(idx.confidence))} · sources: ${esc(idx.source || '—')} · as of ${esc(idx.fetched_at)}.</p></div>`;
}

// Render the hemp/marijuana split as TWO SEPARATE cards, each labeled with its legal basis. `split` is
// the { hemp, marijuana, unknown, basis } shape from cannabis.flowerPrices/seedPrices. When nothing
// aggregates at all, the empty state EXPLAINS the hemp/marijuana split rather than just "not configured".
function splitIndexCards(split, unit, sourceNames) {
  const srcLabel = sourceNames && sourceNames.length ? sourceNames.map(esc).join(', ') : 'sample listings (no live keyless price feed)';
  const hempEmpty = !split || !split.hemp || split.hemp.value == null;
  const mjEmpty = !split || !split.marijuana || split.marijuana.value == null;
  if (hempEmpty && mjEmpty) {
    return `<div class=card><h2>Price index — split by US law</h2>
      <p class=empty>We split cannabis prices on the federal <b>0.3% delta-9 THC line</b> (7 U.S.C. § 1639o):
        at or under it is <b>hemp</b>; above it is <b>marijuana</b> (Schedule I, 21 U.S.C. § 802(16)). These are
        legally distinct goods, so we never publish a single lumped median. No THC-tagged listings are aggregated
        here yet — when a listing source is wired in, this renders two separate derived indexes, one per side of
        the line.</p></div>`;
  }
  return `<p class=muted style="font-size:13px">Derived index — sources: ${srcLabel}. Split on the US-law
      <b>0.3% delta-9 THC line</b> (7 U.S.C. § 1639o): hemp and marijuana are legally distinct goods, shown as two
      separate indexes — never one lumped median.</p>
    ${singleIndexCard('Hemp', 'Hemp — ≤0.3% delta-9 THC, 7 U.S.C. § 1639o', split && split.hemp, unit)}
    ${singleIndexCard('Marijuana', 'Marijuana — >0.3% delta-9, Schedule I (21 U.S.C. § 802(16))', split && split.marijuana, unit)}`;
}

// ── /flower — retail flower price index ──────────────────────────────────────────────────────────
// Sources are injectable at the module level (cannabis.flowerPrices({ sources })). There is no live
// keyless cannabis price API, so by default we aggregate the module's clearly-labeled SAMPLE listings
// (THC-tagged) so the hemp/marijuana split is demonstrable; tests inject canned sources via the arg.
export async function flowerView(sources) {
  const src = sources || { 'sample listings': () => cannabis.SAMPLE_FLOWER_LISTINGS };
  const names = Object.keys(sources || {});
  const idx = await cannabis.flowerPrices({ sources: src }).catch(() => null);
  return `<h1>Flower price index</h1>
    <p class=muted>Our own derived median retail flower price index — computed from aggregated listing prices, provenance-tagged,
      and <b>split by US law</b> into hemp (≤0.3% delta-9) and marijuana (>0.3%). We publish the spread (Q1 / median / Q3)
      and the listing count per side so you can judge it, and we never echo a single vendor's number.</p>
    ${splitIndexCards(idx && idx.split, 'per gram', names)}`;
}

// ── /seeds — seed price index + strain lookup ────────────────────────────────────────────────────
export async function seedsView(strain, sources) {
  const term = String(strain == null ? '' : strain).trim();
  const form = searchForm('/seeds', { value: term, placeholder: 'Strain name, e.g. Northern Lights…', label: 'Look up strain', name: 'strain' });
  const src = sources || { 'sample listings': () => cannabis.SAMPLE_SEED_LISTINGS };
  const names = Object.keys(sources || {});
  const idx = await cannabis.seedPrices({ sources: src }).catch(() => null);

  let strainCard = '';
  if (term) {
    const r = await cannabis.strainLookup(term).catch(() => null);
    if (r && r.links.length) {
      strainCard = `<div class=card><h2>Strain lookup — “${esc(r.query)}”</h2>
        <p class=muted style="font-size:13px">SeedFinder-style lineage/breeder lookups. We link the authoritative databases —
          we don't fabricate parentage. Lineage on record here: ${r.lineage ? esc(r.lineage) : '—'}.</p>
        ${r.links.map((l) => `<div class=rec><div class=nm><a href="${esc(l.url)}">${esc(l.source)} →</a></div></div>`).join('')}</div>`;
    } else {
      strainCard = `<div class=card><h2>Strain lookup — “${esc(term)}”</h2><p class=empty>No lookup links available.</p></div>`;
    }
  }

  // The genetics/lineage source directory (link-outs).
  const dirCard = `<div class=card><h2>Strain genetics &amp; seed-bank sources</h2>
    ${Object.entries(cannabis.STRAIN_SOURCES).map(([cat, rows]) => `<h3 style="margin-top:10px">${esc(cat)}</h3>`
      + rows.map(([nm, url, dsc]) => `<div class=rec><div class=nm><a href="${esc(url)}">${esc(nm)}</a></div><div class=meta>${esc(dsc)}</div></div>`).join('')).join('')}</div>`;

  return `<h1>Seeds &amp; strains</h1>
    <p class=muted>Our own derived median seed-pack price index — <b>split by US law</b> into hemp (≤0.3% delta-9) and
      marijuana (>0.3%) — plus a SeedFinder-style strain / lineage / breeder lookup. Same discipline as the flower index:
      a derived median over aggregated listings, never a fabricated number.</p>
    ${splitIndexCards(idx && idx.split, 'per pack', names)}
    ${form}${strainCard}${dirCard}`;
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

const SITEMAP_PATHS = ['/', '/law', '/orgs', '/flower', '/seeds'];

// The request handler — exported so offline tests drive routes through a mock req/res (no port bound).
export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({
        path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.7',
      }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: 'SoapBox Hemp', baseUrl: BASE_URL,
        summary: 'US cannabis law (hemp vs marijuana), reform organizations, and honest flower & seed price indexes.',
        links: [
          { label: 'US law: hemp vs marijuana', path: '/law' },
          { label: 'Reform organizations & churches', path: '/orgs' },
          { label: 'Flower price index', path: '/flower' },
          { label: 'Seeds & strains', path: '/seeds' },
        ],
      }));
    }

    const sp = url.searchParams;
    if (path === '/') return sendHtml(res, homePage());

    if (path === '/law') {
      return sendHtml(res, page('US Law: hemp vs marijuana — SoapBox Hemp', lawView(sp.get('thc') || '', sp.get('state') || ''),
        { canonical: `${BASE_URL}/law`, robots: (sp.get('thc') || sp.get('state')) ? 'noindex,follow' : 'index,follow' }));
    }
    if (path === '/orgs') {
      return sendHtml(res, page('Reform organizations & churches — SoapBox Hemp', orgsView(), { canonical: `${BASE_URL}/orgs` }));
    }
    if (path === '/flower') {
      return sendHtml(res, page('Flower price index — SoapBox Hemp', await flowerView(), { canonical: `${BASE_URL}/flower` }));
    }
    if (path === '/seeds') {
      return sendHtml(res, page('Seeds & strains — SoapBox Hemp', await seedsView(sp.get('strain') || ''),
        { canonical: `${BASE_URL}/seeds`, robots: sp.get('strain') ? 'noindex,follow' : 'index,follow' }));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly (`node site/hemp/server.mjs`), not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/hemp\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Hemp on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
