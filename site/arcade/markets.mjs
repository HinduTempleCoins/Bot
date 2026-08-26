// site/arcade/markets.mjs — KULA Arcade Event Markets: a handful of binary Yes/No markets played with
// non-cashable PLAY. The teaching point (Kalshi-style): a share settles at 1 PLAY if the event happens
// and 0 if not, so its PRICE reads as the market-implied probability. This surface shows that idea
// using the PURE odds math already in integrations/soapbox/gambling.mjs (impliedProbability, vig) —
// education first. Markets resolve by NAMED public reference sources (the watchdog / 17-API catalog)
// with a dispute window. PLAY stakes only; no money, no cash-out. Design: RESEARCH §3a/§4a/§6.
//
//   PORT=8161 BASE_URL=https://arcade.soapbox.community BASE_PATH=/markets node site/arcade/markets.mjs
//
// Compliance from shared.mjs (disclaimer, geofence, age-gate, alpha/testnet). Hathor is an EDUCATOR
// only here — she explains implied-probability; she never sets a line or gives betting advice.
// Soft-fail; ZERO request-time network (markets + sources are a static, disclosed demo set).

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { impliedProbability, vig } from '../../integrations/soapbox/gambling.mjs';
import { esc, safeHref, shell, commonRoutes, sendHtml, sendJson, PLAY_EXPLAINER, AGE_GATE, geo } from './shared.mjs';

const PORT = +(process.env.PORT || 8161);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
const ARCADE_URL = safeHref(process.env.ARCADE_URL || '/') || '/';

// A small, disclosed demo set. Prices are in PLAY-cents (1..99) per Yes/No share — Kalshi-style, the
// price IS the implied probability. `source` names the reference source that resolves it (Kalshi
// discipline: named source + resolution time up front). Neutral, verifiable questions only.
export const MARKETS = [
  { id: 'ci-hf25', q: 'Will a new MELEK hardfork ship on testnet before the next season rolls over?',
    yes: 58, no: 46, source: 'MELEK chain RPC (on-chain hardfork version)', resolves: 'season close', window: '48h dispute' },
  { id: 'watchdog-bill', q: 'Will the tracked bill reach a floor vote this session?',
    yes: 33, no: 71, source: 'Congress.gov / open-states (watchdog 17-API catalog)', resolves: 'session end', window: '48h dispute' },
  { id: 'noaa-rain', q: 'Will the reference station record measurable rain tomorrow?',
    yes: 40, no: 63, source: 'NOAA climate (public station reading)', resolves: 'next day 23:59 UTC', window: '24h dispute' },
];

// marketMath(m): from the posted Yes/No PLAY-cent prices, derive the implied probabilities and the
// overround (the built-in margin) using the shared gambling.mjs helpers — PURE, no network.
export function marketMath(m) {
  const impYes = (Number(m.yes) || 0) / 100;
  const impNo = (Number(m.no) || 0) / 100;
  const v = vig(impYes, impNo) || { overround: 0, marginPct: 0, fairA: impYes, fairB: impNo };
  return {
    impYesPct: (impYes * 100).toFixed(0),
    impNoPct: (impNo * 100).toFixed(0),
    marginPct: v.marginPct.toFixed(1),
    fairYesPct: (v.fairA * 100).toFixed(0),
    fairNoPct: (v.fairB * 100).toFixed(0),
  };
}

const NAV = [
  { label: 'Hub', href: ARCADE_URL, external: /^https?:/i.test(ARCADE_URL) },
  { label: 'Lotto', href: '/lotto' },
  { label: 'Markets', href: '/markets' },
  { label: 'Verify', href: '/verify' },
];

function marketCard(m) {
  const mm = marketMath(m);
  return `<div class="card" data-id="${esc(m.id)}">
    <h3>${esc(m.q)}</h3>
    <table>
      <tr><th>Yes</th><td>${esc(m.yes)} PLAY → implied <b>${esc(mm.impYesPct)}%</b></td></tr>
      <tr><th>No</th><td>${esc(m.no)} PLAY → implied <b>${esc(mm.impNoPct)}%</b></td></tr>
      <tr><th>Overround (margin)</th><td>${esc(mm.marginPct)}% → de-vigged fair ${esc(mm.fairYesPct)}% / ${esc(mm.fairNoPct)}%</td></tr>
      <tr><th>Resolves from</th><td>${esc(m.source)}</td></tr>
      <tr><th>Settlement</th><td>${esc(m.resolves)} · ${esc(m.window)}</td></tr>
    </table>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn" onclick="kulaStake('${esc(m.id)}','yes')">Stake PLAY on Yes</button>
      <button class="btn" onclick="kulaStake('${esc(m.id)}','no')">Stake PLAY on No</button>
    </div>
    <div class="fair-note" id="msg-${esc(m.id)}"></div>
  </div>`;
}

