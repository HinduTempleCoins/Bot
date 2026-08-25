// server.mjs — Crypto-Town Kit (towns.soapbox.community). A turnkey "start your community's economy"
// guide in the SoapBox house style (mirrors site/diagram + site/tokens). It is NOT new chain mechanics:
// it is a guided landing + step-by-step CHECKLIST that BUNDLES pieces we already have (token turnkey,
// oversight/watchdog, identity/REN, governance) into one coherent "kit" a town / co-op / congregation /
// DAO can work through. The value is the ASSEMBLY + the guidance, not new primitives.
//
//   PORT=8210 BASE_URL=https://towns.soapbox.community node site/towns/server.mjs
//   → serves the kit at  /  and each step at  /step/<slug>
//
// ── What it is (the cross-ref gap: "we have every piece but no bundle") ────────────────────────────
//   Six steps, each linking the ACTUAL existing surface that does that job (env-configurable URLs with
//   sensible defaults — no invented hostnames):
//     1. Your community token   → the token turnkey (TOKENS_URL / TOKEN_MANAGE_URL)
//     2. Local currency & pay    → community-currency model + pay/pool surface (POOL_URL)
//     3. Governance / charter    → light town-charter/council step (DAO_URL); resource-credits over fees
//     4. Oversight & trust       → watchdog dossier vertical + a notary concept (OVERSIGHT_URL)
//     5. Identity                → one MELEK account = member identity + a .melek REN name (SIGNUP_URL / REN_URL)
//     6. 501(c)(3) / legal note  → plain, NON-ADVICE explainer ("not legal advice, consult a professional")
//
// ── DISCIPLINE ─────────────────────────────────────────────────────────────────────────────────────
//   • Token framing = REAL UTILITY (goods / services / access / time-credits), 65/35 author/curator —
//     NEVER a price / appreciation / return promise. A community currency is a tool, not a speculation.
//   • The legal step is EDUCATION + an explicit "not legal advice" disclaimer. Individualized legal
//     advice is OUT of scope (CLAUDE.md).
//   • esc() on EVERY interpolated / echoed value; safeHref() on any user-provided or configured URL.
//   • Soft-fail: every route renders even with no data — unknown path → 404, never a 500.
//   • The server handler does ZERO request-time network. Static content + a little client-side JS only.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8210);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'Crypto-Town Kit';

// ── Tools-hub path awareness (mundane-app-suite-stealth-funnel) ────────────────
// This app can run behind a path-routing proxy at tools.soapbox.community/<app>. The proxy STRIPS the
// prefix inbound (our routes stay on '/', '/health', '/step/…'); we PREPEND it to every self-URL we
// EMIT. BASE_PATH defaults to '' → standalone behaviour is byte-for-byte unchanged.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
const TOOLS_HUB_URL = (process.env.TOOLS_HUB_URL || '/').replace(/\/+$/, '');
const hub = (p) => TOOLS_HUB_URL + p;
const TOOLS_NAV = `<a class=hublink href="${hub('/')}">◧ SoapBox Tools</a>`;

// ── Existing surfaces each step links to — env-overridable, sensible defaults (no invented hostnames) ─
// These are the REAL pieces we already have; the kit only assembles + guides. Every one is run through
// safeHref() before it becomes an href, so a bad override can never inject a javascript:/data: link.
const TOKENS_URL       = process.env.TOKENS_URL       || 'https://tokens.alpha.melek.salon';   // token turnkey (create a side-token)
const TOKEN_MANAGE_URL = process.env.TOKEN_MANAGE_URL || 'https://manage.melek.salon';          // token management + buyback
const ACADEMY_URL      = process.env.ACADEMY_URL      || 'https://academy.melek.salon';         // Token Academy / Economics 101
const POOL_URL         = process.env.POOL_URL         || 'https://pool.soapbox.community';       // mining pool + in-browser wallet (spend/earn)
const DAO_URL          = process.env.DAO_URL          || 'https://dao.alpha.melek.salon';        // governance / DAO proposals
const OVERSIGHT_URL    = process.env.OVERSIGHT_URL    || 'https://oversight.soapbox.community';  // watchdog dossier vertical
const SIGNUP_URL       = process.env.SIGNUP_URL       || 'https://wallet.melek.salon/signup';    // one MELEK account = member identity
const REN_URL          = process.env.REN_URL          || 'https://ren.soapbox.community';        // .melek REN naming
const WITNESS_SCHOOL_URL = process.env.WITNESS_SCHOOL_URL || 'https://witness.melek.salon';      // teaching institution

