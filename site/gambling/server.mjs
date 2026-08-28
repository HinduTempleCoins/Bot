// server.mjs — Gambling EDUCATION Center for SoapBox. EDUCATION & HARM-REDUCTION ONLY.
//
// The whole point of this surface is to tell the truth about gambling math — vig / overround,
// implied probability, +EV vs −EV, the house edge & RTP of every common game, variance, bankroll,
// and the gambler's fallacy — and to LEAD PEOPLE TO HELP. It leads with the reality: over time the
// house wins, and almost every bet is −EV. It carries a responsible-gambling help band on EVERY page
// and a dedicated /help page of real helplines and self-exclusion resources.
//
// LEGAL / ETHICAL FRAMING (load-bearing): publishing odds, results, and gambling education is ordinary,
// legal speech. TAKING a wager — running a book, operating a lottery, offering event contracts — is a
// licensed activity and is explicitly OUT OF SCOPE. This site never takes a wager, holds a stake, runs
// a book, or offers any deposit / cash-out. It informs; it does not accept bets. It is the same posture
// as `integrations/soapbox/gambling.mjs` (§4.7 odds engine) and the compliance line in
// `.local/RESEARCH_PREDICTION_MARKETS_BETTING.md` §5/§6 (prana-defi-arcade-compliance-line). It is NOT
// a "how to beat the house / guaranteed win / winning system" pitch — no such thing exists against a
// negative-EV game, and this site says so plainly.
//
//   PORT=8241 BASE_URL=https://gambling.soapbox.community node site/gambling/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /              home + explainers (vig/implied-prob/EV/house-edge/RTP/variance/bankroll/fallacy)
//   /calculators   interactive client-side calculators (EV, house-edge, odds converter, parlay,
//                  bankroll/Kelly, lottery-EV) — the §4.7 math mirrored client-side
//   /spreadsheets  download CSV worksheets (house-edge table, odds-conversion table, EV/bankroll)
//   /lottery       real published lottery odds + the negative-EV reality + the free play-token option
//   /help          responsible-gambling help: real helplines / orgs / self-exclusion (cited)
//   /health        liveness probe → {"ok":true}
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated value; safeHref() on any URL. Every page carries the persistent
//   responsible-gambling help band + an "education only — we never take a wager / hold a stake / run a
//   book" disclaimer. Soft-fail: every route renders, unknown path → 404, never a 500. ZERO request-time
//   network — all figures are pure math from gambling.mjs (§4.7) or cited static constants; the live
//   fetch readers in gambling.mjs are deliberately NOT used here. All calculators run client-side.
//
// ── SOURCES (cited facts; no network at runtime) ──────────────────────────────────────────────────
//   House edges: wizardofodds.com/gambling/house-edge/, easy.vegas/gambling/house-edge,
//     newgamenetwork.com/article/2930/best-odds-in-casino-12-games-ranked-by-house-edge/
//     (blackjack ~0.5%, video poker 9/6 JoB ~0.46%, baccarat banker ~1.06%, craps pass 1.41%,
//     roulette single-0 2.70% / double-0 5.26%, slots ~2–15%, keno ~25–35%, big-six 11–24%).
//     The roulette + blackjack + craps rows are computed from gambling.mjs tableGameOdds().
//   Lottery odds: multi-state lottery assoc. / state lottery FAQs via LotteryCalc + Illinois/Louisiana/
//     Maryland lottery game-change pages —
//     Powerball (5/69 + 1/26, $2): jackpot 1 in 292,201,338; overall any prize 1 in 24.9.
//     Mega Millions (5/70 + 1/24, $5, since Apr 8 2025 redesign): jackpot 1 in 290,472,336; overall 1 in 23.
//     EuroMillions (5/50 + 2/12): jackpot 1 in 139,838,160. Pick-6 (6/49): 1 in 13,983,816.
//   Responsible-gambling help: National Council on Problem Gambling (ncpgambling.org) — National Problem
//     Gambling Helpline call/text 1-800-522-4700 (a.k.a. 1-800-GAMBLER), text 800GAM, 24/7 chat;
//     Gamblers Anonymous (gamblersanonymous.org), Gam-Anon (gam-anon.org), GamCare UK helpline
//     0808 8020 133 (gamcare.org.uk), GAMSTOP self-exclusion (gamstop.co.uk), 988 Suicide & Crisis Lifeline.

import { createServer } from 'node:http';

import {
  tableGames, tableGameOdds,
  impliedProbability, decimalFromAmerican, impliedFromDecimal, vigOverround,
} from '../../integrations/soapbox/gambling.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags, breadcrumbJsonLd } from '../../integrations/soapbox/seo.mjs';

const PORT = +(process.env.PORT || 8241);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
// The Forum's Gambling Education board — the two tie together (discuss the math there; learn it here).
const FORUM_BOARD = (process.env.FORUM_BOARD_URL || 'https://forum.soapbox.community/b/gambling-education').replace(/\/$/, '');
const SITE_NAME = process.env.SITE_NAME || 'SoapBox Gambling Education';
// Path-routing proxy awareness (mirrors site/diagram): routes stay on '/', we PREPEND BASE_PATH to
// every self-URL we emit. Default '' → standalone behaviour unchanged.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '');
const bp = (p) => BASE_PATH + p;
// The free, provably-fair, NON-CASHABLE play-token alternative (kula-arcade-live-on-prana-testnet).
const KULA_ARCADE_URL = process.env.KULA_ARCADE_URL || 'https://alpha.melek.salon/arcade/';

// ── shared house-style helpers ─────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// safeHref: only real http(s) URLs pass; javascript:/data:/junk → ''.
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// ── responsible-gambling help resources (cited; safeHref'd) ─────────────────────────────────────────
// The National Problem Gambling Helpline is the primary US line; it is reachable both as
// 1-800-522-4700 and as 1-800-GAMBLER. (NCPG, ncpgambling.org)
export const HELPLINE_TEL = '1-800-522-4700';
export const HELPLINE_ALT = '1-800-GAMBLER';
export const HELPLINE_URL = 'https://www.ncpgambling.org/chat/';

export const HELP_ORGS = [
  {
    name: 'National Problem Gambling Helpline (NCPG)',
    contact: 'Call or text 1-800-522-4700 (a.k.a. 1-800-GAMBLER) · text 800GAM · 24/7 live chat',
    url: 'https://www.ncpgambling.org/help-treatment/',
    note: 'Free, confidential, 24/7. One call routes you to help in your own US state — all 50 states and US territories.',
    region: 'United States',
  },
  {
    name: '988 Suicide & Crisis Lifeline',
    contact: 'Call or text 988',
    url: 'https://988lifeline.org/',
    note: 'If gambling has you in crisis or thinking about self-harm, reach out now. Free, confidential, 24/7 (US).',
    region: 'United States',
  },
  {
    name: 'Gamblers Anonymous',
    contact: 'Find a meeting (in person & online)',
    url: 'https://www.gamblersanonymous.org/',
    note: 'A free 12-step peer-support fellowship for anyone who wants to stop gambling. No dues, no fees.',
    region: 'US / International',
  },
  {
    name: 'Gam-Anon',
    contact: 'Support for family & friends',
    url: 'https://www.gam-anon.org/',
    note: 'For partners, family, and friends affected by someone else’s gambling.',
    region: 'US / International',
  },
  {
    name: 'GamCare — National Gambling Helpline',
    contact: 'Call 0808 8020 133 · live chat',
    url: 'https://www.gamcare.org.uk/',
    note: 'Free, confidential help 24/7 across Great Britain.',
    region: 'United Kingdom',
  },
  {
    name: 'GAMSTOP — free self-exclusion',
    contact: 'Register online',
    url: 'https://www.gamstop.co.uk/',
    note: 'Blocks you from all UK-licensed gambling sites and apps for 6 months, 1 year, or 5 years.',
    region: 'United Kingdom',
  },
  {
    name: 'Gamblers Anonymous (GB & Ireland)',
    contact: 'Meetings across England, Wales & N. Ireland',
    url: 'https://www.gamblersanonymous.org.uk/',
    note: '~250 meeting locations; drop in, no appointment needed.',
    region: 'United Kingdom / Ireland',
  },
];

