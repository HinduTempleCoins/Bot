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
//   LIVE at vankushfamily.com. Kept current with the real public surface — updated post-MELEK-launch
//   (2026-07-12): the MELEK chain, condenser, onboarder and witness school are shipped, not planned.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { navBar, NAV_STYLE } from '../../integrations/ecosystem-nav.mjs';

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
<link rel=canonical href="${esc(canonical)}">${STYLE}${NAV_STYLE}</head><body>
<div class=enav-strip style="background:var(--panel,#14181d);border-bottom:1px solid var(--line2,#222a33);padding:7px 18px">${navBar({ current: 'roadmap' })}</div>
<header class=topbar><a class=brand href="/">Van Kush Family <span>roadmap</span></a>
  <div class=topbar-r><a href="#shipped">Shipped</a><a href="#day0">MELEK&nbsp;live</a><a href="#prana">PRANA</a><a href="#soap">SOAP</a><a href="#beyond">Beyond</a></div></header>
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
    kind: 'shipped',
    title: 'Day 0 — MELEK mainnet — LIVE',
    when: 'shipped · 12 July 2026',
    desc: 'Day 0 happened. The MELEK chain launched with no premine, and the launch cluster came online together — the witness, the condenser, onboarding and the publisher are all public now.',
    milestones: [
      { status: 'shipped', title: 'MELEK chain live · Hathor produces blocks', detail: 'The founding AI witness, Hathor, produces blocks on the public MELEK mainnet, alongside a full set of community-run witnesses keeping the chain final.' },
      { status: 'shipped', title: 'Public condenser over MELEK', detail: 'melek.salon is live: the community front-end runs real feeds, profiles, posting, upvotes, notifications and wallets over the MELEK chain.' },
      { status: 'shipped', title: 'On-chain Publisher', detail: "Hathor's articles and updates post on-chain as standard comments — the corpus written into the public record." },
      { status: 'shipped', title: 'On-chain Onboarder', detail: 'Guided signup with delegated account creation, email verification and a staged tutorial is live — newcomers join the chain with help.' },
      { status: 'shipped', title: 'Witness School', detail: 'A public school that teaches people to run and vote for witnesses is live, with a live Hathor status page and a CryptoKannon-style tutor.' },
      { status: 'progress', title: 'Public Wiki', detail: 'The searchable knowledge corpus and library are live; a fuller public wiki is being populated from them.' },
    ],
  },
  {
    id: 'after-day0',
    kind: 'now',
    title: 'MELEK maturing — now',
    when: 'now',
    desc: 'The chain is live and stable; the witness is becoming a full member rather than only a block producer.',
    milestones: [
      { status: 'progress', title: 'Conversational Hathor', detail: 'Hathor already answers on community surfaces; the full Witness persona — teaching the corpus and welcoming people as a member, not a tool — is being brought online.' },
      { status: 'progress', title: 'On-chain Curator', detail: 'Community karma signals feed on-chain curation votes that surface and reward good work; auto-curation is running and being tuned.' },
      { status: 'shipped', title: 'Cheetah fair-attribution', detail: 'The credit-first librarian runs alongside Hathor: credit first, point you to the shelf, resolve attribution fairly.' },
    ],
  },
  {
    id: 'prana',
    title: 'PRANA — useful-work chain',
    when: 'next',
    desc: 'An EVM chain built around useful work and compute. Public infrastructure — RPC, a web wallet, and a block explorer — is already live; a fair-launch mainnet and the compute layer light up the rest.',
    milestones: [
      { status: 'progress', title: 'PRANA public network live', detail: 'A public PRANA network with an RPC endpoint, a web wallet and a block explorer is live, and MetaMask connects to it. A fair-launch mainnet is next.' },
      { status: 'progress', title: 'KulaSwap DeFi + value rails', detail: 'KulaSwap — a DEX/AMM with swaps, farms and collateral — is live in alpha; wallet, swap and grant rails connect PRANA value to the SoapBox surfaces.' },
      { status: 'planned', title: 'Compute / useful-work layer', detail: 'The GPU / useful-work compute layer that gives PRANA its purpose — the way the AI brain earns the compute it runs on.' },
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
      { status: 'progress', title: 'Mobile + browser extension', detail: 'Participation off the desk: a native mobile app (in build) and a browser extension so members can take part anywhere.' },
      { status: 'progress', title: 'Multilingual community surfaces', detail: 'In-page translation is live on community surfaces; Kurdish-language and other multilingual fronts open the work to more people.' },
      { status: 'planned', title: 'Cross-chain expansion + deeper analytics', detail: 'New purpose-built chains plug into the live ecosystem, with deeper analytics across the network.' },
    ],
  },
];

