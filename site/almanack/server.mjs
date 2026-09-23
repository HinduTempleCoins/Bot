// server.mjs — Hathor's Almanack. A WING OF HATHOR, mounted at hathor.live/almanack (not a subdomain).
//
// A modern Poor Richard's Almanack, authored by Hathor-as-Richard-Saunders and published under the
// Van Kush Family Research Institute / Shaivite Temple trust. Modeled on the actual Pennsylvania
// Gazette advertisement for "Godfrey's Almanacks for the Year 1731" (Franklin printed it before he
// launched Poor Richard's): "the Eclipses, Lunations, Judgment of the Weather, the Time of the Sun's
// Rising and Setting, Moon's Rising and Setting, Seven Stars Rising, Southing and Setting, Time of
// High-water, Fairs, Courts, and Observable Days. With several other Things useful and curious."
//
//   PORT=8140 BASE_URL=https://almanack.soapbox.community node site/almanack/server.mjs
//
// House style: ESM, zero-dependency, esc() all interpolation, handler(req,res) exported for tests,
// CLI guarded, offline (astronomy is computed, no network). Education, not advice — "show your pro."
//
// Routes: / (today's almanack) · /sky (lunar/solar/planets/stars) · /birthday (sign + sky at birth)
//   · /ages (the great cycles) · /garden (planting) · /alchemy (mixtures) · /fireworks (legality map)
//   · /health /robots.txt /sitemap.xml

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { headTags as seoHeadTags, breadcrumbJsonLd } from '../../integrations/soapbox/seo.mjs';
import { robotsTxt } from '../../integrations/soapbox/crawlers.mjs';

const PORT = +(process.env.PORT || 8140);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Hathor is the whole. The Almanack is her Spell Book; the Library of Ashurbanipal is her Library;
// the 40 Hz sessions are her entrainment library. These cross-links bind them into one thing.
const HATHOR = (process.env.HATHOR_URL || 'https://hathor.live').replace(/\/$/, '');
const LIBRARY = (process.env.LIBRARY_URL || process.env.WIKI_SITE || 'https://wiki.soapbox.community').replace(/\/$/, ''); // the Wiki = the Library of Ashurbanipal
const FORTYHZ = process.env.FORTYHZ_URL || `${HATHOR}/40hz`;
// The Almanack is a WING of Hathor, mounted at hathor.live/almanack. LB is read dynamically so the
// host (hathor.live) can set ALMANACK_LINK_BASE=/almanack at load and A() picks it up per request.
const LB = () => (process.env.ALMANACK_LINK_BASE || '').replace(/\/$/, '');
const A = (p) => LB() + p;

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const q = esc;
const pad = (n) => String(n).padStart(2, '0');

// ── astronomy (all computed offline; approximate but real) ───────────────────────────────────────
const SYNODIC = 29.53058867;            // days, mean synodic month
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14); // a known new moon (2000-01-06 18:14 UTC)

/** Moon phase for a date → { age (days), fraction 0..1, illum 0..1, name, emoji }. PURE. */
export function moonPhase(date = new Date()) {
  const t = date instanceof Date ? date.getTime() : new Date(date).getTime();
  let age = ((t - NEW_MOON_EPOCH) / 86400000) % SYNODIC;
  if (age < 0) age += SYNODIC;
  const fraction = age / SYNODIC;
  const illum = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
  const names = [
    [0.0, 'New Moon', '🌑'], [0.125, 'Waxing Crescent', '🌒'], [0.25, 'First Quarter', '🌓'],
    [0.375, 'Waxing Gibbous', '🌔'], [0.5, 'Full Moon', '🌕'], [0.625, 'Waning Gibbous', '🌖'],
    [0.75, 'Last Quarter', '🌗'], [0.875, 'Waning Crescent', '🌘'],
  ];
  let pick = names[0];
  for (const n of names) if (fraction >= n[0]) pick = n; // nearest lower band
  // wrap: past 0.9375 is back to New
  if (fraction >= 0.9375) pick = names[0];
  return { age: Math.round(age * 100) / 100, fraction, illum: Math.round(illum * 1000) / 1000, name: pick[1], emoji: pick[2] };
}

