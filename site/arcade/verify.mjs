// site/arcade/verify.mjs — the Provably-Fair page: "verify any draw, spin, or market yourself." This is
// the trust differentiator. It reuses the SAME commit-reveal engine the casino dice + KULA Lotto use
// (integrations/games/dice-provably-fair.mjs), documents exactly how to recompute a result, links the
// per-surface verifiers, and ships a client-side recomputation widget (browser Web Crypto — no external
// libraries). A leaderboard of top verifiers renders gracefully with or without a wired reader.
//
//   PORT=8162 BASE_URL=https://arcade.soapbox.community BASE_PATH=/verify node site/arcade/verify.mjs
//
// Compliance from shared.mjs. PLAY is non-cashable; this page settles nothing and holds no keys — it
// only proves outcomes. Soft-fail; ZERO request-time network.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import * as dice from '../../integrations/games/dice-provably-fair.mjs';
import { esc, safeHref, shell, commonRoutes, sendHtml, sendJson, geo } from './shared.mjs';

const PORT = +(process.env.PORT || 8162);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
const ARCADE_URL = safeHref(process.env.ARCADE_URL || '/') || '/';
const SPIN_URL = safeHref(process.env.SPIN_URL || 'https://spin.soapbox.community') || 'https://spin.soapbox.community';
const CASINO_URL = safeHref(process.env.CASINO_URL || 'https://casino.soapbox.community') || 'https://casino.soapbox.community';

// Leaderboard reader is optional + injectable; soft-returns [] without one wired (no network here).
let _readLeaderboard = null;
export function __setLeaderboardReader(fn) { _readLeaderboard = typeof fn === 'function' ? fn : null; }
export async function topVerifiers() {
  try { if (_readLeaderboard) { const r = await _readLeaderboard(); if (Array.isArray(r)) return r.slice(0, 10); } } catch {}
  return [];
}

const NAV = [
  { label: 'Hub', href: ARCADE_URL, external: /^https?:/i.test(ARCADE_URL) },
  { label: 'Lotto', href: '/lotto' },
  { label: 'Markets', href: '/markets' },
  { label: 'Verify', href: '/verify' },
];

function leaderboardHtml(rows) {
  if (!rows || !rows.length) {
    return `<div class="fair-note">No verifications recorded yet — be the first to recompute a draw and prove it fair.</div>`;
  }
  return `<table><tr><th>#</th><th>Verifier</th><th>Draws checked</th></tr>${
    rows.map((r, i) => `<tr><td>${esc(i + 1)}</td><td>${esc(r.player || r.account || r[0] || '')}</td><td>${esc(r.count || r.score || r[1] || '')}</td></tr>`).join('')
  }</table>`;
}

function page(geoDecision, rows) {
  const body = `<h1>Provably Fair — verify it yourself</h1>
   <p class="muted">Every spin, draw, and market resolution in KULA Arcade is <b>provably fair</b>: the outcome is
   fixed by a seed the house <b>commits to before you play</b>, and you can recompute it afterward. "Provably fair"
   proves the RNG wasn't tampered with — it does not mean the odds favor you. PLAY is non-cashable; nothing here is money.</p>

   <h2>The scheme (commit → reveal → recompute)</h2>
   <ol class="muted" style="font-size:13.5px;line-height:1.7">
     <li><b>Commit.</b> The house publishes <code>serverSeedHash = SHA256(serverSeed)</code> before any play. It can't swap the seed later without breaking the hash.</li>
     <li><b>Play.</b> You contribute a <code>clientSeed</code> (or, for the lotto, the public <code>drawId</code>) and a <code>nonce</code>. Outcome = <code>HMAC_SHA256(serverSeed, clientSeed:nonce)</code>, folded into a range.</li>
     <li><b>Reveal + recompute.</b> On seed rotation the house reveals <code>serverSeed</code>. You confirm <code>SHA256(serverSeed)</code> matches the committed hash, then recompute every outcome. No blockhash is used — PRANA is our own chain, so a block variable would be house-controllable.</li>
   </ol>

   <h2>Verify a roll now</h2>
   <div class="card">
     <p class="muted" style="font-size:13px">Recompute a dice/lotto roll in your browser (Web Crypto — nothing is sent to a server):</p>
     <div class="row" style="display:flex;flex-wrap:wrap;gap:8px">
       <input id="ss" placeholder="serverSeed (revealed)" style="flex:1 1 180px;background:#0b0f14;border:1px solid var(--line2);color:var(--fg);border-radius:6px;padding:7px">
       <input id="cs" placeholder="clientSeed / drawId" style="flex:1 1 140px;background:#0b0f14;border:1px solid var(--line2);color:var(--fg);border-radius:6px;padding:7px">
       <input id="nc" type=number value=0 placeholder="nonce" style="width:90px;background:#0b0f14;border:1px solid var(--line2);color:var(--fg);border-radius:6px;padding:7px">
       <button class="btn primary" onclick="kulaVerify()">Recompute</button>
     </div>
     <div class="fair-note" id="vout">Roll appears here (0–9999). Compare it to the result the game showed you.</div>
   </div>

   <h2>Per-surface verifiers</h2>
   <ul class="muted" style="font-size:13.5px;line-height:1.8">
     <li><b>Daily Spin</b> — the wheel prints the exact HMAC message; recompute at <a href="${esc(SPIN_URL)}" target=_blank rel=noopener>the Daily Spin</a>.</li>
     <li><b>Casino Dice</b> — full commit-reveal audit page at <a href="${esc(CASINO_URL)}/verify" target=_blank rel=noopener>the dice verifier</a>.</li>
     <li><b>KULA Lotto</b> — recompute the winning ticket from the revealed seed on <a href="${esc(bp('/lotto'))}">the Lotto page</a> / <code>${esc(bp('/lotto'))}/api/draw</code>.</li>
     <li><b>Event Markets</b> — each market names the public source + settlement time; the resolution is checkable against that source with a dispute window (<a href="${esc(bp('/markets'))}">markets</a>).</li>
   </ul>

   <h2>Verifier leaderboard</h2>
   ${leaderboardHtml(rows)}`;
  return shell({
    title: 'KULA Arcade — Provably Fair verifier', description: 'Verify any spin, draw, or market resolution in KULA Arcade yourself. Commit-reveal explained, a browser recomputation widget, and per-surface verifiers.',
    canonical: `${BASE_URL}${bp('/')}`, body, nav: NAV, basePath: BASE_PATH, baseUrl: BASE_URL, geoDecision, siteName: 'KULA Provably Fair',
  });
}

