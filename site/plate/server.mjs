// site/plate/server.mjs — THE TEMPLE PLATE (plate.soapbox.community).
//
// Two surfaces that belong together and exist nowhere else as a pair:
//
//   1. THE PLATE — food organised by what it INTERACTS WITH, not by macronutrient. MyPlate already
//      covers macronutrients, it is free, and restating it adds nothing. What no official plate does is
//      tell you which tier your medicine, your fast, or your preparation takes off the table, and name
//      the mechanism. That is temple-plate.mjs.
//   2. THE SCREENER — a MYCIN-shaped deficiency screener whose every conclusion terminates in a TEST TO
//      ASK FOR, never in a finding. Certainty factors in [-1,+1], WHY explanation preserved. That is
//      temple-mycin.mjs.
//
// The hard rule this site is built around: it never tells anyone what they have. It produces a page to
// hand a clinician. If a render ever reads as a diagnosis, the render is wrong.
//
// Pure server-render from the two modules. esc() every interpolation, handler(req,res) exported for
// tests, CLI guarded, no network, no keys, no data collected (the screener is GET query params only —
// nothing is stored).
//
//   PORT=8146 BASE_URL=https://plate.soapbox.community node site/plate/server.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { navBar, NAV_STYLE } from '../../integrations/ecosystem-nav.mjs';
import {
  TIERS, STATES, STATE_IDS, TIER_IDS, plateFor, guardsOn, mechanismSlugs, shareCheck, NOT_ADVICE,
} from '../../integrations/temple-plate.mjs';
import {
  SIGNS, SIGN_IDS, RULES, ASK_FOR, run, why, NOT_A_DIAGNOSIS,
} from '../../integrations/temple-mycin.mjs';

const PORT = +(process.env.PORT || 8146);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://plate.soapbox.community').replace(/\/$/, '');
const BENEFITS = (process.env.BENEFITS_SITE || 'https://benefits.soapbox.community').replace(/\/$/, '');
const WIKI = (process.env.WIKI_SITE || 'https://wiki.soapbox.community').replace(/\/$/, '');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const pct = (n) => `${Math.round(n * 100)}%`;

// Guard rules, rendered. `rule` is the machine word; these are the human ones.
const RULE_WORD = {
  restrict: 'OFF THE PLATE',
  partial: 'PART OF IT COMES OFF',
  suspend: 'SUSPENDED',
  'at-risk': 'THE ONE YOU LOSE FIRST',
};
const RULE_CLASS = { restrict: 'r-off', partial: 'r-part', suspend: 'r-susp', 'at-risk': 'r-risk' };

const STYLE = `<style>
:root{--bg:#f7f6f4;--card:#fff;--ink:#12140f;--dim:#5f6358;--line:#e4e2dc;--off:#8a2f2f;--part:#8a5a00;--ok:#0a6b55;--risk:#5b4b8a}
@media(prefers-color-scheme:dark){:root{--bg:#0e100d;--card:#171a16;--ink:#eef1ea;--dim:#99a094;--line:#242820;--off:#ff9c9c;--part:#e0b44c;--ok:#4fd6ae;--risk:#b8a6ea}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.w{max-width:880px;margin:0 auto;padding:0 18px 72px}
h1{font-size:34px;letter-spacing:-1px;margin:26px 0 6px}
h2{font-size:22px;margin:34px 0 12px;letter-spacing:-.4px}
h3{font-size:17px;margin:0 0 6px}
.lede{color:var(--dim);font-size:18px;margin:0 0 20px;max-width:64ch}
.states{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 26px}
.states a{display:inline-block;padding:9px 14px;border:1px solid var(--line);border-radius:999px;background:var(--card);text-decoration:none;color:inherit;font-size:14px}
.states a.on{background:var(--ink);color:var(--bg);border-color:var(--ink);font-weight:600}
.tier{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;margin:0 0 12px}
.tier .bar{height:7px;border-radius:4px;background:var(--ink);opacity:.22;margin:8px 0 10px}
.tier .holds{color:var(--dim);font-size:14px}
.tier .note{color:var(--dim);font-size:14px;margin:9px 0 0}
.share{float:right;color:var(--dim);font-size:13px;font-variant-numeric:tabular-nums}
.guard{border-left:3px solid currentColor;padding:2px 0 2px 12px;margin:12px 0 0;font-size:14px}
.guard b{display:block;font-size:11px;letter-spacing:.8px;text-transform:uppercase;margin-bottom:3px}
.r-off{color:var(--off)}.r-part{color:var(--part)}.r-susp{color:var(--dim)}.r-risk{color:var(--risk)}
.guard .mech{color:var(--dim);font-size:12px;margin-top:5px}
fieldset{border:1px solid var(--line);border-radius:14px;background:var(--card);padding:14px 16px;margin:0 0 14px}
legend{font-weight:700;font-size:13px;letter-spacing:.6px;text-transform:uppercase;color:var(--dim);padding:0 6px}
label.sign{display:block;padding:5px 0;font-size:15px;cursor:pointer}
button{padding:13px 22px;border:0;border-radius:11px;background:var(--ink);color:var(--bg);font:700 16px/1 inherit;cursor:pointer}
.concl{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:18px;margin:0 0 12px}
.band{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;border:1px solid currentColor;border-radius:6px;padding:3px 7px;color:var(--part)}
.band.strong{color:var(--off)}.band.weak{color:var(--dim)}
.tests{margin:10px 0 0;padding-left:20px}.tests li{margin:3px 0}
.because{margin:12px 0 0;border-top:1px solid var(--line);padding-top:10px;font-size:14px;color:var(--dim)}
.because p{margin:6px 0}
.warn{border:1px solid var(--off);color:var(--off);border-radius:12px;padding:14px 16px;margin:0 0 18px;font-size:15px}
.note{color:var(--dim);font-size:13px;border-top:1px solid var(--line);margin-top:38px;padding-top:16px}
a{color:inherit}
</style>`;

