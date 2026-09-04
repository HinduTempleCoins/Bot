// site/console/server.mjs — the MELEK Game Console: the unified hub surface over PRANA testnet.
//
// Renders the game directory from integrations/games/game-console.mjs (the WAX-modeled registry:
// one MELEK-Signer login = Cloud Wallet, KulaSwap = AtomicHub, engine ERC-1155 = AtomicAssets,
// this = the dApp directory). MELEK Move is featured (operator's ask). Wired to the testnet chain
// config (PRANA chainId 108369) and per-game launch URLs from env — no request-time network.
//
// Built from what's already on testnet: each game's launch URL defaults to its existing surface
// (farm./arcade./kula.money/…) and is env-overridable, so rollout is just pointing the envs at prod.
//
//   PORT=8306 BASE_URL=https://console.soapbox.community node site/console/server.mjs
//
// House style: ESM, esc()/safeHref() every interpolation, handler(req,res) exported, guarded CLI,
// PORT/HOST/BASE_URL/BASE_PATH env, soft-fail-never-throw, /health + robots/sitemap/llms, Alpha badge,
// testnet label, ZERO request-time network (directory() is pure/in-memory).

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import {
  directory, listGames, getGame, launchDescriptor, WAX_MAPPING, SHARED_MARKET, UNIFIED_IDENTITY,
} from '../../integrations/games/game-console.mjs';

const PORT = +(process.env.PORT || 8306);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
const CHAIN_ID = Number(process.env.PRANA_CHAIN_ID || '108369') || 108369;
const NET_LABEL = process.env.NET_LABEL || `PRANA Testnet · chain ${CHAIN_ID}`;
const KULA_URL = safeHref(process.env.KULA_URL || 'https://kula.money') || '#';

// ── tiny safe helpers (inlined; every surface does) ──────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function safeHref(u) {
  const s = String(u || '').trim();
  return /^https?:\/\/|^\/(?!\/)/.test(s) ? s : (s === '#' ? '#' : null);
}
const sendHtml = (res, html, code = 200) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); };
const sendJson = (res, obj, code = 200) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(obj)); };

// Per-game launch URL: env override GAME_URL_<UPPER_ID> wins; else the game's known surface; else its route.
const SURFACE_DEFAULTS = {
  'melek-move': 'https://move.soapbox.community',
  'kush-farm': 'https://farm.soapbox.community',
  'kula-arcade': 'https://arcade.soapbox.community',
  'creatures': '',
  'kush-breeding': '',
  'pass-a-joint': '',
  'quick-farm': '',
  'tribulum': '',
};
export function launchUrl(g) {
  const envKey = 'GAME_URL_' + String(g.id).toUpperCase().replace(/[^A-Z0-9]+/g, '_');
  const fromEnv = process.env[envKey];
  const def = SURFACE_DEFAULTS[g.id];
  const url = fromEnv || def || (BASE_URL + (g.entry || ''));
  return safeHref(url) || '#';
}

const laneBadge = (lane) => lane === 'real-value'
  ? '<span class="lane rv">Earns real token</span>'
  : '<span class="lane play">PLAY · non-cashable</span>';

function gameTile(g) {
  const href = launchUrl(g);
  const soon = !SURFACE_DEFAULTS[g.id] && !process.env['GAME_URL_' + String(g.id).toUpperCase().replace(/[^A-Z0-9]+/g, '_')];
  const cta = soon
    ? '<span class="cta soon">Coming soon</span>'
    : `<a class="cta" href="${esc(href)}" rel="noopener">Launch ▸</a>`;
  return `<div class="tile">
    <div class="ico">${esc(g.icon)}</div>
    <div class="meta">
      <div class="nm">${esc(g.name)} <span class="chain ${esc(g.chain)}">${esc(g.chain.toUpperCase())}</span></div>
      <div class="bl">${esc(g.blurb || '')}</div>
      <div class="row">${laneBadge(g.compliance.lane)} <span class="tok">${esc(g.reward.token)}</span></div>
    </div>
    ${cta}
  </div>`;
}