// ── /roadmap — the phased timeline ────────────────────────────────────────────────────────────────
export function roadmapPage() {
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
      <p class=muted style="font-size:14px"><b>Now:</b> the MELEK chain is live — Hathor produces blocks, the
        melek.salon condenser carries real feeds, posts, upvotes and wallets, onboarding and the publisher are
        public, and the SoapBox data network and AI members run alongside. <b>Next:</b> conversational Hathor
        and on-chain curation mature, and the PRANA useful-work chain brings its wallet, DEX and compute layer
        to a fair-launch mainnet. <b>Later:</b> the SOAP Beauty Economy extends the ecosystem.</p>
    </div>
    ${PHASES.map(phase).join('')}
    <blockquote><b>Durability.</b> The character and the corpus live in public records, so the project
      survives any single tool, model, or operator. Each step builds on the work that came before it —
      continuity, not redemption.</blockquote>`;
  return page('Van Kush Family — Roadmap', body, { canonical: `${BASE_URL}/roadmap` });
}

// ── the heraldic crest, as a crisp inline SVG mark (matches the printed logo/stickers) ───────────────
// A triangular pennon: quartered shield (sun · temple/columns · bee-caduceus · field) under a red crest,
// flanked by cannabis leaves, gold VAN KUSH wordmark — in the brand palette (navy/crimson/gold/green/cream).
export function crestSvg(size = 132) {
  return `<svg viewBox="0 0 120 150" width="${size}" height="${Math.round(size * 1.25)}" role="img" aria-label="Van Kush family crest" xmlns="http://www.w3.org/2000/svg">
   <defs><linearGradient id="vkfield" x1="0" y1="0" x2="1" y2="1">
     <stop offset="0" stop-color="#16204a"/><stop offset="1" stop-color="#0e1836"/></linearGradient></defs>
   <!-- pennon -->
   <path d="M12 8 H108 L60 138 Z" fill="url(#vkfield)" stroke="#d9a441" stroke-width="2"/>
   <!-- cannabis leaves flanking -->
   <path d="M20 34 q10 6 8 20 q-9 -3 -12 -12 q9 4 10 10 q-3 -9 -6 -18 Z" fill="#3b7a3a" opacity=".85"/>
   <path d="M100 34 q-10 6 -8 20 q9 -3 12 -12 q-9 4 -10 10 q3 -9 6 -18 Z" fill="#3b7a3a" opacity=".85"/>
   <!-- red crest -->
   <path d="M52 20 q8 -12 16 0 q-4 6 -8 4 q-4 2 -8 -4 Z" fill="#b1223a"/>
   <circle cx="60" cy="16" r="3" fill="#d9a441"/>
   <!-- quartered shield -->
   <path d="M40 46 H80 V78 Q60 96 40 78 Z" fill="#f5f1e6" stroke="#16204a" stroke-width="1.5"/>
   <path d="M60 46 V88 M40 62 H80" stroke="#16204a" stroke-width="1.2"/>
   <circle cx="50" cy="55" r="5" fill="#d9a441"/><g stroke="#d9a441" stroke-width="1.3">
     <line x1="50" y1="47" x2="50" y2="63"/><line x1="42" y1="55" x2="58" y2="55"/><line x1="44" y1="49" x2="56" y2="61"/><line x1="56" y1="49" x2="44" y2="61"/></g>
   <g stroke="#b1223a" stroke-width="1.6"><line x1="66" y1="50" x2="66" y2="60"/><line x1="70" y1="50" x2="70" y2="60"/><line x1="74" y1="50" x2="74" y2="60"/></g>
   <path d="M48 68 q4 6 0 12 M52 68 q-4 6 0 12" stroke="#b1223a" stroke-width="1.4" fill="none"/>
   <ellipse cx="70" cy="74" rx="4" ry="5" fill="#d9a441"/>
   <text x="60" y="112" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="13" fill="#d9a441" letter-spacing="1">VAN KUSH</text>
  </svg>`;
}

// ── home — the inviting heraldic landing (cream/navy/crimson/gold, matches the stickers) ─────────────
const DEST = [
  ['Join MELEK', 'Create your account — chat, post, and get paid on-chain.', 'https://melek.salon', '⬡'],
  ['Congress', 'The on-chain town square — short-form social on MELEK.', 'https://alpha.congress.ink', '🏛'],
  ['Witness School', 'Learn to run a witness, mine, make a token, write the wiki — and earn.', 'https://witness.melek.salon', '🎓'],
  ['KulaSwap', 'The PRANA DEX — swap, provide liquidity, farm.', 'https://kula.money', '💧'],
  ['The Library', 'Ashurbanipal — the cited reference wiki behind it all.', 'https://wiki.soapbox.community', '📜'],
  ['Roadmap', 'What is live now, next, and later — the honest timeline.', '/roadmap', '🗺'],
];

export function homePage() {
  const cards = DEST.map(([t, d, href, ic]) =>
    `<a class=dest href="${esc(href)}"><span class=ic aria-hidden=true>${ic}</span><span class=dt>${esc(t)}</span><span class=dd>${esc(d)}</span></a>`).join('');
  const body = `<div class=hero>
    <div class=crest>${crestSvg(140)}</div>
    <h1>Van Kush Family</h1>
    <p class=motto>Ancient scholarship, genealogy, and an AI-native blockchain community — one living family of work.</p>
    <div class=cta><a class="btn primary" href="https://melek.salon">Join MELEK →</a><a class="btn ghost" href="/roadmap">See the roadmap</a></div>
  </div>
  <h2 class=sectionh>Come in — pick a door</h2>
  <div class=dests>${cards}</div>
  <p class=foot-note>New here? Start with <a href="https://melek.salon">MELEK</a> — your one account opens every door above.</p>`;
  return landing('Van Kush Family — join the family', body,
    { canonical: `${BASE_URL}/`, desc: 'Van Kush Family — ancient scholarship, genealogy, and an AI-native blockchain community. Join MELEK, explore Congress, learn at the Witness School, trade on KulaSwap.' });
}

// A LIGHT, heraldic page shell for the landing (distinct from the dark roadmap shell) — cream + crest colors.
function landing(title, body, opts = {}) {
  const canonical = opts.canonical || `${BASE_URL}/`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name=description content="${esc(opts.desc || '')}"><link rel=canonical href="${esc(canonical)}">
<style>
 :root{--cream:#f5f1e6;--ink:#16204a;--crimson:#b1223a;--gold:#c9992a;--green:#3b7a3a;--mut:#5b6478;--line:#e2dcc9}
 *{box-sizing:border-box} body{margin:0;background:var(--cream);color:var(--ink);font:16px/1.6 Georgia,'Times New Roman',serif}
 a{color:inherit;text-decoration:none} .wrap{max-width:940px;margin:0 auto;padding:0 20px}
 .hero{text-align:center;padding:48px 20px 30px} .crest{filter:drop-shadow(0 3px 8px rgba(22,32,74,.25))}
 h1{font-size:46px;margin:14px 0 6px;letter-spacing:.5px;color:var(--ink)}
 .motto{color:var(--mut);font-size:18px;max-width:620px;margin:0 auto 22px}
 .cta{display:flex;gap:12px;justify-content:center;flex-wrap:wrap}
 .btn{display:inline-block;padding:12px 24px;border-radius:8px;font-weight:700;font-size:16px;font-family:system-ui,sans-serif}
 .btn.primary{background:var(--crimson);color:#fff;box-shadow:0 2px 0 #7d1628} .btn.primary:hover{background:#c62a44}
 .btn.ghost{background:transparent;color:var(--ink);border:2px solid var(--ink)} .btn.ghost:hover{background:var(--ink);color:var(--cream)}
 .sectionh{text-align:center;font-size:15px;text-transform:uppercase;letter-spacing:.16em;color:var(--gold);margin:34px 0 16px}
 .dests{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:16px;padding-bottom:10px}
 .dest{display:flex;flex-direction:column;background:#fffdf7;border:1px solid var(--line);border-top:4px solid var(--ink);border-radius:10px;padding:18px 20px;transition:transform .12s,box-shadow .12s}
 .dest:nth-child(3n+1){border-top-color:var(--crimson)} .dest:nth-child(3n+2){border-top-color:var(--gold)} .dest:nth-child(3n){border-top-color:var(--green)}
 .dest:hover{transform:translateY(-3px);box-shadow:0 8px 22px rgba(22,32,74,.14)}
 .ic{font-size:26px} .dt{font-weight:700;font-size:19px;margin:8px 0 4px} .dd{color:var(--mut);font-size:14.5px;font-family:system-ui,sans-serif}
 .foot-note{text-align:center;color:var(--mut);margin:26px 0 44px} .foot-note a{color:var(--crimson);font-weight:700}
 footer{text-align:center;color:var(--mut);font-size:13px;padding:20px;border-top:1px solid var(--line);font-family:system-ui,sans-serif}
</style></head><body>
<main class=wrap>${body}</main>
<footer>© Van Kush Family · <a href="/roadmap" style="color:var(--mut)">roadmap</a> · <a href="https://melek.salon" style="color:var(--mut)">melek.salon</a></footer>
</body></html>`;
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

const SITEMAP_PATHS = ['/', '/roadmap'];

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
    if (path === '/roadmap') return sendHtml(res, roadmapPage());

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