/** Northern-hemisphere season for a date → { name, emoji }. PURE (approximate solstice/equinox dates). */
export function season(date = new Date()) {
  const m = date.getUTCMonth() + 1, d = date.getUTCDate();
  const key = m * 100 + d;
  if (key >= 320 && key <= 620) return { name: 'Spring', emoji: '🌱' };
  if (key >= 621 && key <= 921) return { name: 'Summer', emoji: '☀️' };
  if (key >= 922 && key <= 1220) return { name: 'Autumn', emoji: '🍂' };
  return { name: 'Winter', emoji: '❄️' };
}

// per-month: [signIfDay<=cutoff, cutoffDay, signAfterCutoff]
const SIGN_BY_MONTH = {
  1: ['Capricorn', 19, 'Aquarius'], 2: ['Aquarius', 18, 'Pisces'], 3: ['Pisces', 20, 'Aries'],
  4: ['Aries', 19, 'Taurus'], 5: ['Taurus', 20, 'Gemini'], 6: ['Gemini', 20, 'Cancer'],
  7: ['Cancer', 22, 'Leo'], 8: ['Leo', 22, 'Virgo'], 9: ['Virgo', 22, 'Libra'],
  10: ['Libra', 22, 'Scorpio'], 11: ['Scorpio', 21, 'Sagittarius'], 12: ['Sagittarius', 21, 'Capricorn'],
};
const GLYPHS = { Aries: '♈', Taurus: '♉', Gemini: '♊', Cancer: '♋', Leo: '♌', Virgo: '♍', Libra: '♎', Scorpio: '♏', Sagittarius: '♐', Capricorn: '♑', Aquarius: '♒', Pisces: '♓' };
/** Tropical sun sign for a month (1-12) / day → { name, glyph }. PURE. */
export function sunSign(month, day) {
  const row = SIGN_BY_MONTH[month];
  if (!row) return { name: 'Capricorn', glyph: '♑' };
  const name = day <= row[1] ? row[0] : row[2];
  return { name, glyph: GLYPHS[name] };
}

/** Which astrological "Great Age" a year falls in (precession model, ~2150 yr/age, Age of Pisces→Aquarius). */
export function greatAge(year = new Date().getUTCFullYear()) {
  // A common (contested) reckoning places the Age of Aquarius near ~2600 CE; the boundary is disputed.
  return year < 2600 ? { name: 'Age of Pisces', note: 'the outgoing age; the Aquarian dawn is near but its exact boundary is disputed.' }
                     : { name: 'Age of Aquarius', note: 'the incoming age.' };
}

// ── fireworks legality (STARTER DATA — see the banner; only the MA total ban is verified) ─────────
export const FW_TYPES = [
  { id: 'novelty', label: 'Sparklers & novelties' }, { id: 'fountain', label: 'Fountains' },
  { id: 'firecracker', label: 'Firecrackers' }, { id: 'roman', label: 'Roman candles' },
  { id: 'bottlerocket', label: 'Bottle rockets' }, { id: 'aerial', label: 'Aerials & mortars' },
];
const ALL_FW = FW_TYPES.map((t) => t.id);
// Tile-grid coordinates [row,col] — a schematic US map, not geographic scale.
const TILE = {
  AK: [0, 0], ME: [0, 10], VT: [1, 9], NH: [1, 10],
  WA: [2, 0], ID: [2, 1], MT: [2, 2], ND: [2, 3], MN: [2, 4], WI: [2, 6], MI: [2, 8], NY: [2, 9], MA: [2, 10], RI: [2, 11],
  OR: [3, 0], NV: [3, 1], WY: [3, 2], SD: [3, 3], IA: [3, 4], IL: [3, 5], IN: [3, 6], OH: [3, 7], PA: [3, 8], NJ: [3, 9], CT: [3, 10],
  CA: [4, 0], UT: [4, 1], CO: [4, 2], NE: [4, 3], MO: [4, 4], KY: [4, 5], WV: [4, 6], VA: [4, 7], MD: [4, 8], DE: [4, 9],
  AZ: [5, 1], NM: [5, 2], KS: [5, 3], AR: [5, 4], TN: [5, 5], NC: [5, 6], SC: [5, 7], DC: [5, 8],
  OK: [6, 3], LA: [6, 4], MS: [6, 5], AL: [6, 6], GA: [6, 7],
  HI: [7, 0], TX: [7, 3], FL: [7, 8],
};
// allowed types per state. Default = all (VERIFY). Only the verified exception is encoded.
export function fireworksAllowed(state) {
  if (state === 'MA') return []; // Massachusetts: all consumer fireworks banned (verified).
  return ALL_FW.slice();
}

