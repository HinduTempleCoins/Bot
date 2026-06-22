// site/arcade/server.mjs — the GTArcade hub: one page where MELEK's PRANA games appear, starting with the
// SEED GAME (the commit-reveal raffle/casino) and the FARMING GAME (SeasonalFarm), and EXTENSIBLE to other
// games later (just add a registry entry). Each tile shows what the game is + its live state; games that
// post to ArcadeLeaderboard also show the current season + top scores (via integrations/games/prana-arcade).
//
// House style: ESM, esc() all interpolation, env-injected registry (no infra in the repo), handler(req,res)
// exported for tests, soft-fail. Live on-chain reads are OPTIONAL — the page always renders; leaderboards
// fill in when an ArcadeLeaderboard reader is wired on the box. Alpha badge per the standing convention.
//
//   PORT=8159 node site/arcade/server.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { gameId as arcadeGameId, currentSeason, readBoard } from '../../integrations/games/prana-arcade.mjs';

const PORT = +(process.env.PORT || 8159);
const HOST = process.env.HOST || '127.0.0.1';
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };

// ── games registry (env-injected; safe default = the Seed + Farming games + the PvP slate "coming soon") ──
// To add a game later: append to MELEK_ARCADE_GAMES_JSON. kind ∈ seed|farm|board|coming. `board` games carry
// a `gameId` (ArcadeLeaderboard) + `seasonLength` so the tile shows the live season + top scores.
const EXAMPLE_GAMES = [
  { id: 'seed-raffle', name: 'Seed Raffle', kind: 'seed', token: 'KULA', live: true,
    blurb: 'The Token Casino primitive — buy tickets, the winner is drawn from a future blockhash (a seed nobody can predict or grind). Provably fair, no house edge on the draw.',
    play: 'https://alpha.pranascan.soapbox.community' },
  { id: 'seasonal-farm', name: 'Seasonal Farm', kind: 'farm', token: 'KULA', live: true,
    blurb: 'Plant a seed in a plot, add water to grow it faster, wait for it to mature, then harvest a crop. A per-season modifier scales every harvest. Seeds + water burn; yields mint.',
    play: 'https://alpha.pranascan.soapbox.community' },
  { id: 'pentecaust-arena', name: 'Arena (Pentecaust)', kind: 'board', token: 'MELEK', live: false,
    gameId: 'pentecaust-arena', seasonLength: 604800,
    blurb: 'Play from your Pentecaust game channel — scores post to a weekly seasonal leaderboard with a MELEK prize pool. The social front door to the arcade.' },
  { id: 'seed-sower', name: 'Seed Sower', kind: 'coming', token: 'MELEK',
    blurb: 'Two-rank mancala (Kalah) on the GameTable engine — sow your seeds, chain extra turns, capture the opposite pit.' },
  { id: 'glyph-guess', name: 'Glyph Guess', kind: 'coming', token: 'MELEK',
    blurb: 'Commit-reveal hidden-glyph duel on GameTable.' },
];
function cleanGame(g) {
  if (!g || typeof g !== 'object' || !g.id) return null;
  return {
    id: String(g.id).toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40),
    name: String(g.name || g.id), kind: ['seed', 'farm', 'board', 'coming'].includes(g.kind) ? g.kind : 'coming',
    token: String(g.token || 'MELEK'), live: !!g.live, blurb: String(g.blurb || ''),
    play: g.play ? String(g.play) : '', gameId: g.gameId ? String(g.gameId) : '', seasonLength: +g.seasonLength || 0,
  };
}
export function loadGames() {
  const raw = process.env.MELEK_ARCADE_GAMES_JSON;
  if (raw) { try { const a = JSON.parse(raw); if (Array.isArray(a)) { const o = a.map(cleanGame).filter(Boolean); if (o.length) return o; } } catch {} }
  return EXAMPLE_GAMES.map(cleanGame).filter(Boolean);
}
const gameById = (id) => loadGames().find((g) => g.id === String(id || '').toLowerCase()) || null;

const KIND = { seed: { label: '🎲 Seed / Casino', c: 'seed' }, farm: { label: '🌱 Farming', c: 'farm' }, board: { label: '🏆 Arena', c: 'board' }, coming: { label: '… Coming soon', c: 'coming' } };

function card(g) {
  const k = KIND[g.kind] || KIND.coming;
  const cta = g.kind === 'coming'
    ? '<span class="btn ghost" aria-disabled=true>Coming soon</span>'
    : `<a class="btn primary" href="${esc(g.play || '#')}"${g.play ? ' target=_blank rel=noopener' : ''}>▶ Play</a>`;
  return `<div class="card ${k.c}" data-id="${esc(g.id)}"${g.gameId ? ` data-board="${esc(g.gameId)}"` : ''}>
    <div class=top><h2>${esc(g.name)}</h2><span class="kind ${k.c}">${esc(k.label)}</span></div>
    <p class=blurb>${esc(g.blurb)}</p>
    ${g.gameId ? `<div class=board id="b-${esc(g.id)}"><span class=mut>loading season…</span></div>` : ''}
    <div class=foot><span class=token>${esc(g.token)}</span>${cta}</div>
  </div>`;
}

