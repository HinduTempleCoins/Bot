// server.mjs — SoapBox.community, the legible "everything" hub. The apex domain rendered as a
// championship-style BRACKET / tree of the whole ecosystem: root "SoapBox" → top branches = the live
// public subdomains (Data, Search, Law, Politics, Hemp, Stocks, Wiki, Directory) → sub-branches = the
// key sections/verticals under each. A "super cluttered Google page" — dense, links to ALL our stuff —
// but LEGIBLE, so a person can parse the whole organism at a glance, the way March Madness brackets
// make a 64-team field instantly readable.
//
//   PORT=8300 BASE_URL=https://soapbox.community node site/hub/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the bracket — root → public sites → sub-branches; plus the "organism" tier (chains,
//                bots, tokens) drawn honestly from the ecosystem-map ESTATE.
//   /health      liveness probe
//   /robots.txt  index (via crawlers.mjs) /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   HONESTY. Only things actually LIVE are marked live and linked to their subdomain; built-but-not-yet-
//   live verticals render MUTED ("coming"), never as a working link. Admin (soapy.blog) NEVER appears —
//   it is not in PUBLIC_SITES, not in the bracket, not in the footer, not in the sitemap. Pure HTML/CSS
//   tree (nested <ul>) — no JS framework. esc() on every interpolated value. Every route soft-fails to a
//   render rather than throwing. This is the member-facing render of the same catalog the admin HUD shows.

import { createServer } from 'node:http';

