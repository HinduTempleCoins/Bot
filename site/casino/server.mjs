// server.mjs — Casino.SoapBox — the provably-fair NATIVE-TOKEN dice table, a standalone zero-dep HTTP
// service in the SoapBox house style (mirrors site/insurance/server.mjs). It fronts the pure engine
// integrations/games/dice-provably-fair.mjs and does NOTHING else with money: it computes a game
// outcome and shows the proof. It holds no keys, broadcasts nothing, and settles nothing on-chain.
//
//   PORT=8188 BASE_URL=https://casino.soapbox.community node site/casino/server.mjs
//
// ── What this is (and is NOT) — from .local/KULA_LOTTO_DESIGN.md ──────────────────────────────────
//   * NATIVE-TOKEN ENTERTAINMENT, NOT REAL MONEY. Wagers are the ecosystem's OWN token (KULA / PLAY /
//     internal credits) — crypto-native altcoin gaming, never fiat (design CASINO-FRAMING correction
//     2026-08-24). A prominent banner + a responsible-play note say so on every page.
//   * PROVABLY FAIR via off-chain HMAC commit-reveal (design §1, §4a): the server-seed hash is
//     committed UP FRONT (shown on the page), the player supplies a client seed + nonce, and any roll
//     is independently recomputable on /verify from the revealed seed. DO NOT USE BLOCKHASH — PRANA is
//     our own PoW chain, so the house makes the blocks and any block-variable RNG is house-controllable
//     (design §2/§6). The HMAC scheme reads no chain state at all, which is why it is safe here.
//   * The 1% house edge routes CONCEPTUALLY to burn / buyback-PoL / the immutable Hathor 3% cut
//     (design §5). No settlement happens in this repo — that is a Signer-broadcast KULA transfer, out
//     of scope. This service only computes the game + shows the proof.
//
// ── Routes ───────────────────────────────────────────────────────────────────────────────────────
//   /            the dice table — pick target / over-under / bet; shows committed serverSeedHash + roll
//   /roll        GET compute a roll+settlement from query params (target,over,bet,clientSeed,nonce,serverSeed)
//   /verify      paste seeds → recompute a past roll and check the commitment (the audit page)
//   /health /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// DISCIPLINE: esc() every interpolated value. Soft-fail: every route renders even on garbage. The demo
// server seed here is a FIXED, PUBLICLY-KNOWN demo value (not a secret) — a production settler would
// generate a fresh secret seed per epoch off-host and only publish its hash. No keys live here.

import { createServer } from 'node:http';

import * as dice from '../../integrations/games/dice-provably-fair.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, siteGraph, jsonLdScript } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8188);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const SITE_NAME = 'SoapBox Casino';
const TOKEN = process.env.CASINO_TOKEN || 'KULA';

export const esc = dice.esc; // reuse the engine's escaper (house rule: esc() every interpolation)

// A FIXED demo epoch: the seed is intentionally public so anyone can replay every demo roll on
// /verify. A production settler keeps the secret off-host and publishes ONLY the hash up front.
const DEMO_SERVER_SEED = process.env.CASINO_DEMO_SEED || 'melek-casino-demo-epoch-0';
const DEMO_SERVER_SEED_HASH = dice.commit(DEMO_SERVER_SEED);