const shell = (title, desc, body, current = 'plate') => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(BASE_URL)}">
${NAV_STYLE}${STYLE}<script defer src="https://soapy.blog/b.js"></script><noscript><img src="https://soapy.blog/px.gif" alt="" width="1" height="1" style="position:absolute;left:-9999px"></noscript></head><body>
${navBar({ current })}
<div class="w">${body}
<p class="note">${esc(NOT_ADVICE)}<br><br>${esc(NOT_A_DIAGNOSIS)}</p>
</div></body></html>`;

// ── the plate ────────────────────────────────────────────────────────────────────────────────────────
function stateStrip(active) {
  return `<div class="states">${STATES.map((s) =>
    `<a class="${s.id === active ? 'on' : ''}" href="/state/${esc(s.id)}">${esc(s.name)}</a>`).join('')}</div>`;
}

function tierCard(t) {
  const g = t.guard;
  return `<div class="tier">
<span class="share">${esc(pct(t.share))} of a day</span>
<h3><a href="/tier/${esc(t.id)}">${esc(t.name)}</a></h3>
<div class="bar" style="width:${esc(String(Math.round(t.share * 100)))}%"></div>
<div class="holds">${esc(t.holds.join(' · '))}</div>
<p class="note">${esc(t.note)}</p>
${g ? `<div class="guard ${esc(RULE_CLASS[g.rule] || 'r-part')}"><b>${esc(RULE_WORD[g.rule] || g.rule)}</b>${esc(g.why)}
${g.mechanism ? `<div class="mech">Mechanism: <a href="${esc(WIKI)}/interactions/${esc(g.mechanism)}">${esc(g.mechanism)}</a> — the pharmacology and its citations live in the library, not here, so there is one source of truth.</div>` : ''}</div>` : ''}
</div>`;
}

export function plateView(stateId = 'ordinary') {
  if (!STATE_IDS.includes(String(stateId))) return null;
  const p = plateFor(stateId);
  const scarcity = p.state === 'scarcity';
  return shell(
    `${p.stateName} — The Temple Plate`,
    `The Temple Plate for ${p.stateName}: which tiers come off the plate, and the named mechanism for each.`,
    `<h1>The Temple Plate</h1>
<p class="lede">Food organised by what it <b>interacts with</b>. MyPlate already covers macronutrients and it
is free — restating it adds nothing. What no official plate does is tell you which tier your medicine, your
fast or your preparation takes off the table, and name the mechanism.</p>
${stateStrip(p.state)}
<p class="lede"><b>${esc(p.stateName)}.</b> ${esc(p.note)}</p>
${scarcity ? `<div class="warn"><b>This is not a dietary state — it is a circumstance.</b> The right answer to
a short week is not a food rule. It is <a href="${esc(BENEFITS)}">the benefits navigator</a>: SNAP, WIC, food
banks, and the free things nobody tells you about, each labelled with what it actually is.</div>` : ''}
${p.tiers.map(tierCard).join('')}
<h2>Why the ferment tier is set apart</h2>
<p>It is the smallest tier on the plate and the loudest one pharmacologically. Aged cheese, cured meat, soy
sauce, miso, yeast extract, unpasteurised beer — nutritionally a rounding error, and the single tier that can
put someone on an MAOI in hospital. A plate that sorts by macronutrient has no way to say that. This one is
built so it can.</p>`,
  );
}

export function tierView(tierId) {
  const g = guardsOn(tierId);
  if (!g.ok) return null;
  const t = TIERS.find((x) => x.id === g.tier);
  return shell(
    `${t.name} — The Temple Plate`,
    `Every state that constrains the ${t.name} tier, with the mechanism named.`,
    `<h1>${esc(t.name)}</h1>
