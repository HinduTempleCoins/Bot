// site/comms/server.mjs — SoapBox Comms (comms.soapbox.community): WiFi phone and fax.
//
// The operator asked whether we can run phone service over WiFi and a fax service. The software half
// is easy and the answer is yes. This site exists because the software is NOT the hard part, and the
// hard part is invisible from the code:
//
//   The moment a service carries calls to or from ORDINARY PHONE NUMBERS, the operator becomes an
//   INTERCONNECTED VoIP PROVIDER in the FCC's sense — E911 with registered location, FCC registration
//   and Form 499-A, USF contributions, CALEA, CPNI with an annual certification, and state filings.
//   App-to-app calling triggers NONE of that. Reselling from a licensed carrier keeps the burden with
//   the carrier. Those are three different businesses wearing the same word, "phone."
//
// The fax half is here for one reason and the page says it plainly: the TRANSMISSION REPORT is the
// product. A fax to a government office produces third-party evidence — remote CSID, page count,
// duration, timestamp — that an email never produces. That is why a records request goes by fax.
//
// Renders from comms-stack.mjs (regulatory tiers + the OSS survey), doc-services.mjs (provider
// economics), fax-system.mjs (the verified recipient book) and fax-receipts.mjs (report grading).
// Pure render. esc() everywhere, handler(req,res) exported, CLI guarded, no network, no credentials.
//
//   PORT=8321 BASE_URL=https://comms.soapbox.community node site/comms/server.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { navBar, NAV_STYLE } from '../../integrations/ecosystem-nav.mjs';
import { REG_TIERS, STACKS, stack, byTier, tiers, plan, licenseWarnings, stale } from '../../integrations/soapbox/comms-stack.mjs';
import { FAX_PROVIDERS, DEAD_PROVIDERS, CONVERSIONS, estimateFax, recommend } from '../../integrations/soapbox/doc-services.mjs';
import { recipients } from '../../integrations/soapbox/fax-system.mjs';
import { REPORT_FIELDS } from '../../integrations/soapbox/fax-receipts.mjs';

const PORT = +(process.env.PORT || 8321);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://comms.soapbox.community').replace(/\/$/, '');
const LAW = (process.env.LAW_SITE || 'https://law.soapbox.community').replace(/\/$/, '');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const usd = (n) => `$${Number(n).toFixed(2)}`;
const TIER_LIST = [REG_TIERS.APP_ONLY, REG_TIERS.RESELL, REG_TIERS.FULL];

const STYLE = `<style>
:root{--bg:#f6f7f8;--card:#fff;--ink:#101214;--dim:#5d646d;--line:#e3e6ea;--ok:#0a6b55;--warn:#8a5a00;--stop:#8a2f2f}
@media(prefers-color-scheme:dark){:root{--bg:#0d0f11;--card:#16191d;--ink:#eef1f4;--dim:#98a0a9;--line:#232830;--ok:#4fd6ae;--warn:#e0b44c;--stop:#ff9c9c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.w{max-width:900px;margin:0 auto;padding:0 18px 72px}
h1{font-size:34px;letter-spacing:-1px;margin:26px 0 6px}
h2{font-size:22px;margin:34px 0 12px;letter-spacing:-.4px}
h3{font-size:17px;margin:0 0 6px}
.lede{color:var(--dim);font-size:18px;margin:0 0 20px;max-width:64ch}
.tabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px}
.tabs a{padding:9px 14px;border:1px solid var(--line);border-radius:999px;background:var(--card);text-decoration:none;color:inherit;font-size:14px}
.tabs a.on{background:var(--ink);color:var(--bg);border-color:var(--ink);font-weight:600}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:17px;margin:0 0 12px}
.card p{margin:8px 0 0;color:var(--dim);font-size:14px}
.tag{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;border:1px solid currentColor;border-radius:6px;padding:3px 7px;margin-bottom:8px}
.t-ok{color:var(--ok)}.t-warn{color:var(--warn)}.t-stop{color:var(--stop)}
ul.ob{margin:10px 0 0;padding-left:20px;color:var(--stop);font-size:14px}
table{width:100%;border-collapse:collapse;font-size:14px;margin:0 0 14px}
.scroll{overflow-x:auto}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;letter-spacing:.7px;text-transform:uppercase;color:var(--dim)}
td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
.step{display:flex;gap:14px;margin:0 0 12px}
.step .n{flex:0 0 34px;height:34px;border-radius:50%;background:var(--ink);color:var(--bg);display:flex;align-items:center;justify-content:center;font-weight:800}
.warn{border:1px solid var(--stop);color:var(--stop);border-radius:12px;padding:14px 16px;margin:0 0 18px;font-size:15px}
form.est{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 16px}
input,select{padding:11px 13px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);font:inherit}
button{padding:11px 20px;border:0;border-radius:10px;background:var(--ink);color:var(--bg);font:700 15px/1 inherit;cursor:pointer}
.note{color:var(--dim);font-size:13px;border-top:1px solid var(--line);margin-top:38px;padding-top:16px}
a{color:inherit}code{font-size:13px}
</style>`;

