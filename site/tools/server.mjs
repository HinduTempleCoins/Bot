// server.mjs — Tools.SoapBox.Community. The unifying hub for the mundane-app suite
// (mundane-app-suite-stealth-funnel). One friendly, free-tools directory: a card grid of genuinely
// useful everyday utilities (flashlight, calculator, notes, QR, …), a little games shelf, plus a Move
// card and a Wallet/Profile front-door card. Everything is standalone-useful first; there is NO crypto
// pitch on this landing page — that is the whole point (asserted in tools.test.mjs).
//
//   PORT=8230 BASE_URL=https://tools.soapbox.community node site/tools/server.mjs
//   → serves the directory landing at  /
//
// ── ARCHITECTURE (per-process, path-routing proxy — NOT single-process mounting) ────────────────────
//   Each app is its OWN service on its own port. A path-routing reverse proxy (Caddy) sits in front at
//   tools.soapbox.community and routes  /flashlight/* → the flashlight service (started with
//   BASE_PATH=/flashlight), /calculator/* → the calculator service, and so on. The proxy STRIPS the
//   prefix inbound (each app's routes stay on '/', '/health', '/www/…'); each app PREPENDS its BASE_PATH
//   to every self-URL it emits. This hub only serves the landing directory + crawler files; it does not
//   proxy or import the apps. See site/tools/DEPLOY.md for the full Caddy map.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                  the directory landing (card grid, shelves)
//   /health            liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated value; safeHref() on any URL that comes from env/config. Soft-fail:
//   every route renders; unknown path → 404, never a 500. No PII intake, no network at runtime.

import { createServer } from 'node:http';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8230);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Tools';

// The hub lives at the domain root; BASE_PATH defaults to '' (root). Kept for symmetry with the apps
// and so the hub could itself be mounted under a prefix without breaking its internal links.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;

// Move + Wallet/Profile are front-door cards. They link out only if their URL env is set; otherwise the
// card renders as a friendly "coming soon" tile. We deliberately do NOT build Move or the wallet here.
const MOVE_URL = process.env.MOVE_URL || '';
const WALLET_URL = process.env.WALLET_URL || '';

// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// safeHref: only pass through real http(s) URLs; everything else (javascript:, data:, junk) → ''.
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// ── the app registry — one source of truth for the cards, the sitemap and llms.txt ──────────────────
// Every entry is deliberately described as a plain, useful tool. No crypto/token/blockchain language.
export const UTILITIES = [
  { slug: 'flashlight', emoji: '🔦', name: 'Flashlight', tagline: 'Instant screen light', blurb: 'A bright, full-screen flashlight with adjustable colour and brightness.' },
  { slug: 'calculator', emoji: '🧮', name: 'Calculator', tagline: 'Scientific & everyday', blurb: 'A fast calculator with full keyboard support and a running history.' },
  { slug: 'passgen', emoji: '🔐', name: 'Password Generator', tagline: 'Strong, random passwords', blurb: 'Generate strong passwords right in your browser — nothing is sent anywhere.' },
  { slug: 'notes', emoji: '📝', name: 'Notes', tagline: 'Instant scratchpad', blurb: 'A clean notepad that autosaves as you type. Just start writing.' },
  { slug: 'outliner', emoji: '🌳', name: 'Outliner', tagline: 'Collapsible to-do tree', blurb: 'Organise thoughts and tasks in a foldable outline that autosaves.' },
  { slug: 'qr', emoji: '🔳', name: 'QR Codes', tagline: 'Text, links & Wi-Fi → QR', blurb: 'Turn text, a link or Wi-Fi details into a QR code — download PNG or SVG.' },
  { slug: 'markdown', emoji: '✍️', name: 'Markdown Editor', tagline: 'Write with live preview', blurb: 'Write Markdown with an instant preview; export a clean .md or .html file.' },
  { slug: 'timer', emoji: '⏲️', name: 'Timer & Stopwatch', tagline: 'Focus, countdown, stopwatch', blurb: 'A countdown, stopwatch and focus timer that keeps working offline.' },
  { slug: 'converter', emoji: '🔁', name: 'Unit Converter', tagline: 'Units & currency', blurb: 'Convert units and currencies — units work offline, rates fetch live.' },
  { slug: 'weather', emoji: '⛅', name: 'Weather', tagline: 'Your local forecast', blurb: 'A clean local forecast with no ads and nothing to sign up for.' },
  { slug: 'habits', emoji: '✅', name: 'Habit Tracker', tagline: 'Build streaks', blurb: 'Track daily habits and keep your streaks going, all in your browser.' },
  { slug: 'diagram', emoji: '📊', name: 'Diagram Maker', tagline: 'Flowcharts from text', blurb: 'Type text and get a flowchart, sequence diagram, org chart or mind map.' },
];

export const GAMES = [
  { slug: 'idlegames', emoji: '🎮', name: 'Coffee-Break Games', tagline: 'A little pocket arcade', blurb: 'Quick original browser games — idle clicker, snake, merge and minesweeper.' },
];

// The paths this hub advertises to crawlers (each resolves through the proxy to its own app service).
export const APP_PATHS = ['/', ...UTILITIES.map((a) => `/${a.slug}`), ...GAMES.map((a) => `/${a.slug}`)];
export const SITEMAP_PATHS = APP_PATHS;

