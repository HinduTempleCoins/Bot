// site/arcade/server.mjs — KULA ARCADE hub: the compliant, play-token front door that ties together
// the Daily Spin (free), KULA Lotto, Event Markets, the Provably-Fair verifier, and the games. This is
// the §6 "minimal compliant launch" from .local/RESEARCH_PREDICTION_MARKETS_BETTING.md, built SAFE BY
// CONSTRUCTION: PLAY token only (non-cashable), provably-fair, geofence scaffolding + disclaimers from
// day one, Alpha-badged, testnet. NO real-money anything.
//
// Reuse, don't reinvent: the free Daily Spin IS site/spin (linked, not rebuilt); the dice table IS
// site/casino (linked); the published spin weight table comes from integrations/games/daily-spin.mjs;
// the games registry + seasonal leaderboards come from integrations/games/prana-arcade.mjs. Compliance
// shell (disclaimer, age-gate, geofence, Alpha badge) is site/arcade/shared.mjs.
//
//   PORT=8159 BASE_URL=https://arcade.soapbox.community node site/arcade/server.mjs
//
// House style: ESM, esc()/safeHref() every interpolation, handler(req,res) exported, guarded CLI,
// PORT/HOST/BASE_URL/BASE_PATH env, soft-fail-never-throw, /health + robots/sitemap/llms, ZERO
// request-time network (leaderboard reads soft-return without a wired reader).

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

// prana-arcade (seasonal leaderboards) is loaded LAZILY inside /api/board — it pulls in `ethers`, an
// optional heavy dep, and the hub must render (and test) without it. currentSeason is inlined here so
// the common path needs no import. readBoard/gameId come from a soft dynamic import (soft-fail → empty).
import { PRIZE_TABLE, TOTAL_WEIGHT } from '../../integrations/games/daily-spin.mjs';

// season number = time / seasonLength (matches prana-arcade.currentSeason; no ethers needed).
function currentSeason(seasonLength, nowSec = Math.floor(Date.now() / 1000)) {
  const L = Number(seasonLength);
  if (!Number.isFinite(L) || L <= 0) return 0;
  return Math.floor(Number(nowSec) / L);
}
import { esc, safeHref, shell, commonRoutes, sendHtml, sendJson, PLAY_EXPLAINER, AGE_GATE, geo } from './shared.mjs';
import { readAll as liveReadAll, renderPage as liveRenderPage } from './live.mjs';

const PORT = +(process.env.PORT || 8159);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;

// External reused surfaces (env-overridable; safe public defaults).
const SPIN_URL = safeHref(process.env.SPIN_URL || 'https://spin.soapbox.community') || 'https://spin.soapbox.community';
const CASINO_URL = safeHref(process.env.CASINO_URL || 'https://casino.soapbox.community') || 'https://casino.soapbox.community';