const PAGE = () => {
  const games = loadGames();
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>GTArcade — MELEK</title>
<meta name=description content="The MELEK arcade — seed games, farming, and seasonal arenas on PRANA.">
<style>
 :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--blue:#4c8dff;--purple:#9a7bff}
 *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:14px}
 .wrap{max-width:1000px;margin:0 auto}
 header{display:flex;align-items:center;gap:10px;margin:6px 0 4px}.brand{font-size:24px;font-weight:800}.brand b{color:var(--gold)}
 .alpha{font-size:10px;font-weight:700;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px}
 .lead{color:var(--mut);font-size:14px;margin:2px 0 16px}
 .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:14px}
 .card{background:var(--panel);border:1px solid var(--bd);border-radius:16px;padding:16px;display:flex;flex-direction:column}
 .card.coming{opacity:.62}
 .top{display:flex;align-items:flex-start;gap:8px}.top h2{font-size:17px;margin:0;flex:1}
 .kind{font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px;border:1px solid var(--bd);color:var(--mut);white-space:nowrap}
 .kind.seed{color:var(--purple);border-color:var(--purple)}.kind.farm{color:var(--green);border-color:var(--green)}.kind.board{color:var(--gold);border-color:var(--gold)}
 .blurb{color:var(--fg);font-size:13px;margin:10px 0;flex:1}
 .board{font-size:12px;color:var(--mut);background:#0e131b;border:1px solid var(--bd);border-radius:10px;padding:8px 10px;margin-bottom:10px}
 .board b{color:var(--fg)}.board ol{margin:4px 0 0;padding-left:18px}.board li{margin:1px 0}
 .foot{display:flex;align-items:center;gap:8px;margin-top:auto}.token{font-size:11px;color:var(--mut);border:1px solid var(--bd);border-radius:6px;padding:2px 7px}
 .btn{margin-left:auto;font:inherit;font-weight:700;border-radius:10px;padding:8px 14px;text-decoration:none;border:1px solid var(--bd);background:#0e131b;color:var(--fg)}
 .btn.primary{background:var(--gold);color:#1a1306;border-color:var(--gold)}.btn.ghost{color:var(--mut)}
 .mut{color:var(--mut)}footer{color:var(--mut);font-size:12px;text-align:center;margin:24px 0 8px}a{color:var(--gold)}
</style></head><body><div class=wrap>
<header><span class=brand><b>GT</b>Arcade</span><span class=alpha>Alpha</span></header>
<p class=lead>MELEK's games on PRANA — the <b>Seed</b> games (casino), the <b>Farm</b>, and seasonal <b>Arenas</b>. One account, one token economy; more games plug in over time.</p>
<div class=grid>${games.map(card).join('')}</div>
<footer>Play earns + stakes flow through your one MELEK account. Seasons are on-chain &amp; time-derived. <a href="/health">api</a></footer>
</div>
<script>
const E=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function loadBoards(){
 for(const el of document.querySelectorAll('.card[data-board]')){
  const id=el.dataset.id; const box=document.getElementById('b-'+id); if(!box)continue;
  try{const r=await fetch('/api/board?game='+encodeURIComponent(id),{cache:'no-store'});const j=await r.json();
   if(j&&j.ok){let h='<b>Season '+E(j.season)+'</b>';
    if(j.top&&j.top.length){h+='<ol>'+j.top.map(t=>'<li>'+E(t.player)+' — '+E(t.score)+'</li>').join('')+'</ol>';}
    else{h+=' · <span class=mut>no scores yet — be first</span>';}
    box.innerHTML=h;}
   else{box.innerHTML='<span class=mut>season starting soon</span>';}
  }catch(e){box.innerHTML='<span class=mut>season starting soon</span>';}
 }
}
loadBoards();
</script></body></html>`;
};

export async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://arcade.local');
    const path = url.pathname;
    if (path === '/health') return json(res, 200, { ok: true, games: loadGames().length });
    if (path === '/api/games') return json(res, 200, { ok: true, games: loadGames() });
    if (path === '/api/board') {
      const g = gameById(url.searchParams.get('game'));
      if (!g || !g.gameId) return json(res, 404, { ok: false, reason: 'no such board game' });
      const season = currentSeason(g.seasonLength);
      // readBoard soft-returns null unless an ArcadeLeaderboard reader is wired (on the box) — graceful.
      let top = [];
      try {
        const board = await readBoard(g.gameId, season);
        if (Array.isArray(board)) top = board.slice(0, 10).map((e) => ({ player: String(e.player || e[0] || ''), score: String(e.score || e[1] || '') })).filter((e) => e.player);
      } catch {}
      return json(res, 200, { ok: true, id: g.id, gameId: arcadeGameId(g.gameId), season, top });
    }
    if (path === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE()); }
    res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found');
  } catch { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`GTArcade hub on http://${HOST}:${PORT} — ${loadGames().length} games`));
}
