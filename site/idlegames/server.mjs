// server.mjs — Idle-Time Games (idlegames.soapbox.community). A hub of genuinely-playable, ORIGINAL
// casual browser games for people killing a few minutes at work or school — "for your coffee break".
// Every game runs 100% CLIENT-SIDE (canvas/DOM + inline vendored JS — no CDN, no <script src> to a
// third party, no network at runtime). High scores persist to localStorage (try/catch guarded).
//
//   PORT=8311 BASE_URL=https://idlegames.soapbox.community node site/idlegames/server.mjs
//   → the hub at  /   · each game at its own path ( /idle /snake /merge /mines )
//
// ── STEALTH FUNNEL (mundane-app-suite-stealth-funnel) ──────────────────────────────────────────────
//   ZERO crypto up front. The hub reads and plays like an ordinary free browser-games site. Off-chain
//   PLAY is the default and works fully with no account. MELEK appears ONLY as a small, OPTIONAL "☆ Save
//   your high score / earn while you play" affordance on a game page that, when clicked, explains
//   (client-side) that keeping scores across devices + opting into earning needs a free MELEK account.
//   No wallet, no token talk, never the opening pitch. Some games are labelled "just for fun" (off-chain);
//   the earn is an opt-in extra, never required.
//
//   This is deliberately SEPARATE from site/games/ (the PRANA "play & earn on-chain" link directory) and
//   from MELEK Move (a step-counter / geominer — NOT built here). These are original casual games only.
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────────
//   /            the hub — card grid of games
//   /idle        Cinder Foundry v2 — idle/incremental clicker (exp cost, prestige, achievements, offline cap)
//   /kindling    Kindling — a minimalist "first idle" (idle-kit engine)
//   /temple      Tap Temple — a calm clicker, MELEK/temple flavor (idle-kit engine)
//   /ledger      Ledger Legends — a text-driven idle RPG with a scrolling quest log (idle-kit engine)
//   /orchard     Star Harvest — a farm-idle; grows starlight overnight (idle-kit engine)
//   /delve       Deep Delve — a mining-idle with a live Depth meter (idle-kit engine)
//   /snake       Glow Worm — a snake-style game (arrow/WASD, growing worm, score)
//   /merge       Nova Merge — a 2048-style merge game (original tiles; merge logic implemented here)
//   /mines       Signal Sweeper — a minesweeper-style grid (reveal/flag, best time)
//   /www/idle-kit.js  the shared idle engine (offline accrual, streak, prestige, achievements), vendored locally
//   /health      liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated / echoed value; safeHref() on any user-provided URL. The handler does NO
//   request-time network. Soft-fail: every route renders even with no data — unknown path → 404, never a
//   500. No PII intake. All game mechanics + names + art are ORIGINAL (public-domain genres — clicker,
//   snake, merge, minesweeper — with our own naming/theme/colours; no branded IP, no copied sprite sheets).

import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const WWW = join(HERE, 'www');
// idle-kit.js — the shared retention engine, vendored locally in www/. Read ONCE at module load (no
// request-time I/O) and inlined into each idle game's page so the pages stay self-contained (the surface
// forbids <script src>). Also served raw at /www/idle-kit.js for cacheability + honest "lives in www/".
const IDLE_KIT_JS = (() => { try { return readFileSync(join(WWW, 'idle-kit.js'), 'utf8'); } catch { return ''; } })();
// Wrap a per-game inline script so it runs AFTER the kit is defined on window.IdleKit.
const withKit = (inner) => `<script>${IDLE_KIT_JS}</script>\n<script>${inner}</script>`;

const PORT = +(process.env.PORT || 8311);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'Idle-Time Games';
// The opt-in unlock links the ordinary free-account signup flow (env-overridable). No wallet/token here.
const SIGNUP_URL = process.env.SIGNUP_URL || 'https://wallet.melek.salon/signup';

// ── Tools-hub path awareness (mundane-app-suite-stealth-funnel) ────────────────
// This app runs as its own process behind a path-routing proxy at tools.soapbox.community/<app>.
// The proxy STRIPS the prefix inbound (our routes stay on '/', '/health', '/www/…'); we PREPEND it to
// every self-URL we EMIT. BASE_PATH defaults to '' → standalone behaviour is byte-for-byte unchanged.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
// The Tools hub sits at the domain root (default '/'); sibling links point at the hub, not this app.
const TOOLS_HUB_URL = (process.env.TOOLS_HUB_URL || '/').replace(/\/+$/, '');
const hub = (p) => TOOLS_HUB_URL + p;
const SLUG = 'idlegames';
const HUB_SIBLINGS = [['/calculator', 'Calculator'], ['/notes', 'Notes'], ['/qr', 'QR'], ['/timer', 'Timer'], ['/converter', 'Converter'], ['/diagram', 'Diagram']];
const TOOLS_NAV = `<a class=hublink href="${hub('/')}">◧ SoapBox Tools</a>`
  + HUB_SIBLINGS.filter(([p]) => p !== '/' + SLUG).slice(0, 2).map(([p, l]) => `<a href="${hub(p)}">${l}</a>`).join('');


// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// safeHref: only pass through real http(s) URLs; everything else (javascript:, data:, junk) → ''.
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// ── the catalog — each game is its own path. `fun:true` = purely off-chain "just for fun". ───────────
export const GAMES = [
  { slug: 'idle',  name: 'Cinder Foundry', emoji: '🔥', fun: true, idle: true,
    tagline: 'An idle forge that keeps working while you\'re away',
    blurb: 'Strike the anvil for sparks, then hire bellows, apprentices and furnaces that forge cinders for you — even after you close the tab. Ascend for permanent Emberstone bonuses. The classic idle game.' },
  { slug: 'kindling', name: 'Kindling', emoji: '✦', fun: true, idle: true,
    tagline: 'A tiny, elegant first idle game',
    blurb: 'One resource, a handful of makers, one prestige. A deliberately small, polished incremental — the friendliest way into the genre. Gathers sparks while you\'re gone.' },
  { slug: 'temple', name: 'Tap Temple', emoji: '🛕', fun: true, idle: true,
    tagline: 'Tap for offerings; hire acolytes to gather while you rest',
    blurb: 'Tap the altar for offerings, then bring on acolytes, scribes and oracles who keep the incense burning for you. Reach an Ascension for a lasting blessing. A calm idle clicker.' },
  { slug: 'ledger', name: 'Ledger Legends', emoji: '📜', fun: true, idle: true,
    tagline: 'A text-driven idle adventure that quests on its own',
    blurb: 'Recruit couriers, scouts and heroes who run auto-quests and post their deeds to a scrolling log. Watch renown climb, then Retire for a permanent renown multiplier. Pure numbers-and-strings idle.' },
  { slug: 'orchard', name: 'Star Harvest', emoji: '🌱', fun: true, idle: true,
    tagline: 'Plant light-seeds; harvest starlight even overnight',
    blurb: 'Tend beds of light-seeds that grow starlight around the clock — add plots, speed the bloom, and come back to a full harvest. Bloom to reset for a permanent yield boost. A gentle farm-idle.' },
  { slug: 'delve', name: 'Deep Delve', emoji: '⛏️', fun: true, idle: true,
    tagline: 'Auto-miners dig ever deeper for ore while you\'re away',
    blurb: 'Send drills and carts down through the strata; deeper rock is richer but harder. Hit a wall, then trigger a Collapse to restart with a permanent depth multiplier. A moreish mining-idle.' },
  { slug: 'snake', name: 'Glow Worm', emoji: '🪱', fun: true,
    tagline: 'Steer a growing worm; don\'t bite your own tail',
    blurb: 'Arrow keys or WASD. Eat the glowing motes, grow longer, chase your high score. One wrong turn and it\'s over.' },
  { slug: 'merge', name: 'Nova Merge', emoji: '✦', fun: true,
    tagline: 'Slide and merge orbs into a supernova',
    blurb: 'Swipe the board; equal orbs fuse and double. Reach the Nova tile — then see how far past it you can push. A 2048-style brain-teaser.' },
  { slug: 'mines', name: 'Signal Sweeper', emoji: '📡', fun: true,
    tagline: 'Clear the field without tripping a signal',
    blurb: 'Reveal safe cells, flag the hidden signals, race the clock. Numbers tell you how many signals touch a cell. A minesweeper-style logic puzzle.' },
];
export const GAME_SLUGS = GAMES.map((g) => g.slug);
export const gameBySlug = (s) => GAMES.find((g) => g.slug === s) || null;