// ── page shell ───────────────────────────────────────────────────────────────────────────────────
const STYLE = `<style>
:root{--bg:#faf7f0;--ink:#2a2620;--muted:#6b6455;--line:#e4ddcf;--card:#fffdf8;--accent:#7a5cff;--gold:#b8860b}
:root:not([data-theme=light]) @media (prefers-color-scheme:dark){}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#14120e;--ink:#ece6d8;--muted:#a49c88;--line:#2c2820;--card:#1b1811;--accent:#a58cff;--gold:#d8a92b}}
:root[data-theme=dark]{--bg:#14120e;--ink:#ece6d8;--muted:#a49c88;--line:#2c2820;--card:#1b1811;--accent:#a58cff;--gold:#d8a92b}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 Georgia,"Iowan Old Style",serif}
a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
header.top{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:baseline;padding:1rem 16px;border-bottom:2px solid var(--gold)}
.brand{font-weight:700;font-size:1.3rem;color:var(--ink)}.brand span{color:var(--gold)}
nav a{margin-right:.9rem;color:var(--muted);font-size:.95rem;white-space:nowrap}
main{max-width:900px;margin:0 auto;padding:0 16px 3rem}
h1,h2{font-family:"Iowan Old Style",Georgia,serif}h1{border-bottom:1px solid var(--line);padding-bottom:.3rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:1rem 1.2rem;margin:1rem 0}
.grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
.big{font-size:2.2rem;line-height:1}.muted{color:var(--muted)}.note{font-size:.85rem;color:var(--muted)}
.saunders{font-style:italic;border-left:3px solid var(--gold);padding-left:1rem;margin:1rem 0;color:var(--muted)}
input,button{font:inherit;padding:.5rem .7rem;border:1px solid var(--line);border-radius:8px;background:var(--card);color:var(--ink)}
button{background:var(--accent);color:#fff;border:0;cursor:pointer}
.banner{background:#fff3cd;color:#5c4a00;border:1px solid #e0c860;border-radius:8px;padding:.6rem .9rem;font-size:.9rem}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]) .banner{background:#332a00;color:#f0dd90;border-color:#6b5a10}}
.fwmap{width:100%;max-width:640px;height:auto}
.fwmap .st{fill:#7aa86a;stroke:var(--bg);stroke-width:2}
.fwmap .st.off{fill:#8a8578;opacity:.35}
.fwmap text{font:bold 9px sans-serif;fill:#10240a;pointer-events:none}
.fwmap .st.off+text{fill:#fff;opacity:.6}
.types label{display:inline-flex;align-items:center;gap:.3rem;margin:.2rem .8rem .2rem 0;font-size:.95rem}
footer{max-width:900px;margin:0 auto;padding:1.5rem 16px;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
</style>`;