// ── games registry (env-injected; safe default = Seed + Farm + PvP "coming soon") — carried over from
// the prior hub so seasonal-leaderboard games keep working. kind ∈ seed|farm|board|coming. ──────────
const EXAMPLE_GAMES = [
  { id: 'seed-raffle', name: 'Seed Raffle', kind: 'seed', token: 'PLAY', live: true,
    blurb: 'The commit-reveal raffle primitive — enter with PLAY, the winner is drawn from participant-aggregated entropy nobody can grind. Provably fair, on-chain proof.',
    play: '' },
  { id: 'kush-farm', name: 'Kush Farm', kind: 'farm', token: 'PLAY', live: true,
    blurb: 'Grow your own — plant a strain, feed and water it through the season, harvest for PLAY. Pot-Farm-style cultivation; rare strains and the right season mean fatter yields.',
    play: '' },
  { id: 'pentecaust-arena', name: 'Arena (Pentecaust)', kind: 'board', token: 'PLAY', live: false,
    gameId: 'pentecaust-arena', seasonLength: 604800,
    blurb: 'Play from your Pentecaust channel — scores post to a weekly seasonal leaderboard with a PLAY prize pool. The social front door to the arcade.' },
  { id: 'seed-sower', name: 'Seed Sower', kind: 'coming', token: 'PLAY',
    blurb: 'Two-rank mancala (Kalah) on the GameTable engine — sow your seeds, chain extra turns, capture the opposite pit.' },
];
function cleanGame(g) {
  if (!g || typeof g !== 'object' || !g.id) return null;
  return {
    id: String(g.id).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40),
    name: String(g.name || g.id), kind: ['seed', 'farm', 'board', 'coming'].includes(g.kind) ? g.kind : 'coming',
    token: String(g.token || 'PLAY'), live: !!g.live, blurb: String(g.blurb || ''),
    play: g.play ? String(g.play) : '', gameId: g.gameId ? String(g.gameId) : '', seasonLength: +g.seasonLength || 0,
  };
}
export function loadGames() {
  const raw = process.env.MELEK_ARCADE_GAMES_JSON;
  if (raw) { try { const a = JSON.parse(raw); if (Array.isArray(a)) { const o = a.map(cleanGame).filter(Boolean); if (o.length) return o; } } catch {} }
  return EXAMPLE_GAMES.map(cleanGame).filter(Boolean);
}
const gameById = (id) => loadGames().find((g) => g.id === String(id || '').toLowerCase()) || null;

// ── the four compliant PLAY surfaces (the §6 set). Daily Spin + Casino are reused external surfaces;
// Lotto/Markets/Verify are this repo's own surfaces (site/arcade/lotto|markets|verify). ─────────────
function productTiles() {
  const weightRows = PRIZE_TABLE.map((s) => `${esc(s.segment)} ${esc(((s.weight / TOTAL_WEIGHT) * 100).toFixed(1))}%`).join(' · ');
  const P = [
    { name: 'Daily Spin', tag: 'Free · AMOE', tagClass: 'free', href: SPIN_URL, external: true, cta: 'Spin (free, once a day)',
      blurb: `The free daily wheel — one free spin per day paying non-cashable PLAY. The free spin IS the Alternative Means Of Entry (AMOE), which is what keeps this a lawful sweepstakes, not gambling. Published weights: ${weightRows}.` },
    { name: 'KULA Lotto', tag: 'PLAY tickets', tagClass: 'play', href: bp('/lotto'), external: false, cta: 'Open Lotto',
      blurb: 'A VRF-style raffle — a ticket costs PLAY, the draw is settled from a verifiable seed, and the pool split + on-chain proof are shown up front. Verify any draw yourself.' },
    { name: 'Event Markets', tag: 'PLAY stakes', tagClass: 'play', href: bp('/markets'), external: false, cta: 'Open Markets',
      blurb: 'Binary Yes/No markets where the price reads as the market-implied probability. Resolved by named public reference sources with a dispute window. Education-first; PLAY stakes only.' },
    { name: 'Provably Fair', tag: 'Verify', tagClass: '', href: bp('/verify'), external: false, cta: 'Verify a draw',
      blurb: 'The trust differentiator — recompute any spin, draw, or market resolution yourself from the published seeds. Leaderboard + how-to-verify links.' },
    { name: 'Casino Dice', tag: 'PLAY · provably fair', tagClass: 'play', href: CASINO_URL, external: true, cta: 'Play dice',
      blurb: 'The Satoshi-Dice-style provably-fair dice table — commit-reveal HMAC (no blockhash on our own chain), disclosed house edge, PLAY only. Instant, auditable.' },
  ];
  return P.map((p) => {
    const href = safeHref(p.href);
    const ext = p.external ? ' target=_blank rel=noopener' : '';
    const cta = href ? `<a class="btn primary" href="${esc(href)}"${ext}>${esc(p.cta)}</a>` : '';
    return `<div class="card"><div style="display:flex;gap:8px;align-items:flex-start">
      <h3 style="flex:1">${esc(p.name)}</h3><span class="tag ${esc(p.tagClass)}">${esc(p.tag)}</span></div>
      <p class="blurb">${esc(p.blurb)}</p>${cta}</div>`;
  }).join('');
}