// ── shared house-style theme (same dark palette as Insurance/Coupons) ─────────────────────────────
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:820px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:19px;margin:0 0 10px} h3{font-size:15px;margin:14px 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  label{display:block;font-size:13px;color:var(--mut);margin:10px 0 4px}
  input,select{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:10px 12px;font-size:15px;width:100%}
  input:focus,select:focus{border-color:var(--blue);outline:none}
  .row{display:flex;flex-wrap:wrap;gap:12px} .row>div{flex:1 1 160px;min-width:120px}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:700;padding:12px 22px;font-size:15px;margin-top:14px}
  button:hover{border-color:var(--blue);color:var(--blue)}
  code,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;word-break:break-all}
  .commit{background:#0b0f14;border:1px dashed var(--line2);border-radius:8px;padding:10px 12px;margin:10px 0}
  .commit b{color:var(--gold)}
  .result{border-radius:10px;padding:16px 18px;margin:14px 0;border:1px solid var(--line2)}
  .result.win{border-color:var(--up)} .result.lose{border-color:var(--down)}
  .roll-big{font-size:40px;font-weight:800;letter-spacing:1px}
  .win-tag{color:var(--up);font-weight:800} .lose-tag{color:var(--down);font-weight:800}
  .not-real-banner{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:11px 14px;color:var(--gold);font-size:13px;margin:12px 0;font-weight:600}
  .responsible{background:#f8514911;border:1px solid var(--down);border-radius:8px;padding:10px 14px;color:#f8b3ad;font-size:12px;margin:12px 0}
  table.kv{width:100%;border-collapse:collapse;font-size:14px;margin:8px 0}
  .kv td{padding:7px 8px;border-bottom:1px solid var(--line)} .kv td:first-child{color:var(--mut);width:42%}
  .ok{color:var(--up);font-weight:700} .bad{color:var(--down);font-weight:700}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// The load-bearing "not real money · provably fair · verify any roll" banner. On every page.
function notRealBanner() {
  return `<div class="not-real-banner" role="note">🎲 Native-token entertainment, <b>not real money</b> ·
    provably fair · <a href="/verify">verify any roll</a>. Wagers are the ecosystem's own token
    (${esc(TOKEN)}) — crypto-native gaming, never fiat.</div>`;
}
function responsibleNote() {
  return `<div class="responsible" role="note">Play responsibly. This is entertainment with an
    ecosystem token, not an investment or a way to make money — the house edge means the game is
    +EV for the house by design. Never wager more than you can comfortably lose, and take breaks.</div>`;
}

const FOOTER = `<footer>
  <b>Provably fair, native-token only.</b> SoapBox Casino is crypto-native entertainment played with the
  ecosystem's own ${esc(TOKEN)} token — <b>not real money, not fiat, not an investment</b>. Every roll is an
  off-chain HMAC commit-reveal (server-seed hash committed up front, your client seed + nonce mixed in) and
  is independently auditable on the <a href="/verify">verify</a> page. No blockhash is ever used. This
  service holds no keys and settles nothing on-chain.
  <div style="margin-top:8px"><a href="/">Dice</a> · <a href="/verify">Verify</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'Provably-fair native-token dice — crypto-native entertainment (not real money). The server-seed hash is committed up front; verify any roll from the revealed seed.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/verify` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">🎲 SoapBox <span>casino</span></a>
  <div class=topbar-r><a href="/">Dice</a><a href="/verify">Verify</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// The committed-seed panel, shown on the table so the player sees the binding commitment up front.
function commitPanel() {
  return `<div class="commit"><span class=muted>Committed server-seed hash (this epoch):</span><br>
    <code>${esc(DEMO_SERVER_SEED_HASH)}</code><br>
    <span class=muted style="font-size:12px">Published <b>before</b> your bet — the house is bound to this
    seed. On epoch rotation the seed is revealed so you can recompute every roll on
    <a href="/verify">verify</a>.</span></div>`;
}

// ── the dice table ─────────────────────────────────────────────────────────────────────────────────
export function homePage(params = {}) {
  const target = clampInt(params.target, dice.DEFAULTS.target, 1, dice.ROLL_MAX - 1);
  const over = params.over === undefined ? dice.DEFAULTS.over : params.over === 'over' || params.over === true || params.over === 'true';
  const bet = Math.max(0, Number.isFinite(+params.bet) ? +params.bet : 10);
  const clientSeed = params.clientSeed ? String(params.clientSeed) : 'player-seed';
  const nonce = clampInt(params.nonce, 0, 0, Number.MAX_SAFE_INTEGER);

  let resultHtml = '';
  if (params._rolled) {
    const rolled = dice.roll({ serverSeed: DEMO_SERVER_SEED, clientSeed, nonce });
    const s = dice.settleBet({ roll: rolled.roll, target, over, betAmount: bet, edgeBps: dice.DEFAULTS.edgeBps });
    const two = (n) => (n / 100).toFixed(2);
    resultHtml = `<div class="result ${s.win ? 'win' : 'lose'}">
      <div class="roll-big">${two(s.roll)}</div>
      <div>${s.win ? '<span class=win-tag>WIN</span>' : '<span class=lose-tag>LOSE</span>'} —
        rolled ${esc(String(two(s.roll)))} · needed ${over ? 'over' : 'under'} ${esc(String(two(target)))}</div>
      <table class=kv>
        <tr><td>Wager</td><td>${esc(String(bet))} ${esc(TOKEN)}</td></tr>
        <tr><td>Win chance</td><td>${esc(s.winChancePct.toFixed(2))}%</td></tr>
        <tr><td>Multiplier (1% edge)</td><td>${esc(s.multiplier.toFixed(4))}×</td></tr>
        <tr><td>Payout</td><td>${esc(s.payout.toFixed(4))} ${esc(TOKEN)}</td></tr>
        <tr><td>Net</td><td class="${s.profit >= 0 ? 'ok' : 'bad'}">${esc(s.profit >= 0 ? '+' : '')}${esc(s.profit.toFixed(4))} ${esc(TOKEN)}</td></tr>
        <tr><td>Client seed : nonce</td><td class=mono>${esc(clientSeed)} : ${esc(String(nonce))}</td></tr>
        <tr><td>HMAC-SHA256 digest</td><td class=mono>${esc(rolled.hmac)}</td></tr>
      </table>
      <div class=muted style="font-size:12px">Recompute this exact roll (after the seed is revealed) on
      <a href="/verify?serverSeed=${encodeURIComponent(DEMO_SERVER_SEED)}&clientSeed=${encodeURIComponent(clientSeed)}&nonce=${nonce}&roll=${s.roll}&serverSeedHash=${encodeURIComponent(DEMO_SERVER_SEED_HASH)}">the verify page</a>.
      This is a demo epoch, so the seed is already public.</div>
    </div>`;
  }

  const body = `<h1>Dice <span class=muted style="font-size:14px">· provably fair · ${esc(TOKEN)}</span></h1>
    ${notRealBanner()}
    ${commitPanel()}
    <form class=card method=get action="/roll">
      <div class=row>
        <div><label>Target (0.00–99.99)</label><input name=target type=number step=0.01 min=0.01 max=99.98 value="${esc((target / 100).toFixed(2))}"></div>
        <div><label>Roll must be</label><select name=over>
          <option value=over ${over ? 'selected' : ''}>Over</option>
          <option value=under ${over ? '' : 'selected'}>Under</option>
        </select></div>
      </div>
      <div class=row>
        <div><label>Wager (${esc(TOKEN)})</label><input name=bet type=number step=any min=0 value="${esc(String(bet))}"></div>
        <div><label>Nonce</label><input name=nonce type=number step=1 min=0 value="${esc(String(nonce))}"></div>
      </div>
      <label>Client seed (your randomness — edit any time)</label>
      <input name=clientSeed value="${esc(clientSeed)}" autocomplete=off>
      <button type=submit>Roll the dice</button>
    </form>
    ${resultHtml}
    ${responsibleNote()}
    <div class=card><h2>How the fairness works</h2>
      <p class=muted style="font-size:14px">Roll = <code>HMAC_SHA256(serverSeed, clientSeed:nonce)</code>
      folded uniformly into 0.00–99.99. The <b>server-seed hash is committed above before you bet</b>, so
      the house can't swap the seed; your client seed means the house can't precompute your result; the
      nonce increments per bet. On epoch rotation the server seed is revealed and you can replay every roll.
      <b>No blockhash is ever used</b> — this chain is ours to mine, so a block-variable would be
      house-controllable; the HMAC scheme reads no chain state at all.</p></div>`;
  return page(`${SITE_NAME} — provably-fair native-token dice`, body, { canonical: `${BASE_URL}/` });
}

// ── the verify (audit) page ─────────────────────────────────────────────────────────────────────────
export function verifyPage(params = {}) {
  const serverSeed = params.serverSeed != null ? String(params.serverSeed) : '';
  const serverSeedHash = params.serverSeedHash != null ? String(params.serverSeedHash) : '';
  const clientSeed = params.clientSeed != null ? String(params.clientSeed) : '';
  const nonce = params.nonce != null ? String(params.nonce) : '';
  const claimed = params.roll != null ? String(params.roll) : '';

  let resultHtml = '';
  const anyInput = serverSeed || clientSeed || nonce || claimed;
  if (anyInput) {
    const recomputed = dice.roll({ serverSeed, clientSeed, nonce: parseInt(nonce, 10) });
    const computedHash = dice.commit(serverSeed);
    const hashProvided = serverSeedHash.trim();
    const hashMatches = hashProvided ? hashProvided.toLowerCase() === computedHash.toLowerCase() : null;
    const rollMatches = claimed !== '' ? recomputed.roll === Math.trunc(Number(claimed)) : null;
    const ok = dice.verify({ serverSeed, serverSeedHash: hashProvided || computedHash, clientSeed, nonce: parseInt(nonce, 10), roll: parseInt(claimed, 10) });
    resultHtml = `<div class="result ${claimed !== '' ? (ok ? 'win' : 'lose') : ''}">
      <table class=kv>
        <tr><td>SHA256(serverSeed)</td><td class=mono>${esc(computedHash)}</td></tr>
        ${hashProvided ? `<tr><td>Commitment match</td><td class="${hashMatches ? 'ok' : 'bad'}">${hashMatches ? 'MATCHES ✓ (seed not swapped)' : 'DOES NOT MATCH ✗'}</td></tr>` : ''}
        <tr><td>Recomputed roll</td><td><b>${esc((recomputed.roll / 100).toFixed(2))}</b> (${esc(String(recomputed.roll))})</td></tr>
        ${claimed !== '' ? `<tr><td>Claimed roll</td><td>${esc((Math.trunc(Number(claimed)) / 100).toFixed(2))} (${esc(String(Math.trunc(Number(claimed))))})</td></tr>` : ''}
        ${rollMatches !== null ? `<tr><td>Roll reproduces</td><td class="${rollMatches ? 'ok' : 'bad'}">${rollMatches ? 'YES ✓' : 'NO ✗'}</td></tr>` : ''}
        <tr><td>HMAC digest</td><td class=mono>${esc(recomputed.hmac)}</td></tr>
        ${claimed !== '' && hashProvided ? `<tr><td>Overall verify()</td><td class="${ok ? 'ok' : 'bad'}">${ok ? 'PROVABLY FAIR ✓' : 'FAILED ✗'}</td></tr>` : ''}
      </table></div>`;
  }

  const body = `<h1>Verify a roll</h1>
    ${notRealBanner()}
    <p class=muted>Paste the revealed <b>server seed</b>, its published <b>hash</b>, your <b>client seed</b>,
    the <b>nonce</b>, and the <b>roll</b> you were shown. This page recomputes the roll independently and
    checks the commitment — proving the house neither swapped the seed nor faked the outcome.</p>
    <form class=card method=get action="/verify">
      <label>Server seed (revealed)</label><input name=serverSeed value="${esc(serverSeed)}" autocomplete=off>
      <label>Published server-seed hash (optional — SHA256 of the seed)</label><input name=serverSeedHash value="${esc(serverSeedHash)}" autocomplete=off>
      <div class=row>
        <div><label>Client seed</label><input name=clientSeed value="${esc(clientSeed)}" autocomplete=off></div>
        <div><label>Nonce</label><input name=nonce type=number step=1 min=0 value="${esc(nonce)}"></div>
        <div><label>Roll (0–9999)</label><input name=roll type=number step=1 min=0 max=9999 value="${esc(claimed)}"></div>
      </div>
      <button type=submit>Recompute &amp; verify</button>
    </form>
    ${resultHtml}
    <div class=card><h2>What a pass means</h2>
      <p class=muted style="font-size:14px"><b>Commitment match</b> proves the server seed is the same one
      whose hash was published before you bet. <b>Roll reproduces</b> proves the shown roll is exactly what
      the HMAC yields for these seeds and nonce. Both true → the roll was provably fair. Fairness proves the
      RNG wasn't tampered with — <b>not</b> that the odds favor you; the disclosed house edge still applies.</p></div>`;
  return page(`Verify a roll — ${SITE_NAME}`, body, { canonical: `${BASE_URL}/verify`, robots: 'noindex,follow' });
}

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
function clampInt(v, dflt, lo, hi) {
  // target comes in as a two-decimal value (e.g. 50.00) OR already-scaled int; homePage passes the
  // scaled int from /roll. Here we accept a number and clamp to [lo,hi].
  const n = Math.trunc(Number(v));
  if (!Number.isFinite(n)) return dflt;
  return Math.max(lo, Math.min(hi, n));
}

function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', '/verify'];

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
        path: u, lastmod: today, changefreq: 'weekly', priority: u === '/' ? '1.0' : '0.6',
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
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: `Provably-fair native-token dice (wagers are the ${TOKEN} ecosystem token — NOT real money, not fiat). Off-chain HMAC commit-reveal; no blockhash; every roll independently verifiable.`,
        links: [{ label: 'Dice table', path: '/' }, { label: 'Verify a roll', path: '/verify' }],
      }));
    }

    if (path === '/') return sendHtml(res, homePage());

    // /roll — the table submits here; render the home page WITH a computed result.
    if (path === '/roll') {
      const p = Object.fromEntries(url.searchParams.entries());
      // target arrives as a two-decimal string (e.g. "50.00") → scale to the 0..9999 int space.
      const tRaw = Number(p.target);
      p.target = Number.isFinite(tRaw) ? Math.round(tRaw * 100) : dice.DEFAULTS.target;
      p._rolled = true;
      return sendHtml(res, homePage(p));
    }

    if (path === '/verify') {
      const p = Object.fromEntries(url.searchParams.entries());
      return sendHtml(res, verifyPage(p));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// expose for tests
export { siteGraph, jsonLdScript, DEMO_SERVER_SEED, DEMO_SERVER_SEED_HASH };

// Bind the port only when run directly (CLI guard scoped to site/casino/), not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/casino\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Casino on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