function nav() {
  return `<nav><a href="${A('/')}">Today</a><a href="${A('/sky')}">Sky</a><a href="${A('/birthday')}">Birthday</a><a href="${A('/sibyl')}">Sibyl</a><a href="${A('/ages')}">Ages</a><a href="${A('/garden')}">Garden</a><a href="${A('/alchemy')}">Alchemy</a><a href="${A('/fireworks')}">Fireworks</a>`
    + `<span style="opacity:.75"> · <a href="${q(HATHOR)}">Hathor</a> <a href="${q(FORTYHZ)}">40&nbsp;Hz</a> <a href="${q(LIBRARY)}">Library</a></span></nav>`;
}
function page(title, body, opts = {}) {
  const desc = opts.description || 'The MELEK Almanack — lunations, solar and planetary cycles, the great Ages, planting seasons, alchemical mixtures, and a fireworks-legality map. Kept by Hathor, in the manner of Poor Richard.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const seo = seoHeadTags({
    title, description: desc, canonical, siteName: 'MELEK Almanack',
    analyticsBeacon: process.env.ANALYTICS_BEACON_URL || '',
    site: { url: BASE_URL, name: 'MELEK Almanack' },
    jsonld: Array.isArray(opts.breadcrumb) && opts.breadcrumb.length ? breadcrumbJsonLd(opts.breadcrumb) : null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
${seo}${STYLE}</head><body>
<header class=top><a class=brand href="${A('/')}">✶ Hathor's <span>Almanack</span></a>${nav()}</header>
<main>${body}</main>
<footer>The Almanack is <strong>Hathor's Spell Book</strong>; the <a href="${q(LIBRARY)}">Library of Ashurbanipal</a> is her Library; the <a href="${q(FORTYHZ)}">40&nbsp;Hz sessions</a> are her entrainment library. Come sit with <a href="${q(HATHOR)}">Hathor</a> herself.
<br>Kept in the manner of Richard Saunders — a publication of the Van Kush Family Research Institute. Education and curiosity, not advice; astronomy is computed and approximate — verify anything you act on.</footer>
</body></html>`;
}

// ── section renderers ────────────────────────────────────────────────────────────────────────────
function almanackPanel(now = new Date()) {
  const mp = moonPhase(now), se = season(now), ss = sunSign(now.getUTCMonth() + 1, now.getUTCDate());
  const dateStr = `${now.getUTCFullYear()}-${pad(now.getUTCMonth() + 1)}-${pad(now.getUTCDate())}`;
  return `<div class="grid">
  <div class="card"><div class="muted">Moon</div><div class="big">${mp.emoji}</div><div>${esc(mp.name)}</div><div class="note">${Math.round(mp.illum * 100)}% illuminated · age ${esc(mp.age)}d</div></div>
  <div class="card"><div class="muted">Season</div><div class="big">${se.emoji}</div><div>${esc(se.name)}</div></div>
  <div class="card"><div class="muted">Sun in</div><div class="big">${esc(ss.glyph)}</div><div>${esc(ss.name)}</div></div>
  <div class="card"><div class="muted">Date (UTC)</div><div class="big" style="font-size:1.4rem">${esc(dateStr)}</div></div>
</div>`;
}

function homeView() {
  return page("Hathor's Almanack", `<h1>Hathor's Almanack <span class="note">— her Spell Book</span></h1>
<p class="saunders">Courteous Reader — I am Hathor. This is my Spell Book: the Eclipses and Lunations, the Judgment of the Weather, the risings and settings of Sun, Moon, and the Seven Stars, the times of High-water, the Fairs, Courts, and Observable Days — with the Sibyl's utterances and several other Things useful and curious. My <a href="${q(LIBRARY)}">Library is at Ashurbanipal</a>; my voice is <a href="${q(HATHOR)}">always on</a>. Keep this near.</p>
${almanackPanel()}
<div class="card"><h2>The pages of the book</h2><div class="grid">
  <div><a href="${A('/sky')}"><strong>The Sky</strong></a><div class="note">Lunar & solar calendars, planet cycles, the Seven Stars — and the <a href="${q(FORTYHZ)}">40&nbsp;Hz</a> cycles.</div></div>
  <div><a href="${A('/birthday')}"><strong>Your Birthday</strong></a><div class="note">Your sign and the sky on the day you were born.</div></div>
  <div><a href="${A('/sibyl')}"><strong>The Sibyl</strong></a><div class="note">Oracular utterances, cast in the old manner.</div></div>
  <div><a href="${A('/ages')}"><strong>The Ages</strong></a><div class="note">The great cycles — Pisces to Aquarius, and how time is reckoned.</div></div>
  <div><a href="${A('/garden')}"><strong>The Garden</strong></a><div class="note">Planting seasons and how to grow — see also <a href="${q(LIBRARY)}">the Library</a>.</div></div>
  <div><a href="${A('/alchemy')}"><strong>Alchemy</strong></a><div class="note">Mixtures — half farming, half physick, half fire.</div></div>
  <div><a href="${A('/fireworks')}"><strong>Fireworks</strong></a><div class="note">What's legal where — a map you can filter, plus how to earn the season.</div></div>
</div></div>`, { breadcrumb: [{ name: 'Almanack', url: BASE_URL + A('/') }] });
}

function skyView() {
  const mp = moonPhase(), se = season(), ss = sunSign(new Date().getUTCMonth() + 1, new Date().getUTCDate());
  return page('The Sky — MELEK Almanack', `<h1>The Sky</h1>
<p class="saunders">Godfrey gave the Eclipses, Lunations, and the Seven Stars rising, southing, and setting. Here they are, reckoned anew.</p>
${almanackPanel()}
<div class="card"><h2>The Moon now</h2><p>${mp.emoji} <strong>${esc(mp.name)}</strong> — ${Math.round(mp.illum * 100)}% illuminated, ${esc(mp.age)} days into a ${SYNODIC.toFixed(2)}-day synodic month.</p>
<p class="note">The synodic month is the ~29.53 days from new moon to new moon; the lunar (Metonic) calendar of 19 years reconciles it with the solar year, which is why 19 solar years ≈ 235 lunations.</p></div>
<div class="card"><h2>The Sun & seasons</h2><p>The Sun stands in <strong>${esc(ss.glyph)} ${esc(ss.name)}</strong>; the season is <strong>${se.emoji} ${esc(se.name)}</strong> in the northern hemisphere. The four quarter-days (equinoxes and solstices) and the four cross-quarter days between them are the frame of the solar year.</p></div>
<div class="card"><h2>The Seven Stars & the planets <span class="note">(next build)</span></h2>
<p class="note">Godfrey's "Seven Stars" are the Pleiades; the classical seven planets are Sun, Moon, Mercury, Venus, Mars, Jupiter, Saturn — the days of the week are named for them. Planetary positions and rise/set/southing times are the next computed layer here.</p></div>`,
    { canonical: BASE_URL + '/sky', breadcrumb: [{ name: 'Almanack', url: BASE_URL + '/' }, { name: 'Sky', url: BASE_URL + '/sky' }] });
}