const KIND = { seed: '🎲 Seed / Raffle', farm: '🌿 Grow', board: '🏆 Arena', coming: '… Coming soon' };
function gameCard(g) {
  const cta = g.kind === 'coming'
    ? '<span class="tag">Coming soon</span>'
    : (safeHref(g.play) ? `<a class="btn" href="${esc(safeHref(g.play))}" target=_blank rel=noopener>Play</a>` : '<span class="tag play">In arcade</span>');
  return `<div class="card" data-id="${esc(g.id)}"${g.gameId ? ` data-board="${esc(g.gameId)}"` : ''}>
    <div style="display:flex;gap:8px;align-items:flex-start"><h3 style="flex:1">${esc(g.name)}</h3><span class="tag">${esc(KIND[g.kind] || KIND.coming)}</span></div>
    <p class="blurb">${esc(g.blurb)}</p>
    ${g.gameId ? `<div class="fair-note" id="b-${esc(g.id)}">loading season…</div>` : ''}
    <div style="display:flex;align-items:center;gap:8px;margin-top:auto"><span class="tag play">${esc(g.token)}</span>${cta}</div>
  </div>`;
}

const NAV = [
  { label: 'Hub', href: '/' },
  { label: 'Daily Spin', href: SPIN_URL, external: true },
  { label: 'Lotto', href: '/lotto' },
  { label: 'Markets', href: '/markets' },
  { label: 'Verify', href: '/verify' },
];

function page(geoDecision) {
  const games = loadGames();
  const body = `<h1>KULA Arcade</h1>
   <p class="muted">A free, provably-fair, <b>play-token</b> arcade on the PRANA testnet. Everything here pays or stakes
   <b>PLAY</b> — an internal points token that is <b>non-cashable</b>. Free to play, fair by construction, yours to verify.</p>
   ${PLAY_EXPLAINER}
   <div class="play-note" id="play-balance" style="display:none">Your local PLAY tally: <b id="play-bal">0</b>
     <span class="muted">(a per-device demo counter — non-cashable, resets if you clear site data)</span></div>
   <h2>Play</h2>
   <div class="grid">${productTiles()}</div>
   <h2>Games</h2>
   <p class="muted" style="font-size:13px">Seasonal + arcade games — all played with non-cashable PLAY. More plug in over time.</p>
   <div class="grid">${games.map(gameCard).join('')}</div>
   ${AGE_GATE}
   <h2>How this stays on the right side of the line</h2>
   <ul class="muted" style="font-size:13.5px;line-height:1.7">
     <li><b>PLAY is non-cashable.</b> No fiat on-ramp, nothing to cash out — so there is no "consideration/prize" gambling exposure.</li>
     <li><b>The free Daily Spin is the AMOE.</b> A genuinely-free entry always available keeps the loop a lawful sweepstakes.</li>
     <li><b>Provably fair + disclosed.</b> Weights, seeds, and pool splits are published; you can recompute every result on the <a href="${esc(bp('/verify'))}">verifier</a>.</li>
     <li><b>Geofence scaffolding + disclaimers from day one.</b> "Not available where prohibited," age-gate, alpha/testnet framing — the plumbing a real-money gate would bolt onto is already here.</li>
     <li><b>Hathor is an educator only.</b> She explains how implied-probability and provably-fair draws work — she never sets a line or gives betting advice.</li>
   </ul>`;
  return shell({
    title: 'KULA Arcade — free, provably-fair, play-token', description: 'A free provably-fair play-token arcade: Daily Spin, KULA Lotto, Event Markets, and games. PLAY is non-cashable — entertainment only, not gambling.',
    canonical: `${BASE_URL}${bp('/')}`, body, nav: NAV, basePath: BASE_PATH, baseUrl: BASE_URL, geoDecision, siteName: 'KULA Arcade',
  });
}

