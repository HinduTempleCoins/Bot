// site/arcade/lotto.mjs — KULA Lotto: the play-token raffle surface. A ticket costs non-cashable PLAY;
// a periodic draw picks the winner from a verifiable, committed seed; the pool split + on-chain proof
// concept are shown up front. Draw SETTLEMENT is the PRANA contract's job (another agent) — this
// surface renders the PLAY UI + the "verify this draw yourself" story, reusing the SAME provably-fair
// commit-reveal engine as the casino dice (integrations/games/dice-provably-fair.mjs) so the proof is
// consistent across the arcade. Design: .local/KULA_LOTTO_DESIGN.md §4b/§5 + RESEARCH §6.
//
//   PORT=8160 BASE_URL=https://arcade.soapbox.community BASE_PATH=/lotto node site/arcade/lotto.mjs
//
// Compliance: PLAY only, non-cashable, no fiat rail, no cash-out. Disclaimer + geofence + age-gate
// from shared.mjs. Provably fair + disclosed pool split. Soft-fail; ZERO request-time network.

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import * as dice from '../../integrations/games/dice-provably-fair.mjs';
import { esc, safeHref, shell, commonRoutes, sendHtml, sendJson, PLAY_EXPLAINER, AGE_GATE, geo } from './shared.mjs';

const PORT = +(process.env.PORT || 8160);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
const ARCADE_URL = safeHref(process.env.ARCADE_URL || '/') || '/';

// ── PURE lotto helpers ────────────────────────────────────────────────────────────────────────────
export const TICKET_PRICE_PLAY = +(process.env.LOTTO_TICKET_PLAY || 10);   // non-cashable PLAY per ticket

// The disclosed pool split (design §5 / RESEARCH §4b). Illustrative + tunable; shown on the page so
// the "edge" is never hidden. Sums to 100.
export const POOL_SPLIT = Object.freeze({ prize: 90, treasuryPoL: 5, burn: 5 });

// poolSplit(potPlay) → the PLAY that flows to each bucket for a given pot. Never throws.
export function poolSplit(potPlay) {
  const pot = Math.max(0, Number(potPlay) || 0);
  const prize = Math.floor(pot * POOL_SPLIT.prize / 100);
  const treasuryPoL = Math.floor(pot * POOL_SPLIT.treasuryPoL / 100);
  const burn = pot - prize - treasuryPoL; // remainder → burn, so the split always reconciles
  return { pot, prize, treasuryPoL, burn };
}

// drawWinner({ serverSeed, drawId, ticketCount, nonce }) → { winner, roll, hmac, serverSeedHash }.
// Reuses the casino's HMAC commit-reveal engine: the winning ticket index is deterministic in the
// committed serverSeed + the public drawId, so ANY entrant can recompute it after the seed is
// revealed. (A production draw also folds participant entropy on-chain per KULA_LOTTO_DESIGN §4b; the
// verifiable-seed proof story is the same.) Soft-fails to winner 0 on garbage.
export function drawWinner({ serverSeed, drawId, ticketCount, nonce = 0 } = {}) {
  const n = Math.max(1, Math.floor(Number(ticketCount) || 1));
  const r = dice.roll({ serverSeed, clientSeed: String(drawId == null ? '' : drawId), nonce });
  const winner = ((r.roll % n) + n) % n;
  return { winner, roll: r.roll, hmac: r.hmac, ticketCount: n, drawId: String(drawId == null ? '' : drawId), serverSeedHash: dice.commit(serverSeed) };
}

// A FIXED, PUBLIC demo epoch so anyone can replay the sample draw on the verifier. A production settler
// keeps the secret seed off-host and publishes ONLY its hash up front, revealing on rotation.
const DEMO_SERVER_SEED = process.env.LOTTO_DEMO_SEED || 'kula-lotto-demo-epoch-0';
const DEMO_HASH = dice.commit(DEMO_SERVER_SEED);
const DEMO_DRAW_ID = 'draw-2026-08-26';
const DEMO_TICKETS = 250;

const NAV = [
  { label: 'Hub', href: ARCADE_URL, external: /^https?:/i.test(ARCADE_URL) },
  { label: 'Lotto', href: '/lotto' },
  { label: 'Markets', href: '/markets' },
  { label: 'Verify', href: '/verify' },
];

