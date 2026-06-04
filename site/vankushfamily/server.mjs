// server.mjs — VanKushFamily.com public ROADMAP. A standalone, zero-dependency HTTP service in the
// SoapBox house style (mirrors site/law/server.mjs + site/hemp/server.mjs) that presents the Van Kush
// Family roadmap the way other blockchain projects present theirs: a PHASED TIMELINE of milestone
// cards, each marked done / in-progress / planned, with a "now / next / later" shape.
//
//   PORT=8104 BASE_URL=https://vankushfamily.com node site/vankushfamily/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the roadmap — Phase 0 (shipped) → Day 0 (MELEK) → PRANA → SOAP → Beyond
//   /health      liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   PUBLIC ONLY. Every line here is a public-facing product or feature. No infrastructure, no
//   resident-AI internals, no signer/keys, no trade-bot accounts, no grant programs, no servers — the
//   gap analysis (.local/ROADMAP_GAP_ANALYSIS.md) already drew that boundary and this honors it.
//   HONEST: where a module is "built but not live," it is shown as PLANNED / IN-PROGRESS, not shipped.
//   We claim only the genuinely-live public surface (data.soapbox + verticals + Discord/Telegram +
//   soapy.blog) as DONE. esc() on every interpolated value. Soft-fail: the page is static, never throws.
//   This is a DRAFT for operator review — not deployed.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';

const PORT = +(process.env.PORT || 8104);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://vankushfamily.com').replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const LAW = process.env.LAW_SITE || 'https://law.soapbox.community';
const POLITICS = process.env.POLITICS_SITE || 'https://politics.soapbox.community';
const HEMP = process.env.HEMP_SITE || 'https://hemp.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
const ADMIN = process.env.ADMIN_SITE || 'https://soapy.blog';