import { PUBLIC_SITES, robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { ESTATE } from '../../integrations/ecosystem-map.mjs';

const PORT = +(process.env.PORT || 8300);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://soapbox.community').replace(/\/$/, '');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ── the bracket model ──────────────────────────────────────────────────────────────────────────────
// Which public subdomains are actually LIVE today. Honesty rule: only these are rendered as working
// links; every other PUBLIC_SITES entry shows muted ("coming"). Keep this conservative — better to
// undersell a page than to link a dead one.
const LIVE_SLUGS = new Set(['data', 'search', 'wiki', 'hemp', 'stocks', 'law', 'politics']);

// Representative sub-branches per public site — the key sections/verticals a person would actually
// click into. `live:false` renders the leaf muted ("coming") with no link, even when its parent site is
// live. This is the curated, member-facing slice of the ~190-module catalog (feature-registry /
// ecosystem-map): enough to show the shape of each branch without dumping every internal building block.
const SUBBRANCHES = {
  data: [
    { label: 'Coins & markets', live: true, path: '/' },
    { label: 'Clarity Score', live: true, path: '/' },
    { label: 'Macro: FRED · Census · World Bank', live: true, path: '/' },
    { label: 'Filings & recalls (SEC · FDA · CPSC)', live: true, path: '/' },
    { label: 'Patents · PubMed · Treasury', live: true, path: '/' },
  ],
  search: [
    { label: 'Vertical-tab ribbon', live: true, path: '/' },
    { label: 'Web · coins · library · law', live: true, path: '/' },
    { label: 'Hathor AI answer mode', live: false },
  ],
  wiki: [
    { label: 'Open corpus / Library of Ashurbanipal', live: true, path: '/' },
    { label: 'Fact-checked articles', live: true, path: '/' },
    { label: 'Scripture corpus', live: true, path: '/' },
  ],
  hemp: [
    { label: 'US law: hemp vs marijuana', live: true, path: '/law' },
    { label: 'Reform orgs & churches', live: true, path: '/orgs' },
    { label: 'Flower price index', live: true, path: '/flower' },
    { label: 'Seeds & strains', live: true, path: '/seeds' },
  ],
  stocks: [
    { label: 'Equity quotes & profiles', live: true, path: '/' },
    { label: 'Market health', live: true, path: '/' },
    { label: 'Insurance vertical', live: false },
  ],
  law: [
    { label: 'Caselaw & courts', live: false },
    { label: 'Statutes & citations', live: false },
    { label: 'Lawyer / FARA / lobbying records', live: false },
  ],
  politics: [
    { label: 'Congress & FEC', live: false },
    { label: 'Elections & civic records', live: false },
    { label: 'Business-accountability records', live: false },
  ],
  directory: [
    { label: 'Org & entity directory', live: false },
    { label: 'OpenCorporates lookups', live: false },
  ],
};

// A short, plain-English line per site so the bracket reads, not just links.
const SITE_BLURB = {
  data: 'CMC-style data aggregator — coins, macro, filings, the Clarity Score.',
  search: 'One search box across web, coins, the library, and the law.',
  stocks: 'Equities, market health, and the insurance vertical.',
  directory: 'A directory of orgs and entities you can look up.',
  wiki: 'The open corpus + the Ashurbanipal fact-checked wiki.',
  hemp: 'Where US cannabis law draws the line, plus honest price indexes.',
  law: 'Caselaw, statutes, and accountability records — facts, not verdicts.',
  politics: 'Congress, elections, lobbying, and business-accountability records.',
};

// The PRANA play layer — the game/farm surfaces we run as their own live subdomains (not in PUBLIC_SITES,
// which is the data/civic side). Each is its own site branch with its own URL; honesty rule still applies
// (every one below is deployed + live). Rendered as a second, clearly-labelled bracket.
const GAME_SITES = [
  { slug: 'arcade', name: 'SoapBox Arcade', url: 'https://arcade.soapbox.community', live: true,
    blurb: 'The MELEK game hub on PRANA — seed/casino games, the grow, and seasonal arenas.',
    children: [
      { label: 'Seed Raffle (token casino)', live: true, path: '/' },
      { label: 'Kush Farm tile', live: true, path: '/' },
    ] },
  { slug: 'kush', name: 'Kush Farm', url: 'https://kush.soapbox.community', live: true,
    blurb: 'Grow crops across the real seasons — two axes (grow-time × season), harvest for KULA.',
    children: [
      { label: "What's plantable now", live: true, path: '/' },
      { label: 'Strain & crop catalog', live: true, path: '/' },
    ] },
  { slug: 'seeds', name: 'Seeds', url: 'https://seeds.soapbox.community', live: true,
    blurb: 'Your seed wallet — the seeds you hold, as engine tokens & NFTs (token vs NFT by scarcity).',
    children: [
      { label: 'Your seed collection', live: true, path: '/' },
    ] },
  { slug: 'farm', name: 'KULA Farm', url: 'https://farm.soapbox.community', live: true,
    blurb: 'Farm the tokens — KULA emissions, pool APRs, and permanent wMELEK → APIS-Hash staking.',
    children: [
      { label: 'Stake wMELEK → APIS-Hash', live: true, path: '/' },
      { label: 'Emissions & no-loss lottery', live: true, path: '/' },
    ] },
  { slug: 'move', name: 'MELEK Move', url: 'https://move.soapbox.community', live: true,
    blurb: 'Move-to-earn — geo-mining boosted by your step counter, paid in MELEK.',
    children: [
      { label: 'Map your blocks & walk', live: true, path: '/' },
    ] },
];

// Build the top tier from PUBLIC_SITES (the single source of truth), merging in live status + branches.
function topBranches() {
  return PUBLIC_SITES.map((s) => ({
    slug: s.slug,
    name: s.name,
    url: s.url,
    live: LIVE_SLUGS.has(s.slug),
    blurb: SITE_BLURB[s.slug] || '',
    children: SUBBRANCHES[s.slug] || [],
  }));
}

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .wrap{max-width:1100px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:28px} h2{font-size:18px;margin:26px 0 10px}
  .muted{color:var(--mut)} .lead{color:var(--mut);font-size:15px;max-width:760px}
  .legend{display:flex;gap:16px;flex-wrap:wrap;margin:12px 0 4px;font-size:13px;color:var(--mut)}
  .legend b{color:var(--fg)}
  .pill{display:inline-block;font-size:11px;border-radius:8px;padding:1px 7px;margin-left:7px;vertical-align:middle}
  .pill.live{background:#3fb95022;color:var(--up);border:1px solid #3fb95055}
  .pill.coming{background:#8b949e22;color:var(--mut);border:1px solid #30363d}

  /* ── the bracket: nested <ul> rendered as a connected tree ── */
  .bracket{margin:8px 0}
  .bracket ul{list-style:none;margin:0;padding-left:26px;position:relative}
  .bracket>ul{padding-left:0}
  .bracket li{position:relative;padding:6px 0 6px 0;margin:0}
  /* connector lines */
  .bracket ul ul>li::before{content:"";position:absolute;left:-15px;top:0;bottom:50%;width:1px;background:var(--line2)}
  .bracket ul ul>li::after{content:"";position:absolute;left:-15px;top:calc(50% - 0px);width:12px;height:1px;background:var(--line2)}
  .bracket ul ul>li:last-child::before{bottom:50%}
  .node{display:inline-block;border:1px solid var(--line2);border-radius:9px;padding:8px 14px;background:var(--panel)}
  .node.root{border-color:var(--gold);background:#161b22;font-weight:800;font-size:18px}
  .node.site{font-weight:700}
  .node.site a{color:var(--fg)} .node.site a:hover{color:var(--blue)}
  .node.leaf{padding:5px 11px;font-size:13px;border-style:dashed;border-color:var(--line)}
  .node.leaf.islive{border-style:solid}
  .node .blurb{display:block;color:var(--mut);font-weight:400;font-size:12px;margin-top:2px;max-width:520px}
  .node.coming{opacity:.62}

  /* ── the organism tier: chains / bots / tokens, drawn from ESTATE, honest status ── */
  .org-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px}
  .org-col{border:1px solid var(--line2);border-radius:10px;background:var(--panel);padding:14px 16px}
  .org-col h3{margin:0 0 8px;font-size:15px}
  .org-col .row{padding:6px 0;border-bottom:1px solid var(--line);font-size:13px} .org-col .row:last-child{border-bottom:0}
  .org-col .nm{font-weight:600}
  .dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:middle}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:30px;border-top:1px solid var(--line);line-height:1.8}
  footer a{color:var(--blue);margin:0 4px}
  @media(max-width:640px){ .bracket ul{padding-left:18px} .node .blurb{max-width:none} }
</style>`;

const STATUS_DOT = { live: '#3fb950', built: '#58a6ff', 'pre-testnet': '#d29922', 'pre-launch': '#d29922', planned: '#d29922', lineage: '#8b949e' };
const sdot = (status) => `<span class=dot style="background:${STATUS_DOT[status] || '#8b949e'}" title="${esc(status)}"></span>`;

// footer cross-links — LIVE public subdomains only; admin can never appear.
function footerLinks() {
  return PUBLIC_SITES.filter((s) => LIVE_SLUGS.has(s.slug))
    .map((s) => `<a href="${esc(s.url)}">${esc(s.name.replace(/^SoapBox /, '').replace(/^Library.*/, 'Library'))}</a>`)
    .join(' · ');
}

const FOOTER = `<footer>
  <b>SoapBox.community</b> — the map of everything we make: an organism you can actually read.
  Each branch links to a real, live subdomain; greyed branches are built but not yet live.
  <div style="margin-top:8px">${footerLinks()}</div>
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'SoapBox.community — the map of everything we make, rendered as a bracket: every public site and vertical branching from one tree. An organism you can actually read.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=robots content="${esc(robots)}">
<link rel=canonical href="${esc(canonical)}">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">🧭 SoapBox <span>community · the whole map</span></a></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── render one site branch (top node + its sub-branch leaves) ───────────────────────────────────────
function leafNode(leaf, parentLive) {
  // a leaf is clickable only if the leaf is live AND its parent site is live (we never link into a
  // not-yet-live subdomain). Otherwise it renders muted, no link.
  const clickable = leaf.live && parentLive;
  const cls = `node leaf${clickable ? ' islive' : ' coming'}`;
  const pill = leaf.live ? '' : `<span class="pill coming">coming</span>`;
  if (clickable) {
    // parent site is live; leaf.path is relative to that subdomain.
    const href = leaf._siteUrl ? esc(leaf._siteUrl.replace(/\/$/, '') + (leaf.path || '/')) : '#';
    return `<li><a class="${cls}" href="${href}">${esc(leaf.label)}</a></li>`;
  }
  return `<li><span class="${cls}">${esc(leaf.label)}${pill}</span></li>`;
}

function siteBranch(site) {
  const livePill = site.live ? `<span class="pill live">live</span>` : `<span class="pill coming">coming</span>`;
  const head = site.live
    ? `<a href="${esc(site.url)}">${esc(site.name)}</a>${livePill}`
    : `${esc(site.name)}${livePill}`;
  const nodeCls = `node site${site.live ? '' : ' coming'}`;
  const blurb = site.blurb ? `<span class=blurb>${esc(site.blurb)}</span>` : '';
  const kids = site.children.map((c) => leafNode({ ...c, _siteUrl: site.url }, site.live)).join('');
  const kidList = kids ? `<ul>${kids}</ul>` : '';
  return `<li><span class="${nodeCls}">${head}${blurb}</span>${kidList}</li>`;
}

// ── the organism tier: chains / bots / tokens from ESTATE, honest status, no links into not-live ─────
function organismTier() {
  const chainRows = ESTATE.chains.map((c) =>
    `<div class=row><span class=nm>${sdot(c.status)}${esc(c.label)}</span> <span class=muted>· ${esc(c.kind)} · ${esc(c.status)}</span></div>`).join('');
  const botRows = ESTATE.bots.map((b) =>
    `<div class=row><span class=nm>${sdot(b.status)}${esc(b.name)}</span> <span class=muted>· ${esc(b.role)} · ${esc(b.status)}</span></div>`).join('');
  const tokenRows = ESTATE.tokens.map((t) =>
    `<div class=row><span class=nm>${sdot(t.status)}${esc(t.symbol)}</span> <span class=muted>· ${esc(t.chain)} · ${esc(t.status)}</span></div>`).join('');
  return `<div class=org-grid>
    <div class=org-col><h3>Chains</h3>${chainRows}</div>
    <div class=org-col><h3>Bots &amp; agents</h3>${botRows}</div>
    <div class=org-col><h3>Tokens</h3>${tokenRows}</div>
  </div>`;
}

// ── home: the bracket ───────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const sites = topBranches();
  // root → sites → sub-branches, as one nested <ul> tree.
  const tree = `<div class=bracket><ul>
    <li><span class="node root">SoapBox</span>
      <ul>${sites.map(siteBranch).join('')}</ul>
    </li>
  </ul></div>`;

  const body = `<h1>SoapBox.community</h1>
    <p class=lead>This is the map of everything we make — every public site and the verticals under it,
      branching from one tree. The point isn't to be tidy; it's to be <b>readable</b>: an organism you can
      actually read, laid out like a championship bracket so the whole thing fits in one look.</p>
    <div class=legend>
      <span><span class="pill live">live</span> open now — the link works.</span>
      <span><span class="pill coming">coming</span> built, not yet live — shown so you can see what's growing.</span>
    </div>
    ${tree}
    <h2>Games &amp; Farm — the PRANA play layer</h2>
    <p class=lead>The game side of the family: grow crops and strains, hold them as tokens &amp; NFTs, farm the
      tokens, and earn by moving. All live on PRANA today.</p>
    <div class=bracket><ul>
      <li><span class="node root">Play</span>
        <ul>${GAME_SITES.map(siteBranch).join('')}</ul>
      </li>
    </ul></div>
    <h2>The organism underneath</h2>
    <p class=lead>The sites sit on top of chains, bots, and tokens. Here's that layer, with honest status —
      green is live, blue is built, amber is on the way.</p>
    ${organismTier()}`;
  return page('SoapBox.community — the whole map', body, { canonical: `${BASE_URL}/` });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

const SITEMAP_PATHS = ['/'];

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
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'daily', priority: '1.0' }));
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
        name: 'SoapBox.community',
        baseUrl: BASE_URL,
        summary: 'The map of everything we make — every public site and its verticals, branching from one tree. An organism you can actually read.',
        links: PUBLIC_SITES.filter((s) => LIVE_SLUGS.has(s.slug)).map((s) => ({ label: s.name, path: s.url })),
      }));
    }

    if (path === '/') return sendHtml(res, homePage());

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/hub\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox hub on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}

// exported for tests
export { topBranches, organismTier, footerLinks, LIVE_SLUGS, SUBBRANCHES };