// ── styling (dark, arcade-ish, self-contained) ───────────────────────────────────────────────────────
const STYLE = `<style>
  :root{--bg:#0c0e14;--panel:#151823;--line:#232838;--line2:#333a50;--fg:#e8ecf5;--mut:#8b93a7;--acc:#6ea8ff;--gold:#e0a92e;--up:#54c96a;--down:#f8595a}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--acc);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap;background:var(--panel)}
  .topbar-r a:hover{border-color:var(--acc);color:var(--acc);text-decoration:none}
  .wrap{max-width:1080px;margin:0 auto;padding:22px 22px 60px}
  h1{margin:0 0 4px;font-size:28px} .sub{color:var(--mut);margin:0 0 18px;font-size:15px}
  .muted{color:var(--mut)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px;margin:18px 0}
  a.card{display:block;background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:18px;transition:border-color .12s,transform .12s}
  a.card:hover{border-color:var(--acc);text-decoration:none;transform:translateY(-2px)}
  a.card .e{font-size:2rem;display:block;margin-bottom:6px}
  a.card .t{font-weight:800;font-size:1.12rem;color:var(--fg)}
  a.card .tl{color:var(--acc);font-size:.86rem;margin:2px 0 8px}
  a.card .b{color:var(--mut);font-size:.9rem}
  .fun{display:inline-block;font-size:.6rem;text-transform:uppercase;letter-spacing:.05em;color:var(--up);border:1px solid var(--line2);border-radius:20px;padding:1px 8px;float:right}
  .backlink{font-size:13px;margin-bottom:12px}
  .gamehead{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;margin-bottom:4px}
  .gamehead h1{font-size:24px;margin:0}
  .score-row{display:flex;gap:18px;flex-wrap:wrap;align-items:center;margin:12px 0;font-size:15px}
  .score-row .box{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:8px 14px}
  .score-row .box b{color:var(--gold);font-variant-numeric:tabular-nums}
  .btn{border:1px solid var(--line2);border-radius:9px;padding:8px 15px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer}
  .btn:hover{border-color:var(--acc);color:var(--acc)}
  .stage{margin:10px 0}
  canvas{background:#080a10;border:1px solid var(--line2);border-radius:12px;max-width:100%;height:auto;touch-action:none;display:block}
  .hint{color:var(--mut);font-size:13px;margin:10px 0}
  .challenge{background:#e0a92e18;border:1px solid var(--gold);border-radius:10px;padding:10px 14px;margin:10px 0;color:var(--fg);font-size:14px}
  /* idle */
  .foundry{display:grid;grid-template-columns:1fr 1.2fr;gap:16px} @media(max-width:720px){.foundry{grid-template-columns:1fr}}
  .anvil{background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:22px;text-align:center}
  .anvil .count{font-size:2.4rem;font-weight:800;color:var(--gold);font-variant-numeric:tabular-nums}
  .anvil .rate{color:var(--mut);font-size:.9rem;margin-bottom:14px}
  .strike{font-size:3.6rem;line-height:1;border:none;background:none;cursor:pointer;user-select:none;filter:drop-shadow(0 0 10px #e0a92e66);transition:transform .05s}
  .strike:active{transform:scale(.9)}
  .shop{display:flex;flex-direction:column;gap:8px}
  .up{display:flex;align-items:center;gap:12px;background:var(--panel);border:1px solid var(--line2);border-radius:11px;padding:10px 14px;text-align:left;cursor:pointer;color:var(--fg)}
  .up:hover:not(:disabled){border-color:var(--acc)} .up:disabled{opacity:.5;cursor:not-allowed}
  .up .ue{font-size:1.6rem} .up .un{font-weight:700} .up .ud{color:var(--mut);font-size:.82rem}
  .up .uc{margin-left:auto;text-align:right;white-space:nowrap} .up .uc b{color:var(--gold)} .up .uc small{display:block;color:var(--mut)}
  .away{background:#54c96a18;border:1px solid var(--up);border-radius:10px;padding:10px 14px;margin:10px 0;font-size:14px}
  /* idle-kit: prestige, achievements, flavor log */
  .prestige{display:flex;align-items:center;gap:14px;flex-wrap:wrap;background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:12px 16px;margin:14px 0}
  .prestige .hint{margin:0;flex:1;min-width:220px}
  .achs{margin:12px 0}
  .achs-h{color:var(--mut);font-size:.72rem;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px}
  .ach{display:inline-block;font-size:.78rem;color:var(--mut);border:1px solid var(--line2);border-radius:20px;padding:3px 10px;margin:0 6px 6px 0;background:var(--panel);opacity:.55}
  .ach.got{color:var(--gold);border-color:var(--gold);opacity:1}
  .idlelog{background:#080a10;border:1px solid var(--line2);border-radius:10px;padding:10px 14px;margin:12px 0;max-height:190px;overflow:auto;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .idlelog-line{color:var(--mut);padding:2px 0;border-bottom:1px solid #12151f}
  .idlelog-line:first-child{color:var(--fg)}
  /* merge tiles */
  .board{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;background:var(--panel);border:1px solid var(--line2);border-radius:14px;padding:10px;width:min(92vw,420px);aspect-ratio:1}
  .cell{display:flex;align-items:center;justify-content:center;border-radius:10px;background:#0d1018;font-weight:800;font-size:clamp(16px,6vw,30px);color:#0c0e14}
  .cell[data-v="0"]{color:transparent}
  /* mines */
  .mfield{display:grid;gap:3px;background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:8px;width:max-content;max-width:100%}
  .mrow{display:flex;gap:3px}
  .mc{width:30px;height:30px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;border-radius:6px;background:#1c2233;border:1px solid var(--line2);cursor:pointer;user-select:none}
  .mc.open{background:#0d1018;cursor:default}
  .mc.flag{background:#e0a92e22}
  .mc.mine{background:#f8595a33}
  /* opt-in */
  .optin{margin:22px 0 6px}
  .optin>button{border:1px solid var(--line2);border-radius:9px;padding:8px 15px;font-weight:700;font-size:14px;color:var(--mut);background:var(--panel);cursor:pointer}
  .optin>button:hover{border-color:var(--gold);color:var(--gold)}
  .panel{display:none;border:1px solid var(--gold);background:#e0a92e11;border-radius:11px;padding:16px 18px;margin:12px 0;color:var(--fg);max-width:640px}
  .panel.on{display:block}
  .panel h3{margin:0 0 6px;font-size:16px} .panel p{margin:6px 0;font-size:14px}
  .panel a.cta{display:inline-block;margin-top:8px;border:1px solid var(--gold);color:var(--gold);border-radius:8px;padding:8px 15px;font-weight:700}
  .panel a.cta:hover{background:var(--gold);color:#0c0e14;text-decoration:none}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:26px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--acc)}
</style>`;