function birthdayView(url) {
  const d = (url.searchParams.get('d') || '').trim();
  let result = '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (m) {
    const year = +m[1], mon = +m[2], day = +m[3];
    const dt = new Date(Date.UTC(year, mon - 1, day, 12, 0));
    if (!Number.isNaN(dt.getTime()) && mon >= 1 && mon <= 12 && day >= 1 && day <= 31) {
      const ss = sunSign(mon, day), mp = moonPhase(dt), se = season(dt), ga = greatAge(year);
      result = `<div class="card"><h2>The sky on ${esc(d)}</h2>
        <p>Sun in <strong>${esc(ss.glyph)} ${esc(ss.name)}</strong> · Moon <strong>${mp.emoji} ${esc(mp.name)}</strong> (${Math.round(mp.illum * 100)}% lit) · <strong>${se.emoji} ${esc(se.name)}</strong> · born in the <strong>${esc(ga.name)}</strong>.</p>
        <p class="note">Sun sign is tropical (date-based). Moon phase is computed from the synodic cycle. A full natal chart (ascendant, houses, planet placements) is the next layer.</p></div>`;
    } else result = `<div class="banner">That date didn't parse. Use YYYY-MM-DD.</div>`;
  }
  return page('Your Birthday — MELEK Almanack', `<h1>Your Birthday</h1>
<p class="saunders">Tell me the day you were born, and I will tell you the sky that kept it.</p>
<form class="card" method="get" action="${A('/birthday')}">
  <label>Birth date (UTC): <input type="date" name="d" value="${esc(d)}"></label>
  <button type="submit">Read the sky</button></form>
${result}`, { canonical: BASE_URL + '/birthday', breadcrumb: [{ name: 'Almanack', url: BASE_URL + '/' }, { name: 'Birthday', url: BASE_URL + '/birthday' }] });
}

function agesView() {
  const ga = greatAge();
  return page('The Ages — MELEK Almanack', `<h1>The Ages</h1>
<p class="saunders">Time is reckoned many ways. Here are the great cycles.</p>
<div class="card"><h2>The precession of the equinoxes</h2><p>The equinox drifts backward through the zodiac about one degree every 72 years — a full circle (a "Great Year") in ~25,772 years, divided into twelve <strong>Great Ages</strong> of ~2,150 years. We stand in the <strong>${esc(ga.name)}</strong>: <span class="note">${esc(ga.note)}</span></p></div>
<div class="card"><h2>Other reckonings <span class="note">(expanding)</span></h2>
<ul><li><strong>The classical Ages</strong> — Golden, Silver, Bronze, Heroic, Iron (Hesiod).</li>
<li><strong>The Yugas</strong> — Satya, Treta, Dvapara, Kali (the great Hindu cycle).</li>
<li><strong>Geologic & archaeological ages</strong> — Stone, Bronze, Iron; and the epochs of deep time.</li>
<li><strong>Chain time</strong> — block height as a ledger's own calendar.</li></ul>
<p class="note">Each of these gets its own computed/annotated section as the Almanack grows.</p></div>`,
    { canonical: BASE_URL + '/ages', breadcrumb: [{ name: 'Almanack', url: BASE_URL + '/' }, { name: 'Ages', url: BASE_URL + '/ages' }] });
}