function page(geoDecision) {
  // A worked implied-probability example using the American-odds helper (education, Hathor's voice).
  const exOdds = -150;
  const exP = impliedProbability(exOdds);
  const body = `<h1>Event Markets</h1>
   <p class="muted">Binary <b>Yes/No</b> markets, Kalshi-style: a share settles at <b>1 PLAY</b> if the event happens
   and <b>0</b> if it doesn't — so the price you pay reads as the <b>market-implied probability</b>. You stake
   non-cashable <b>PLAY</b> only. This is education and entertainment, not a real-money book.</p>
   ${PLAY_EXPLAINER}

   <div class="play-note"><b>Hathor explains (education, not advice):</b> a Yes price of 60 PLAY means the market
   implies about a 60% chance. American odds of <code>${esc(exOdds)}</code> imply
   <b>${esc((exP * 100).toFixed(1))}%</b> (risk ${esc(Math.abs(exOdds))} to win 100). When Yes% + No% add up to more
   than 100%, that excess is the <b>overround</b> — the built-in margin. Hathor never sets a line or tells you what to stake.</div>

   <h2>Markets</h2>
   <div class="grid">${MARKETS.map(marketCard).join('')}</div>

   <h2>How markets resolve</h2>
   <ul class="muted" style="font-size:13.5px;line-height:1.7">
     <li><b>Named reference source, fixed up front.</b> Each market lists the public source that resolves it (the
       watchdog / 17-API catalog, NOAA, on-chain RPC) and its settlement time — the Kalshi discipline.</li>
     <li><b>Dispute window.</b> A proposed outcome opens a challenge window (optimistic-oracle style) before it
       finalizes, so a wrong resolution can be contested.</li>
     <li><b>PLAY stakes only.</b> No money enters or leaves; winnings are non-cashable PLAY. Verify any resolution on the
       <a href="${esc(bp('/verify'))}">verifier</a>.</li>
   </ul>
   ${AGE_GATE}`;
  return shell({
    title: 'KULA Arcade — Event Markets (play-token)', description: 'Binary Yes/No event markets played with non-cashable PLAY; price reads as implied probability. Resolved by named public sources. Education first, not a real-money book.',
    canonical: `${BASE_URL}${bp('/')}`, body, nav: NAV, basePath: BASE_PATH, baseUrl: BASE_URL, geoDecision, siteName: 'KULA Event Markets',
  });
}

const STAKE_SCRIPT = `<script>
function kulaStake(id,side){try{
  var msg=document.getElementById('msg-'+id);var stake=10;
  var bal=0;try{bal=parseInt(localStorage.getItem('kula-arcade-play')||'0',10)||0;}catch(e){}
  if(bal<stake){if(msg)msg.textContent='Not enough PLAY — earn free PLAY on the Daily Spin first. (PLAY is non-cashable.)';return;}
  bal-=stake;try{localStorage.setItem('kula-arcade-play',String(bal));}catch(e){}
  if(msg)msg.textContent='Staked '+stake+' PLAY on '+side.toUpperCase()+' (demo). Your PLAY tally: '+bal+'. Settles from the named source; verify the resolution.';
}catch(e){}}
</script>`;

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (commonRoutes(req, res, path, {
      baseUrl: BASE_URL, name: 'KULA Event Markets',
      summary: 'Binary Yes/No event markets played with non-cashable PLAY; price ≈ implied probability. Resolved by named public reference sources with a dispute window. Education first, not gambling, not available where prohibited.',
      sitemapPaths: ['/'], links: [{ label: 'Markets', path: '/' }],
      health: { markets: MARKETS.length, geoMode: geo.geoMode() },
    })) return;

    if (path === '/api/markets') {
      return sendJson(res, { ok: true, cashable: false, currency: 'PLAY', markets: MARKETS.map((m) => ({ ...m, math: marketMath(m) })) });
    }

    if (path === '/' || path === bp('/') || path === '') {
      if (!geo.serverGate(req, res)) return;
      const html = page(geo.decide(req)).replace('</body>', `${STAKE_SCRIPT}</body>`);
      return sendHtml(res, html);
    }

    res.writeHead(404, { 'content-type': 'text/plain' }); res.end('not found');
  } catch {
    try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); } catch {}
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`KULA Event Markets on ${BASE_URL} — ${MARKETS.length} markets`));
}