// ── style (house style; mirrors site/diagram + site/idlegames) ──────────────────────────────────────
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--acc:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--acc);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap;background:var(--panel)}
  .topbar-r a:hover{border-color:var(--acc);color:var(--acc);text-decoration:none}
  .wrap{max-width:1080px;margin:0 auto;padding:22px 22px 60px}
  h1{margin:0 0 4px;font-size:28px} .sub{color:var(--mut);margin:0 0 8px;font-size:15px;max-width:60ch}
  .muted{color:var(--mut)}
  h2.shelf{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:var(--mut);margin:26px 0 8px;font-weight:700}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px;margin:8px 0}
  a.card,div.card{display:block;background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:18px;transition:border-color .12s,transform .12s}
  a.card:hover{border-color:var(--acc);text-decoration:none;transform:translateY(-2px)}
  .card .e{font-size:2rem;display:block;margin-bottom:6px}
  .card .t{font-weight:800;font-size:1.12rem;color:var(--fg)}
  .card .tl{color:var(--acc);font-size:.86rem;margin:2px 0 8px}
  div.card .tl{color:var(--mut)}
  .card .b{color:var(--mut);font-size:.9rem}
  .soon{display:inline-block;font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gold);border:1px solid var(--line2);border-radius:20px;padding:1px 8px;float:right}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--acc)}
</style>`;

const FOOTER = `<footer>
  <b>${esc(SITE_NAME)}</b> — a collection of free, private, everyday tools. Each one runs in your browser,
  needs no sign-up and keeps your data on your own device. Pick a tool and go.
</footer>`;

// ── page shell ──────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Free, private everyday tools in one place — flashlight, calculator, password generator, notes, QR codes, timer, unit converter, weather, habit tracker and a diagram maker. No sign-up, no install.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    jsonld: opts.jsonld || null,
  });
  // A couple of quick links in the top bar for parity with the app pages' shared nav.
  const quick = `<a href="${esc(bp('/calculator'))}">Calculator</a><a href="${esc(bp('/notes'))}">Notes</a>`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="${esc(bp('/'))}">◧ SoapBox <span>Tools</span><span class=alpha>Alpha</span></a>
  <div class=topbar-r>${quick}</div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── card renderers ────────────────────────────────────────────────────────────────────────────────
function toolCard(a) {
  return `<a class=card href="${esc(bp('/' + a.slug))}">
    <span class=e>${esc(a.emoji)}</span>
    <span class=t>${esc(a.name)}</span>
    <span class=tl>${esc(a.tagline)}</span>
    <span class=b>${esc(a.blurb)}</span></a>`;
}

// A front-door card. If `href` (from env, via safeHref) is set it links out; otherwise it's a calm
// "coming soon" tile — never a dead link, never a pitch.
function frontDoorCard({ emoji, name, tagline, blurb, href }) {
  const safe = safeHref(href);
  const inner = `<span class=e>${esc(emoji)}</span>
    <span class=t>${esc(name)}</span>
    <span class=tl>${esc(tagline)}</span>
    <span class=b>${esc(blurb)}</span>`;
  return safe
    ? `<a class=card href="${esc(safe)}">${inner}</a>`
    : `<div class=card><span class=soon>coming soon</span>${inner}</div>`;
}

// ── the landing directory ───────────────────────────────────────────────────────────────────────────
export function landingPage() {
  const utilities = UTILITIES.map(toolCard).join('');
  const games = GAMES.map(toolCard).join('');

  // Move: a plain, useful "step counter that rewards walking" tile to a newcomer. No earn/geomining
  // language on the front — that depth reveals itself only once someone is inside the app.
  const moveCard = frontDoorCard({
    emoji: '👟', name: 'Move', tagline: 'Step counter & walking rewards',
    blurb: 'Count your daily steps and earn little rewards just for walking.',
    href: MOVE_URL,
  });

  // Wallet/Profile: the front-door identity card — one profile + watchlist that follows you across the
  // tools. Described plainly; it is a directory tile, not a wallet build and not a token pitch.
  const walletCard = frontDoorCard({
    emoji: '🪪', name: 'Wallet / Profile', tagline: 'One profile across your tools',
    blurb: 'A single profile and watchlist that follows you from tool to tool — one login for everything you use here.',
    href: WALLET_URL,
  });

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'WebSite',
    name: SITE_NAME, url: `${BASE_URL}/`,
    description: 'A directory of free, private everyday web tools — flashlight, calculator, notes, QR codes, timer, converter, weather, habits and more.',
  };

  const body = `<h1>Free tools for everyday things</h1>
<p class=sub>A little collection of fast, private tools that just work — no sign-up, no install, no ads.
  Pick one and go; everything runs right here in your browser.</p>

<h2 class=shelf>Utilities</h2>
<div class=grid>${utilities}</div>

<h2 class=shelf>Games</h2>
<div class=grid>${games}</div>

<h2 class=shelf>Move</h2>
<div class=grid>${moveCard}</div>

<h2 class=shelf>Your profile</h2>
<div class=grid>${walletCard}</div>`;

  return page(`${SITE_NAME} — free everyday web tools, no sign-up`, body, { canonical: `${BASE_URL}/`, jsonld });
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

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
        summary: 'A directory of free, private, browser-based everyday tools (flashlight, calculator, password generator, notes, outliner, QR codes, markdown, timer, converter, weather, habits, diagrams) plus a games shelf. No account, no install, no tracking.',
        links: [...UTILITIES, ...GAMES].map((a) => ({ label: a.name, path: `/${a.slug}`, note: a.tagline })),
      }));
    }

    if (path === '/') return sendHtml(res, landingPage());

    // unknown → 404, never a 500
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — SoapBox Tools', '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="' + bp('/') + '">Back to all tools</a>.</p>', { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/tools\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Tools on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