// ── supplemental sourced house-edge rows (games gambling.mjs does not model) ────────────────────────
// gambling.mjs models roulette (both), blackjack, and the craps lines from PURE math — we use those
// directly. These rows fill in the rest with cited textbook ranges. edgePct = representative % (a
// typical/best-case figure); lo/hi bound the realistic range where the game varies with rules/bet.
export const SUPP_EDGES = [
  { label: 'Video poker — 9/6 Jacks or Better (optimal play)', edgePct: 0.46, lo: 0.46, hi: 5, note: 'Best-paying paytable + perfect strategy. Worse paytables and misplays raise the edge sharply.' },
  { label: 'Baccarat — Banker (5% commission)', edgePct: 1.06, lo: 1.06, hi: 1.06, note: 'The single best bet at the baccarat table.' },
  { label: 'Baccarat — Player', edgePct: 1.24, lo: 1.24, hi: 1.36, note: 'Close behind the Banker bet.' },
  { label: 'Baccarat — Tie (8:1)', edgePct: 14.4, lo: 4.8, hi: 14.4, note: 'A sucker bet; ~14.4% at 8:1 (about 4.8% at 9:1).' },
  { label: 'Slot machines (typical)', edgePct: 6, lo: 2, hi: 15, note: 'RTP is set by the operator and usually undisclosed; casino slots commonly hold 4–10%.' },
  { label: 'Sic Bo (varies by bet)', edgePct: 8, lo: 2.78, hi: 30, note: 'Small/Big ~2.78%; specific triples can exceed 16–30%.' },
  { label: 'Big Six / Money Wheel', edgePct: 15, lo: 11, hi: 24, note: 'One of the worst bets on the floor.' },
  { label: 'Keno', edgePct: 27, lo: 25, hi: 35, note: 'Lottery-like odds on the casino floor — among the highest edges anywhere.' },
  { label: 'State lottery / Powerball (draw games)', edgePct: 50, lo: 30, hi: 55, note: 'RTP is roughly ~50% — you keep about half of what is wagered, in aggregate, before taxes.' },
];

// Combined, sorted table (best-for-player first). MODELED rows come straight from gambling.mjs.
export function houseEdgeTable() {
  const modeled = tableGames().map((g) => ({
    label: g.label,
    edgePct: +(g.houseEdgePct).toFixed(2),
    lo: +(g.houseEdgePct).toFixed(2),
    hi: +(g.houseEdgePct).toFixed(2),
    note: g.note,
    source: 'gambling.mjs (§4.7 pure math)',
  }));
  const supp = SUPP_EDGES.map((s) => ({ ...s, source: 'cited range — see page footer' }));
  return [...modeled, ...supp].sort((a, b) => a.edgePct - b.edgePct);
}

// ── real published lottery odds (cited static constants; NO network) ────────────────────────────────
export const LOTTERIES = [
  {
    name: 'Powerball (US, multi-state)',
    format: 'Pick 5 of 69 white balls + 1 of 26 Powerballs',
    ticket: 2,
    jackpotOdds: 292201338,
    overallOdds: 24.9,
    tiers: [
      { prize: 'Jackpot (5 + Powerball)', odds: 292201338 },
      { prize: '$1,000,000 (match 5)', odds: 11688053.52 },
      { prize: '$50,000 (match 4 + PB)', odds: 913129.18 },
      { prize: '$4 (match Powerball only)', odds: 38.32 },
    ],
    note: 'Jackpot 1 in 292 million. Overall chance of ANY prize is about 1 in 24.9 — but most of those "wins" are the $4 return-of-ticket tier.',
  },
  {
    name: 'Mega Millions (US, multi-state)',
    format: 'Pick 5 of 70 + 1 of 24 Mega Balls (redesigned Apr 8, 2025)',
    ticket: 5,
    jackpotOdds: 290472336,
    overallOdds: 23,
    tiers: [
      { prize: 'Jackpot (5 + Mega Ball)', odds: 290472336 },
      { prize: '$1,000,000+ (match 5, ×built-in multiplier)', odds: 12607306 },
    ],
    note: 'Since the April 2025 redesign, tickets are $5 with a built-in 2×–10× multiplier. Jackpot 1 in 290 million; overall about 1 in 23.',
  },
  {
    name: 'EuroMillions (Europe)',
    format: 'Pick 5 of 50 + 2 of 12 Lucky Stars',
    ticket: 2.5,
    jackpotOdds: 139838160,
    overallOdds: 13,
    tiers: [{ prize: 'Jackpot (5 + 2 stars)', odds: 139838160 }],
    note: 'Better jackpot odds than the US giants, still ~1 in 140 million.',
  },
  {
    name: 'Typical state "Pick 6" (6/49)',
    format: 'Pick 6 of 49',
    ticket: 1,
    jackpotOdds: 13983816,
    overallOdds: 54,
    tiers: [{ prize: 'Jackpot (match 6)', odds: 13983816 }],
    note: 'Even a "small" 6/49 game is ~1 in 14 million for the top prize.',
  },
];