// The understated opt-in. Off-chain play always works; this only reveals on click. It names the free
// account and the optional earn — never a wallet/token pitch, never the opening copy.
function optInBlock() {
  const cta = esc(safeHref(SIGNUP_URL) || '/');
  return `<div class=optin>
  <button type=button id=optin-btn>☆ Save your high score / earn while you play</button>
  <div class=panel id=optin-panel role=note>
    <h3>Your scores are already saved — on this device</h3>
    <p>Every game here is <b>just for fun</b> and works fully with no account; your best scores live in this
      browser automatically. If you'd like to keep them <b>across devices</b> — and optionally <b>earn as you
      play</b> — you can create a free MELEK account. It's completely optional; nothing here needs it.</p>
    <p class=muted>Prefer to just play? Ignore this and carry on — no sign-up, no interruptions.</p>
    <a class=cta href="${cta}" target=_blank rel="noopener">Create a free account</a>
  </div>
</div>
<script>(function(){var b=document.getElementById('optin-btn'),p=document.getElementById('optin-panel');
  if(b&&p)b.addEventListener('click',function(){p.classList.toggle('on');if(p.classList.contains('on'))p.scrollIntoView({behavior:'smooth',block:'nearest'});});})();</script>`;
}

const FOOTER = `<footer>
  <b>${esc(SITE_NAME)}</b> — free browser games for your coffee break. Everything runs in your browser; your
  scores save to this device. No sign-up, no install, no tracking. Original games — public-domain genres,
  our own names &amp; art.
</footer>`;

// ── page shell ──────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description
    || 'Free, original browser games for a quick break — idle/incrementals (a forge, a farm, a mine, a temple clicker, a text idle RPG) plus arcade classics (snake, a 2048-style merge, minesweeper). No sign-up, no install; runs entirely in your browser.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  // Neutral SoftwareApplication JSON-LD only — this surface carries no crypto branding, even in metadata.
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="${bp('/')}">🎮 ${esc(SITE_NAME)}<span class=alpha>Alpha</span></a>
  <div class=topbar-r>${TOOLS_NAV}<a href="${bp('/')}">All games</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── the hub ───────────────────────────────────────────────────────────────────────────────────────
// NOTE: deliberately no crypto/token/wallet/earn pitch here — the hub is pure play. The opt-in lives on
// the game pages (where a high score actually exists to save).
export function hubPage() {
  const cards = GAMES.map((g) => `<a class=card href="${bp('/' + esc(g.slug))}">
    ${g.fun ? '<span class=fun>just for fun</span>' : ''}
    <span class=e>${esc(g.emoji)}</span>
    <span class=t>${esc(g.name)}</span>
    <span class=tl>${esc(g.tagline)}</span>
    <span class=b>${esc(g.blurb)}</span></a>`).join('');

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'WebSite',
    name: SITE_NAME, url: `${BASE_URL}/`,
    description: 'Free original browser games for a quick break — idle clicker, snake, 2048-style merge, minesweeper.',
  };
  const body = `<h1>Games for your coffee break</h1>
<p class=sub>A little pocket arcade for when you've got five minutes to kill. Pick one, no sign-up, no install —
  it plays right here in your browser and remembers your best score.</p>
<div class=grid>${cards}</div>
<p class=hint>Every game here is an original built on a classic public-domain genre — idle forges, farms, mines
  and clickers that tick along while you're away, plus a few quick arcade classics. Your progress saves to this
  browser automatically — see the ☆ on any game if you'd like to keep it across devices.</p>`;
  return page(`${SITE_NAME} — free browser games for a quick break`, body, { canonical: `${BASE_URL}/`, jsonld });
}

// A challenge banner from share params (?by=&s=). BOTH are user-controlled → esc()'d. `s` is coerced to
// a bounded integer so nothing but digits is ever echoed as the score.
function challengeBanner(params) {
  const by = params.get('by');
  const sRaw = params.get('s');
  if (!by && !sRaw) return '';
  const score = /^\d{1,12}$/.test(String(sRaw || '')) ? String(sRaw) : '';
  const who = by ? esc(by) : 'A friend';
  const scoreTxt = score ? ` of <b>${esc(score)}</b>` : '';
  return `<div class=challenge>🏁 ${who} challenged you to beat their score${scoreTxt}. Give it a go!</div>`;
}

// ── game pages. Each returns a full page; all game logic is inline, client-side, canvas/DOM only. ─────
function gamePage(slug, params) {
  const g = gameBySlug(slug);
  if (!g) return null;
  const banner = challengeBanner(params);
  const back = `<div class=backlink><a href="${bp('/')}">&larr; All games</a></div>`;
  const head = `<div class=gamehead><span style="font-size:1.8rem">${esc(g.emoji)}</span>
    <h1>${esc(g.name)}</h1><span class=muted>${esc(g.tagline)}</span></div>`;
  const bodyByGame = {
    idle: idleGame(), kindling: kindlingGame(), temple: templeGame(), ledger: ledgerGame(),
    orchard: orchardGame(), delve: delveGame(),
    snake: snakeGame(), merge: mergeGame(), mines: minesGame(),
  };
  const body = `${back}${head}${banner}${bodyByGame[slug]}${optInBlock()}`;
  return page(`${g.name} — ${SITE_NAME}`, body, { canonical: `${BASE_URL}/${slug}` });
}