const TABS = [
  ['/', 'Phone'], ['/tiers', 'What it triggers'], ['/stacks', 'The software'],
  ['/fax', 'Fax'], ['/fax/cost', 'What a fax costs'], ['/fax/book', 'Verified fax lines'],
];

const NOT_LEGAL =
  'Engineering and regulatory orientation, not legal advice. The FCC obligations named here are real '
  + 'and enforced; confirm your own position with counsel before carrying a single call to a phone number.';

const shell = (title, desc, body, current = '/') => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(BASE_URL)}${esc(current === '/' ? '' : current)}">
${NAV_STYLE}${STYLE}<script defer src="https://analytics.soapbox.community/b.js"></script><noscript><img src="https://analytics.soapbox.community/px.gif" alt="" width="1" height="1" style="position:absolute;left:-9999px"></noscript></head><body>
${navBar({ current: 'comms' })}
<div class="w">
<div class="tabs">${TABS.map(([h, l]) => `<a class="${h === current ? 'on' : ''}" href="${esc(h)}">${esc(l)}</a>`).join('')}</div>
${body}
<p class="note">${esc(NOT_LEGAL)}</p>
</div></body></html>`;

// ── phone ────────────────────────────────────────────────────────────────────────────────────────────
export function phonePage() {
  const steps = plan();
  return shell('WiFi phone — SoapBox Comms',
    'What it actually takes to run phone service over WiFi: the three regulatory tiers, and the build order that ships without touching the hard one.',
    `<h1>Phone service over WiFi</h1>
<p class="lede">The software is easy. The stacks are mature, permissively licensed and actively
maintained, and you could have members calling each other this month. <b>The software is not the hard
part</b> — and the hard part is invisible from the code.</p>
<div class="warn"><b>The line that decides everything:</b> the moment a service carries calls to or from
<b>ordinary phone numbers</b>, you are an <b>interconnected VoIP provider</b> in the FCC's sense. E911 with
a registered caller location. FCC registration and Form 499-A. Universal Service Fund contributions on
interstate revenue. CALEA lawful intercept. CPNI rules with an annual certification. State registration and
911 fee remittance in some states. <b>App-to-app calling triggers none of it.</b></div>
<h2>The build order</h2>
${steps.map((s) => `<div class="card"><div class="step"><div class="n">${esc(String(s.step))}</div><div>
<h3>${esc(s.what)}</h3>
<span class="tag ${s.tier === 'full' ? 't-stop' : s.tier === 'resell' ? 't-warn' : 't-ok'}">${esc(s.triggers)}</span>
<p>${esc(s.why)}</p></div></div></div>`).join('')}
<h2>Why not just get numbers</h2>
<p class="lede">You can — by <b>reselling from a licensed carrier</b>. Telnyx, Bandwidth and similar already
hold the registrations and run the E911 plumbing, and a white-label arrangement leaves the regulatory burden
with them. It costs margin, and it is how nearly every small phone app actually ships. ⭐ The same carriers
are already priced for <a href="/fax">fax</a> — one account, both products.</p>
<p><a href="/tiers">→ the three tiers, with the obligations listed</a></p>`, '/');
}

export function tiersPage(arch = '') {
  const asked = String(arch || '').trim();
  const answer = asked ? tiers(asked) : null;
  return shell('What your architecture triggers — SoapBox Comms',
    'The three regulatory tiers for voice service, with the obligations each one attaches.',
    `<h1>What your architecture triggers</h1>