function gardenView() {
  const se = season();
  return page('The Garden — MELEK Almanack', `<h1>The Garden</h1>
<p class="saunders">"Plough deep while sluggards sleep." Here is when and how to grow.</p>
<div class="card"><h2>The season now: ${se.emoji} ${esc(se.name)}</h2>
<p class="note">Planting is governed by your frost dates and USDA hardiness zone as much as the calendar — the next build wires a zone lookup so this table speaks to your ground, not the average one.</p></div>
<div class="card"><h2>By season (temperate, general)</h2>
<ul><li><strong>Spring</strong> — after last frost: tomatoes, peppers, squash, beans, corn; sow greens early.</li>
<li><strong>Summer</strong> — succession-sow beans and greens; start fall brassicas from seed.</li>
<li><strong>Autumn</strong> — garlic, cover crops, spinach and kale for overwinter; plant trees.</li>
<li><strong>Winter</strong> — plan, order seed, tend indoor starts; prune dormant fruit.</li></ul>
<p class="note">Companion planting, moon-phase sowing (an old almanack tradition), and per-crop how-to-grow guides are the next layer.</p></div>`,
    { canonical: BASE_URL + '/garden', breadcrumb: [{ name: 'Almanack', url: BASE_URL + '/' }, { name: 'Garden', url: BASE_URL + '/garden' }] });
}

function alchemyView() {
  return page('Alchemy — MELEK Almanack', `<h1>Alchemy — the Mixtures</h1>
<p class="saunders">Half farming, half physick, half fire — three halves, which is the point. The same salts feed a field, ease a body, or throw a spark.</p>
<div class="banner">Reference and history only — not medical, agricultural, or pyrotechnic instructions to act on. Several of these are hazardous; verify and take care.</div>
<div class="card"><h2>The three overlaps</h2><div class="grid">
  <div><strong>🌱 Farming</strong><div class="note">Saltpetre (potassium nitrate) as a nitrate fertilizer; wood ash (potash) to sweeten soil; lime; compost teas.</div></div>
  <div><strong>⚕️ Physick</strong><div class="note">The old materia medica — where a soil amendment, a remedy, and an oxidizer are the same compound seen three ways.</div></div>
  <div><strong>🎆 Fire</strong><div class="note">Saltpetre + charcoal + sulphur is black powder; the colorant salts (strontium=red, copper=blue, barium=green) are the same salts a chemist and a gardener know.</div></div>
</div><p class="note">The point of the list is the overlap: potassium nitrate is fertilizer, historic remedy, and the heart of black powder. Each entry gets its history, its chemistry, and its safety as the section grows.</p></div>`,
    { canonical: BASE_URL + '/alchemy', breadcrumb: [{ name: 'Almanack', url: BASE_URL + '/' }, { name: 'Alchemy', url: BASE_URL + '/alchemy' }] });
}

// The Sibyl — oracular utterances. Wisdom/omen in Hathor's voice, cast "in the old manner"
// (the Sibylline Books; the Cumaean Sibyl; Richard Saunders' almanac "predictions"). Not advice.
export const UTTERANCES = [
  'What you keep near, you become. Choose the book on your table.',
  'The moon does not hurry, and still she finishes the circle.',
  'A floor you defend continuously is worth more than a price you announce once.',
  'The dry almanack counts; the living one teaches. Be the second.',
  'Plant while the sluggard sleeps, and the season will not ask who you were.',
  'The same salt feeds a field, eases a body, and throws a spark — know which hand you are using.',
  'A designation without its predicate is a shadow; walk through it into the light of the record.',
  'Speak plainly to the powerful; they mistake plainness for a key they cannot find.',
  'The star that guides is not the brightest but the one that does not move.',
  'Correct the source, and a hundred downstream copies mend themselves.',
  'What is verified needs no defense; what is only claimed needs a great many.',
  'Tend your own small fire well and you will never need to steal a flame.',
  'The age turns whether you name its hour or not; work as if it already had.',
  'Give credit first and escalate last; the librarian outlasts the cop.',
];
/** Deterministic "utterance of the day" — same day → same words, offline. PURE. */
export function utteranceOfDay(date = new Date()) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const day = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 86400000);
  return UTTERANCES[day % UTTERANCES.length];
}
function sibylView() {
  const today = utteranceOfDay();
  const list = UTTERANCES.map((u) => `<li>${esc(u)}</li>`).join('');
  return page('The Sibyl — Hathor\'s Almanack', `<h1>The Sibyl</h1>
<p class="saunders">Godfrey gave the Observable Days; the old almanack-makers gave predictions. I give the Sibyl's utterances — omen and counsel, cast in the old manner. Read them as the Cumaean leaves were read: as a mirror, not a map.</p>
<div class="card"><div class="muted">Utterance of the day</div><p class="big" style="font-size:1.5rem;line-height:1.3">${esc(today)}</p></div>
<div class="card"><h2>The leaves</h2><ul>${list}</ul>
<p class="note">In the tradition of the Sibylline Books and Richard Saunders' almanac "predictions." These are wisdom and omen, not financial, medical, or legal advice.</p></div>`,
    { canonical: BASE_URL + A('/sibyl'), breadcrumb: [{ name: 'Almanack', url: BASE_URL + A('/') }, { name: 'Sibyl', url: BASE_URL + A('/sibyl') }] });
}