const BOARD_SCRIPT = `<script>
(function(){
 var E=function(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c];});};
 try{var raw=null;try{raw=localStorage.getItem('kula-arcade-play');}catch(e){}
  if(raw!=null){var el=document.getElementById('play-balance');var b=document.getElementById('play-bal');if(el&&b){b.textContent=E(raw);el.style.display='';}}}catch(e){}
 var cards=document.querySelectorAll('.card[data-board]');
 cards.forEach(function(el){var id=el.getAttribute('data-id');var box=document.getElementById('b-'+id);if(!box)return;
  fetch('${'${bpjs}'}/api/board?game='+encodeURIComponent(id),{cache:'no-store'}).then(function(r){return r.json();}).then(function(j){
   if(j&&j.ok){var h='Season '+E(j.season);if(j.top&&j.top.length){h+=' — '+j.top.slice(0,3).map(function(t){return E(t.player)+' ('+E(t.score)+')';}).join(', ');}else{h+=' · no scores yet — be first';}box.textContent=h;}
   else{box.textContent='season starting soon';}
  }).catch(function(){box.textContent='season starting soon';});
 });
})();
</script>`.replace('${bpjs}', BASE_PATH);

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (commonRoutes(req, res, path, {
      baseUrl: BASE_URL, name: 'KULA Arcade',
      summary: 'A free, provably-fair, play-token arcade (Daily Spin, KULA Lotto, Event Markets, games). PLAY is non-cashable — entertainment only, not gambling, not available where prohibited.',
      sitemapPaths: ['/', '/lotto', '/markets', '/verify', '/live'],
      links: [{ label: 'Lotto', path: '/lotto' }, { label: 'Markets', path: '/markets' }, { label: 'Verify', path: '/verify' }, { label: 'Live', path: '/live' }],
      health: { games: loadGames().length, geoMode: geo.geoMode() },
    })) return;

    if (path === '/api/games') return sendJson(res, { ok: true, games: loadGames() });
    if (path === '/api/board') {
      const g = gameById(url.searchParams.get('game'));
      if (!g || !g.gameId) return sendJson(res, { ok: false, reason: 'no such board game' }, 404);
      const season = currentSeason(g.seasonLength);
      let top = [];
      let gid = g.gameId;
      try {
        // Soft dynamic import: works only where `ethers` is installed + a reader is wired; else graceful.
        const pa = await import('../../integrations/games/prana-arcade.mjs');
        try { gid = pa.gameId(g.gameId); } catch {}
        const board = await pa.readBoard(g.gameId, season);
        if (Array.isArray(board)) top = board.slice(0, 10).map((e) => ({ player: String(e.player || e[0] || ''), score: String(e.score || e[1] || '') })).filter((e) => e.player);
      } catch {}
      return sendJson(res, { ok: true, id: g.id, gameId: gid, season, top });
    }

    if (path === '/' || path === bp('/') || path === '') {
      const decision = geo.decide(req);
      // Hard-block seam (only fires in ARCADE_GEO_MODE=block with a blocked region; play-token default never does).
      if (!geo.serverGate(req, res)) return;
      const html = page(decision).replace('</body>', `${BOARD_SCRIPT}</body>`);
      return sendHtml(res, html);
    }

    // Live testnet state, read from-chain by live.mjs (soft-fails to "chain unavailable" cards offline/in tests).
    if (path === '/api/live' || path === bp('/api/live')) return sendJson(res, { ok: true, ...(await liveReadAll()) });
    if (path === '/live' || path === bp('/live')) return sendHtml(res, await liveRenderPage());

    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
  } catch {
    try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); } catch {}
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`KULA Arcade hub on ${BASE_URL} — ${loadGames().length} games`));
}
