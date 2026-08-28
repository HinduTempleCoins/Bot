// server.mjs — Travel.SoapBox.Community. The TRAVEL vertical as a standalone HTTP service in the
// SoapBox house style (mirrors site/coupons/server.mjs and site/hemp/server.mjs). Operator (Jun-4,
// L6853) named Shopping/Travel/Home as siblings to the live Coupons/A Buck/Stores set.
//
// There is no FREE, keyless live flights/hotels price feed (Skyscanner/Kayak/Booking all gate behind
// paid affiliate APIs), so — exactly like the repo's other no-live-data verticals — Travel is a CURATED
// DIRECTORY: the honest travel-comparison doorways (flights, hotels, car rentals, cruises, vacation
// rentals, parking, tours, travel insurance), each with its honest incumbent and an outbound link
// routed through affiliate.trackedLink(). Source of truth for the doorway list is the shared
// aggregator-directory (group=travel) so it never drifts from the rest of the ecosystem.
//
//   PORT=8133 BASE_URL=https://travel.soapbox.community node site/travel/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /            the curated travel directory — a card per doorway + a destination search box
//   /health      liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ────────────────────────────────────────────────────────────────────────────────────
//   HONEST, NOT PAY-TO-RANK. Doorways are listed alphabetically/canonically, never reordered by
//   commission. Outbound links route through the shared affiliate engine (works unmonetized until env
//   ids are set) and carry the FTC disclosure. NO data-selling. Soft-fail: every route renders even if
//   the directory module is unavailable — never throws. esc() on every interpolated value. A directory,
//   not travel advice; prices and availability live on the merchant's own site.

import { createServer } from 'node:http';

import * as affiliate from '../../integrations/affiliate.mjs';
import { listByGroup, BRAND_GUARDRAIL } from '../../integrations/aggregator-directory.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import * as seo from '../../integrations/soapbox/seo.mjs';
import * as guides from '../../integrations/affiliate-guides.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';
import * as routing from '../../integrations/soapbox/routing.mjs';

const PORT = +(process.env.PORT || 8133);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.DATA_SITE || 'https://data.soapbox.community';
const SHOPPING = process.env.SHOPPING_SITE || 'https://shopping.soapbox.community';
const SEARCH = process.env.SEARCH_SITE || 'https://search.soapbox.community';
const SITE_NAME = 'SoapBox Travel';