<p class="lede">Not a boolean. Describe what you are building and the answer names a tier and its
obligations, because "do we need a licence" has three different right answers.</p>
<form class="est" method="get" action="/tiers">
<input name="arch" placeholder="e.g. members call each other in the app" value="${esc(asked)}" size="40">
<button type="submit">What does that trigger?</button></form>
${answer ? `<div class="card"><span class="tag ${answer.interconnected ? 't-warn' : 't-ok'}">${esc(answer.label)}</span>
<h3>${esc(answer.recommendation)}</h3><p>${esc(answer.note)}</p>
${answer.obligations && answer.obligations.length ? `<ul class="ob">${answer.obligations.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : '<p><b>No carrier obligations attach.</b></p>'}
</div>` : ''}
<h2>The three tiers</h2>
${TIER_LIST.map((t) => `<div class="card">
<span class="tag ${t.id === 'app-only' ? 't-ok' : t.id === 'resell' ? 't-warn' : 't-stop'}">${esc(t.label)}</span>
<h3>${t.interconnected ? 'Interconnected' : 'Not interconnected'}${t.burdenOn ? ` — burden on the ${esc(t.burdenOn)}` : ''}</h3>
<p>${esc(t.note)}</p>
${t.obligations.length ? `<ul class="ob">${t.obligations.map((o) => `<li>${esc(o)}</li>`).join('')}</ul>` : ''}
</div>`).join('')}`, '/tiers');
}

export function stacksPage() {
  const warn = licenseWarnings();
  const old = stale();
  const rows = (list) => `<div class="scroll"><table><tr><th>Project</th><th>Role</th><th>Licence</th><th>Last push</th></tr>
${list.map((s) => `<tr><td><a href="/stacks/${esc(s.id)}">${esc(s.repo)}</a></td><td>${esc(s.role)}</td>
<td>${esc(s.license)}</td><td class="num">${esc(s.pushed)}</td></tr>`).join('')}</table></div>`;
  return shell('The software — SoapBox Comms',
    'The open-source voice, fax and streaming stacks, surveyed with licences and last-push dates.',
    `<h1>The software</h1>
<p class="lede">Surveyed against the GitHub API. Star counts are a staleness marker, not a quality
judgement — <b>last push</b> is the field that matters, and the licence column is the one that decides
whether you can host it.</p>
<h2>App-to-app — build these first</h2>
${rows(byTier('app-only'))}
<h2>Only once there are real numbers</h2>
${rows(byTier('resell'))}
<h2>⚠️ Licences that constrain a hosted service</h2>
<p class="lede">The AGPL network clause triggers on <b>offering software over a network</b>, even though
nothing is distributed. That is fine if we publish the source, and it is a decision if we do not.</p>
${warn.map((w) => `<div class="card"><h3>${esc(w.id)} — ${esc(w.license)}</h3><p>${esc(w.warning)}</p></div>`).join('')}
${old.length ? `<h2>Verify before adopting</h2>${old.map((s) => `<div class="card"><h3>${esc(s.id)}</h3><p>${esc(s.note)} (last push ${esc(s.pushed)})</p></div>`).join('')}` : ''}`,
    '/stacks');
}

export function stackPage(id) {
  const s = stack(id);
  if (!s) return null;
  return shell(`${s.repo} — SoapBox Comms`, s.why,
    `<h1>${esc(s.repo)}</h1>
<p class="lede">${esc(s.role)} · ${esc(s.lang)} · ${esc(s.license)}</p>
<div class="card"><span class="tag ${s.tier === 'app-only' ? 't-ok' : 't-warn'}">${esc(s.tier)}</span>
<p>${esc(s.why)}</p>
<p>Last push ${esc(s.pushed)} · ${esc(String(s.stars))} stars at survey time.
<a href="https://github.com/${esc(s.repo)}">github.com/${esc(s.repo)}</a></p></div>
<p><a href="/stacks">← the survey</a></p>`, '/stacks');
}