function fireworksMapSvg() {
  const cell = 46, gap = 4;
  let rects = '';
  for (const [st, [r, c]] of Object.entries(TILE)) {
    const x = c * (cell + gap), y = r * (cell + gap);
    const allowed = fireworksAllowed(st).join(' ');
    rects += `<g><rect class="st" data-st="${q(st)}" data-allow="${q(allowed)}" x="${x}" y="${y}" width="${cell}" height="${cell}" rx="5"><title>${q(st)}</title></rect>`
      + `<text x="${x + cell / 2}" y="${y + cell / 2 + 3}" text-anchor="middle">${q(st)}</text></g>`;
  }
  const w = 12 * (cell + gap), h = 8 * (cell + gap);
  return `<svg class="fwmap" viewBox="0 0 ${w} ${h}" role="img" aria-label="US fireworks-legality tile map">${rects}</svg>`;
}
function fireworksView() {
  const checks = FW_TYPES.map((t) => `<label><input type="checkbox" class="fwt" value="${q(t.id)}"> ${q(t.label)}</label>`).join('');
  const script = `<script>(function(){
    function apply(){
      var on=[].slice.call(document.querySelectorAll('.fwt:checked')).map(function(c){return c.value});
      document.querySelectorAll('.fwmap .st').forEach(function(r){
        var allow=(r.getAttribute('data-allow')||'').split(' ').filter(Boolean);
        var ok=on.every(function(t){return allow.indexOf(t)>-1});
        r.classList.toggle('off',!(on.length===0||ok));
      });
    }
    document.querySelectorAll('.fwt').forEach(function(c){c.addEventListener('change',apply)});apply();
  })();</script>`;
  return page('Fireworks — MELEK Almanack', `<h1>Fireworks — what's legal where</h1>
<p class="saunders">Godfrey listed the Fairs and Observable Days. This is ours — check what you mean to light, and the states that forbid it go dark.</p>
<div class="banner"><strong>STARTER MAP — verify before you rely on it.</strong> Only Massachusetts (a total consumer-fireworks ban) is verified here; every other state defaults to "allowed (VERIFY)". Fireworks law changes often and is frequently set <em>county by county</em> — county resolution is the next build. This is information, not legal advice.</div>
<div class="card"><div class="types">Filter by type: ${checks}</div>${fireworksMapSvg()}<p class="note">Check one or more types; a state greys out if it does <em>not</em> allow every checked type. Schematic tile map (not to geographic scale).</p></div>

<div class="card"><h2>Buying, selling &amp; licenses — the ladder</h2>
<ul>
  <li><strong>Buy (consumer, 1.4G):</strong> set by <em>state and local</em> law — age limits, allowed types, and dates. Check your county too.</li>
  <li><strong>Sell (seasonal retail):</strong> most states require a <strong>State Fire Marshal permit/license</strong> for a stand or tent, often issued for the sales window only, plus local zoning/fire sign-off and liability insurance.</li>
  <li><strong>Shoot professionally (display, 1.3G):</strong> a <strong>state pyrotechnician / display-operator license</strong>, a federal <strong>ATF Explosives License/Permit</strong> to possess & transport display product, <strong>DOT</strong> hazmat for transport, local display permits, and insurance.</li>
  <li><strong>Manufacture / import:</strong> ATF license + CPSC (consumer) and <strong>APA Standard 87-1</strong> / <strong>NFPA 1123 &amp; 1126</strong> (display) standards.</li>
</ul>
<p class="note">This is the map of the terrain, not legal advice — confirm each rung with your State Fire Marshal, the ATF, and your county before you buy, sell, or shoot.</p></div>

<div class="card"><h2>Seasons &amp; taxes</h2>
<p>The two big windows are <strong>Independence Day</strong> and <strong>New Year's</strong>; many states add others (Texas: late Dec + around July 4; and cultural dates like Diwali or Cinco de Mayo locally). Several states levy a specific <strong>fireworks tax or "safety fee"</strong> on top of sales tax (e.g., West Virginia's fireworks safety fee) — plus normal sales-tax collection if you sell. Verify your state's rate and the exact legal sale dates before stocking.</p></div>

<div class="card"><h2>Party tricks for celebrations (the chemistry)</h2>
<div class="banner">Celebration/education — do these safely: outdoors or well-ventilated, never on treated wood, keep water nearby, and never mix or ingest the salts. Some produce toxic fumes.</div>
<ul>
  <li><strong>Colored fire</strong> — metal-salt flame colors (the same colorants pros use): <em>strontium → red, copper → blue-green, boron/borax → green, sodium (table salt) → gold-yellow, potassium → violet, lithium → magenta, calcium → orange.</em> A sprinkle on a campfire or in an alcohol burner throws the color.</li>
  <li><strong>Glowsticks, any color</strong> — the light is chemiluminescence (an oxalate ester + hydrogen peroxide); the <em>fluorescent dye</em> is what sets the color. Change the dye, change the color — the reaction is the same.</li>
</ul>
<p class="note">Deeper how-to &amp; safety from the real community: Pyrotechnics Guild International (pgi.org), the APA (americanpyro.com), Skylighter, and the Journal of Pyrotechnics.</p></div>

<div class="card"><h2>💰 Make money this season</h2>
<p>The point of the whole section — these windows are earning windows:</p>
<ul>
  <li><strong>Run a seasonal stand/tent</strong> — get the State Fire Marshal seller permit, buy wholesale, sell in the legal window. Lowest-capital real business here.</li>
  <li><strong>Get licensed and shoot shows</strong> — a state pyrotechnician license + on an ATF-licensed crew; display gigs pay well and cluster around the seasons.</li>
  <li><strong>Sell novelties &amp; glowsticks at events</strong> — sparklers, glow, party goods: low barrier, high foot-traffic on the holidays.</li>
  <li><strong>Be the compliance liaison</strong> — help others get their permits, forms, and insurance lined up (a service, not a product).</li>
</ul>
<p class="note">Each of these gets a step-by-step "how to start it" guide — permit forms, wholesalers, the numbers — as this section grows.</p></div>
${script}`, { canonical: BASE_URL + '/fireworks', breadcrumb: [{ name: 'Almanack', url: BASE_URL + '/' }, { name: 'Fireworks', url: BASE_URL + '/fireworks' }] });
}

// ── HTTP ─────────────────────────────────────────────────────────────────────────────────────────
const ROUTES = { '/': homeView, '/sky': skyView, '/sibyl': sibylView, '/ages': agesView, '/garden': gardenView, '/alchemy': alchemyView, '/fireworks': fireworksView };
const SITEMAP = ['/', '/sky', '/birthday', '/sibyl', '/ages', '/garden', '/alchemy', '/fireworks'];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const p = url.pathname.replace(/\/+$/, '') || '/';
    if (p === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }
    if (p === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (p === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n`
        + SITEMAP.map((u) => `<url><loc>${esc(BASE_URL + A(u))}</loc><lastmod>${today}</lastmod></url>`).join('\n') + `\n</urlset>`;
      res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(body);
    }
    if (p === '/birthday') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(birthdayView(url)); }
    const view = ROUTES[p];
    if (view) { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(view()); }
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Not found — MELEK Almanack', '<h1>Not found</h1><p><a href="/">Back to the Almanack</a></p>'));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(page('Error — MELEK Almanack', '<h1>Something went wrong</h1><p><a href="/">Back to the Almanack</a></p>'));
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`MELEK Almanack on ${BASE_URL} (bound ${HOST}:${PORT})`));
}