// ── GAME 1: Cinder Foundry v2 (idle / incremental clicker) ───────────────────────────────────────────
// v2 (on idle-kit): exponential cost curve, Emberstone prestige/ascension, achievements, an 8h offline
// cap with a proper "while you were away" collect screen, and a daily-login streak yield bonus. The
// bespoke anvil shell is kept; all the mechanics come from window.IdleKit so it matches the sibling games.
function idleGame() {
  return `<p class=sub>Strike the anvil for sparks, then hire help that forges cinders for you — even while
  the tab is closed. Come back later and collect what your foundry made; ascend for permanent Emberstone bonuses.</p>
<div id=away class=away style="display:none"></div>
<div class=foundry>
  <div class=anvil>
    <div class=count id=count>0</div>
    <div class=rate id=rate>0.0 / sec</div>
    <div class=hint id=meta></div>
    <button class=strike id=strike title="Strike the anvil">🔨</button>
    <div class=hint>Click the hammer. Every strike = <b id=cp>1</b> cinder.</div>
    <div class=hint id=streak></div>
  </div>
  <div class=shop id=shop></div>
</div>
<div class=prestige><div class=hint id=prestige-info></div><button class=btn id=prestige-btn>Ascend</button></div>
<div class=achs id=achs></div>
${withKit(idleScript())}`;
}
function idleScript() {
  // Cinder Foundry keeps its own anvil markup but drives IdleKit for the maths (format/cost/away/prestige/
  // streak/achievements). Offline accrual caps at 8h; saves every 5s + on hide/visibility-change.
  return `(function(){
  var K=window.IdleKit; if(!K)return;
  var KEY='idlegames.cinderfoundry.v2', CAP=8;
  var GENS=[
    {id:'bellows',   name:'Bellows',     emoji:'🎐', rate:0.2, base:15,    desc:'Fans the coals. +0.2/sec each.'},
    {id:'apprentice',name:'Apprentice',  emoji:'🧑‍🏭', rate:1,   base:110,   desc:'A helping pair of hands. +1/sec each.'},
    {id:'furnace',   name:'Furnace',     emoji:'🏭', rate:8,   base:1200,  desc:'Roars day and night. +8/sec each.'},
    {id:'golem',     name:'Forge Golem', emoji:'🗿', rate:50,  base:13000, desc:'Tireless iron worker. +50/sec each.'}
  ];
  var ACH=[
    {id:'first',  name:'First Spark',   emoji:'✨', desc:'Forge 100 cinders.',       test:function(s){return s.lifetime>=100;}},
    {id:'crew',   name:'A Full Crew',   emoji:'👥', desc:'Own 25 buildings in all.', test:function(s){return total(s)>=25;}},
    {id:'roaring',name:'Roaring Forge', emoji:'🔥', desc:'Reach 1M lifetime cinders.',test:function(s){return s.lifetime>=1e6;}},
    {id:'ascend', name:'Reborn in Fire',emoji:'💎', desc:'Ascend at least once.',    test:function(s){return s.prestige>0;}}
  ];
  function total(s){var t=0;GENS.forEach(function(g){t+=s.owned[g.id]||0;});return t;}
  var CLICK=1;
  var fresh={res:0,lifetime:0,owned:{},prestige:0,ach:{},streak:0,lastDay:null,ts:Date.now()};
  GENS.forEach(function(g){fresh.owned[g.id]=0;});
  var s=K.load(KEY,null)||fresh;
  s.res=+s.res||0; s.lifetime=+s.lifetime||0; s.prestige=+s.prestige||0; s.streak=+s.streak||0;
  s.owned=s.owned&&typeof s.owned==='object'?s.owned:{}; s.ach=s.ach&&typeof s.ach==='object'?s.ach:{};
  GENS.forEach(function(g){s.owned[g.id]=+s.owned[g.id]||0;}); if(s.ts==null)s.ts=Date.now();
  var AT=1e6;
  function pmult(){return 1+s.prestige*0.1;}
  function smult(){return K.streakMult(s.streak);}
  function rate(){var r=0;GENS.forEach(function(g){r+=g.rate*(s.owned[g.id]||0);});return r*pmult()*smult();}
  function cost(g){return K.cost(g.base,s.owned[g.id]||0);}
  function gain(a){s.res+=a;s.lifetime+=a;}
  var countEl=document.getElementById('count'),rateEl=document.getElementById('rate'),
      metaEl=document.getElementById('meta'),cpEl=document.getElementById('cp'),
      streakEl=document.getElementById('streak'),shop=document.getElementById('shop'),
      awayEl=document.getElementById('away'),achEl=document.getElementById('achs'),
      pInfo=document.getElementById('prestige-info'),pBtn=document.getElementById('prestige-btn');
  if(cpEl)cpEl.textContent=CLICK;
  function persist(){s.ts=Date.now();K.save(KEY,s);}
  // daily streak
  K.streakUpdate(s);
  // offline accrual
  var a=K.awaySeconds(s.ts,CAP),earned=rate()*a.seconds;
  if(earned>=1){gain(earned);var mins=Math.floor(a.rawSeconds/60),hh=Math.floor(mins/60),mm=mins%60;
    awayEl.style.display='block';
    awayEl.innerHTML='🔥 While you were away ('+(hh>0?hh+'h '+mm+'m':mm+'m')+(a.wasCapped?', capped at '+CAP+'h':'')+'), your foundry forged <b>'+K.format(earned)+'</b> cinders. Welcome back!';}
  function renderShop(){shop.innerHTML='';GENS.forEach(function(g){var c=cost(g);var b=document.createElement('button');
    b.className='up';b.disabled=s.res<c;
    b.innerHTML='<span class=ue>'+g.emoji+'</span><span><span class=un>'+g.name+' <small class=muted>x'+(s.owned[g.id]||0)+'</small></span><span class=ud>'+g.desc+'</span></span><span class=uc><b>'+K.format(c)+'</b><small>cinders</small></span>';
    b.addEventListener('click',function(){var cc=cost(g);if(s.res>=cc){s.res-=cc;s.owned[g.id]=(s.owned[g.id]||0)+1;draw();persist();}});
    shop.appendChild(b);});}
  function renderAch(){if(!achEl)return;achEl.innerHTML='<div class=achs-h>Milestones</div>';
    ACH.forEach(function(x){var got=!!s.ach[x.id];var chip=document.createElement('span');chip.className='ach'+(got?' got':'');
      chip.textContent=x.emoji+' '+x.name;chip.title=(got?'':'Locked — ')+x.desc;achEl.appendChild(chip);});}
  function renderPrestige(){if(!pInfo)return;var pend=K.prestigeGain(s.lifetime,AT);
    pInfo.innerHTML='💎 <b>'+K.format(s.prestige)+'</b> Emberstones — global ×'+pmult().toFixed(2)+'<br><small class=muted>Ascend to melt the forge down for permanent Emberstones (each +10% output).</small>';
    pBtn.textContent=pend>0?('Ascend for +'+K.format(pend)+' Emberstone'+(pend===1?'':'s')):('Reach '+K.format(AT)+' lifetime to ascend');
    pBtn.disabled=pend<=0;}
  if(pBtn)pBtn.addEventListener('click',function(){var pend=K.prestigeGain(s.lifetime,AT);if(pend<=0)return;
    var ok=false;try{ok=window.confirm('Ascend now? Your cinders and buildings reset, but you gain +'+K.format(pend)+' Emberstone'+(pend===1?'':'s')+' — a permanent +'+(pend*10)+'% to all output.');}catch(e){ok=true;}
    if(!ok)return;s.prestige+=pend;s.res=0;s.lifetime=0;GENS.forEach(function(g){s.owned[g.id]=0;});draw();persist();});
  function draw(){countEl.textContent=K.format(s.res);rateEl.textContent=K.format(rate())+' / sec';
    if(metaEl)metaEl.innerHTML='lifetime <b>'+K.format(s.lifetime)+'</b> cinders';
    if(streakEl)streakEl.innerHTML='🔥 Daily streak: <b>'+K.format(s.streak)+'</b> day'+(s.streak===1?'':'s')+' <small class=muted>(×'+smult().toFixed(2)+' yield)</small>';
    renderShop();renderAch();renderPrestige();}
  document.getElementById('strike').addEventListener('click',function(){gain(CLICK*pmult()*smult());draw();});
  var last=Date.now();
  setInterval(function(){var now=Date.now(),dt=(now-last)/1000;last=now;gain(rate()*dt);
    countEl.textContent=K.format(s.res);
    if(metaEl)metaEl.innerHTML='lifetime <b>'+K.format(s.lifetime)+'</b> cinders';
    var kids=shop.children,i=0;GENS.forEach(function(g){var e=kids[i++];if(e)e.disabled=s.res<cost(g);});
    K.checkAchievements(ACH,s,s.ach);},100);
  setInterval(persist,5000);
  document.addEventListener('visibilitychange',function(){if(document.hidden)persist();});
  window.addEventListener('pagehide',persist);
  draw();
})();`;
}