<p class="lede">${esc(t.note)}</p>
<div class="tier"><div class="holds">${esc(t.holds.join(' · '))}</div>
<p class="note">${esc(pct(t.share))} of a day's food, roughly. A proportion, not a prescription.</p></div>
<h2>What takes this tier off the plate</h2>
${g.guards.length ? g.guards.map((x) => `<div class="tier"><div class="guard ${esc(RULE_CLASS[x.rule] || 'r-part')}">
<b>${esc(x.stateName)} — ${esc(RULE_WORD[x.rule] || x.rule)}</b>${esc(x.why)}
${x.mechanism ? `<div class="mech">Mechanism: <a href="${esc(WIKI)}/interactions/${esc(x.mechanism)}">${esc(x.mechanism)}</a></div>` : ''}
</div></div>`).join('')
      : '<p>Nothing in the recorded states constrains this tier. That is not a guarantee — it means none of the states here touch it.</p>'}
<p><a href="/">← the whole plate</a></p>`,
  );
}

// ── the screener ─────────────────────────────────────────────────────────────────────────────────────
// Signs are grouped only for legibility; the rules do not care which group a sign came from.
const SIGN_GROUPS = [
  { name: 'What you notice', ids: ['fatigue', 'pallor', 'pica', 'numb_hands_feet', 'balance_off', 'sore_tongue', 'bruises_easy', 'bone_ache', 'cramps', 'palpitations', 'hair_loss', 'slow_wounds', 'taste_dull', 'night_vision_poor', 'heavy_periods'] },
  { name: 'Sun and skin', ids: ['low_sun', 'dark_skin', 'covered'] },
  { name: 'Diet, medicines, circumstances', ids: ['vegan_diet', 'alcohol_heavy', 'metformin', 'ppi', 'diuretic', 'bariatric', 'pregnant', 'low_food'] },
];

export function screenerForm(checked = []) {
  const on = new Set(checked);
  const groups = SIGN_GROUPS.map((grp) => `<fieldset><legend>${esc(grp.name)}</legend>
${grp.ids.filter((id) => id in SIGNS).map((id) =>
    `<label class="sign"><input type="checkbox" name="s" value="${esc(id)}"${on.has(id) ? ' checked' : ''}> ${esc(SIGNS[id])}</label>`).join('')}
</fieldset>`).join('');
  return shell(
    'Deficiency screener — The Temple Plate',
    'A MYCIN-shaped screener for common nutritional deficiencies. Every answer terminates in a test to ask a clinician for — never in a finding.',
    `<h1>What to ask for</h1>
<p class="lede">A screener built on the MYCIN architecture — production rules, certainty factors, and the WHY
explanation kept intact. It does <b>not</b> tell you what you have. Every conclusion terminates in a
<b>specific laboratory test to ask a clinician for</b>, with the reasoning shown so you and they can both
check it.</p>
<div class="warn"><b>Nothing this page produces is a result, a finding, or a clearance.</b> It is a list of
questions and tests to bring to someone who can order them. Nothing you tick is stored or sent anywhere —
your answers live in the URL and nowhere else.</div>
<form method="get" action="/screener">${groups}<button type="submit">Show me what to ask for</button></form>`,
    'plate',
  );
}

export function screenerResult(signs = []) {
  const picked = (signs || []).filter((s) => s in SIGNS);
  const r = run(picked);
  const bandClass = (b) => (b === 'strong pointer' ? 'strong' : b === 'weak pointer' ? 'weak' : '');
  const body = `<h1>Take this to a clinician</h1>
<div class="warn"><b>${esc(NOT_A_DIAGNOSIS)}</b></div>
<h2>What you reported</h2>
<ul>${r.observed.map((o) => `<li>${esc(o.text)}</li>`).join('') || '<li>Nothing selected.</li>'}</ul>
<h2>Tests to ask for</h2>
${r.conclusions.length ? r.conclusions.map((c) => `<div class="concl">
<span class="band ${esc(bandClass(c.band))}">${esc(c.band)} · ${esc(String(c.strength))}</span>
<h3 style="margin-top:9px">${esc(c.label)}</h3>
<ul class="tests">${c.ask_for.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>
<p class="note">${esc(c.note)}</p>
<div class="because"><b>Why these rules fired</b>
${c.because.map((f) => `<p>${esc(f.why)} <a href="/why/${esc(f.rule)}">(rule ${esc(f.rule)}, strength ${esc(String(f.cf))})</a></p>`).join('')}</div>
</div>`).join('')
    : '<p>Nothing here points anywhere specific. <b>That is not a clearance</b> — it means these particular questions did not fire.</p>'}