// ── shared house-style helpers (same dark theme as Coupons/Hemp/Law/Stocks) ───────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const slugify = (s) => String(s == null ? '' : s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950;--down:#f85149}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:920px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 10px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  .sec .x{display:inline-block;margin-top:8px;font-size:12px;font-weight:700;color:var(--blue)}
  form.hsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 220px;min-width:160px;max-width:420px}
  input.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .verify{background:#d2992211;border:1px solid var(--gold);border-radius:8px;padding:10px 14px;color:var(--gold);font-size:13px;margin:12px 0}
  ul.legs{list-style:none;margin:8px 0;padding:0} li.leg{padding:10px 0;border-bottom:1px solid var(--line);display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  li.leg:last-child{border-bottom:0} .leg .mode{font-weight:700;color:var(--fg);min-width:74px} .leg .meta{color:var(--mut);font-size:13px}
  .empty{color:var(--mut);padding:12px 0}
  .ftc-disclosure{color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px;margin-top:14px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const VERIFY_NOTE = `<div class=verify><b>Prices &amp; availability change constantly.</b> Fares, room rates, and
  terms move minute to minute — always check the current price and policy on the provider's own site before
  you book.</div>`;

const FOOTER = `<footer>
  <b>Honest ranking, not pay-to-rank.</b> SoapBox Travel lists comparison doorways in a fixed order — never
  reordered by commission. Some links are <b>affiliate links</b>; we may earn a commission at no extra cost to
  you, and <b>we never sell your data</b>. Verify current prices on the provider's site.
  <div style="margin-top:8px"><a href="/">Travel</a> · <a href="${esc(SHOPPING)}">Shopping</a> · <a href="${esc(DATA)}">Data</a> · <a href="${esc(SEARCH)}">Search</a></div>
</footer>`;

// ── doorways: the curated travel directory (source of truth = the shared aggregator-directory) ──────
// Soft-fail: if the directory module is unavailable, fall back to a built-in list so the page still
// renders every doorway. Each doorway carries a generic outbound search routed through the shared
// affiliate engine (unmonetized until env ids are set) — we never hard-code a single vendor as "the" pick.
const FALLBACK_DOORWAYS = [
  { id: 'flights', name: 'Flights', exampleIncumbent: 'Skyscanner / Kayak' },
  { id: 'hotels', name: 'Hotels', exampleIncumbent: 'Trivago / Booking' },
  { id: 'car-rentals', name: 'Car rentals', exampleIncumbent: 'rental aggregator' },
  { id: 'cruises', name: 'Cruises', exampleIncumbent: 'cruise comparison' },
  { id: 'vacation-rentals', name: 'Vacation rentals', exampleIncumbent: 'HomeToGo' },
  { id: 'parking', name: 'Parking', exampleIncumbent: 'SpotHero' },
  { id: 'tours', name: 'Tours & activities', exampleIncumbent: 'Viator' },
  { id: 'travel-insurance', name: 'Travel insurance', exampleIncumbent: 'travel-insurance compare' },
];

export function doorways() {
  try {
    const items = listByGroup('travel');
    if (Array.isArray(items) && items.length) {
      return items.map((v) => ({ id: v.id, name: v.name, exampleIncumbent: v.exampleIncumbent || '' }));
    }
  } catch { /* fall through */ }
  return FALLBACK_DOORWAYS;
}

const DOORWAY_DESC = {
  flights: 'Compare fares across airlines and metasearch — find the cheapest route and date.',
  hotels: 'Compare room rates across booking sites for the same property.',
  'car-rentals': 'Compare rental cars by class, pickup, and total price.',
  cruises: 'Compare cruise lines, cabins, and sail dates.',
  'vacation-rentals': 'Compare whole-home rentals across listing sites.',
  parking: 'Reserve airport and city parking ahead of time.',
  tours: 'Book tours, attractions, and activities at your destination.',
  'travel-insurance': 'Compare trip-protection plans before you go.',
};

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'SoapBox Travel — plan a trip from any city to any city across flights, trains, buses, ferries and rideshare, plus an honest comparison directory. Listed in a fixed order, never reordered by commission; affiliate links disclosed; we never sell your data.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const head = headTags({ title, description: desc, canonical, siteName: SITE_NAME, robots: opts.robots || 'index,follow,max-image-preview:large', jsonld: opts.jsonld || null });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">✈️ SoapBox <span>travel</span></a>
  <div class=topbar-r><a href="/guides">Guides</a><a href="${esc(SHOPPING)}">Shopping</a><a href="${esc(DATA)}">Data</a><a href="${esc(SEARCH)}">Search</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// The Start→Destination trip planner box → /plan (multimodal routing across bus/plane/train/ferry/car).
function searchForm({ from = '', to = '' } = {}) {
  return `<form class=hsearch method=get action="/plan"><div class=row>
    <input class=q name="from" value="${esc(from)}" placeholder="Starting city — e.g. Austin" autocomplete=off aria-label="Starting city">
    <span class=muted aria-hidden=true>→</span>
    <input class=q name="to" value="${esc(to)}" placeholder="Destination — e.g. Lisbon" autocomplete=off aria-label="Destination city">
    <button type=submit>Plan trip</button>
  </div></form>`;
}

// mode → human label + which affiliate network its booking link routes through (id by env NAME).
const MODE_LABEL = { fly: 'Flight', train: 'Train', bus: 'Bus', car: 'Car / rideshare', ferry: 'Ferry', walk: 'Walk', bike: 'Bike', other: 'Transfer' };
const MODE_NET = { fly: 'travelpayouts', train: 'impact', bus: 'impact', car: 'impact', ferry: 'cj', walk: null, bike: null, other: 'travelpayouts' };

// Build an affiliate-wrapped "Book" outbound for a leg. Keyless + honest: routes a provider search for
// the from→to pair through the shared affiliate engine (plain url + "(unmonetized)" when the id is unset).
function bookLink(mode, from, to) {
  const net = MODE_NET[mode] || 'travelpayouts';
  const label = MODE_LABEL[mode] || 'Book';
  if (!net) return null; // walk/bike — nothing to book
  const url = `https://www.google.com/search?q=${encodeURIComponent(`book ${mode} from ${from} to ${to}`)}`;
  const out = affiliate.trackedLink(net, url, { subId: slugify(`${mode}-${from}-${to}`) });
  return { url: out.url, tracked: out.tracked, label };
}

// The curated doorway cards (shared by the home page and the /plan fallback).
function doorwayCards() {
  return doorways().map((d) => {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(`compare ${d.name.toLowerCase()} deals`)}`;
    const out = affiliate.trackedLink('travelpayouts', searchUrl, { subId: slugify(d.id) });
    const desc = DOORWAY_DESC[d.id] || (d.exampleIncumbent ? `Honest comparison — like ${d.exampleIncumbent}, done with disclosure.` : '');
    return `<a class=sec href="${esc(out.url)}" rel="sponsored nofollow noopener" target="_blank">
      <div class=t>${esc(d.name)}</div>
      <div class=d>${esc(desc)}</div>
      <span class=x>Compare ${esc(d.name.toLowerCase())} →${out.tracked ? '' : ' (unmonetized)'}</span>
    </a>`;
  }).join('');
}

// ── /plan — the real Start→Destination multimodal planner ─────────────────────────────────────────
// Calls routing.planTrip (Rome2Rio → OpenTripPlanner/Navitia/Transitland; soft-fails to null with no
// provider key). On a hit, renders the legs (bus/plane/train/ferry/rideshare) each with an affiliate
// "Book" link + a "hotels in <dest>" affiliate link. On a miss, falls back to the curated directory —
// never an error page. Returns the inner HTML, or null when from/to are missing.
export async function planView(from, to, { plan } = {}) {
  const f = String(from == null ? '' : from).trim();
  const t = String(to == null ? '' : to).trim();
  if (!f || !t) return null;
  const trip = plan !== undefined ? plan : await routing.planTrip({ from: f, to: t }).catch(() => null);

  const hotelsUrl = `https://www.google.com/search?q=${encodeURIComponent(`hotels in ${t}`)}`;
  const hotels = affiliate.trackedLink('booking', hotelsUrl, { subId: slugify(`hotels-${t}`) });
  const hotelsCard = `<div class=card><h2>Where to stay</h2>
    <p><a href="${esc(hotels.url)}" rel="sponsored nofollow noopener" target="_blank">Compare hotels in ${esc(t)} →${hotels.tracked ? '' : ' (unmonetized)'}</a></p></div>`;

  let optionsHtml;
  if (trip && Array.isArray(trip.legs) && trip.legs.length) {
    const legs = trip.legs.map((l) => {
      const b = bookLink(l.mode, f, t);
      const dur = l.duration != null ? `${esc(l.duration)} min` : '';
      const price = l.price && l.price.amount != null ? `${esc(l.price.amount)} ${esc(l.price.currency || '')}` : '';
      const book = b ? `<a href="${esc(b.url)}" rel="sponsored nofollow noopener" target="_blank">Book ${esc(b.label)} →${b.tracked ? '' : ' (unmonetized)'}</a>` : '';
      return `<li class=leg><span class=mode>${esc(MODE_LABEL[l.mode] || l.mode)}</span> ${esc(l.operator || '')}
        <span class=meta>${dur} ${price}</span> ${book}</li>`;
    }).join('');
    optionsHtml = `<div class=card><h2>${esc(f)} → ${esc(t)} <span class=muted style="font-size:13px">· ${esc(trip.source || 'route')} · ${esc(trip.provenance || '')}</span></h2>
      <p class=muted>Total ~${esc(trip.totalDuration == null ? '?' : trip.totalDuration)} min across ${trip.legs.length} leg(s).</p>
      <ul class=legs>${legs}</ul></div>`;
  } else {
    optionsHtml = `<div class=card><p class=muted>No live multimodal route is available right now (a routing-provider key
      isn't configured). Search the comparison doorways directly:</p>
      <div class=grid style="margin-top:6px">${doorwayCards()}</div></div>`;
  }

  return `<h1>${esc(f)} → ${esc(t)}</h1>
    ${searchForm({ from: f, to: t })}
    ${VERIFY_NOTE}
    ${optionsHtml}
    ${hotelsCard}
    <p class=ftc-disclosure>${esc(affiliate.ftcDisclosure())}</p>`;
}

// ── home — the curated directory ────────────────────────────────────────────────────────────────────
export function homePage() {
  const cards = doorwayCards();
  const body = `<h1>SoapBox Travel <span class=muted style="font-size:14px">· plan a trip, any city to any city</span></h1>
    <p class=muted>Tell us where you're starting and where you're going — we'll plan it across flights, trains, buses,
      ferries and rideshare. Or browse the honest comparison doorways below.</p>
    ${searchForm()}
    <p style="margin:10px 0"><a class=card style="display:block;padding:12px 14px;text-decoration:none" href="/overland"><b>🌍 Overland routes &amp; entry rules →</b><br><span class=muted style="font-size:13px">Continent-to-continent by road (and the Darién Gap), passport-stamp conflicts where visit order matters, and an entry-requirements checklist — verify-before-travel reference.</span></a></p>
    ${VERIFY_NOTE}
    <div class=card><h2>Comparison doorways</h2>
      <p class=muted style="font-size:13px;margin:0 0 8px">${esc(BRAND_GUARDRAIL)}</p>
      <div class=grid style="margin-top:4px">${cards || '<p class=empty>Doorways are temporarily unavailable — please try again shortly.</p>'}</div></div>
    <p class=ftc-disclosure>${esc(affiliate.ftcDisclosure())}</p>`;
  return page(`${SITE_NAME} — plan a trip: flights, trains, buses, ferries & hotels`, body, { canonical: `${BASE_URL}/` });
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
// ── /overland — overland routes + passport-stamp conflicts + entry rules (State-Dept-style reference) ─
// Original reference content (facts, no copied text). Entry rules change constantly and are safety-
// critical, so every section says VERIFY with official sources and links travel.state.gov + IATA.
export function overlandPage() {
  const STATE = 'https://travel.state.gov/content/travel/en/international-travel.html';
  const IATA = 'https://www.iatatravelcentre.com/';
  const corridors = [
    ['Afro-Eurasia — one connected landmass', 'Africa, Europe and Asia are joined by land. You can, in principle, drive between them: Europe↔Asia across the Bosphorus (Istanbul) or the Caucasus; Asia↔Africa across the Sinai (Egypt). The classic long hauls: the <b>Trans-Eurasian</b> run (Western Europe → the Balkans/Turkey → the Caucasus or Central Asia → South/Southeast Asia), the <b>Silk Road</b> corridors, and <b>Cairo → Cape Town</b> down the eastern spine of Africa. Choke points are political (closed borders, conflict zones, visa walls), not physical.'],
    ['The Americas — the Pan-American Highway', 'A near-continuous road runs from <b>Prudhoe Bay, Alaska</b> to <b>Ushuaia, Argentina</b> — except for one gap. The <b>Darién Gap</b> (~100 km of roadless jungle and swamp between Panama and Colombia) has <b>no road</b>: overlanders ship the vehicle by sea or fly around it. Plan this break in advance; it is the single unavoidable non-road segment of the Americas.'],
    ['What is NOT road-connected', 'Islands and isolated landmasses need sea or air: Great Britain, Ireland, Japan, the Philippines, Indonesia (partly), Madagascar, <b>Australia</b>, New Zealand, and <b>Antarctica</b>. Ferries bridge many short gaps (Gibraltar↔Morocco, the Baltic, SE-Asian islands) and count as "roads-plus-ferry" overland travel.'],
  ];
  const stamps = [
    ['Israel and some of its neighbours', 'A number of countries have historically <b>refused entry</b> to travelers showing evidence of a visit to Israel (at various times: Iran, Lebanon, Syria, Libya, Yemen, and others — the list shifts). <b>Mitigation:</b> Israel generally issues a <b>separate entry/exit card</b> rather than stamping the passport at its main crossings, so a paper trail can be avoided — but land borders with Egypt and Jordan may still stamp, and those stamps reveal an Israel crossing. <b>Order:</b> if you plan to visit a country that bars Israel-linked travelers, visit it <b>before</b> Israel, or rely on the separate-card system and keep no Israeli stamps.'],
    ['Azerbaijan ↔ Armenia / Nagorno-Karabakh', 'Azerbaijan <b>bars entry</b> to travelers with evidence of having visited <b>Nagorno-Karabakh</b> without its permission, and relations with Armenia are tense. <b>Order:</b> visit Azerbaijan before any independent travel into the Karabakh region; keep the two itineraries separate.'],
    ['Serbia ↔ Kosovo', 'Serbia does not recognize Kosovo as a separate state and may treat entry to Serbia <b>after</b> a Kosovo-only entry as <b>illegal entry</b> (you "never legally left" Serbia in its view). <b>Order:</b> enter Kosovo <b>from</b> Serbia and exit back through Serbia, or arrange your Serbia entry/exit so it is not preceded by a Kosovo-only stamp.'],
    ['Divided-territory cases', 'Similar sequencing care applies to <b>Northern Cyprus ↔ Republic of Cyprus</b>, and <b>Abkhazia / South Ossetia ↔ Georgia</b> (Georgia treats entry via those regions from Russia as illegal). Research each divided territory\'s rules before you cross.'],
  ];
  const body = `<h1>Overland routes &amp; entry rules</h1>
    <div class=card style="border-color:#a8730c;background:#2a2417">
      <p style="margin:0"><b>⚠ Verify before you travel.</b> Entry requirements, border openings, and stamp policies
      change without notice and can be safety-critical. This page is <b>reference, not advice</b>. Confirm every
      route and rule against official sources: the U.S. State Department's
      <a href="${esc(STATE)}" rel="nofollow">country information</a>, the
      <a href="${esc(IATA)}" rel="nofollow">IATA Travel Centre</a>, and each country's own immigration authority.</p>
    </div>

    <h2>Continent-to-continent by road</h2>
    <p class=muted>Where the roads actually connect — and where they don't.</p>
    ${corridors.map(([h, d]) => `<div class=card><h3 style="margin-top:0">${esc(h)}</h3><p>${d}</p></div>`).join('')}

    <h2>Passport-stamp conflicts — why order matters</h2>
    <p class=muted>Some countries deny entry based on where you have already been. When that is a risk, the
      <b>sequence</b> of your trip — which country you visit first — is what keeps the door open.</p>
    ${stamps.map(([h, d]) => `<div class=card><h3 style="margin-top:0">${esc(h)}</h3><p>${d}</p></div>`).join('')}

    <h2>Entry-requirements checklist</h2>
    <div class=card><ul>
      <li><b>Passport validity.</b> Many countries require <b>6 months' validity beyond your arrival</b> and one or more blank pages.</li>
      <li><b>Visa vs. visa-free vs. e-visa vs. visa-on-arrival.</b> Confirm which applies to <i>your</i> nationality — it varies by passport.</li>
      <li><b>Onward/return ticket and funds.</b> Some borders ask for proof of onward travel and sufficient funds.</li>
      <li><b>Vaccination / health entry rules.</b> Yellow-fever certificates and other requirements apply to certain routes.</li>
      <li><b>Overland border hours &amp; closures.</b> Land crossings keep limited hours and close for holidays, weather, or unrest.</li>
    </ul>
    <p class=muted style="font-size:13px">Authoritative sources: <a href="${esc(STATE)}" rel="nofollow">travel.state.gov</a> ·
      <a href="${esc(IATA)}" rel="nofollow">IATA Travel Centre</a> · each country's immigration ministry.</p></div>

    <div class=card><p>Planning a specific city-to-city trip across modes? Use the
      <a href="/plan">Start → Destination planner</a>. And before any international trip, travel insurance is worth
      pricing in the <a href="/">travel directory</a>.</p>
      <p class=ftc-disclosure>${esc(affiliate.ftcDisclosure())}</p></div>`;
  return page('Overland routes & entry rules — SoapBox Travel', body, {
    canonical: `${BASE_URL}/overland`,
    description: 'Overland (roads-only) continent-to-continent routes — the Trans-Eurasian and Cairo-to-Cape-Town corridors, the Pan-American Highway and the Darién Gap — plus passport-stamp conflicts where visit order matters (Israel and its neighbours, Azerbaijan/Nagorno-Karabakh, Serbia/Kosovo, divided territories) and an entry-requirements checklist. Reference, not advice; verify with travel.state.gov and IATA.',
  });
}

function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', '/overland', ...guides.guideSitemapPaths('travel')];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: 'weekly', priority: '1.0' }));
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
        summary: 'Honest travel-comparison directory — flights, hotels, car rentals, cruises, vacation rentals, parking, tours, travel insurance. Fixed order, never reordered by commission; affiliate links disclosed; no data-selling.',
        links: doorways().map((d) => ({ label: d.name, path: '/' })),
      }));
    }

    if (path === '/') return sendHtml(res, homePage());
    if (path === '/plan') {
      const from = url.searchParams.get('from') || '';
      const to = url.searchParams.get('to') || '';
      const view = await planView(from, to);
      if (!view) { res.writeHead(302, { location: '/' }); return res.end(); }
      return sendHtml(res, page(`${from} → ${to} — ${SITE_NAME}`, view,
        { canonical: `${BASE_URL}/`, robots: 'noindex,follow',
          description: `Plan a trip from ${from} to ${to} across flights, trains, buses, ferries and rideshare — with hotels.` }));
    }
    if (path === '/overland') return sendHtml(res, overlandPage());
    if (path === '/guides') {
      return sendHtml(res, page(`Travel guides — ${SITE_NAME}`,
        guides.GUIDE_STYLE + guides.renderGuideIndexBody('travel'),
        { canonical: `${BASE_URL}/guides`, description: 'Honest travel guides — best carry-on luggage, how to find cheap flights and more, compared by value, never by commission.' }));
    }
    if (path.startsWith('/g/')) {
      const g = guides.guideBySlug('travel', path.slice(3));
      if (!g) { res.writeHead(302, { location: '/guides' }); return res.end(); }
      const { html, jsonld } = guides.renderGuideBody(g, { baseUrl: BASE_URL, affiliate, seo });
      return sendHtml(res, page(`${g.title} — ${SITE_NAME}`, guides.GUIDE_STYLE + html,
        { canonical: `${BASE_URL}/g/${g.slug}`, description: g.description, jsonld }));
    }

    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/travel\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Travel on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