// ── GAMES 2–6: new idle-incrementals, each a themed config over IdleKit.mount() ──────────────────────
// All five are pure client-side, IP-safe originals (invented names/lore over public-domain idle genres).
// The engine (offline cap + "while you were away" screen + daily streak + achievements + prestige +
// exponential cost) lives in www/idle-kit.js; each game below is content + theme.

// GAME 2: Kindling — a tiny, polished minimalist "first idle" (the genre on-ramp).
function kindlingGame() {
  return `<p class=sub>The smallest idle game we could make and still love. Coax a spark, add a few makers,
  and let it smoulder while you're away. One prestige — a Rekindle — resets it for a permanent boost.</p>
<div id=game></div>
${withKit(`(function(){var K=window.IdleKit;if(!K)return;K.mount(document.getElementById('game'),{
  key:'idlegames.kindling.v1',
  resource:{name:'sparks',emoji:'✦'},
  click:{label:'Coax a spark',power:1},
  capHours:8, streak:true,
  generators:[
    {id:'tinder', name:'Tinder',   emoji:'🍂', rate:0.2, base:12,   desc:'Catches easily. +0.2/sec each.'},
    {id:'twig',   name:'Twig',     emoji:'🪵', rate:1.2, base:90,   desc:'Steady little flame. +1.2/sec each.'},
    {id:'log',    name:'Log',      emoji:'🪵', rate:7,   base:1000, desc:'Burns long and slow. +7/sec each.'},
    {id:'brazier',name:'Brazier',  emoji:'🔥', rate:45,  base:12000,desc:'A proper blaze. +45/sec each.'}
  ],
  prestige:{name:'Rekindle',emoji:'💠',unit:'embers',at:5e5,mult:function(p){return 1+p*0.12;},blurb:'Rekindle to bank embers — each gives +12% to everything, forever.'},
  achievements:[
    {id:'lit',   name:'Lit',        emoji:'✨',desc:'Gather 50 sparks.',        test:function(s){return s.lifetime>=50;}},
    {id:'steady',name:'Steady Burn', emoji:'🔥',desc:'Reach 5,000 lifetime sparks.', test:function(s){return s.lifetime>=5000;}},
    {id:'ember', name:'First Ember',  emoji:'💠',desc:'Rekindle once.',           test:function(s){return s.prestige>0;}}
  ]
});})();`)}`;
}

// GAME 3: Tap Temple — a second clicker, native MELEK/Ashurbanipal temple flavor (lore only; no crypto).
function templeGame() {
  return `<p class=sub>Tap the altar for offerings, then bring on temple folk who keep the incense burning
  while you rest. Reach an Ascension for a lasting blessing. A calm, on-brand idle clicker.</p>
<div id=game></div>
${withKit(`(function(){var K=window.IdleKit;if(!K)return;K.mount(document.getElementById('game'),{
  key:'idlegames.taptemple.v1',
  resource:{name:'offerings',emoji:'🪔'},
  click:{label:'Tend the altar',power:1},
  capHours:10, streak:true,
  generators:[
    {id:'acolyte',name:'Acolyte',  emoji:'🧎', rate:0.3, base:15,    desc:'Tends the lamps. +0.3/sec each.'},
    {id:'scribe', name:'Scribe',   emoji:'✍️', rate:1.5, base:120,   desc:'Copies the liturgy. +1.5/sec each.'},
    {id:'oracle', name:'Oracle',   emoji:'🔮', rate:9,   base:1400,  desc:'Reads the smoke. +9/sec each.'},
    {id:'ziggurat',name:'Ziggurat',emoji:'🛕', rate:60,  base:16000, desc:'A whole terraced temple. +60/sec each.'}
  ],
  prestige:{name:'Ascension',emoji:'🌟',unit:'blessings',at:1e6,mult:function(p){return 1+p*0.1;},blurb:'Ascend to receive blessings — each grants +10% to all offerings, permanently.'},
  achievements:[
    {id:'first',  name:'First Light', emoji:'🪔',desc:'Gather 100 offerings.',   test:function(s){return s.lifetime>=100;}},
    {id:'order',  name:'Holy Order',  emoji:'👥',desc:'Own 30 temple folk.',      test:function(s){var t=0;for(var k in s.owned)t+=s.owned[k]||0;return t>=30;}},
    {id:'ascend', name:'Ascended',    emoji:'🌟',desc:'Ascend once.',             test:function(s){return s.prestige>0;}}
  ]
});})();`)}`;
}

// GAME 4: Ledger Legends — text/idle incremental RPG (bespoke shell: a scrolling quest log over the kit).
function ledgerGame() {
  return `<p class=sub>The cheapest kind of idle: strings and numbers. Recruit couriers, scouts and heroes
  who run auto-quests and post their deeds to the log. Renown climbs; Retire for a permanent multiplier.</p>
<div id=game></div>
${withKit(`(function(){var K=window.IdleKit;if(!K)return;
  var DEEDS=['cleared a goblin warren','escorted a caravan','mapped a lost road','recovered a stolen relic',
    'slew a marsh wyrm','calmed a haunted mill','won a tavern wager','charted a hidden vale','routed a bandit camp'];
  K.mount(document.getElementById('game'),{
  key:'idlegames.ledgerlegends.v1',
  resource:{name:'renown',emoji:'📜'},
  click:{label:'Post a bounty',power:2},
  capHours:8, streak:true,
  generators:[
    {id:'courier',name:'Courier', emoji:'🏃', rate:0.4, base:18,    desc:'Runs small errands. +0.4/sec each.'},
    {id:'scout',  name:'Scout',   emoji:'🗺️', rate:2,   base:160,   desc:'Clears the road ahead. +2/sec each.'},
    {id:'knight', name:'Knight',  emoji:'⚔️', rate:12,  base:1800,  desc:'Takes real quests. +12/sec each.'},
    {id:'hero',   name:'Hero',    emoji:'🛡️', rate:80,  base:20000, desc:'The stuff of legends. +80/sec each.'}
  ],
  prestige:{name:'Retire',emoji:'🏅',unit:'legends',at:1e6,mult:function(p){return 1+p*0.1;},blurb:'Retire the party into legend — each Legend adds +10% renown to the next, forever.'},
  achievements:[
    {id:'known',  name:'Word Spreads', emoji:'📜',desc:'Earn 200 renown.',      test:function(s){return s.lifetime>=200;}},
    {id:'band',   name:'A Full Band',  emoji:'👥',desc:'Recruit 25 adventurers.',test:function(s){var t=0;for(var k in s.owned)t+=s.owned[k]||0;return t>=25;}},
    {id:'legend', name:'Legendary',    emoji:'🏅',desc:'Retire once.',           test:function(s){return s.prestige>0;}}
  ],
  log:{line:function(s){var who=['A courier','A scout','A knight','A hero'][Math.floor(Math.random()*4)];
    return who+' '+DEEDS[Math.floor(Math.random()*DEEDS.length)]+'.';}}
});})();`)}`;
}