// ── styling ─────────────────────────────────────────────────────────────────────────────────────────
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149;--warn:#f0883e}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{font-size:.58rem;letter-spacing:.06em;text-transform:uppercase;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 4px;vertical-align:super;margin-left:5px;font-weight:700}
  nav.topnav{margin-left:auto;display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  nav.topnav a{color:var(--fg);font-weight:600;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 12px;white-space:nowrap}
  nav.topnav a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  nav.topnav a.help{border-color:var(--down);color:var(--down)}
  .helpband{background:#f8514915;border-bottom:1px solid var(--down);color:var(--fg);font-size:13.5px;padding:8px 20px;text-align:center}
  .helpband b{color:var(--down)} .helpband a{color:var(--down);font-weight:700;text-decoration:underline}
  .disc{background:#d2992212;border:1px solid var(--gold);border-radius:9px;color:var(--fg);font-size:13px;padding:10px 14px;margin:0 0 18px}
  .disc b{color:var(--gold)}
  .wrap{max-width:1080px;margin:0 auto;padding:18px 22px}
  h1{margin:0 0 6px;font-size:26px} h2{margin:26px 0 10px;font-size:20px;border-bottom:1px solid var(--line);padding-bottom:6px}
  h3{margin:18px 0 6px;font-size:16px}
  .sub{color:var(--mut);margin:0 0 16px;font-size:15px} .muted{color:var(--mut)}
  .lead{font-size:18px;line-height:1.55;background:var(--panel);border:1px solid var(--line2);border-left:4px solid var(--down);border-radius:10px;padding:16px 18px;margin:0 0 18px}
  .lead b{color:var(--down)}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin:14px 0}
  .card{border:1px solid var(--line2);border-radius:10px;background:var(--panel);padding:14px 16px}
  .card h3{margin:0 0 6px;font-size:16px;color:var(--blue)} .card p{margin:0;font-size:13.5px;color:var(--mut)}
  table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0}
  .tblwrap{overflow-x:auto}
  th,td{border:1px solid var(--line2);padding:7px 10px;text-align:left;vertical-align:top}
  th{background:var(--panel);color:var(--mut);font-weight:600} tr:nth-child(even) td{background:#161b2288}
  td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .good{color:var(--up)} .bad{color:var(--down)} .warncol{color:var(--warn)}
  .calc{border:1px solid var(--line2);border-radius:10px;background:var(--panel);padding:16px 18px;margin:14px 0}
  .calc h3{margin:0 0 4px;color:var(--fg)} .calc .hint{color:var(--mut);font-size:13px;margin:0 0 12px}
  .row{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;margin:8px 0}
  .fld{display:flex;flex-direction:column;gap:3px} .fld label{font-size:12px;color:var(--mut)}
  .fld input,.fld select{background:#0b0f14;border:1px solid var(--line2);border-radius:7px;color:var(--fg);padding:7px 9px;font:14px system-ui;min-width:130px}
  .fld input:focus,.fld select:focus{outline:none;border-color:var(--blue)}
  .out{margin-top:10px;padding:10px 12px;border:1px dashed var(--line2);border-radius:8px;background:#0b0f14;font-size:14px;min-height:22px}
  .out .k{color:var(--mut)} .out b{font-variant-numeric:tabular-nums}
  button.act{border:1px solid var(--line2);border-radius:8px;padding:8px 15px;font-weight:700;font-size:14px;color:var(--fg);background:var(--panel);cursor:pointer}
  button.act:hover{border-color:var(--blue);color:var(--blue)}
  .dlgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:12px;margin:14px 0}
  .dl{border:1px solid var(--line2);border-radius:10px;background:var(--panel);padding:14px 16px}
  .dl h3{margin:0 0 5px;font-size:15px} .dl p{margin:0 0 10px;font-size:13px;color:var(--mut)}
  ul.tips{margin:8px 0;padding-left:20px} ul.tips li{margin:4px 0}
  .orglist{list-style:none;padding:0;margin:12px 0} .orglist li{border:1px solid var(--line2);border-radius:10px;background:var(--panel);padding:13px 15px;margin:0 0 10px}
  .orglist .nm{font-weight:700;font-size:15px} .orglist .rg{font-size:11px;color:var(--gold);border:1px solid var(--gold);border-radius:5px;padding:0 5px;margin-left:6px}
  .orglist .ct{color:var(--blue);font-size:14px;margin:3px 0} .orglist .nt{color:var(--mut);font-size:13px}
  footer{color:var(--mut);font-size:12px;padding:26px 22px;margin-top:26px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)} footer .srcs{font-size:11px;margin-top:8px}
</style>`;

// Persistent responsible-gambling help band — appears on EVERY page (load-bearing).
const HELP_BAND = `<div class=helpband role=note>
  <b>Gambling a problem?</b> Call or text <a href="${esc(safeHref(HELPLINE_URL) || '#')}"><b>${esc(HELPLINE_TEL)}</b></a>
  (a.k.a. ${esc(HELPLINE_ALT)}) — free, confidential, 24/7. Text <b>800GAM</b> or
  <a href="${esc(safeHref(HELPLINE_URL) || '#')}">chat now</a>. More help: <a href="${bp('/help')}">${esc(SITE_NAME)} help &rarr;</a>
</div>`;

// The education-only / never-take-a-wager disclaimer — appears on EVERY page (load-bearing).
const DISCLAIMER = `<div class=disc role=note>
  <b>Education only.</b> This is a free educational reference about gambling math and risk. We
  <b>never take a wager, hold a stake, or run a book</b> — there is no deposit, no cash-out, and no bet to
  place here. Publishing odds and education is legal speech; taking bets is a licensed activity and is out
  of scope. Nothing here is betting, investment, legal, or financial advice.
</div>`;

const TOPNAV = [
  ['/', 'Home'],
  ['/calculators', 'Calculators'],
  ['/spreadsheets', 'Spreadsheets'],
  ['/lottery', 'Lottery'],
].map(([p, l]) => `<a href="${bp(p)}">${esc(l)}</a>`).join('') + `<a class=help href="${bp('/help')}">Get help</a>`;

// Every page's source list (footer) — keeps facts cited without any runtime network.
const SOURCES_FOOTER = `<div class=srcs>Sources: house edges — wizardofodds.com/gambling/house-edge, easy.vegas/gambling/house-edge,
  newgamenetwork.com (12 games ranked by house edge); lottery odds — Multi-State Lottery Association &amp; state
  lottery game pages via lotterycalc.com, Illinois/Louisiana/Maryland lottery Mega Millions change pages;
  help resources — National Council on Problem Gambling (ncpgambling.org), gamblersanonymous.org, gam-anon.org,
  gamcare.org.uk, gamstop.co.uk, 988lifeline.org. Roulette/blackjack/craps edges computed from the §4.7 math in
  <code>integrations/soapbox/gambling.mjs</code>.</div>`;

function footer() {
  return `<footer>
    <b>${esc(SITE_NAME)}</b> — a free gambling-education &amp; harm-reduction reference. We never take a wager,
    hold a stake, or run a book. If gambling is causing harm, help is free and confidential:
    <a href="${bp('/help')}">get help</a> or call ${esc(HELPLINE_TEL)}.
    · Discuss the math in the <a href="${esc(FORUM_BOARD)}">Forum</a>.
    ${SOURCES_FOOTER}
  </footer>`;
}

// ── page shell ──────────────────────────────────────────────────────────────────────────────────
function page(title, bodyInner, opts = {}) {
  const desc = opts.description
    || 'Free, honest gambling education: house edge & RTP by game, implied probability, vig, +EV vs −EV, bankroll and the gambler\'s fallacy, plus interactive calculators and real lottery odds. Education only — help is one click away.';
  const canonical = opts.canonical || `${BASE_URL}${opts.path || '/'}`;
  const jsonld = [].concat(opts.jsonld || []).filter(Boolean);
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME,
    robots: opts.robots || 'index,follow,max-image-preview:large',
    jsonld: jsonld.length ? jsonld : null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}</head><body>
<header class=topbar><a class=brand href="${bp('/')}">🎲 SoapBox <span>Gambling Education</span><span class=alpha>Alpha</span></a>
  <nav class=topnav>${TOPNAV}</nav></header>
${HELP_BAND}
<main class=wrap>${DISCLAIMER}${bodyInner}</main>
${footer()}</body></html>`;
}

// ── shared server-side house-edge table (from gambling.mjs values + cited rows) ─────────────────────
function edgeTableHtml() {
  const rows = houseEdgeTable().map((r) => {
    const cls = r.edgePct < 2 ? 'good' : r.edgePct < 6 ? 'warncol' : 'bad';
    const range = (r.lo != null && r.hi != null && r.lo !== r.hi) ? `${r.lo}–${r.hi}%` : `${r.edgePct}%`;
    const rtp = `${(100 - r.edgePct).toFixed(2)}%`;
    return `<tr><td>${esc(r.label)}</td><td class="n ${cls}">${esc(range)}</td><td class=n>${esc(rtp)}</td><td>${esc(r.note)}</td></tr>`;
  }).join('');
  return `<div class=tblwrap><table>
    <thead><tr><th>Game / bet</th><th>House edge</th><th>Return to player (RTP)</th><th>Notes</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
    <p class=muted style="font-size:12.5px">RTP = 1 − house edge = the share of each dollar wagered that comes back to players in aggregate, over the very long run. It is <b>not</b> a promise for any single session; variance dominates the short run.</p>`;
}

// ── HOME / explainers ───────────────────────────────────────────────────────────────────────────────
function homePage() {
  // Pull a couple of concrete gambling.mjs values to teach with (no network).
  const dz = tableGameOdds('roulette-double-zero');
  const sz = tableGameOdds('roulette-single-zero');
  const vig = vigOverround([-110, -110]); // the classic two-sided sportsbook line
  const jsonld = [
    breadcrumbJsonLd([{ name: SITE_NAME, url: `${BASE_URL}/` }]),
    {
      '@context': 'https://schema.org', '@type': 'FAQPage',
      mainEntity: [
        { '@type': 'Question', name: 'Does the house always win?', acceptedAnswer: { '@type': 'Answer', text: 'Over the long run, yes. Every casino game and lottery is built with a house edge — a negative expected value for the player — so aggregate returns to players are less than the amount wagered. Short-run variance lets some players win, but the math grinds toward the house over time.' } },
        { '@type': 'Question', name: 'What is the house edge?', acceptedAnswer: { '@type': 'Answer', text: 'The house edge is the casino\'s expected profit as a percentage of your wager. American roulette keeps about 5.26%; blackjack with basic strategy about 0.5%; keno 25–35%. RTP (return to player) is 100% minus the house edge.' } },
        { '@type': 'Question', name: 'Can a betting system overcome the house edge?', acceptedAnswer: { '@type': 'Answer', text: 'No. No staking pattern or progression changes the expected value of a negative-EV game. Systems like Martingale rearrange when you win or lose, but the long-run expectation stays negative.' } },
      ],
    },
  ];

  const body = `
<h1>Gambling, honestly: the math the casino hopes you skip</h1>
<p class=sub>Free education on odds, expected value, and the house edge — plus calculators, downloadable
  worksheets, and real lottery odds. No sign-up, nothing to bet.</p>

<div class=lead><b>Over time, the house wins.</b> Almost every bet in a casino, sportsbook, or lottery is
  <b>−EV</b> (negative expected value): on average you lose money every time you play. That is not bad luck —
  it is the built-in design. This page teaches you exactly how that design works, so you can see it clearly.
  If gambling is hurting you or someone you love, <a href="${bp('/help')}">help is here</a>.</div>

<div class=cards>
  <div class=card><h3>Try the calculators</h3><p>Expected value, house edge per game, odds conversion, parlays, bankroll/Kelly, and lottery EV — all run in your browser.</p><p style="margin-top:8px"><a href="${bp('/calculators')}">Open calculators &rarr;</a></p></div>
  <div class=card><h3>Download the worksheets</h3><p>House-edge-by-game table, an odds-conversion sheet, and an EV/bankroll worksheet as CSV spreadsheets.</p><p style="margin-top:8px"><a href="${bp('/spreadsheets')}">Get spreadsheets &rarr;</a></p></div>
  <div class=card><h3>See the lottery odds</h3><p>Powerball, Mega Millions and friends — the real 1-in-hundreds-of-millions numbers and what a ticket is actually worth.</p><p style="margin-top:8px"><a href="${bp('/lottery')}">Lottery reality &rarr;</a></p></div>
</div>

<h2>House edge &amp; RTP — what every game keeps</h2>
<p>The <b>house edge</b> is the casino's expected hold, as a percentage of your wager. Lower is better for
  you; none of these are zero or negative for the player. The two roulette rows below are computed live from
  our §4.7 odds engine: an American (double-zero) wheel keeps
  <b class=bad>${esc((dz.houseEdgePct).toFixed(2))}%</b> and a European (single-zero) wheel keeps
  <b class=warncol>${esc((sz.houseEdgePct).toFixed(2))}%</b>.</p>
${edgeTableHtml()}

<h2>Implied probability &amp; the vig (overround)</h2>
<p>Odds are just a probability in disguise. A decimal price <code>d</code> implies a win probability of
  <code>1 / d</code>. Bookmakers shade every price a little short, so the implied probabilities across a
  market add up to <b>more than 100%</b>. That excess is the <b>vig</b> (a.k.a. juice / overround) — the
  slice the book keeps no matter who wins.</p>
<p>Classic example: a sportsbook posts both sides of a game at <b>−110</b>. Each side implies
  <b>${esc((impliedProbability(-110) * 100).toFixed(2))}%</b>, so the two sides sum to
  <b class=bad>${esc((vig.bookedProbability * 100).toFixed(2))}%</b> — an overround of
  <b class=bad>${esc(vig.marginPct.toFixed(2))}%</b>. The "fair" no-vig probability of each side is
  <b>${esc((vig.fair[0] * 100).toFixed(2))}%</b>. You are paying that ${esc(vig.marginPct.toFixed(2))}% margin
  on every bet.</p>

<h2>Expected value: +EV vs −EV</h2>
<p>Expected value (EV) is the average result of a bet if you could repeat it forever:</p>
<p style="font-family:ui-monospace,monospace;background:#0b0f14;border:1px solid var(--line2);border-radius:7px;padding:10px 12px;display:inline-block">
  EV = (P<sub>true</sub> × payout) − (1 − P<sub>true</sub>)</p>
<p>where <code>payout</code> is the net profit per unit staked on a win (decimal odds − 1). If your honest
  probability estimate beats the price offered, EV is positive (<b class=good>+EV</b>) — rare, and usually
  competed away. If the price is worse than fair — the normal case, because of the vig and the house edge —
  EV is negative (<b class=bad>−EV</b>) and you lose over time.
  <a href="${bp('/calculators')}">Run the numbers &rarr;</a></p>

<h2>Variance &amp; bankroll</h2>
<p>A negative expectation does not mean you lose every session — <b>variance</b> means short runs swing
  wildly, and that swing is exactly what keeps people playing. The longer you play a −EV game, the more the
  average asserts itself and the closer your results track the house edge. Sensible <b>bankroll</b> rules
  (only stake money you can lose, size bets as a small fraction of your bankroll, set loss limits and walk
  away) reduce the chance of ruin — they do <b>not</b> turn a −EV game positive.</p>

<h2>The gambler's fallacy</h2>
<p>Independent random events have <b>no memory</b>. After red hits five times on a fair roulette wheel, black
  is <b>not</b> "due" — the next spin is still ${esc((sz.winning))}/${esc((sz.pockets))} either way. Believing
  otherwise (the gambler's fallacy) is one of the most expensive mistakes in gambling. Related trap: the
  "hot hand" — assuming a streak will continue. Neither the wheel, the dice, nor the RNG knows what came
  before.</p>

<h2>The one honest takeaway</h2>
<p>There is <b>no system, pattern, or trick that changes the house edge</b> of a negative-EV game. Anyone
  selling you one is selling you the fallacy above. The realistic goals are: understand the true cost, treat
  it strictly as paid entertainment with money you can afford to lose, and know where the exit is. Want to
  play for fun with <b>zero real money at risk</b>? See the free, provably-fair, non-cashable
  <a href="${esc(safeHref(KULA_ARCADE_URL) || bp('/lottery'))}" rel="noopener">KULA Arcade play-token games</a>
  — entertainment only, with no real-money stake and no payout.</p>
`;
  return page('Gambling Education — House Edge, Odds & Expected Value, Explained', body, {
    path: '/', jsonld,
  });
}

// ── CALCULATORS (client-side; §4.7 math mirrored) ───────────────────────────────────────────────────
function calculatorsPage() {
  // Serve the modeled+cited edges to the client for the house-edge dropdown (JSON, esc-safe via JSON).
  const edges = houseEdgeTable().map((r) => ({ label: r.label, edge: r.edgePct }));
  const jsonld = breadcrumbJsonLd([
    { name: SITE_NAME, url: `${BASE_URL}/` },
    { name: 'Calculators', url: `${BASE_URL}/calculators` },
  ]);

  const gameOptions = edges.map((e, i) =>
    `<option value="${esc(String(e.edge))}"${i === 0 ? ' selected' : ''}>${esc(e.label)} — ${esc(String(e.edge))}%</option>`).join('');

  const body = `
<h1>Gambling calculators</h1>
<p class=sub>Every calculator runs entirely in your browser — nothing is sent anywhere, no bet is placed.
  The math mirrors our §4.7 odds engine (<code>integrations/soapbox/gambling.mjs</code>).</p>

<div class=calc id=c-ev>
  <h3>1 · Expected value (EV)</h3>
  <p class=hint>Your honest win probability vs the price offered. Positive EV is rare; the vig usually makes it negative.</p>
  <div class=row>
    <div class=fld><label>Your win probability (%)</label><input type=number id=ev-p value=50 min=0 max=100 step=any></div>
    <div class=fld><label>Decimal odds offered</label><input type=number id=ev-d value=1.91 min=1 step=any></div>
    <div class=fld><label>Stake ($)</label><input type=number id=ev-s value=100 min=0 step=any></div>
    <button class=act id=ev-go>Calculate</button>
  </div>
  <div class=out id=ev-out></div>
</div>

<div class=calc id=c-house>
  <h3>2 · House edge per game</h3>
  <p class=hint>Pick a game to see its house edge, RTP, and your expected loss over a session.</p>
  <div class=row>
    <div class=fld><label>Game / bet</label><select id=hs-game>${gameOptions}</select></div>
    <div class=fld><label>Bet size ($)</label><input type=number id=hs-bet value=10 min=0 step=any></div>
    <div class=fld><label>Number of bets</label><input type=number id=hs-n value=100 min=0 step=1></div>
    <button class=act id=hs-go>Calculate</button>
  </div>
  <div class=out id=hs-out></div>
</div>

<div class=calc id=c-conv>
  <h3>3 · Odds converter</h3>
  <p class=hint>American ↔ decimal ↔ fractional ↔ implied probability. Enter ONE field, convert.</p>
  <div class=row>
    <div class=fld><label>American (e.g. -110 or +150)</label><input type=number id=cv-am placeholder="-110" step=any></div>
    <div class=fld><label>Decimal (e.g. 1.91)</label><input type=number id=cv-dec placeholder="1.91" min=1 step=any></div>
    <div class=fld><label>Fractional (e.g. 7/2)</label><input type=text id=cv-frac placeholder="7/2"></div>
    <div class=fld><label>Implied prob (%)</label><input type=number id=cv-imp placeholder="52.38" min=0 max=100 step=any></div>
  </div>
  <div class=out id=cv-out></div>
</div>

<div class=calc id=c-parlay>
  <h3>4 · Parlay / accumulator</h3>
  <p class=hint>Combine legs (decimal odds, comma-separated). Every leg must win — the payout grows, but so does the combined vig you pay.</p>
  <div class=row>
    <div class=fld style="flex:1"><label>Legs (decimal odds)</label><input type=text id=pl-legs value="1.91, 2.10, 1.75" style="min-width:260px"></div>
    <div class=fld><label>Stake ($)</label><input type=number id=pl-s value=10 min=0 step=any></div>
    <button class=act id=pl-go>Calculate</button>
  </div>
  <div class=out id=pl-out></div>
</div>

<div class=calc id=c-kelly>
  <h3>5 · Bankroll &amp; Kelly fraction</h3>
  <p class=hint>The Kelly criterion sizes a bet to your edge. If you have no edge (the normal case), Kelly says bet <b>nothing</b>. Most who use it bet a fraction of full Kelly to cut variance.</p>
  <div class=row>
    <div class=fld><label>Bankroll ($)</label><input type=number id=kl-bank value=1000 min=0 step=any></div>
    <div class=fld><label>Your win probability (%)</label><input type=number id=kl-p value=55 min=0 max=100 step=any></div>
    <div class=fld><label>Decimal odds</label><input type=number id=kl-d value=2.0 min=1 step=any></div>
    <div class=fld><label>Kelly fraction</label><input type=number id=kl-frac value=0.5 min=0 max=1 step=any></div>
    <button class=act id=kl-go>Calculate</button>
  </div>
  <div class=out id=kl-out></div>
</div>

<div class=calc id=c-lotto>
  <h3>6 · Lottery expected value</h3>
  <p class=hint>Ticket cost vs jackpot × probability. It is almost always deeply negative — and this ignores taxes and jackpot-sharing, which make it worse.</p>
  <div class=row>
    <div class=fld><label>Ticket cost ($)</label><input type=number id=lt-cost value=2 min=0 step=any></div>
    <div class=fld><label>Jackpot ($)</label><input type=number id=lt-jack value=100000000 min=0 step=any></div>
    <div class=fld><label>Jackpot odds: 1 in …</label><input type=number id=lt-odds value=292201338 min=1 step=any></div>
    <button class=act id=lt-go>Calculate</button>
  </div>
  <div class=out id=lt-out></div>
  <p class=hint style="margin-top:8px">Prefill from a real game on the <a href="${bp('/lottery')}">lottery page</a>.</p>
</div>

<script>
(function(){
  var EDGES = ${JSON.stringify(edges)};
  function num(id){ var v = parseFloat(document.getElementById(id).value); return Number.isFinite(v)? v : NaN; }
  function money(x){ return (x<0?'-$':'$') + Math.abs(x).toLocaleString(undefined,{maximumFractionDigits:2}); }
  function pct(x){ return (x).toLocaleString(undefined,{maximumFractionDigits:2}) + '%'; }
  function set(id,html){ document.getElementById(id).innerHTML = html; }
  function bad(id,msg){ set(id, '<span class="bad">'+msg+'</span>'); }

  // §4.7 math mirrored client-side ------------------------------------------------
  function impliedFromAmerican(a){ if(!isFinite(a)||a===0) return null; return a<0 ? (-a)/(-a+100) : 100/(a+100); }
  function decimalFromAmerican(a){ if(!isFinite(a)||a===0) return null; return a>0 ? a/100+1 : 100/(-a)+1; }
  function americanFromDecimal(d){ if(!isFinite(d)||d<=1) return null; return d>=2 ? Math.round((d-1)*100) : Math.round(-100/(d-1)); }
  function impliedFromDecimal(d){ if(!isFinite(d)||d<=1) return null; return 1/d; }
  function decimalFromFractional(s){ var m=String(s).split('/'); if(m.length!==2) return null; var n=parseFloat(m[0]),de=parseFloat(m[1]); if(!isFinite(n)||!isFinite(de)||n<0||de<=0) return null; return n/de+1; }
  function fmtFrac(d){ if(!isFinite(d)||d<=1) return '—'; var num=d-1, den=1; // approximate to a tidy fraction
    var best=null; for(var q=1;q<=100;q++){ var p=Math.round(num*q); if(p<=0) continue; var err=Math.abs(p/q-num); if(best===null||err<best.err) best={p:p,q:q,err:err}; if(err<1e-9) break; }
    return best ? best.p+'/'+best.q : '—'; }

  // 1 · EV
  function evCalc(){
    var p=num('ev-p')/100, d=num('ev-d'), s=num('ev-s');
    if(!(p>0&&p<1)) return bad('ev-out','Enter a probability between 0 and 100 (exclusive).');
    if(!(d>1)) return bad('ev-out','Decimal odds must be greater than 1.');
    if(!(s>=0)) return bad('ev-out','Enter a stake of 0 or more.');
    var payout=d-1, edge=p*payout-(1-p), ev=edge*s;
    var tag = edge>0 ? '<b class="good">+EV</b>' : (edge<0 ? '<b class="bad">−EV</b>' : '<b>break-even</b>');
    set('ev-out','Per-unit edge: <b>'+pct(edge*100)+'</b> ('+tag+'). Expected result on a '+money(s)+' stake: <b class="'+(ev>=0?'good':'bad')+'">'+money(ev)+'</b>. '
      + (edge<0?'Over time, a bet like this loses.':'A rare positive-EV price — double-check your probability estimate is honest.'));
  }

  // 2 · house edge
  function houseCalc(){
    var e=num('hs-game')/100, bet=num('hs-bet'), n=num('hs-n');
    if(!(bet>=0)||!(n>=0)) return bad('hs-out','Enter a bet size and number of bets.');
    var loss=bet*n*e, rtp=100-e*100;
    set('hs-out','House edge: <b class="bad">'+pct(e*100)+'</b> · RTP: <b>'+pct(rtp)+'</b>. '
      + 'Expected loss over '+n.toLocaleString()+' bets of '+money(bet)+' (total wagered '+money(bet*n)+'): <b class="bad">'+money(loss)+'</b>. '
      + 'That is the long-run average — any one session varies widely.');
  }

  // 3 · converter
  function convFrom(which){
    var d=null;
    if(which==='am'){ var a=num('cv-am'); if(isFinite(a)) d=decimalFromAmerican(a); }
    else if(which==='dec'){ var x=num('cv-dec'); if(isFinite(x)) d=x; }
    else if(which==='frac'){ d=decimalFromFractional(document.getElementById('cv-frac').value); }
    else if(which==='imp'){ var q=num('cv-imp')/100; if(q>0&&q<1) d=1/q; }
    if(!(d>1)){ set('cv-out','<span class="muted">Enter one valid field to convert.</span>'); return; }
    var am=americanFromDecimal(d), imp=impliedFromDecimal(d);
    // reflect into the other inputs (without recursion)
    document.getElementById('cv-am').value = am;
    document.getElementById('cv-dec').value = d.toFixed(4).replace(/0+$/,'').replace(/\\.$/,'');
    document.getElementById('cv-frac').value = fmtFrac(d);
    document.getElementById('cv-imp').value = (imp*100).toFixed(2);
    set('cv-out','American <b>'+(am>0?'+':'')+am+'</b> · Decimal <b>'+d.toFixed(4)+'</b> · Fractional <b>'+fmtFrac(d)+'</b> · Implied probability <b>'+pct(imp*100)+'</b>.');
  }

  // 4 · parlay
  function parlayCalc(){
    var raw=document.getElementById('pl-legs').value.split(',').map(function(t){return parseFloat(t.trim());});
    var s=num('pl-s');
    if(raw.some(function(x){return !(x>1);})||raw.length===0) return bad('pl-out','Enter comma-separated decimal odds, each greater than 1.');
    if(!(s>=0)) return bad('pl-out','Enter a stake.');
    var combined=raw.reduce(function(a,b){return a*b;},1);
    var impl=1/combined, payout=s*combined, profit=payout-s;
    // combined vig: product of leg implied probs vs combined implied
    set('pl-out',raw.length+'-leg parlay · combined decimal <b>'+combined.toFixed(3)+'</b> ('+(americanFromDecimal(combined)>0?'+':'')+americanFromDecimal(combined)+' American). '
      + 'Implied chance all legs win: <b class="bad">'+pct(impl*100)+'</b>. A '+money(s)+' stake returns <b>'+money(payout)+'</b> ('+money(profit)+' profit) — only if EVERY leg wins. '
      + 'The vig compounds across legs, so parlays are among the worst bets by EV.');
  }

  // 5 · Kelly
  function kellyCalc(){
    var bank=num('kl-bank'), p=num('kl-p')/100, d=num('kl-d'), f=num('kl-frac');
    if(!(bank>=0)) return bad('kl-out','Enter a bankroll.');
    if(!(p>0&&p<1)) return bad('kl-out','Enter a win probability between 0 and 100.');
    if(!(d>1)) return bad('kl-out','Decimal odds must be greater than 1.');
    if(!(f>=0&&f<=1)) f=1;
    var b=d-1, q=1-p, kelly=(b*p-q)/b;
    if(kelly<=0){ set('kl-out','Full-Kelly fraction: <b class="bad">'+pct(kelly*100)+'</b>. You have <b>no edge</b> at this price — Kelly says stake <b>$0</b>. This is the normal case for casino/lottery bets.'); return; }
    var frac=kelly*f, stake=bank*frac;
    set('kl-out','Full-Kelly fraction: <b>'+pct(kelly*100)+'</b> of bankroll. At '+f+'× Kelly, stake <b>'+pct(frac*100)+'</b> = <b>'+money(stake)+'</b>. '
      + 'Kelly only applies when you genuinely have an edge; over-betting it risks ruin, so fractional Kelly is standard.');
  }

  // 6 · lottery EV
  function lottoCalc(){
    var cost=num('lt-cost'), jack=num('lt-jack'), N=num('lt-odds');
    if(!(cost>=0)||!(jack>=0)||!(N>=1)) return bad('lt-out','Enter ticket cost, jackpot, and odds (1 in N).');
    var pWin=1/N, evGross=jack*pWin, ev=evGross-cost, breakeven=cost*N;
    var retPct = cost>0 ? (evGross/cost)*100 : 0;
    set('lt-out','Chance to hit the jackpot: <b class="bad">1 in '+N.toLocaleString()+'</b> ('+pWin.toExponential(2)+'). '
      + 'Jackpot value × probability = <b>'+money(evGross)+'</b> per '+money(cost)+' ticket. '
      + 'Expected value: <b class="'+(ev>=0?'good':'bad')+'">'+money(ev)+'</b> per ticket ('+retPct.toFixed(1)+'% of cost returned, jackpot-only). '
      + 'The jackpot would need to exceed <b>'+money(breakeven)+'</b> just to break even on this tier — and that ignores taxes, annuity discounting, and splitting the prize, all of which make it worse.');
  }

  document.getElementById('ev-go').addEventListener('click',evCalc);
  document.getElementById('hs-go').addEventListener('click',houseCalc);
  document.getElementById('pl-go').addEventListener('click',parlayCalc);
  document.getElementById('kl-go').addEventListener('click',kellyCalc);
  document.getElementById('lt-go').addEventListener('click',lottoCalc);
  ['cv-am','cv-dec','cv-frac','cv-imp'].forEach(function(id){
    var which = id.split('-')[1];
    document.getElementById(id).addEventListener('change',function(){ convFrom(which); });
  });
  // prefill from ?jack=&odds=&cost= (lottery page deep-links here)
  try{ var q=new URLSearchParams(location.search);
    if(q.get('cost')) document.getElementById('lt-cost').value=q.get('cost');
    if(q.get('jack')) document.getElementById('lt-jack').value=q.get('jack');
    if(q.get('odds')) document.getElementById('lt-odds').value=q.get('odds');
    if(q.get('jack')||q.get('odds')) lottoCalc();
  }catch(e){}
  // initial renders
  evCalc(); houseCalc(); parlayCalc(); kellyCalc(); lottoCalc();
})();
</script>
`;
  return page('Gambling Calculators — EV, House Edge, Odds Converter, Parlay, Kelly & Lottery', body, {
    path: '/calculators', jsonld,
    description: 'Free client-side gambling calculators: expected value, house edge per game, odds converter (American/decimal/fractional/implied), parlay, bankroll/Kelly, and lottery EV. Nothing is wagered.',
  });
}

// ── SPREADSHEETS (client-side CSV downloads) ────────────────────────────────────────────────────────
function spreadsheetsPage() {
  // Build the CSV payloads server-side (as data) and hand them to the client to blob-download. NO server
  // file write, NO network — a pure client-side download.
  const edgeRows = houseEdgeTable().map((r) => ({
    game: r.label,
    houseEdgePct: r.edgePct,
    rtpPct: +(100 - r.edgePct).toFixed(2),
    edgeRange: (r.lo != null && r.hi != null && r.lo !== r.hi) ? `${r.lo}-${r.hi}%` : `${r.edgePct}%`,
    notes: r.note,
  }));
  // odds conversion sheet: a ladder of common American lines → decimal / implied
  const oddsLadder = [-500, -300, -250, -200, -150, -120, -110, +100, +120, +150, +200, +250, +300, +500].map((a) => ({
    american: a,
    decimal: decimalFromAmerican(a),
    impliedPct: +(impliedProbability(a) * 100).toFixed(2),
  }));

  const jsonld = breadcrumbJsonLd([
    { name: SITE_NAME, url: `${BASE_URL}/` },
    { name: 'Spreadsheets', url: `${BASE_URL}/spreadsheets` },
  ]);

  const body = `
<h1>Download the worksheets</h1>
<p class=sub>Grab any of these as a CSV spreadsheet — opens in Excel, Google Sheets, or Numbers. Files are
  generated in your browser; nothing is uploaded, and there is still nothing to bet.</p>

<div class=dlgrid>
  <div class=dl>
    <h3>House edge by game</h3>
    <p>Every common casino game and bet, ranked by house edge, with RTP and rule notes. Roulette / blackjack /
      craps values come from the §4.7 engine; the rest are cited ranges.</p>
    <button class=act data-csv="edges">Download CSV</button>
  </div>
  <div class=dl>
    <h3>Odds conversion table</h3>
    <p>A ladder of common American moneylines with their decimal odds and implied probability — a quick
      reference you can keep offline.</p>
    <button class=act data-csv="odds">Download CSV</button>
  </div>
  <div class=dl>
    <h3>EV &amp; bankroll worksheet</h3>
    <p>A ready-to-fill sheet: enter your probability, odds, and stake and the formulas compute EV, edge, and
      expected loss. Includes a bankroll / Kelly row.</p>
    <button class=act data-csv="worksheet">Download CSV</button>
  </div>
</div>

<h2>What's inside</h2>
<p class=muted>The house-edge sheet mirrors the table on the <a href="${bp('/')}">home page</a>; the odds sheet
  mirrors the converter on the <a href="${bp('/calculators')}">calculators page</a>. The worksheet is a
  template with example rows you overwrite with your own numbers — the EV column shows how fast a −EV price
  drains a bankroll.</p>

<script>
(function(){
  var EDGES = ${JSON.stringify(edgeRows)};
  var ODDS = ${JSON.stringify(oddsLadder)};
  function csvCell(v){ v = (v==null?'':String(v)); return /[",\\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; }
  function toCsv(headers, rows){ return [headers.join(',')].concat(rows.map(function(r){ return r.map(csvCell).join(','); })).join('\\r\\n'); }
  function download(name, text){
    var blob=new Blob([text],{type:'text/csv;charset=utf-8'});
    var url=URL.createObjectURL(blob);
    var a=document.createElement('a'); a.href=url; a.download=name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function(){ URL.revokeObjectURL(url); },1000);
  }
  var BUILD = {
    edges: function(){
      return toCsv(['Game / bet','House edge %','RTP %','Edge range','Notes'],
        EDGES.map(function(r){ return [r.game, r.houseEdgePct, r.rtpPct, r.edgeRange, r.notes]; }));
    },
    odds: function(){
      return toCsv(['American','Decimal','Implied probability %'],
        ODDS.map(function(r){ return [ (r.american>0?'+':'')+r.american, r.decimal, r.impliedPct ]; }));
    },
    worksheet: function(){
      var rows=[
        ['EV worksheet — fill the first three columns; the rest are the formulas spelled out',''],
        ['Win probability (0-1)','Decimal odds','Stake','Net payout on win = (odds-1)*stake','Edge = p*(odds-1)-(1-p)','Expected value = edge*stake'],
        [0.50, 1.91, 100, (1.91-1)*100, (0.5*(1.91-1)-0.5).toFixed(4), (0.5*(1.91-1)-0.5)*100],
        [0.55, 2.00, 100, (2.00-1)*100, (0.55*(2.0-1)-0.45).toFixed(4), (0.55*(2.0-1)-0.45)*100],
        ['',''],
        ['Bankroll worksheet',''],
        ['Bankroll','Win prob (0-1)','Decimal odds','Full Kelly = ((odds-1)*p-(1-p))/(odds-1)','Suggested (half-Kelly) stake'],
        [1000, 0.55, 2.00, (((2-1)*0.55-0.45)/(2-1)).toFixed(4), (1000*((((2-1)*0.55-0.45)/(2-1))*0.5)).toFixed(2)],
        ['',''],
        ['Reminder: if your true edge is zero or negative (the normal case), Kelly says stake $0. This is education only — nothing here takes a bet.','']
      ];
      return rows.map(function(r){ return r.map(csvCell).join(','); }).join('\\r\\n');
    }
  };
  document.querySelectorAll('button[data-csv]').forEach(function(b){
    b.addEventListener('click', function(){
      var k=b.getAttribute('data-csv'); var fn=BUILD[k]; if(!fn) return;
      download('soapbox-gambling-'+k+'.csv', fn());
      var o=b.textContent; b.textContent='Downloaded ✓'; setTimeout(function(){ b.textContent=o; },1400);
    });
  });
})();
</script>
`;
  return page('Gambling Spreadsheets — House Edge, Odds & EV/Bankroll Worksheets (CSV)', body, {
    path: '/spreadsheets', jsonld,
    description: 'Download free CSV spreadsheets: house-edge-by-game table, odds-conversion table, and an EV/bankroll worksheet. Generated in your browser; nothing is wagered.',
  });
}

// ── LOTTERY ─────────────────────────────────────────────────────────────────────────────────────────
function lotteryPage() {
  const jsonld = breadcrumbJsonLd([
    { name: SITE_NAME, url: `${BASE_URL}/` },
    { name: 'Lottery', url: `${BASE_URL}/lottery` },
  ]);

  const cards = LOTTERIES.map((l) => {
    const tiers = l.tiers.map((t) =>
      `<tr><td>${esc(t.prize)}</td><td class="n bad">1 in ${esc(Math.round(t.odds).toLocaleString())}</td></tr>`).join('');
    const evLink = `${bp('/calculators')}?cost=${encodeURIComponent(l.ticket)}&jack=100000000&odds=${encodeURIComponent(l.jackpotOdds)}`;
    return `<div class=card style="grid-column:1/-1">
      <h3>${esc(l.name)}</h3>
      <p style="color:var(--fg)">${esc(l.format)} · ticket <b>$${esc(String(l.ticket))}</b> · jackpot odds
        <b class=bad>1 in ${esc(l.jackpotOdds.toLocaleString())}</b> · any prize ≈ <b>1 in ${esc(String(l.overallOdds))}</b></p>
      <div class=tblwrap><table><thead><tr><th>Prize tier</th><th>Odds</th></tr></thead><tbody>${tiers}</tbody></table></div>
      <p class=muted style="font-size:13px">${esc(l.note)} <a href="${esc(evLink)}">Compute this game's EV &rarr;</a></p>
    </div>`;
  }).join('');

  const body = `
<h1>Lottery odds — the real numbers</h1>
<p class=sub>The published odds for the big draw games, and what a ticket is actually worth. Spoiler: over the
  long run, you lose.</p>

<div class=lead><b>You are far more likely to be struck by lightning</b> (about 1 in a million in a given year)
  than to win a Powerball or Mega Millions jackpot (about 1 in 290 <b>million</b>). Lotteries return only
  roughly <b>half</b> of ticket revenue as prizes — an implied "house edge" near <b>50%</b>, the worst on
  this whole site. A ticket is a small purchase of hope and entertainment; it is not an investment.</div>

<h2>Major lottery games</h2>
<div class=cards>${cards}</div>

<h2>Why lottery EV is (almost) always negative</h2>
<p>Expected value of a ticket ≈ (jackpot × your probability of winning it) − ticket cost, summed across
  prize tiers. Because the odds are astronomical, the jackpot has to be enormous just to make the
  jackpot-tier EV break even — and even when a headline jackpot briefly exceeds that break-even point,
  <b>taxes</b>, <b>annuity-vs-lump-sum discounting</b>, and the risk of <b>splitting</b> the prize with other
  winners pull the real EV back below zero. Try any game in the
  <a href="${bp('/calculators')}">lottery EV calculator</a>.</p>

<h2>The gambler's-fallacy trap, lottery edition</h2>
<p>"Numbers that haven't come up are due" is false — every draw is independent, and quick-pick vs hand-picked
  makes no difference to your odds. Playing the same numbers every week does not improve them either.</p>

<h2>Want to play for fun with zero money at risk?</h2>
<p>If it's the <em>thrill of the draw</em> you enjoy, there's a free alternative that can't cost you anything:
  the <a href="${esc(safeHref(KULA_ARCADE_URL) || bp('/'))}" rel="noopener"><b>KULA Arcade</b></a> runs a
  <b>provably-fair, non-cashable play-token lotto</b> — the tickets are earned free, the draw is verifiable
  on-chain, and there is <b>no payout</b>. It's entertainment, not real money — there's no cash prize to
  chase and no money at stake. (Alpha / testnet.)</p>
`;
  return page('Lottery Odds — Powerball, Mega Millions & the Expected-Value Reality', body, {
    path: '/lottery', jsonld,
    description: 'Real published lottery odds for Powerball, Mega Millions, EuroMillions and more — the 1-in-hundreds-of-millions jackpot numbers, why lottery EV is negative, and a free non-cashable play-token alternative.',
  });
}

// ── HELP (responsible gambling) ─────────────────────────────────────────────────────────────────────
function helpPage() {
  const jsonld = breadcrumbJsonLd([
    { name: SITE_NAME, url: `${BASE_URL}/` },
    { name: 'Get help', url: `${BASE_URL}/help` },
  ]);

  const orgs = HELP_ORGS.map((o) => {
    const href = safeHref(o.url);
    const link = href ? `<a href="${esc(href)}" rel="noopener">${esc(o.url.replace(/^https?:\/\//, ''))}</a>` : esc(o.url);
    return `<li>
      <div class=nm>${esc(o.name)}<span class=rg>${esc(o.region)}</span></div>
      <div class=ct>${esc(o.contact)}</div>
      <div class=nt>${esc(o.note)} · ${link}</div>
    </li>`;
  }).join('');

  const body = `
<h1>Get help — you're not alone</h1>
<p class=sub>Problem gambling is common, and it is treatable. Reaching out is free and confidential. If you or
  someone you care about is struggling, start with any of these.</p>

<div class=lead>Call or text the <b>National Problem Gambling Helpline</b> at
  <a href="${esc(safeHref(HELPLINE_URL) || '#')}"><b>${esc(HELPLINE_TEL)}</b></a>
  (also known as <b>${esc(HELPLINE_ALT)}</b>) — free, confidential, 24/7, everywhere in the US. Text
  <b>800GAM</b>, or <a href="${esc(safeHref(HELPLINE_URL) || '#')}">chat online now</a>. If you are in crisis
  or thinking about self-harm, call or text <b>988</b> (US Suicide &amp; Crisis Lifeline).</div>

<h2>Helplines &amp; organizations</h2>
<ul class=orglist>${orgs}</ul>

<h2>Self-exclusion — put a wall between you and the bet</h2>
<p>Self-exclusion lets you voluntarily ban yourself from casinos and gambling sites for a set period. In the
  US, most states and casinos run voluntary self-exclusion programs (the NCPG can point you to yours). In
  Great Britain, <a href="https://www.gamstop.co.uk/" rel="noopener">GAMSTOP</a> blocks every UK-licensed
  site and app in one free registration (6 months, 1 year, or 5 years). Many operators also offer deposit
  limits, cool-off periods, and account closure — use them.</p>

<h2>Warning signs</h2>
<ul class=tips>
  <li>Betting more than you can afford to lose, or chasing losses to "get even".</li>
  <li>Borrowing money, selling things, or lying to family to keep gambling.</li>
  <li>Gambling to escape stress, or feeling restless or irritable when trying to cut back.</li>
  <li>Gambling harming your work, studies, relationships, or sleep.</li>
</ul>
<p>If any of these sound familiar, that call is worth making today.</p>

<h2>How to help someone else</h2>
<p>You don't have to fix it alone. <a href="https://www.gam-anon.org/" rel="noopener">Gam-Anon</a> supports
  family and friends of people who gamble. Lead with concern, not blame; don't cover their debts or bail them
  out repeatedly; and share the helpline number above. Support for you matters too.</p>

<p class=muted style="margin-top:18px">This site is education and harm-reduction only. We never take a wager,
  hold a stake, or run a book — there is no bet to place here, ever.</p>
`;
  return page('Get Help — Responsible Gambling Helplines & Self-Exclusion', body, {
    path: '/help', jsonld,
    description: 'Free, confidential help for problem gambling: National Problem Gambling Helpline 1-800-522-4700 (1-800-GAMBLER), Gamblers Anonymous, Gam-Anon, GamCare, GAMSTOP self-exclusion, and warning signs.',
  });
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', '/calculators', '/spreadsheets', '/lottery', '/help'];

// Map path → page renderer. Keeps handler tiny and testable.
const PAGES = {
  '/': homePage,
  '/calculators': calculatorsPage,
  '/spreadsheets': spreadsheetsPage,
  '/lottery': lotteryPage,
  '/help': helpPage,
};

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname.replace(/\/+$/, '') || '/';

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
        summary: 'Free gambling EDUCATION & harm-reduction: house edge/RTP by game, implied probability & vig, +EV vs −EV, variance, bankroll, the gambler\'s fallacy, interactive calculators, downloadable CSV worksheets, real lottery odds, and responsible-gambling helplines. Education only — never takes a wager, holds a stake, or runs a book.',
        links: SITEMAP_PATHS.map((p) => ({ label: p === '/' ? 'Home & explainers' : p.slice(1), path: p })),
      }));
    }

    const render = PAGES[path];
    if (render) return sendHtml(res, render());

    // unknown → 404 (still carries help band + disclaimer via page shell)
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — ' + SITE_NAME,
      '<h1>Not found</h1><p class=muted>That page doesn\'t exist. <a href="' + bp('/') + '">Start at the gambling-education home</a>, or <a href="' + bp('/help') + '">get help</a>.</p>',
      { robots: 'noindex,follow' }));
  } catch (e) {
    // last-resort soft-fail — still never a stack trace to the client
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error');
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/gambling\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Gambling Education on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