// ── shared house-style helpers ───────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// safeHref: only pass through real http(s) URLs; everything else (javascript:, data:, junk) → ''.
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// A guarded link helper: renders an <a> only for a safe URL; otherwise plain text (never a live href).
function linkOut(url, label) {
  const href = safeHref(url);
  return href
    ? `<a class=steplink href="${esc(href)}" target=_blank rel="noopener">${esc(label)} &rarr;</a>`
    : `<span class=steplink-off>${esc(label)}</span>`;
}

// ── the kit steps ─────────────────────────────────────────────────────────────────────────────────
// Each step is a stable slug + a plain-language body + the real surface(s) it links to. `intro` shows
// on the checklist card; `body` (array of HTML paragraph strings) shows on the deep /step/<slug> page.
// NOTE token copy: real UTILITY only (goods/services/access/time-credits, 65/35 author/curator) —
// never a price/return/appreciation promise (token-philosophy-real-utility-not-speculation).
export const STEPS = [
  {
    slug: 'token',
    n: 1,
    title: 'Your community token',
    intro: 'Launch a MELEK-Engine side-token for your town — a community currency, point-and-click, no smart-contract coding.',
    body: [
      'The first building block is a token your community controls. Using the existing <b>token turnkey</b>, a town, co-op, congregation, or DAO stands up its own MELEK-Engine side-token in minutes — the same way Hive-Engine communities mint their own. No contract to write; the wizard drives the existing PRANA factories.',
      'Think of it in the <b>DevCoin / community-currency</b> tradition: the token is a <b>tool for real utility</b> — a way to reward the people who do the work and to buy goods, services, access, and time-credits inside your community. It is <b>not</b> a speculation instrument, and this kit will never frame it as one. The reward split follows the proof-of-brain model: <b>65% to authors, 35% to curators</b>.',
      'What the token is <em>for</em> should be concrete from day one: hours of a member\'s time, a seat at an event, a copy of a book, a share of a harvest, a service credit. Utility first; the currency exists to move that value around, not to be flipped.',
    ],
    links: [
      { url: TOKENS_URL, label: 'Open the token turnkey (create your token)' },
      { url: TOKEN_MANAGE_URL, label: 'Manage the token + buyback' },
      { url: ACADEMY_URL, label: 'Token Academy / Economics 101' },
    ],
  },
  {
    slug: 'currency',
    n: 2,
    title: 'Local currency & payments',
    intro: 'Make the token work as everyday money — spent and earned locally, redeemable for real goods and services.',
    body: [
      'A community currency only matters if people can <b>spend it and earn it locally</b>. Members earn by doing the work — writing, curating, contributing, walking, serving — and spend it with local vendors, at community events, or for member services and time-credits.',
      'The kit points at the existing pay and wallet surfaces: the SoapBox <b>pool + in-browser wallet</b> gives every member a place to hold and move the token, and the same account works across every MELEK surface. The design goal is an interconnected network of small community economies, each grounded in things people actually need.',
      'Keep the loop honest: the currency\'s worth comes from what it <b>redeems for</b> — goods, services, access, time — backed by the community that issues it, not from anyone hoping to sell it to the next person.',
    ],
    links: [
      { url: POOL_URL, label: 'Pool + in-browser wallet (hold / spend / earn)' },
      { url: TOKEN_MANAGE_URL, label: 'Token management + founder buyback floor' },
    ],
  },
  {
    slug: 'governance',
    n: 3,
    title: 'Governance — your town charter',
    intro: 'Write a light charter and stand up a council: proposals, votes, and resource-credits instead of fees.',
    body: [
      'Every community needs a way to decide things together. This step is a <b>light town charter / council</b>: agree who can propose, how a proposal is voted, and what thresholds carry it. Start small — a one-page charter and a handful of council seats — and grow it as trust grows.',
      'Bring proposals and votes on-chain through the existing <b>governance / DAO</b> surface, so the record is transparent and every member can see what was decided and why. In the <b>federalism</b> spirit: keep local decisions local, and reserve only what truly must be shared for the wider network.',
      'A MELEK principle carries through here: use <b>resource-credits, not per-action fees</b>. Participating in your community\'s economy should not cost gas — members act within a credit allowance rather than paying a toll on every move.',
    ],
    links: [
      { url: DAO_URL, label: 'Governance / DAO proposals' },
      { url: WITNESS_SCHOOL_URL, label: 'Witness School (how governance works)' },
    ],
  },
  {
    slug: 'oversight',
    n: 4,
    title: 'Oversight & trust',
    intro: 'Keep the books and the record honest: source-anchored dossiers and a notary concept for local records.',
    body: [
      'Trust is infrastructure. The kit links the existing <b>oversight / watchdog</b> vertical — <b>source-anchored, no-verdict</b> dossiers built on the LittleSis / FollowTheMoney discipline: facts, connections, and a required source for every claim, covering public-capacity conduct only. It is a way for a community to keep an honest, cited record of the people and organizations it deals with, without editorializing.',
      'Alongside it sits a <b>notary</b> concept for local records: a notarized document as a shared point of truth — minutes, agreements, deeds, and council decisions, timestamped and verifiable. The town\'s records become something members can check rather than take on faith.',
      'Used together, oversight and notary give a young community the accountability layer that usually takes years to build — transparency first, so the currency and the charter rest on a record everyone can inspect.',
    ],
    links: [
      { url: OVERSIGHT_URL, label: 'Oversight / watchdog dossiers' },
    ],
  },
  {
    slug: 'identity',
    n: 5,
    title: 'Identity — one account, one name',
    intro: 'One MELEK account is a member\'s whole identity: login, mailbox, and a sovereign .melek REN name.',
    body: [
      'Every member needs an identity that travels. A single <b>MELEK account</b> is a member\'s login across every surface — chat, wallet, forum, the town\'s governance — created in one step at signup. Members "almost don\'t know they have an account"; it just works everywhere.',
      'Each account carries a <b>sovereign .melek name</b> through <b>REN</b> (our on-chain naming): <code>alice.melek</code> resolves to the member and their mailbox, a portable handle the community owns rather than rents. A town can take its own name too — a shared <code>.melek</code> namespace for its members.',
      'Because the identity is one account, membership, the currency, the charter vote, and the record all hang off the same key — no separate logins to reconcile.',
    ],
    links: [
      { url: SIGNUP_URL, label: 'Create a MELEK account (member identity)' },
      { url: REN_URL, label: 'Claim a .melek REN name' },
    ],
  },
  {
    slug: 'legal',
    n: 6,
    title: '501(c)(3) / legal note',
    intro: 'A plain explainer that a community can run this as a nonprofit or co-op — education only, not legal advice.',
    body: [
      '<b>This is general education, not legal advice.</b> Nothing here is individualized legal, tax, or financial advice, and it is not a substitute for a professional. Before you form an entity, adopt a charter, or treat a token as anything with legal or tax consequences, <b>consult a qualified attorney and accountant</b> in your jurisdiction.',
      'With that said: many communities run a shared economy through an existing legal form — a <b>501(c)(3) nonprofit</b>, a <b>cooperative</b>, a mutual-benefit association, or a religious organization. These are ordinary, well-trodden structures; a community currency and a member roster can live inside one the same way a food co-op\'s scrip or a congregation\'s programs do.',
      'A few things a professional can help you get right: whether your token is treated as a currency, a security, a gift-card/scrip, or something else; how member "earnings" are reported; what your charter needs to say to match your entity; and which activities keep (or jeopardize) a nonprofit\'s status. The kit gives you the building blocks — the legal wrapper around them is a decision to make <b>with an advisor</b>.',
      '<b>Again: not legal advice. Consult a licensed professional before acting.</b>',
    ],
    links: [
      { url: WITNESS_SCHOOL_URL, label: 'Witness School (background reading)' },
    ],
  },
];
export const STEP_SLUGS = STEPS.map((s) => s.slug);
export const stepBySlug = (slug) => STEPS.find((s) => s.slug === slug) || null;

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap;background:var(--panel)}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:940px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} .sub{color:var(--mut);margin:0 0 18px;font-size:15px}
  .muted{color:var(--mut)} code{background:#0b0f14;border:1px solid var(--line2);border-radius:5px;padding:1px 5px;font-size:13px}
  .lede{border:1px solid var(--line2);background:#161b2299;border-radius:12px;padding:16px 18px;margin:0 0 20px}
  .lede p{margin:6px 0}
  .steps{display:flex;flex-direction:column;gap:12px;margin:18px 0}
  .step{border:1px solid var(--line2);border-radius:12px;background:var(--panel);padding:14px 16px}
  .step .row{display:flex;align-items:flex-start;gap:12px}
  .badge{flex:0 0 auto;width:30px;height:30px;border-radius:50%;background:#21262d;border:1px solid var(--line2);color:var(--gold);font-weight:800;display:flex;align-items:center;justify-content:center;font-size:14px}
  .step h3{margin:0 0 3px;font-size:17px} .step h3 a{color:var(--fg)}
  .step p.intro{margin:2px 0 8px;color:var(--fg);font-size:14px}
  .step .links{display:flex;flex-wrap:wrap;gap:8px}
  .steplink{display:inline-block;border:1px solid var(--line2);border-radius:8px;padding:6px 12px;font-size:13px;font-weight:700;color:var(--blue);background:#0b0f14}
  .steplink:hover{border-color:var(--blue);text-decoration:none}
  .steplink-off{display:inline-block;border:1px dashed var(--line2);border-radius:8px;padding:6px 12px;font-size:13px;color:var(--mut)}
  .chk{margin-left:auto;font-size:13px;color:var(--mut);cursor:pointer;user-select:none;white-space:nowrap}
  .chk input{vertical-align:middle;margin-right:5px}
  .callout{border:1px solid var(--gold);background:#d2992211;border-radius:10px;padding:12px 15px;margin:16px 0;font-size:14px}
  .callout b{color:var(--gold)}
  .prose p{margin:10px 0}
  .backlink{font-size:13px;margin-bottom:12px}
  .stepnav{display:flex;justify-content:space-between;gap:10px;margin:22px 0 0;font-size:14px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>${esc(SITE_NAME)}</b> — a guide, not new chain mechanics. It bundles pieces that already exist so a
  town, co-op, congregation, or DAO can stand up its own on-chain economy. A community token is a tool for
  <b>real utility</b>, never a speculation. The legal note is general education, <b>not legal advice</b>.
</footer>`;

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Start your community\'s economy: a step-by-step kit that bundles a community token, local payments, a town charter, oversight, member identity, and a plain 501(c)(3)/legal note — using building blocks that already exist.';
  const canonical = opts.canonical || `${BASE_URL}${bp('/')}`;
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="${bp('/')}">🏘️ Crypto-Town <span>Kit</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r>${TOOLS_NAV}<a href="${bp('/')}">The kit</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── the landing / kit checklist ─────────────────────────────────────────────────────────────────────
// `town` (optional) is a user-supplied community name echoed in the hero — ALWAYS esc()'d. `ret`
// (optional) is a return path for an embedding hub — passed through safeHref() before it is an href.
export function kitPage({ town, ret } = {}) {
  const back = safeHref(ret);
  const echoedTown = town
    ? `<p class=sub>Standing up the economy for: <b>${esc(town)}</b></p>`
    : '';

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'HowTo',
    name: 'Start your community\'s on-chain economy',
    description: 'A six-step kit that bundles existing building blocks — a community token, local payments, a town charter, oversight, member identity, and a legal note — into one turnkey guide.',
    step: STEPS.map((s) => ({ '@type': 'HowToStep', position: s.n, name: s.title, text: s.intro, url: `${BASE_URL}${bp('/step/' + s.slug)}` })),
  };

  const stepCards = STEPS.map((s) => `
  <section class=step id="${esc(s.slug)}">
    <div class=row>
      <div class=badge>${esc(String(s.n))}</div>
      <div style="flex:1;min-width:0">
        <h3><a href="${bp('/step/' + esc(s.slug))}">${esc(s.title)}</a></h3>
        <p class=intro>${esc(s.intro)}</p>
        <div class=links>${s.links.map((l) => linkOut(l.url, l.label)).join('')}</div>
      </div>
      <label class=chk><input type=checkbox data-step="${esc(s.slug)}"> Done</label>
    </div>
  </section>`).join('');

  const body = `
${back ? `<div class=backlink><a href="${esc(back)}">&larr; Back</a></div>` : ''}
<h1>Start your community's economy</h1>
<p class=sub>A turnkey kit for a town, a co-op, a congregation, or a DAO. Six steps, each one wired to a
  building block that already exists — you bring the community, the kit brings the assembly.</p>
${echoedTown}

<div class=lede>
  <p><b>We have every piece — this is the bundle.</b> Standing up an on-chain community economy usually
    means gluing a dozen tools together. This kit walks you through six, in order, each linking the real
    surface that does the job.</p>
  <p class=muted>No new chain mechanics. A community token is a <b>tool for real utility</b> — goods,
    services, access, and time-credits — never a speculation. Work the checklist at your own pace.</p>
</div>

<div class=steps>${stepCards}</div>

<div class=callout>
  <b>Legal, plainly:</b> a community can run all of this inside an ordinary legal form — a 501(c)(3)
  nonprofit, a cooperative, or a religious organization. That is general education, <b>not legal
  advice</b> — <a href="${bp('/step/legal')}">read the legal note</a> and consult a licensed professional
  before you form an entity or treat the token as having legal or tax consequences.
</div>

<script>
(function(){
  // Client-side only: remember which steps a visitor has ticked off. Best-effort — wrapped so a blocked
  // or private localStorage never breaks the page (it just won't remember).
  var KEY='cryptotown.done.v1';
  function load(){ try{ return JSON.parse(localStorage.getItem(KEY)||'{}')||{}; }catch(e){ return {}; } }
  function save(o){ try{ localStorage.setItem(KEY, JSON.stringify(o)); }catch(e){} }
  var state=load();
  document.querySelectorAll('input[data-step]').forEach(function(b){
    var k=b.getAttribute('data-step');
    b.checked=!!state[k];
    b.addEventListener('change', function(){ state[k]=b.checked; save(state); });
  });
})();
</script>`;

  return page('Crypto-Town Kit — Start Your Community\'s Economy', body, { canonical: `${BASE_URL}${bp('/')}`, jsonld });
}

// ── a single step's deep page ───────────────────────────────────────────────────────────────────────
export function stepPage(slug) {
  const s = stepBySlug(slug);
  if (!s) return null;
  const idx = STEPS.indexOf(s);
  const prev = STEPS[idx - 1];
  const next = STEPS[idx + 1];
  const jsonld = {
    '@context': 'https://schema.org', '@type': 'HowToStep',
    position: s.n, name: s.title, text: s.intro,
    url: `${BASE_URL}${bp('/step/' + s.slug)}`,
  };
  const body = `
<div class=backlink><a href="${bp('/')}">&larr; Back to the kit</a></div>
<h1>Step ${esc(String(s.n))} · ${esc(s.title)}</h1>
<p class=sub>${esc(s.intro)}</p>
<div class=prose>${s.body.map((p) => `<p>${p}</p>`).join('')}</div>
<div class=links style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px">${s.links.map((l) => linkOut(l.url, l.label)).join('')}</div>
<div class=stepnav>
  <span>${prev ? `<a href="${bp('/step/' + esc(prev.slug))}">&larr; ${esc(prev.title)}</a>` : ''}</span>
  <span>${next ? `<a href="${bp('/step/' + esc(next.slug))}">${esc(next.title)} &rarr;</a>` : ''}</span>
</div>`;
  return page(`Step ${esc(String(s.n))}: ${esc(s.title)} — Crypto-Town Kit`, body, {
    canonical: `${BASE_URL}${bp('/step/' + s.slug)}`, jsonld,
  });
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', ...STEP_SLUGS.map((s) => '/step/' + s)];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true }));
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'weekly', priority: u === '/' ? '1.0' : '0.7' }));
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
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'A turnkey "start your community\'s economy" kit: six guided steps (community token, local currency, town charter/governance, oversight, member identity/REN, 501(c)(3)/legal note) that bundle existing building blocks. Token = real utility, not speculation. Legal step is education, not legal advice.',
        links: [{ label: 'The kit', path: '/' }, ...STEPS.map((s) => ({ label: `Step ${s.n}: ${s.title}`, path: '/step/' + s.slug }))],
      }));
    }

    if (path === '/' || path === '') {
      return sendHtml(res, kitPage({
        town: url.searchParams.get('town') || '',
        ret: url.searchParams.get('ret') || '',
      }));
    }

    if (path.startsWith('/step/')) {
      const slug = path.slice('/step/'.length).replace(/\/+$/, '');
      const html = stepPage(slug);
      if (html) return sendHtml(res, html);
    }

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — Crypto-Town Kit', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="' + bp('/') + '">Open the kit</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/towns\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`Crypto-Town Kit on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