// GAME 5: Star Harvest — farm-idle. Plots grow starlight on a timer; Bloom to reset for a yield boost.
function orchardGame() {
  return `<p class=sub>Plant beds of light-seeds that grow starlight around the clock. Add plots, speed the
  bloom, and come back to a full harvest. Bloom the whole field for a permanent yield boost. A gentle farm-idle.</p>
<div id=game></div>
${withKit(`(function(){var K=window.IdleKit;if(!K)return;K.mount(document.getElementById('game'),{
  key:'idlegames.starharvest.v1',
  resource:{name:'starlight',emoji:'✨'},
  click:{label:'Hand-pick starlight',power:1},
  capHours:12, streak:true,
  generators:[
    {id:'plot',   name:'Seed Plot',   emoji:'🌱', rate:0.3, base:14,    desc:'A small bed. +0.3/sec each.'},
    {id:'row',    name:'Long Row',    emoji:'🌾', rate:1.6, base:130,   desc:'A full furrow. +1.6/sec each.'},
    {id:'grove',  name:'Moon Grove',  emoji:'🌳', rate:10,  base:1500,  desc:'Glows all night. +10/sec each.'},
    {id:'field',  name:'Star Field',  emoji:'🌌', rate:66,  base:17000, desc:'A whole sky of it. +66/sec each.'}
  ],
  prestige:{name:'Bloom',emoji:'🌸',unit:'blooms',at:1e6,mult:function(p){return 1+p*0.1;},blurb:'Bloom the field to bank blooms — each gives +10% yield to every future harvest.'},
  achievements:[
    {id:'sprout', name:'First Sprout', emoji:'🌱',desc:'Harvest 100 starlight.', test:function(s){return s.lifetime>=100;}},
    {id:'farm',   name:'Working Farm', emoji:'🚜',desc:'Own 30 growing beds.',    test:function(s){var t=0;for(var k in s.owned)t+=s.owned[k]||0;return t>=30;}},
    {id:'bloom',  name:'In Full Bloom',emoji:'🌸',desc:'Bloom once.',             test:function(s){return s.prestige>0;}}
  ]
});})();`)}`;
}

// GAME 6: Deep Delve — mining-idle. Drills dig ever deeper (a live Depth meter); Collapse for a multiplier.
function delveGame() {
  return `<p class=sub>Send drills and carts down through the strata — deeper rock is richer but slower to
  reach. Watch the Depth climb, hit a wall, then trigger a Collapse to restart with a permanent depth boost.</p>
<div id=game></div>
${withKit(`(function(){var K=window.IdleKit;if(!K)return;K.mount(document.getElementById('game'),{
  key:'idlegames.deepdelve.v1',
  resource:{name:'ore',emoji:'⛏️'},
  click:{label:'Swing the pick',power:1},
  capHours:8, streak:true,
  generators:[
    {id:'pick',   name:'Pick Hand',   emoji:'🧑‍🔧', rate:0.3, base:16,    desc:'Chips at the wall. +0.3/sec each.'},
    {id:'drill',  name:'Auto-Drill',  emoji:'🛠️', rate:1.8, base:150,   desc:'Bites into rock. +1.8/sec each.'},
    {id:'cart',   name:'Ore Cart',    emoji:'🛒', rate:11,  base:1700,  desc:'Hauls it up fast. +11/sec each.'},
    {id:'bore',   name:'Deep Bore',   emoji:'🏗️', rate:72,  base:19000, desc:'Punches to bedrock. +72/sec each.'}
  ],
  meter:{label:'Depth', value:function(s){var t=0;for(var k in s.owned)t+=s.owned[k]||0;return t*12+Math.floor(s.lifetime/500);},
    fmt:function(n){return K.format(n)+' m';}},
  prestige:{name:'Collapse',emoji:'🕳️',unit:'depth cores',at:1e6,mult:function(p){return 1+p*0.1;},blurb:'Collapse the shaft to bank depth cores — each adds +10% ore, forever.'},
  achievements:[
    {id:'vein',   name:'First Vein',  emoji:'⛏️',desc:'Mine 100 ore.',          test:function(s){return s.lifetime>=100;}},
    {id:'fleet',  name:'Full Fleet',  emoji:'🚜',desc:'Own 30 diggers.',         test:function(s){var t=0;for(var k in s.owned)t+=s.owned[k]||0;return t>=30;}},
    {id:'core',   name:'Bedrock',     emoji:'🕳️',desc:'Collapse once.',          test:function(s){return s.prestige>0;}}
  ]
});})();`)}`;
}

// ── GAME 2: Glow Worm (snake) ────────────────────────────────────────────────────────────────────────
function snakeGame() {
  return `<div class=score-row>
    <div class=box>Score <b id=score>0</b></div>
    <div class=box>Best <b id=best>0</b></div>
    <button class=btn id=restart>Restart</button>
  </div>
  <div class=stage><canvas id=cv width=440 height=440 aria-label="Glow Worm playfield"></canvas></div>
  <p class=hint>Arrow keys or <b>WASD</b> to steer · <b>Space</b> to pause / restart · eat the motes, don't hit a wall or your own tail.</p>
<script>${snakeScript()}</script>`;
}
function snakeScript() {
  return `(function(){
  var KEY='idlegames.glowworm.best.v1';
  var cv=document.getElementById('cv'),ctx=cv.getContext('2d');
  var N=22, S=cv.width/N; // grid cells / cell size
  var snake,dir,nextDir,food,score,alive,timer,speed;
  var scoreEl=document.getElementById('score'),bestEl=document.getElementById('best');
  var best=0; try{best=+localStorage.getItem(KEY)||0;}catch(e){} bestEl.textContent=best;
  function place(){ while(true){var x=Math.floor(Math.random()*N),y=Math.floor(Math.random()*N);
    if(!snake.some(function(s){return s.x===x&&s.y===y;})){return {x:x,y:y};} } }
  function reset(){snake=[{x:11,y:11},{x:10,y:11},{x:9,y:11}];dir={x:1,y:0};nextDir=dir;
    food=place();score=0;alive=true;speed=120;scoreEl.textContent=0;
    clearInterval(timer);timer=setInterval(step,speed);draw();}
  function grow(){ // shorten interval slightly as you score
    var ns=Math.max(60,120-Math.floor(score/40)*8);
    if(ns!==speed){speed=ns;clearInterval(timer);timer=setInterval(step,speed);} }
  function step(){
    if(!alive)return; dir=nextDir;
    var head={x:snake[0].x+dir.x,y:snake[0].y+dir.y};
    if(head.x<0||head.y<0||head.x>=N||head.y>=N||snake.some(function(s){return s.x===head.x&&s.y===head.y;})){
      alive=false;clearInterval(timer);
      if(score>best){best=score;try{localStorage.setItem(KEY,String(best));}catch(e){}bestEl.textContent=best;}
      draw();return;}
    snake.unshift(head);
    if(head.x===food.x&&head.y===food.y){score+=10;scoreEl.textContent=score;food=place();grow();}
    else{snake.pop();}
    draw();
  }
  function cell(x,y,col){ctx.fillStyle=col;ctx.fillRect(x*S+1,y*S+1,S-2,S-2);}
  function draw(){
    ctx.fillStyle='#080a10';ctx.fillRect(0,0,cv.width,cv.height);
    cell(food.x,food.y,'#e0a92e');
    for(var i=snake.length-1;i>=0;i--){var t=i/snake.length;
      cell(snake[i].x,snake[i].y, i===0?'#9ecbff':('rgb('+Math.round(80+120*(1-t))+','+Math.round(160+60*(1-t))+',255)'));}
    if(!alive){ctx.fillStyle='rgba(8,10,16,.72)';ctx.fillRect(0,0,cv.width,cv.height);
      ctx.fillStyle='#e8ecf5';ctx.textAlign='center';ctx.font='700 26px system-ui,sans-serif';
      ctx.fillText('Game over',cv.width/2,cv.height/2-8);
      ctx.font='15px system-ui,sans-serif';ctx.fillStyle='#8b93a7';
      ctx.fillText('Score '+score+' · Space or Restart to play again',cv.width/2,cv.height/2+20);}
  }
  var MAP={37:{x:-1,y:0},38:{x:0,y:-1},39:{x:1,y:0},40:{x:0,y:1},
           65:{x:-1,y:0},87:{x:0,y:-1},68:{x:1,y:0},83:{x:0,y:1}};
  document.addEventListener('keydown',function(e){
    if(e.keyCode===32){e.preventDefault();if(!alive){reset();}else{if(timer){clearInterval(timer);timer=null;}else{timer=setInterval(step,speed);}}return;}
    var d=MAP[e.keyCode]; if(!d)return; e.preventDefault();
    if(d.x===-dir.x&&d.y===-dir.y)return; // no instant reverse
    nextDir=d;});
  document.getElementById('restart').addEventListener('click',reset);
  reset();
})();`;
}