// Browser recomputation: mirrors dice-provably-fair foldToRoll (0..9999) using SubtleCrypto HMAC.
const VERIFY_SCRIPT = `<script>
function _foldToRoll(hex){if(!hex||hex.length<4)return 0;var limit=Math.floor(0x10000/10000)*10000;
 for(var i=0;i+4<=hex.length;i+=4){var chunk=parseInt(hex.slice(i,i+4),16);if(isFinite(chunk)&&chunk<limit)return chunk%10000;}
 var acc=0;for(var j=0;j<hex.length;j++){acc=(acc*16+(parseInt(hex[j],16)||0))%10000;}return acc;}
async function kulaVerify(){var out=document.getElementById('vout');try{
 var ss=(document.getElementById('ss').value)||'';var cs=(document.getElementById('cs').value)||'';var nc=parseInt(document.getElementById('nc').value,10)||0;
 if(!(window.crypto&&crypto.subtle)){out.textContent='Web Crypto unavailable in this browser — use the dice verifier page instead.';return;}
 var enc=new TextEncoder();var key=await crypto.subtle.importKey('raw',enc.encode(ss),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 var sig=await crypto.subtle.sign('HMAC',key,enc.encode(cs+':'+nc));
 var b=new Uint8Array(sig);var hex='';for(var i=0;i<b.length;i++){hex+=('0'+b[i].toString(16)).slice(-2);}
 out.textContent='roll = '+_foldToRoll(hex)+' (0–9999). For a lotto, winner = roll mod ticketCount.';
}catch(e){out.textContent='Could not recompute — check the seeds.';}}
</script>`;

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (commonRoutes(req, res, path, {
      baseUrl: BASE_URL, name: 'KULA Provably Fair',
      summary: 'Verify any spin, draw, or market resolution in KULA Arcade yourself: commit-reveal explained + a browser recomputation widget. PLAY is non-cashable; entertainment only, not gambling, not available where prohibited.',
      sitemapPaths: ['/'], links: [{ label: 'Verify', path: '/' }],
      health: { geoMode: geo.geoMode() },
    })) return;

    // Server-side verification (reuses the pure engine) — offline deterministic.
    if (path === '/api/verify') {
      const p = url.searchParams;
      const ok = dice.verify({
        serverSeed: p.get('serverSeed'), serverSeedHash: p.get('serverSeedHash'),
        clientSeed: p.get('clientSeed'), nonce: +(p.get('nonce') || 0), roll: +(p.get('roll') || -1),
      });
      return sendJson(res, { ok: true, verified: !!ok });
    }

    if (path === '/' || path === bp('/') || path === '') {
      if (!geo.serverGate(req, res)) return;
      const rows = await topVerifiers();
      const html = page(geo.decide(req), rows).replace('</body>', `${VERIFY_SCRIPT}</body>`);
      return sendHtml(res, html);
    }

    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
  } catch {
    try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); } catch {}
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`KULA Provably Fair verifier on ${BASE_URL}`));
}