function page(geoDecision) {
  const demo = drawWinner({ serverSeed: DEMO_SERVER_SEED, drawId: DEMO_DRAW_ID, ticketCount: DEMO_TICKETS });
  const samplePot = TICKET_PRICE_PLAY * DEMO_TICKETS;
  const split = poolSplit(samplePot);
  const body = `<h1>KULA Lotto</h1>
   <p class="muted">A provably-fair raffle. A ticket costs <b>${esc(TICKET_PRICE_PLAY)} PLAY</b> (non-cashable). When the
   draw closes, the winning ticket is picked from a <b>committed, verifiable seed</b> — you can recompute it yourself.
   No money is staked and nothing here can be cashed out.</p>
   ${PLAY_EXPLAINER}

   <h2>This draw</h2>
   <div class="card">
     <table>
       <tr><th>Draw</th><td><code>${esc(DEMO_DRAW_ID)}</code></td></tr>
       <tr><th>Ticket price</th><td>${esc(TICKET_PRICE_PLAY)} PLAY (non-cashable)</td></tr>
       <tr><th>Tickets in pool</th><td>${esc(DEMO_TICKETS)}</td></tr>
       <tr><th>Committed seed hash</th><td><code>${esc(DEMO_HASH.slice(0, 24))}…</code></td></tr>
     </table>
     <form method=get action="${esc(bp('/'))}" style="margin-top:10px" onsubmit="return kulaEnter(event)">
       <label class="muted">Tickets (paid in PLAY): </label>
       <input id="tk" type=number min=1 max=100 value=1 style="width:70px;background:#0b0f14;border:1px solid var(--line2);color:var(--fg);border-radius:6px;padding:6px">
       <button class="btn primary" type=submit>Enter the draw</button>
       <div class="fair-note" id="enter-msg"></div>
     </form>
   </div>

   <h2>Where the pool goes (disclosed)</h2>
   <p class="muted" style="font-size:13.5px">The split is published up front — the "edge" is never hidden. For this
   sample pot of <b>${esc(samplePot)} PLAY</b> (${esc(DEMO_TICKETS)} × ${esc(TICKET_PRICE_PLAY)}):</p>
   <table>
     <tr><th>Prize pool (to the winner)</th><td>${esc(POOL_SPLIT.prize)}% → ${esc(split.prize)} PLAY</td></tr>
     <tr><th>Treasury / protocol-owned-liquidity</th><td>${esc(POOL_SPLIT.treasuryPoL)}% → ${esc(split.treasuryPoL)} PLAY</td></tr>
     <tr><th>Burn (PLAY sink)</th><td>${esc(POOL_SPLIT.burn)}% → ${esc(split.burn)} PLAY</td></tr>
   </table>

   <h2>Verify this draw</h2>
   <p class="muted" style="font-size:13.5px">Fairness is the seed commitment, exactly like the dice table. Before the
   draw the house publishes <code>serverSeedHash = SHA256(serverSeed)</code>. After the draw it reveals
   <code>serverSeed</code>; anyone checks the hash matches, then recomputes the winner:</p>
   <div class="card"><code>winner = HMAC_SHA256(serverSeed, drawId) mod ticketCount</code>
     <div class="fair-note">Sample: drawId <code>${esc(DEMO_DRAW_ID)}</code>, ${esc(DEMO_TICKETS)} tickets →
     winning ticket <b>#${esc(demo.winner)}</b> (roll ${esc(demo.roll)}). On seed reveal, confirm
     <code>SHA256(serverSeed)</code> equals the committed hash above, then replay it on the
     <a href="${esc(bp('/verify'))}">verifier</a>.</div>
   </div>
   <p class="muted" style="font-size:12.5px">On PRANA, the settlement contract also folds entropy from every entrant
   into the seed (participant-aggregated commit-reveal), so no single party — not even the miners — can grind the
   result. This page renders the play UI and the proof story; the draw itself settles on-chain.</p>

   ${AGE_GATE}`;
  return shell({
    title: 'KULA Lotto — provably-fair play-token raffle', description: 'A provably-fair raffle played with non-cashable PLAY. Committed seed, disclosed pool split, verify any draw yourself. Entertainment only, not gambling.',
    canonical: `${BASE_URL}${bp('/')}`, body, nav: NAV, basePath: BASE_PATH, baseUrl: BASE_URL, geoDecision, siteName: 'KULA Lotto',
  });
}

const ENTER_SCRIPT = `<script>
function kulaEnter(ev){ev.preventDefault();try{
  var el=document.getElementById('tk');var n=Math.max(1,Math.min(100,parseInt(el&&el.value,10)||1));
  var cost=n*${TICKET_PRICE_PLAY};var msg=document.getElementById('enter-msg');
  var bal=0;try{bal=parseInt(localStorage.getItem('kula-arcade-play')||'0',10)||0;}catch(e){}
  if(bal<cost){if(msg)msg.textContent='Not enough PLAY — earn free PLAY on the Daily Spin first. (PLAY is non-cashable.)';return false;}
  bal-=cost;try{localStorage.setItem('kula-arcade-play',String(bal));}catch(e){}
  if(msg)msg.textContent='Entered '+n+' ticket(s) for '+cost+' PLAY (demo). Your PLAY tally: '+bal+'. Winner is drawn from the committed seed — verify it after the draw.';
}catch(e){}return false;}
</script>`;

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (commonRoutes(req, res, path, {
      baseUrl: BASE_URL, name: 'KULA Lotto',
      summary: 'A provably-fair raffle played with non-cashable PLAY tickets. Committed seed + disclosed pool split; verify any draw. Entertainment only, not gambling, not available where prohibited.',
      sitemapPaths: ['/'], links: [{ label: 'Lotto', path: '/' }],
      health: { ticketPricePlay: TICKET_PRICE_PLAY, geoMode: geo.geoMode() },
    })) return;

    // Offline-deterministic draw proof endpoint (no network).
    if (path === '/api/draw') {
      const serverSeed = url.searchParams.get('serverSeed') || DEMO_SERVER_SEED;
      const drawId = url.searchParams.get('drawId') || DEMO_DRAW_ID;
      const ticketCount = +(url.searchParams.get('tickets') || DEMO_TICKETS);
      const d = drawWinner({ serverSeed, drawId, ticketCount });
      return sendJson(res, { ok: true, cashable: false, currency: 'PLAY', ...d, split: poolSplit(ticketCount * TICKET_PRICE_PLAY) });
    }

    if (path === '/' || path === bp('/') || path === '') {
      if (!geo.serverGate(req, res)) return;
      const html = page(geo.decide(req)).replace('</body>', `${ENTER_SCRIPT}</body>`);
      return sendHtml(res, html);
    }

    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
  } catch {
    try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); } catch {}
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`KULA Lotto on ${BASE_URL}`));
}