// ── GAME 3: Nova Merge (2048-style) — merge logic implemented here ────────────────────────────────────
function mergeGame() {
  return `<div class=score-row>
    <div class=box>Score <b id=score>0</b></div>
    <div class=box>Best <b id=best>0</b></div>
    <button class=btn id=newgame>New game</button>
  </div>
  <div class=stage><div class=board id=board aria-label="Nova Merge board"></div></div>
  <p class=hint>Arrow keys or <b>WASD</b> (or swipe) to slide every orb. Two equal orbs fuse into one twice as
    bright. Reach <b>2048 — the Nova</b>, then keep going. Game over when the board locks up.</p>
<script>${mergeScript()}</script>`;
}
function mergeScript() {
  return `(function(){
  var KEY='idlegames.novamerge.best.v1';
  var board=document.getElementById('board'),scoreEl=document.getElementById('score'),bestEl=document.getElementById('best');
  var grid,score,best=0; try{best=+localStorage.getItem(KEY)||0;}catch(e){} bestEl.textContent=best;
  // original palette (our art) keyed by tile value
  var COL={0:'#0d1018',2:'#3a4c6e',4:'#3f6ea0',8:'#4d8fc0',16:'#57b0c9',32:'#57c9a6',64:'#67c957',
    128:'#a6c957',256:'#c9b657',512:'#e0a92e',1024:'#e08a2e',2048:'#f85a8a',4096:'#c05af8',8192:'#8a5af8'};
  function empty(){return [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0];}
  function spawn(){var e=[];for(var i=0;i<16;i++)if(grid[i]===0)e.push(i);
    if(!e.length)return;grid[e[Math.floor(Math.random()*e.length)]]=Math.random()<0.9?2:4;}
  function reset(){grid=empty();score=0;spawn();spawn();scoreEl.textContent=0;draw();}
  function row(i){return [grid[i*4],grid[i*4+1],grid[i*4+2],grid[i*4+3]];}
  function setRow(i,r){for(var k=0;k<4;k++)grid[i*4+k]=r[k];}
  function col(j){return [grid[j],grid[j+4],grid[j+8],grid[j+12]];}
  function setCol(j,c){for(var k=0;k<4;k++)grid[j+k*4]=c[k];}
  // slide+merge one line toward index 0; returns {line,moved,gained}
  function collapse(line){
    var t=line.filter(function(v){return v!==0;}),gained=0;
    for(var k=0;k<t.length-1;k++){if(t[k]===t[k+1]){t[k]*=2;gained+=t[k];t.splice(k+1,1);}}
    while(t.length<4)t.push(0);
    var moved=false;for(var k=0;k<4;k++)if(t[k]!==line[k])moved=true;
    return {line:t,moved:moved,gained:gained};
  }
  function move(dir){ // 0 left,1 right,2 up,3 down
    var moved=false,gained=0;
    for(var i=0;i<4;i++){
      var line = (dir<2)?row(i):col(i);
      var rev = (dir===1||dir===3);
      if(rev)line.reverse();
      var r=collapse(line);
      if(rev)r.line.reverse();
      if(r.moved)moved=true; gained+=r.gained;
      if(dir<2)setRow(i,r.line);else setCol(i,r.line);
    }
    if(moved){score+=gained;scoreEl.textContent=score;spawn();
      if(score>best){best=score;try{localStorage.setItem(KEY,String(best));}catch(e){}bestEl.textContent=best;}
      draw(); if(!canMove())over();}
  }
  function canMove(){for(var i=0;i<16;i++){if(grid[i]===0)return true;
    var r=i%4,c=Math.floor(i/4);
    if(r<3&&grid[i]===grid[i+1])return true;
    if(c<3&&grid[i]===grid[i+4])return true;}return false;}
  function over(){var cells=board.children;for(var i=0;i<16;i++){cells[i].style.opacity='.55';}}
  function draw(){
    if(board.children.length!==16){board.innerHTML='';for(var i=0;i<16;i++){var d=document.createElement('div');d.className='cell';board.appendChild(d);}}
    var cells=board.children;
    for(var i=0;i<16;i++){var v=grid[i],el=cells[i];el.style.opacity='1';
      el.setAttribute('data-v',v);el.textContent=v||'';
      el.style.background=COL[v]||'#f85a8a';
      el.style.color=(v<=4)?'#e8ecf5':'#0c0e14';
      el.style.fontSize=(v>=1024)?'clamp(13px,4.6vw,22px)':(v>=128?'clamp(15px,5.2vw,26px)':'clamp(16px,6vw,30px)');}
  }
  var MAP={37:0,39:1,38:2,40:3,65:0,68:1,87:2,83:3};
  document.addEventListener('keydown',function(e){var d=MAP[e.keyCode];if(d===undefined)return;e.preventDefault();move(d);});
  // touch swipe
  var sx=0,sy=0;
  board.addEventListener('touchstart',function(e){var t=e.touches[0];sx=t.clientX;sy=t.clientY;},{passive:true});
  board.addEventListener('touchend',function(e){var t=e.changedTouches[0];var dx=t.clientX-sx,dy=t.clientY-sy;
    if(Math.max(Math.abs(dx),Math.abs(dy))<24)return;
    if(Math.abs(dx)>Math.abs(dy))move(dx>0?1:0);else move(dy>0?3:2);});
  document.getElementById('newgame').addEventListener('click',reset);
  reset();
})();`;
}