// ── fax ──────────────────────────────────────────────────────────────────────────────────────────────
export function faxPage() {
  const provs = Object.values(FAX_PROVIDERS);
  return shell('Fax — SoapBox Comms',
    'Why a records request goes by fax: the transmission report is third-party evidence the document arrived. Provider economics, and the one provider that cannot be used for it.',
    `<h1>Fax</h1>
<p class="lede">Fax survives in government because of one property nothing else has: <b>the transmission
report is third-party evidence the document arrived.</b> Remote CSID, page count, duration, timestamp. An
email produces none of that, and a certified-mail green card takes weeks.</p>
<div class="warn"><b>The report IS the product.</b> A service that sends a fax and throws away the
confirmation has delivered nothing of value here. Every send keeps: ${REPORT_FIELDS.map((f) => `<code>${esc(f)}</code>`).join(' · ')}.</div>
<h2>What it costs, per provider</h2>
<div class="scroll"><table><tr><th>Provider</th><th>Type</th><th class="num">Per page</th><th class="num">Monthly min</th><th>Note</th></tr>
${provs.map((p) => `<tr><td><b>${esc(p.label)}</b></td><td>${esc(p.kind)}</td>
<td class="num">${esc(p.perPageUSD === 0 ? 'free' : usd(p.perPageUSD))}</td>
<td class="num">${esc(p.monthlyMinUSD ? usd(p.monthlyMinUSD) : '—')}</td><td>${esc(p.note)}</td></tr>`).join('')}
</table></div>
<h2>⚠️ The free one cannot be used for a filing</h2>
<p class="lede">FaxZero is genuinely free and genuinely useful for sending a form to a doctor's office. It is
<b>disqualified for anything evidentiary</b> for two reasons that have nothing to do with quality: it prints
an <b>advertisement on the cover page</b> of your document, and <b>the transmission report is theirs, not
yours</b> — you cannot produce it. Use it for errands, never for a records request or a filing.</p>
<h2>Twilio is not an option, and people keep reaching for it</h2>
<p class="lede">${esc(DEAD_PROVIDERS.twilio.note)} Discontinued ${esc(DEAD_PROVIDERS.twilio.diedOn)}.</p>
<h2>Retry is not optional, and it is not linear</h2>
<p class="lede">Busy is the <b>normal</b> outcome for a government fax line, not the exception — they are
frequently single-line and in use. Retrying a busy line in ten seconds just burns a page charge, so the
waits escalate.</p>
<h2>Document conversion</h2>
<div class="scroll"><table><tr><th>Conversion</th><th>Lossy?</th><th>Note</th></tr>
${CONVERSIONS.map((c) => `<tr><td><code>${esc(c.id)}</code></td>
<td>${c.lossy ? '<b style="color:var(--stop)">LOSSY</b>' : 'no'}</td><td>${esc(c.note || '')}</td></tr>`).join('')}
</table></div>
<p class="lede">The lossy ones matter: never round-trip a filing through PDF→DOCX, and never shrink a PDF
where a stamp or a signature has to stay legible in an exhibit.</p>`, '/fax');
}

export function faxCostPage(q = {}) {
  const pages = Math.max(1, Math.min(9999, Math.floor(Number(q.pages) || 3)));
  const faxes = Math.max(1, Math.min(9999, Math.floor(Number(q.faxes) || 1)));
  const evidentiary = String(q.evidentiary ?? '1') !== '0';
  const rec = recommend({ pages, faxes, evidentiary });
  const rows = Object.keys(FAX_PROVIDERS).map((id) => estimateFax({ providerId: id, pages, faxes })).filter(Boolean);
  return shell('What a fax costs — SoapBox Comms',
    'Per-provider cost for a given page count, with ad-supported providers excluded from evidentiary sends and the reason given.',
    `<h1>What a fax costs</h1>
<form class="est" method="get" action="/fax/cost">
<label>Pages <input name="pages" type="number" min="1" max="9999" value="${esc(String(pages))}" size="5"></label>
<label>Faxes <input name="faxes" type="number" min="1" max="9999" value="${esc(String(faxes))}" size="5"></label>
<label>Use <select name="evidentiary"><option value="1"${evidentiary ? ' selected' : ''}>A filing or records request</option>
<option value="0"${evidentiary ? '' : ' selected'}>An errand</option></select></label>
<button type="submit">Price it</button></form>
${rec.best ? `<div class="card"><span class="tag t-ok">Cheapest eligible</span>
<h3>${esc(rec.best.label)} — ${esc(usd(rec.best.totalFirstMonthUSD))} for ${esc(String(rec.totalPages))} pages</h3>
<p>Ranked on first-month total, so a monthly minimum cannot hide inside a low per-page rate.</p></div>` : ''}
${rec.excluded.length ? `<div class="warn"><b>Excluded${evidentiary ? ' because this is a filing' : ''}:</b><br>
${rec.excluded.map((x) => `<b>${esc(x.id)}</b> — ${esc(x.reason)}`).join('<br>')}</div>` : ''}
<div class="scroll"><table><tr><th>Provider</th><th class="num">${esc(String(pages * faxes))} pages</th><th class="num">First month</th><th>Cover page</th></tr>
${rows.map((r) => `<tr><td>${esc(FAX_PROVIDERS[r.provider].label)}</td><td class="num">${esc(usd(r.usageUSD))}</td>
<td class="num">${esc(usd(r.totalFirstMonthUSD))}${r.overMinimum ? '' : ' <span style="color:var(--warn)">(under minimum)</span>'}</td>
<td>${r.adCoverPage ? '<b style="color:var(--stop)">carries an ad</b>' : 'clean'}</td></tr>`).join('')}
</table></div>
<p class="lede">A subscription provider is cheaper above roughly 300 pages a month and worse below it. That
crossover is the whole decision, and it is why the minimum column is shown rather than folded into an
average.</p>
<h2>⭐ And for a handful of evidentiary sends, none of this is the answer</h2>
<div class="card"><h3>${esc(rec.manualAlternative.what)}</h3>
<p>${esc(rec.manualAlternative.why)}</p>
<p><b>${esc(rec.manualAlternative.example)}</b></p></div>
<h2>Providers that no longer exist</h2>
${rec.deadEnds.map((d) => `<div class="card"><h3>${esc(d.id)} — dead ${esc(d.diedOn)}</h3><p>${esc(d.note)}</p></div>`).join('')}`, '/fax/cost');
}