function page() {
  const d = directory();
  const games = listGames();
  const move = getGame('melek-move');
  const featured = move ? `<section class="featured">
    <div class="fico">${esc(move.icon)}</div>
    <div>
      <div class="ftag">Featured</div>
      <h2>${esc(move.name)}</h2>
      <p>${esc(move.blurb)}</p>
      <div class="row">${laneBadge(move.compliance.lane)} <span class="tok">${esc(move.reward.token)}</span> <span class="chain melek">MELEK</span></div>
      <a class="cta big" href="${esc(launchUrl(move))}" rel="noopener">Open MELEK Move ▸</a>
    </div>
  </section>` : '';

  const cats = Object.keys(d.byCategory).sort();
  const grid = cats.map((c) => `<h3 class="cat">${esc(c.replace(/-/g, ' '))}</h3>
    <div class="grid">${listGames({ category: c }).map(gameTile).join('')}</div>`).join('');

  const wax = Object.entries(WAX_MAPPING).map(([k, v]) => `<li><b>${esc(k)}</b> → ${esc(v)}</li>`).join('');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MELEK Game Console</title>
<style>
  :root{--bg:#0e1116;--card:#171c24;--ink:#e8edf2;--dim:#9aa7b4;--acc:#7cc4ff;--rv:#ffd27c;--play:#8ee6a8}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,sans-serif}
  .alpha{position:fixed;top:8px;left:8px;background:#c0392b;color:#fff;font:700 11px/1 system-ui;padding:5px 8px;border-radius:5px;letter-spacing:.05em;z-index:9}
  header{padding:54px 20px 10px;text-align:center}
  h1{margin:0;font-size:26px} .net{color:var(--dim);font-size:12px;margin-top:4px}
  .spine{max-width:900px;margin:14px auto;padding:12px 16px;background:var(--card);border-radius:10px;color:var(--dim);font-size:13px;display:flex;gap:18px;flex-wrap:wrap;justify-content:center}
  .spine b{color:var(--ink)}
  main{max-width:1000px;margin:0 auto;padding:10px 16px 60px}
  .featured{display:flex;gap:18px;align-items:center;background:linear-gradient(120deg,#1b2330,#171c24);border:1px solid #2a3644;border-radius:14px;padding:20px;margin:16px 0}
  .featured .fico{font-size:52px} .ftag{color:var(--acc);font:700 11px/1 system-ui;letter-spacing:.08em;text-transform:uppercase}
  .featured h2{margin:4px 0} .featured p{color:var(--dim);margin:6px 0}
  .cat{margin:26px 0 8px;color:var(--acc);text-transform:capitalize;font-size:14px;letter-spacing:.03em}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
  .tile{display:flex;gap:12px;align-items:flex-start;background:var(--card);border:1px solid #232c38;border-radius:12px;padding:14px}
  .tile .ico{font-size:30px} .tile .meta{flex:1;min-width:0} .nm{font-weight:700} .bl{color:var(--dim);font-size:12.5px;margin:3px 0}
  .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:6px}
  .chain{font:700 10px/1 system-ui;padding:3px 5px;border-radius:4px;background:#22303f;color:#bcd}
  .chain.melek{background:#3a2a4a;color:#e5c8ff} .chain.prana{background:#213a2e;color:#bfe8cf}
  .lane{font:700 10px/1.2 system-ui;padding:3px 6px;border-radius:20px}
  .lane.rv{background:rgba(255,210,124,.15);color:var(--rv)} .lane.play{background:rgba(142,230,168,.13);color:var(--play)}
  .tok{color:var(--dim);font-size:11px}
  .cta{margin-left:auto;white-space:nowrap;background:var(--acc);color:#08131f;text-decoration:none;font-weight:700;padding:8px 12px;border-radius:8px;align-self:center}
  .cta.big{display:inline-block;margin:10px 0 0}
  .cta.soon{background:#2a3441;color:var(--dim);cursor:default}
  footer{max-width:1000px;margin:0 auto;padding:0 16px 40px;color:var(--dim);font-size:12px}
  footer ul{padding-left:18px} footer a{color:var(--acc)}
</style></head>
<body>
<div class="alpha">ALPHA</div>
<header>
  <h1>🎮 MELEK Game Console</h1>
  <div class="net">${esc(NET_LABEL)} · ${esc(String(games.length))} games · ${esc(String(d.counts.realValue))} earn-token · ${esc(String(d.counts.play))} play</div>
</header>
<div class="spine">
  <span>🔑 One login: <b>${esc(UNIFIED_IDENTITY.provider)}</b></span>
  <span>🏪 One market: <b><a href="${esc(KULA_URL)}" style="color:inherit">${esc(SHARED_MARKET.name)}</a></b></span>
  <span>⛽ <b>zero-gas</b> (signer-sponsored)</span>
</div>
<main>
  ${featured}
  ${grid}
</main>
<footer>
  <p><b>How it works (modeled on WAX):</b></p>
  <ul>${wax}</ul>
  <p>Two lanes: <span class="lane rv">Earns real token</span> games pay a real chain coin (MELEK / KULA / NFTs) — reward economics are counsel-reviewed. <span class="lane play">PLAY · non-cashable</span> games are entertainment-only play scores, provably-fair and geofenced, never money and never a wager. Alpha, on testnet — verify everything on-chain.</p>
</footer>
</body></html>`;
}

// ── router ────────────────────────────────────────────────────────────────────────────────────────
export function handler(req, res) {
  let url;
  try { url = new URL(req.url, BASE_URL); } catch { return sendJson(res, { error: 'bad-url' }, 400); }
  const path = url.pathname.replace(BASE_PATH, '') || '/';
  try {
    if (path === '/' || path === '') return sendHtml(res, page());
    if (path === '/health') return sendJson(res, { ok: true, chainId: CHAIN_ID, net: NET_LABEL, games: listGames().length, counts: directory().counts });
    if (path === '/api/directory') return sendJson(res, directory());
    if (path === '/api/launch') {
      const id = url.searchParams.get('game') || '';
      const g = getGame(id);
      if (!g) return sendJson(res, { error: 'unknown-game', game: id }, 404);
      return sendJson(res, { ...launchDescriptor(id), launchUrl: launchUrl(g), chainId: CHAIN_ID });
    }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`User-agent: *\nAllow: /\nSitemap: ${BASE_URL}${bp('/sitemap.xml')}\n`); }
    if (path === '/sitemap.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${esc(BASE_URL + bp('/'))}</loc></url></urlset>`);
    }
    if (path === '/llms.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('# MELEK Game Console\nUnified game hub on PRANA/MELEK. One MELEK-Signer login, KulaSwap market. Alpha, testnet.\n'); }
    return sendJson(res, { error: 'not-found', path }, 404);
  } catch (e) {
    return sendJson(res, { error: 'server-error', detail: String(e && e.message || e) }, 500);
  }
}

// ── guarded CLI ───────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  createServer(handler).listen(PORT, HOST, () => console.log(`MELEK Game Console on http://${HOST}:${PORT} (${NET_LABEL})`));
}