// ── GAME 4 (optional): Signal Sweeper (minesweeper-style) ─────────────────────────────────────────────
function minesGame() {
  return `<div class=score-row>
    <div class=box>Signals left <b id=left>10</b></div>
    <div class=box>Time <b id=time>0</b></div>
    <div class=box>Best <b id=best>—</b></div>
    <button class=btn id=newgame>New game</button>
  </div>
  <div class=stage><div class=mfield id=field aria-label="Signal Sweeper field"></div></div>
  <p class=hint>Click a cell to reveal it · <b>right-click</b> (or long-press) to flag a hidden signal · numbers
    count the signals touching that cell. Clear every safe cell to win.</p>
<script>${minesScript()}</script>`;
}
function minesScript() {
  return `(function(){
  var KEY='idlegames.signalsweeper.best.v1';
  var W=9,H=9,MINES=10;
  var field=document.getElementById('field'),leftEl=document.getElementById('left'),
      timeEl=document.getElementById('time'),bestEl=document.getElementById('best');
  var cells,mine,open,flag,started,dead,won,tick,secs,flags;
  var best=null; try{var b=localStorage.getItem(KEY);best=b?+b:null;}catch(e){} bestEl.textContent=best==null?'—':best;
  function idx(x,y){return y*W+x;}
  function nbrs(x,y){var a=[];for(var dy=-1;dy<=1;dy++)for(var dx=-1;dx<=1;dx++){if(!dx&&!dy)continue;
    var nx=x+dx,ny=y+dy;if(nx>=0&&ny>=0&&nx<W&&ny<H)a.push([nx,ny]);}return a;}
  function count(x,y){var c=0;nbrs(x,y).forEach(function(n){if(mine[idx(n[0],n[1])])c++;});return c;}
  function build(){field.style.gridTemplateColumns='repeat('+W+',30px)';field.innerHTML='';cells=[];
    for(var y=0;y<H;y++){for(var x=0;x<W;x++){var d=document.createElement('div');d.className='mc';
      d.setAttribute('data-x',x);d.setAttribute('data-y',y);cells.push(d);field.appendChild(d);}}}
  function reset(){mine=[];open=[];flag=[];for(var i=0;i<W*H;i++){mine[i]=false;open[i]=false;flag[i]=false;}
    started=false;dead=false;won=false;secs=0;flags=0;clearInterval(tick);
    leftEl.textContent=MINES;timeEl.textContent=0;build();render();}
  function seed(safe){var placed=0;while(placed<MINES){var i=Math.floor(Math.random()*W*H);
    if(mine[i]||i===safe)continue;mine[i]=true;placed++;}
    started=true;tick=setInterval(function(){secs++;timeEl.textContent=secs;},1000);}
  function flood(x,y){var st=[[x,y]];while(st.length){var p=st.pop(),i=idx(p[0],p[1]);
    if(open[i]||flag[i])continue;open[i]=true;if(count(p[0],p[1])===0){nbrs(p[0],p[1]).forEach(function(n){
      if(!open[idx(n[0],n[1])])st.push(n);});}}}
  function reveal(x,y){var i=idx(x,y);if(open[i]||flag[i]||dead||won)return;
    if(!started)seed(i);
    if(mine[i]){dead=true;clearInterval(tick);render();return;}
    flood(x,y);checkWin();render();}
  function toggleFlag(x,y){var i=idx(x,y);if(open[i]||dead||won)return;if(!started)seed(i);
    flag[i]=!flag[i];flags+=flag[i]?1:-1;leftEl.textContent=MINES-flags;render();}
  function checkWin(){var c=0;for(var i=0;i<W*H;i++)if(open[i])c++;
    if(c===W*H-MINES){won=true;clearInterval(tick);
      if(best==null||secs<best){best=secs;try{localStorage.setItem(KEY,String(best));}catch(e){}bestEl.textContent=best;}}}
  function render(){for(var y=0;y<H;y++)for(var x=0;x<W;x++){var i=idx(x,y),el=cells[i];
    el.className='mc';el.textContent='';
    if(flag[i]&&!open[i]){el.classList.add('flag');el.textContent='🚩';}
    if(open[i]){el.classList.add('open');var n=count(x,y);if(n){el.textContent=n;
      el.style.color=['','#6ea8ff','#54c96a','#f8595a','#c05af8','#e0a92e','#57c9a6','#e8ecf5','#8b93a7'][n];}}
    if((dead)&&mine[i]){el.classList.add('mine');el.classList.add('open');el.textContent='📡';}}
    if(won){leftEl.textContent='0';}}
  field.addEventListener('click',function(e){var t=e.target.closest('.mc');if(!t)return;
    reveal(+t.getAttribute('data-x'),+t.getAttribute('data-y'));});
  field.addEventListener('contextmenu',function(e){var t=e.target.closest('.mc');if(!t)return;e.preventDefault();
    toggleFlag(+t.getAttribute('data-x'),+t.getAttribute('data-y'));});
  // long-press to flag (touch)
  var lpTimer=null;
  field.addEventListener('touchstart',function(e){var t=e.target.closest('.mc');if(!t)return;
    lpTimer=setTimeout(function(){toggleFlag(+t.getAttribute('data-x'),+t.getAttribute('data-y'));lpTimer=null;},450);},{passive:true});
  field.addEventListener('touchend',function(e){if(lpTimer){clearTimeout(lpTimer);lpTimer=null;}});
  document.getElementById('newgame').addEventListener('click',reset);
  reset();
})();`;
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', ...GAME_SLUGS.map((s) => `/${s}`)];

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
        summary: 'Free, original browser games for a quick break. Idle/incrementals — Cinder Foundry (a forge), Kindling (a minimalist first idle), Tap Temple (a calm clicker), Ledger Legends (a text-driven idle RPG), Star Harvest (a farm-idle), Deep Delve (a mining-idle) — each with offline accrual, a daily streak, achievements and a prestige reset. Plus arcade classics: Glow Worm (snake), Nova Merge (2048-style) and Signal Sweeper (minesweeper-style). No account, no install, no tracking; progress saves locally. Optional free MELEK account to keep progress across devices.',
        links: [{ label: 'All games', path: '/' }, ...GAMES.map((g) => ({ label: g.name, path: `/${g.slug}` }))],
      }));
    }

    // the shared idle engine, served raw from www/ (also inlined into each idle page). Immutable-cacheable.
    if (path === '/www/idle-kit.js') {
      res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'public, max-age=604800, immutable' });
      return res.end(IDLE_KIT_JS);
    }

    if (path === '/') return sendHtml(res, hubPage());

    // /<slug> game pages
    const slug = path.replace(/^\/+/, '').replace(/\/+$/, '');
    if (GAME_SLUGS.includes(slug)) {
      return sendHtml(res, gamePage(slug, url.searchParams));
    }

    // unknown → 404, never a 500. The requested path is echoed back ESCAPED.
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — ' + SITE_NAME,
      `<h1>Not found</h1><p class=muted>There's no game at <code>${esc(path)}</code>. <a href="${bp('/')}">Back to all games</a>.</p>`,
      { robots: 'noindex,follow' }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/idlegames\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`${SITE_NAME} on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