export function faxBookPage() {
  const list = recipients();
  return shell('Verified fax lines — SoapBox Comms',
    'Government fax numbers verified by hand, with the gotcha that makes each one necessary.',
    `<h1>Verified fax lines</h1>
<p class="lede">Every number here was checked against the office's own published page, with the date. The
<b>note</b> column is the reason the entry exists — usually that the obvious channel does not work.</p>
<div class="scroll"><table><tr><th>Office</th><th>Fax</th><th>Regime</th><th>Verified</th></tr>
${list.map((r) => `<tr><td><b>${esc(r.name)}</b>${r.note ? `<br><span style="color:var(--warn);font-size:13px">${esc(r.note)}</span>` : ''}</td>
<td class="num"><code>${esc(r.fax)}</code></td><td>${esc(r.regime || '—')}</td><td>${esc(r.verified || '')}</td></tr>`).join('')}
</table></div>
<p class="lede">A request sent to the wrong channel is not received, and the statutory clock does not start.
That is the entire reason this table is hand-verified rather than scraped. More on the deadlines at
<a href="${esc(LAW)}">law.soapbox.community</a>.</p>`, '/fax/book');
}

// ── routes ───────────────────────────────────────────────────────────────────────────────────────────
export const SITEMAP_PATHS = [
  '/', '/tiers', '/stacks', '/fax', '/fax/cost', '/fax/book',
  ...STACKS.map((s) => `/stacks/${s.id}`),
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
    name: 'SoapBox Comms',
    baseUrl: BASE_URL,
    summary: 'WiFi phone and fax. The three FCC regulatory tiers for voice (app-to-app triggers nothing; '
      + 'reselling keeps the burden with the carrier; owning interconnected VoIP means E911, 499-A, USF, '
      + 'CALEA and CPNI), the open-source stacks with licences, and fax provider economics — including why '
      + 'a free ad-supported fax cannot be used for a filing.',
    links: TABS.map(([url_, label]) => ({ label, url: url_ })),
  }), 'text/plain; charset=utf-8');
  if (path === '/healthz') return json(200, {
    ok: true, stacks: STACKS.length, tiers: TIER_LIST.length,
    faxProviders: Object.keys(FAX_PROVIDERS).length, faxBook: recipients().length,
  });

  if (path === '/api/tiers') return json(200, { ok: true, ...tiers(url.searchParams.get('arch') || '') });
  if (path === '/api/fax-cost') return json(200, {
    ok: true,
    estimates: Object.keys(FAX_PROVIDERS)
      .map((id) => estimateFax({ providerId: id, pages: Number(url.searchParams.get('pages')) || 1, faxes: Number(url.searchParams.get('faxes')) || 1 }))
      .filter(Boolean),
  });

  if (path === '/') return send(phonePage());
  if (path === '/tiers') return send(tiersPage(url.searchParams.get('arch') || ''));
  if (path === '/stacks') return send(stacksPage());
  if (path === '/fax') return send(faxPage());
  if (path === '/fax/cost') return send(faxCostPage(Object.fromEntries(url.searchParams)));
  if (path === '/fax/book') return send(faxBookPage());
  const s = path.match(/^\/stacks\/([a-z0-9._-]+)$/); if (s) { const v = stackPage(s[1]); if (v) return send(v); }

  send(shell('Not found', '', '<h1>Not found</h1><p><a href="/">← comms</a></p>'), 'text/html; charset=utf-8', 404);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () =>
    console.log(`comms → http://${HOST}:${PORT}  (${STACKS.length} stacks, ${Object.keys(FAX_PROVIDERS).length} fax providers)`));
}