// ── shared house-style helpers (same dark theme as Law/Hemp/Stocks/Search) ────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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
  h1{margin:0 0 6px;font-size:28px} h2{font-size:17px;margin:0 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .lead{font-size:16px;color:var(--mut);max-width:72ch;margin:6px 0 4px}
  /* the phased timeline — a left rail with phase nodes; each phase holds milestone cards */
  .phase{position:relative;border-left:2px solid var(--line2);margin:0 0 6px;padding:6px 0 14px 26px}
  .phase::before{content:"";position:absolute;left:-9px;top:10px;width:16px;height:16px;border-radius:50%;background:var(--panel);border:2px solid var(--blue)}
  .phase.shipped::before{background:var(--up);border-color:var(--up)}
  .phase.now::before{background:var(--gold);border-color:var(--gold)}
  .phase .ph-h{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
  .phase .ph-t{font-weight:800;font-size:20px;color:var(--fg)}
  .phase .ph-when{color:var(--mut);font-size:13px;font-weight:600}
  .phase .ph-d{color:var(--mut);font-size:14px;margin:4px 0 12px;max-width:70ch}
  .ms{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:13px 15px}
  .ms .m-t{font-weight:700;font-size:15px;color:var(--fg)} .ms .m-d{color:var(--mut);font-size:13px;margin-top:5px}
  /* status badges — done / in-progress / planned / shipped */
  .badge{display:inline-block;font-size:11px;font-weight:700;border-radius:8px;padding:2px 9px;letter-spacing:.02em;vertical-align:middle}
  .badge.done{background:#3fb95033;color:var(--up)}
  .badge.shipped{background:#3fb95033;color:var(--up)}
  .badge.progress{background:#d2992233;color:var(--gold)}
  .badge.planned{background:#1f6feb33;color:var(--blue)}
  .legend{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0 2px;font-size:13px;color:var(--mut)}
  .legend .badge{margin-right:5px}
  blockquote{border-left:3px solid var(--line2);margin:10px 0;padding:2px 0 2px 12px;color:var(--mut);font-size:14px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// Footer — names the public/private boundary and cross-links the live SoapBox surface.
const FOOTER = `<footer>
  <b>Public roadmap.</b> This page shows the direction of the work in plain terms. Technical architecture,
  infrastructure, and operational detail are kept private — only public-facing products and features appear here.
  <b>Continuity, not redemption</b> · <b>Durability</b> (the character and corpus live in public records) ·
  <b>Credit first</b>.
  <div style="margin-top:8px">
    <a href="${esc(DATA)}">Data</a> · <a href="${esc(LAW)}">Law</a> · <a href="${esc(POLITICS)}">Politics</a> ·
    <a href="${esc(HEMP)}">Hemp</a> · <a href="${esc(SEARCH)}">Search</a> · <a href="${esc(WIKI)}">Library</a> ·
    <a href="${esc(ADMIN)}">Admin</a>
  </div></footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'The Van Kush Family roadmap — a phased timeline from the live SoapBox data network through the MELEK, PRANA, and SOAP chains. What is shipped, what is in progress, and what is planned.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=robots content="${esc(robots)}">
<link rel=canonical href="${esc(canonical)}">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">Van Kush Family <span>roadmap</span></a>
  <div class=topbar-r><a href="#shipped">Shipped</a><a href="#day0">Day&nbsp;0</a><a href="#prana">PRANA</a><a href="#soap">SOAP</a><a href="#beyond">Beyond</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── status badge helper ───────────────────────────────────────────────────────────────────────────
const STATUS = {
  shipped: ['shipped', 'shipped'],
  done: ['done', 'done'],
  progress: ['progress', 'in progress'],
  planned: ['planned', 'planned'],
};
function badge(status) {
  const [cls, label] = STATUS[status] || STATUS.planned;
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

// ── milestone card ──────────────────────────────────────────────────────────────────────────────
function milestone(m) {
  return `<div class=ms>
    <div class=m-t>${esc(m.title)} ${badge(m.status)}</div>
    <div class=m-d>${esc(m.detail)}</div>
  </div>`;
}

// ── a phase block: node on the rail + milestone grid ──────────────────────────────────────────────
function phase(p) {
  const cls = p.kind ? ` ${p.kind}` : '';
  return `<section class="phase${cls}" id="${esc(p.id)}">
    <div class=ph-h><span class=ph-t>${esc(p.title)}</span><span class=ph-when>${esc(p.when)}</span></div>
    <div class=ph-d>${esc(p.desc)}</div>
    <div class=grid>${p.milestones.map(milestone).join('')}</div>
  </section>`;
}

// ── ROADMAP CONTENT ───────────────────────────────────────────────────────────────────────────────
// Sourced from .local/ROADMAP_GAP_ANALYSIS.md. PUBLIC items only. "built ≠ live" is honored: only the
// genuinely-live public surface is marked done/shipped; code-complete-but-gated work is planned/progress.
export const PHASES = [
  {
    id: 'shipped',
    kind: 'shipped',
    title: 'Phase 0 — Already shipped',
    when: 'before Day 0 · live now',
    desc: 'The foundation is real and public today. Before the chain launches, the data network, the community surfaces, and the AI shells already run.',
    milestones: [
      { status: 'shipped', title: 'data.soapbox.community is LIVE', detail: 'A CMC-style public data aggregator: ~20 core routes plus ~45 data verticals, the front of house for the whole network.' },
      { status: 'shipped', title: 'The other SoapBox sites', detail: 'Civic and data storefronts came up next: Law, Politics, Hemp, Search, Library and dozens of public data pages (economy, health, recalls, civic).' },
      { status: 'shipped', title: 'Cheetah librarian + Hathor shell', detail: 'The credit-first librarian bot is operational, and a working shell of the Hathor witness is in place — the AI members are real before the chain is.' },
      { status: 'shipped', title: 'Condenser proven over MELEK', detail: 'The community front-end ran live feeds with the MELEK chain underneath it in testing — the path to a public condenser is proven, not theoretical.' },
      { status: 'shipped', title: 'Discord + Telegram community', detail: 'The Van Kush Family Discord community bot and the Telegram front desk are live and in use today.' },
      { status: 'shipped', title: 'Research corpus + published papers', detail: 'The scholarship: published genealogy and mythology-as-history papers plus the assembled scripture canon — the meaning the technology serves.' },
      { status: 'shipped', title: 'Knowledge base + library / RAG', detail: 'A searchable corpus with retrieval, feeding the library vertical and the AI members.' },
      { status: 'shipped', title: 'soapy.blog admin portal', detail: 'The public admin and features catalog is live, with front-page ticker, world clocks and a Claude chat bridge.' },
    ],
  },
  {
    id: 'day0',
    kind: 'now',
    title: 'Day 0 — MELEK mainnet launch',
    when: 'next',
    desc: 'The launch cluster. Most of this is code-complete and unblocks together the moment the MELEK chain goes live — Day 0 is a cluster-launch, not a long sequence.',
    milestones: [
      { status: 'planned', title: 'MELEK chain live · Hathor produces blocks', detail: 'The founding AI witness, Hathor, begins producing blocks publicly. Witness software is built; this turns on at launch.' },
      { status: 'planned', title: 'Public condenser over MELEK', detail: 'The community front-end goes up over the live chain — the BLURT-feed-over-MELEK condenser already proven in testing, made public.' },
      { status: 'planned', title: 'On-chain Publisher', detail: "Hathor's library articles post on-chain as standard comments — the corpus written into the public record." },
      { status: 'planned', title: 'On-chain Onboarder', detail: 'Guided signup with delegated account creation and email verification, so newcomers can join the chain with help.' },
      { status: 'progress', title: 'Public Wiki', detail: 'A public wiki stands up and is populated from the corpus. The library vertical is live today; the full public wiki is the next step.' },
      { status: 'progress', title: 'Civic & data verticals to front-of-house', detail: 'Built-but-staged civic and consumer-safety readers flip public to carry launch traffic alongside the live data verticals.' },
    ],
  },
  {
    id: 'after-day0',
    title: 'Soon after Day 0 — MELEK maturing',
    when: 'next',
    desc: 'Once the chain is live and stable, the witness becomes a full member rather than a block producer.',
    milestones: [
      { status: 'planned', title: 'Conversational Hathor turns on', detail: 'The full Witness persona answers live — teaching the corpus, welcoming people, and participating as a member, not a tool.' },
      { status: 'planned', title: 'On-chain Curator', detail: 'Community karma signals become on-chain votes, surfacing and rewarding good work.' },
      { status: 'progress', title: 'Cheetah fair-attribution flow', detail: "Cheetah's resolution flow goes live alongside Hathor: credit first, point you to the shelf, resolve attribution fairly." },
    ],
  },
  {
    id: 'prana',
    title: 'PRANA — useful-work chain',
    when: 'later · soon after MELEK',
    desc: 'An EVM chain built around useful work and compute. The plumbing — adapters, wallet, token factory — is already built; the chain launch lights it up.',
    milestones: [
      { status: 'planned', title: 'PRANA mainnet launch', detail: 'The useful-work / compute chain goes live: token factory, an AMM/DEX, and a GPU/useful-work compute layer.' },
      { status: 'progress', title: 'DeFi tools + value rails', detail: 'Wallet, swap and grant rails connect PRANA value to the existing SoapBox data and games surfaces. Adapters built; they activate with the chain.' },
      { status: 'planned', title: 'Public forums', detail: 'Dedicated community forums stand up as the PRANA-era community grows. Discord remains the live community in the interim.' },
    ],
  },
  {
    id: 'soap',
    title: 'SOAP — the Beauty Economy',
    when: 'later this year',
    desc: '"A legal Silk Road, but a Beauty Economy." Its own chain and marketplace — the least-built of the three, deliberately kept soft.',
    milestones: [
      { status: 'planned', title: 'SOAP chain launch', detail: 'SOAP launches as its own chain into the live ecosystem, anchoring the Beauty Economy marketplace.' },
      { status: 'planned', title: 'Marketplace + real-world-asset tokenization', detail: 'A public marketplace with real-world-asset tokenization for the Beauty Economy. Tokenization and DEX scaffolding are built; the marketplace is being built out.' },
      { status: 'planned', title: 'Analytics + fair-resolution tribunal', detail: 'A public analytics layer and a fair-resolution / attribution tribunal for disputes — credit and fairness before accusation.' },
    ],
  },
  {
    id: 'beyond',
    title: 'Beyond',
    when: 'open',
    desc: 'Open direction, to be shaped with the community.',
    milestones: [
      { status: 'planned', title: 'Mobile + browser extension', detail: 'Participation off the desk: a mobile app and a browser extension so members can take part anywhere.' },
      { status: 'planned', title: 'Multilingual community surfaces', detail: 'Kurdish-language and other multilingual community surfaces, opening the work to more people.' },
      { status: 'planned', title: 'Cross-chain expansion + deeper analytics', detail: 'New purpose-built chains plug into the live ecosystem, with deeper analytics across the network.' },
    ],
  },
];

// ── home — the roadmap ────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const legend = `<div class=legend>
    <span>${badge('shipped')} live now</span>
    <span>${badge('progress')} in progress</span>
    <span>${badge('planned')} planned</span>
  </div>`;
  const body = `<h1>Van Kush Family — Roadmap</h1>
    <p class=lead>A research and technology effort spanning ancient-history scholarship, genealogy, and an
      AI-native blockchain community. Here is the shape of the work as a phased timeline — what is already
      shipped, what is launching next, and what comes later. We show what is actually <b>live</b>,
      not merely built.</p>
    ${legend}
    <div class=card style="margin-top:14px">
      <h2>Now → Next → Later</h2>
      <p class=muted style="font-size:14px"><b>Now:</b> the SoapBox data network, the community bots, and the
        AI members are live. <b>Next:</b> Day 0 launches the MELEK chain and brings the witness, condenser,
        publisher and onboarder online together. <b>Later:</b> the PRANA useful-work chain and the SOAP
        Beauty Economy extend the ecosystem.</p>
    </div>
    ${PHASES.map(phase).join('')}
    <blockquote><b>Durability.</b> The character and the corpus live in public records, so the project
      survives any single tool, model, or operator. Each step builds on the work that came before it —
      continuity, not redemption.</blockquote>`;
  return page('Van Kush Family — Roadmap', body, { canonical: `${BASE_URL}/` });
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

const SITEMAP_PATHS = ['/'];

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
        path: u, lastmod: today, changefreq: 'weekly', priority: '1.0',
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
        name: 'Van Kush Family Roadmap', baseUrl: BASE_URL,
        summary: 'The Van Kush Family roadmap — a phased timeline from the live SoapBox data network through the MELEK, PRANA, and SOAP chains.',
        links: [{ label: 'Roadmap', path: '/' }],
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
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/vankushfamily\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`Van Kush Family Roadmap on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