<p class="lede">${esc(r.next)}</p>
<p><a href="/screener">← change what you reported</a> · <a href="/">the plate</a></p>`;
  return shell('What to ask for — The Temple Plate', 'Tests to ask a clinician for, with the reasoning shown.', body);
}

export function whyView(ruleId) {
  const w = why(ruleId);
  if (!w.ok) return null;
  return shell(
    `Rule ${w.rule} — The Temple Plate`,
    `Why rule ${w.rule} fires, what it points at, and how strongly.`,
    `<h1>Rule <code>${esc(w.rule)}</code></h1>
<p class="lede">MYCIN kept an explanation facility because a rule you cannot inspect is a rule you cannot
argue with. This is that facility.</p>
<div class="concl">
<h3>Fires when all of these are true</h3>
<ul>${w.fires_on.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
<h3 style="margin-top:14px">Points at</h3>
<p>${esc(w.points_at)} — strength ${esc(String(w.strength))} on a scale where 1.0 would be certainty, which
no rule here reaches or claims.</p>
<h3>Why</h3>
<p>${esc(w.why)}</p>
</div>
<p><a href="/screener">← the screener</a></p>`,
  );
}

// ── routes ───────────────────────────────────────────────────────────────────────────────────────────
export const SITEMAP_PATHS = [
  '/', '/screener',
  ...STATE_IDS.map((s) => `/state/${s}`),
  ...TIER_IDS.map((t) => `/tier/${t}`),
  ...RULES.map((r) => `/why/${r.id}`),
];

export async function handler(req, res) {
  const url = new URL(req.url, BASE_URL);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const send = (body, type = 'text/html; charset=utf-8', code = 200) => {
    res.statusCode = code; res.setHeader('content-type', type); res.end(body);
  };
  const json = (code, obj) => send(JSON.stringify(obj, null, 2), 'application/json; charset=utf-8', code);

  if (path === '/robots.txt') return send(robotsTxt(BASE_URL), 'text/plain; charset=utf-8');
  if (path === '/sitemap.xml') {
    const today = new Date().toISOString().slice(0, 10);
    return send(sitemapXml(BASE_URL, SITEMAP_PATHS.map((p) => ({
      path: p, lastmod: today, changefreq: 'weekly', priority: p === '/' ? '1.0' : '0.6',
    }))), 'application/xml; charset=utf-8');
  }
  if (path === '/llms.txt') return send(llmsTxt({
    name: 'The Temple Plate',
    baseUrl: BASE_URL,
    summary: 'Food organised by what it interacts with, not by macronutrient — plus a MYCIN-shaped deficiency '
      + 'screener whose every conclusion terminates in a laboratory test to ask a clinician for, never in a '
      + 'finding. No account, nothing stored.',
    links: [
      { label: 'The plate', url: '/' },
      { label: 'Deficiency screener', url: '/screener' },
      ...STATES.map((s) => ({ label: s.name, url: `/state/${s.id}` })),
      ...TIERS.map((t) => ({ label: `${t.name} tier`, url: `/tier/${t.id}` })),
    ],
  }), 'text/plain; charset=utf-8');
  if (path === '/healthz') return json(200, {
    ok: true, tiers: TIERS.length, states: STATES.length, signs: SIGN_IDS.length, rules: RULES.length,
    shares: shareCheck(), mechanisms: mechanismSlugs(),
  });

  if (path === '/api/plate') return json(200, { ok: true, ...plateFor(url.searchParams.get('state') || 'ordinary') });
  if (path === '/api/screen') return json(200, { ok: true, ...run(url.searchParams.getAll('s')) });

  if (path === '/') return send(plateView('ordinary'));
  if (path === '/screener') {
    const picked = url.searchParams.getAll('s').filter((s) => s in SIGNS);
    return send(picked.length ? screenerResult(picked) : screenerForm(url.searchParams.getAll('s')));
  }
  const st = path.match(/^\/state\/([a-z0-9-]+)$/); if (st) { const v = plateView(st[1]); if (v) return send(v); }
  const ti = path.match(/^\/tier\/([a-z0-9-]+)$/); if (ti) { const v = tierView(ti[1]); if (v) return send(v); }
  const wy = path.match(/^\/why\/([a-z0-9-]+)$/); if (wy) { const v = whyView(wy[1]); if (v) return send(v); }

  send(shell('Not found', '', '<h1>Not found</h1><p><a href="/">← the plate</a></p>'), 'text/html; charset=utf-8', 404);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () =>
    console.log(`plate → http://${HOST}:${PORT}  (${TIERS.length} tiers, ${STATES.length} states, ${RULES.length} rules)`));
}
