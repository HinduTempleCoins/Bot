// site/business/server.mjs — SoapBox Business Credit (business.soapbox.community).
//
// The eight-step ladder that actually builds a business credit file, taught for free, with the fraud
// that surrounds it named by category. This is the teaching surface for business-credit-bot.mjs.
//
// Why it exists as a public page rather than only a bot: every step on this ladder is sold by someone.
// The EIN is free and people pay for it. The D-U-N-S number is free and people pay for it. The parts
// that cannot be bought — an active entity, a bank account, and months of on-time payments — are the
// parts the paid services quietly skip, which is why their customers end up with a file and no score.
//
// THE GUARDRAIL IS THE PRODUCT. CPN numbers, synthetic identities, bought or rented tradelines, aged
// shelf corporations, "800 PAYDEX guaranteed" — those are credit fraud, not credit building, and this
// site refuses them by name with the reason attached. `/check` runs the same guardrail the bot runs.
//
// Pure render from business-credit-bot.mjs. esc() everywhere, handler(req,res) exported, CLI guarded,
// no network, no keys, nothing stored — progress is in the query string and nowhere else.
//
//   PORT=8330 BASE_URL=https://business.soapbox.community node site/business/server.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { navBar, NAV_STYLE } from '../../integrations/ecosystem-nav.mjs';
import {
  KB, STEPS, MIN_HISTORY_MONTHS, NOT_ADVICE, guardrail, newProgress, completeStep, advise,
} from '../../integrations/business-credit-bot.mjs';

const PORT = +(process.env.PORT || 8330);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://business.soapbox.community').replace(/\/$/, '');
const BENEFITS = (process.env.BENEFITS_SITE || 'https://benefits.soapbox.community').replace(/\/$/, '');
const CREDIT = (process.env.CREDIT_SITE || 'https://credit.soapbox.community').replace(/\/$/, '');
const GRANTS = (process.env.GRANTS_SITE || 'https://grants.soapbox.community').replace(/\/$/, '');
const COMMS = (process.env.COMMS_SITE || 'https://comms.soapbox.community').replace(/\/$/, '');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const stepByKey = (k) => STEPS.find((s) => s.key === String(k || ''));

// What each step costs, and who charges for the free ones. This is the column no paid service prints.
const COST = {
  entity: { real: 'State filing fee — a Texas nonprofit corporation is about $25; LLCs vary by state',
    trap: 'Formation mills bundle a $300 "package" around a filing you can do yourself on the state website.' },
  ein: { real: 'FREE, directly from the IRS',
    trap: '⚠️ Sites that charge $75–$300 to "obtain your EIN." The IRS issues it free at irs.gov in about fifteen minutes. Never pay for an EIN.' },
  bank: { real: 'Free to open at most credit unions; some banks charge a monthly fee below a balance minimum',
    trap: 'If a past account was closed for overdrafts, you are likely in ChexSystems — a Bank On certified account is designed to open anyway. That is the door, not a fee-heavy "second chance" account.' },
  address_phone: { real: 'A listed business line; a commercial address you control',
    trap: 'A PO box fails verification. A virtual address that dozens of other companies also list is a known underwriting flag.' },
  duns: { real: 'FREE, directly from Dun & Bradstreet',
    trap: '⚠️ D&B upsells a paid "CreditBuilder" product alongside the free number, and resellers charge for expedited issuance. The NUMBER is free. Ask for the number.' },
  tradelines: { real: 'The cost of things the business actually needs',
    trap: 'A tradeline that does not report does nothing for the file. Confirm reporting BEFORE you order, not after.' },
  history: { real: 'Time. Three to six months, and nothing shortens it',
    trap: '⛔ This is the step every scheme is sold around. There is no honest shortcut, and the ones on offer are fraud.' },
  card: { real: 'Underwriting, once the file supports it',
    trap: 'Applying before the file exists produces a denial that is itself a data point. Wait for step 7 to finish.' },
};

const STYLE = `<style>
:root{--bg:#f6f7f8;--card:#fff;--ink:#101214;--dim:#5d646d;--line:#e3e6ea;--ok:#0a6b55;--warn:#8a5a00;--stop:#8a2f2f}
@media(prefers-color-scheme:dark){:root{--bg:#0d0f11;--card:#16191d;--ink:#eef1f4;--dim:#98a0a9;--line:#232830;--ok:#4fd6ae;--warn:#e0b44c;--stop:#ff9c9c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.w{max-width:880px;margin:0 auto;padding:0 18px 72px}
h1{font-size:34px;letter-spacing:-1px;margin:26px 0 6px}
h2{font-size:22px;margin:34px 0 12px;letter-spacing:-.4px}
h3{font-size:18px;margin:0 0 6px}
.lede{color:var(--dim);font-size:18px;margin:0 0 20px;max-width:64ch}
.tabs{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 24px}
.tabs a{padding:9px 14px;border:1px solid var(--line);border-radius:999px;background:var(--card);text-decoration:none;color:inherit;font-size:14px}
.tabs a.on{background:var(--ink);color:var(--bg);border-color:var(--ink);font-weight:600}
a.step,.card{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:17px;margin:0 0 12px;text-decoration:none;color:inherit}
a.step:hover{border-color:var(--ink)}
.row{display:flex;gap:14px;align-items:flex-start}
.n{flex:0 0 34px;height:34px;border-radius:50%;background:var(--ink);color:var(--bg);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px}
.n.free{background:var(--ok)}.n.gate{background:var(--warn)}
.card p,a.step p{margin:7px 0 0;color:var(--dim);font-size:14px}
.tag{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;border:1px solid currentColor;border-radius:6px;padding:3px 7px;margin:0 6px 6px 0}
.t-free{color:var(--ok)}.t-trap{color:var(--stop)}.t-time{color:var(--warn)}
.warn{border:1px solid var(--stop);color:var(--stop);border-radius:12px;padding:14px 16px;margin:0 0 18px;font-size:15px}
.good{border:1px solid var(--ok);color:var(--ok);border-radius:12px;padding:14px 16px;margin:0 0 18px;font-size:15px}
table{width:100%;border-collapse:collapse;font-size:14px}.scroll{overflow-x:auto}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{font-size:11px;letter-spacing:.7px;text-transform:uppercase;color:var(--dim)}
form.chk{display:flex;gap:8px;margin:0 0 18px}
input{flex:1;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);font:inherit}
button{padding:12px 20px;border:0;border-radius:10px;background:var(--ink);color:var(--bg);font:700 15px/1 inherit;cursor:pointer}
.note{color:var(--dim);font-size:13px;border-top:1px solid var(--line);margin-top:38px;padding-top:16px}
a{color:inherit}
</style>`;

const TABS = [['/', 'The ladder'], ['/bureaus', 'The bureaus'], ['/vendors', 'Vendors that report'], ['/scams', 'What is fraud'], ['/check', 'Check an offer']];

const shell = (title, desc, body, current = '/') => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(BASE_URL)}${esc(current === '/' ? '' : current)}">
${NAV_STYLE}${STYLE}<script defer src="https://soapy.blog/b.js"></script><noscript><img src="https://soapy.blog/px.gif" alt="" width="1" height="1" style="position:absolute;left:-9999px"></noscript></head><body>
${navBar({ current: 'business' })}
<div class="w">
<div class="tabs">${TABS.map(([h, l]) => `<a class="${h === current ? 'on' : ''}" href="${esc(h)}">${esc(l)}</a>`).join('')}</div>
${body}
<p class="note">${esc(NOT_ADVICE)}</p>
</div></body></html>`;

const isFree = (k) => /FREE/.test(COST[k]?.real || '');

export function ladderPage() {
  return shell('Build business credit — SoapBox',
    'The eight real steps that build a business credit file, taught free, with the cost of each and who charges for the free ones.',
    `<h1>Build business credit</h1>
<p class="lede">Eight steps, in order, each one gated on the one before it. Nothing here is clever. The
reason to publish it is that <b>every single step is sold by somebody</b> — including the two that are
free — and the steps that cannot be sold are the ones the paid services quietly skip.</p>
<div class="good"><b>Two of these cost nothing and are widely sold anyway:</b> the <b>EIN</b> is free from
the IRS, and the <b>D-U-N-S number</b> is free from Dun &amp; Bradstreet. If you are being charged for
either one, you are being charged for a form.</div>
${STEPS.map((s) => {
      const c = COST[s.key] || {};
      return `<a class="step" href="/step/${esc(s.key)}"><div class="row">
<div class="n ${isFree(s.key) ? 'free' : s.gate ? 'gate' : ''}">${esc(String(s.id))}</div><div>
<h3>${esc(s.label)}</h3>
${isFree(s.key) ? '<span class="tag t-free">Free</span>' : ''}${s.gate ? `<span class="tag t-time">Takes ${esc(String(MIN_HISTORY_MONTHS))}–6 months</span>` : ''}
<p>${esc(s.why)}</p>
${c.trap ? `<p style="color:var(--stop)">${esc(c.trap)}</p>` : ''}
</div></div></a>`;
    }).join('')}
<h2>The principle underneath all eight</h2>
<div class="card"><p style="color:inherit">${esc(KB.separateFromPersonal.principle)}</p>
<p>${esc(KB.separateFromPersonal.source)}</p></div>
<h2>Where this connects</h2>
<p class="lede">Step 3 is a bank account, and if a past account was closed on you that is a
<a href="${esc(CREDIT)}">personal credit</a> problem blocking a business one. Step 1 costs a state filing
fee. Step 4 needs a listed business line — <a href="${esc(COMMS)}">comms</a> covers what that actually
takes. And once the entity exists, <a href="${esc(GRANTS)}">grants</a> and the
<a href="${esc(BENEFITS)}">benefits navigator</a> become reachable in the entity's name.</p>`, '/');
}

export function stepPage(key) {
  const s = stepByKey(key);
  if (!s) return null;
  const c = COST[s.key] || {};
  const prereqs = s.prereqs.map((id) => STEPS.find((x) => x.id === id)).filter(Boolean);
  const next = STEPS.find((x) => x.prereqs.includes(s.id));
  return shell(`${s.label} — SoapBox Business Credit`, s.why,
    `<h1>${esc(s.id)}. ${esc(s.label)}</h1>
<p class="lede">${esc(s.what)}</p>
<div class="card"><h3>Why it matters</h3><p style="color:inherit">${esc(s.why)}</p></div>
<div class="card"><h3>How</h3><p style="color:inherit">${esc(s.how)}</p>
<p>Source: ${esc(s.source)}</p></div>
${c.real ? `<div class="${isFree(s.key) ? 'good' : 'card'}"><h3>What it costs</h3>
<p style="color:inherit">${esc(c.real)}</p></div>` : ''}
${c.trap ? `<div class="warn"><b>What gets sold here:</b> ${esc(c.trap)}</div>` : ''}
${s.gate ? `<div class="warn"><b>This step is time-gated and cannot be shortened.</b> A credit profile is
time plus consistency — at least ${esc(String(MIN_HISTORY_MONTHS))} months, six is stronger. Every scheme
on the <a href="/scams" style="color:inherit">fraud list</a> is sold as a way around this one step.</div>` : ''}
${prereqs.length ? `<h2>Do these first</h2>${prereqs.map((p) => `<a class="step" href="/step/${esc(p.key)}"><h3>${esc(p.id)}. ${esc(p.label)}</h3></a>`).join('')}` : ''}
${next ? `<h2>Then</h2><a class="step" href="/step/${esc(next.key)}"><h3>${esc(next.id)}. ${esc(next.label)}</h3><p>${esc(next.why)}</p></a>` : ''}
<p><a href="/">← the whole ladder</a></p>`, '/');
}

export function bureausPage() {
  return shell('The business credit bureaus — SoapBox',
    'Who files business credit, what each one scores, and what actually feeds it.',
    `<h1>The bureaus</h1>
<p class="lede">Three bureaus, three scores, and none of them is your personal credit score. A business
file can exist while your personal file is in poor shape, and the whole point of the ladder is to keep
them apart.</p>
${KB.bureaus.map((b) => `<div class="card"><h3>${esc(b.name)}</h3>
<span class="tag">${esc(b.score)}</span>
<p style="color:inherit">${esc(b.tracks)}</p>
<p>${esc(b.source)}</p></div>`).join('')}
<div class="good"><b>Note what Experian Business does:</b> it builds a file automatically once vendors
report — <b>no application needed</b>. You do not open an Experian business file. Your vendors open it
for you, which is why step 6 is about vendors that actually report.</div>`, '/bureaus');
}

export function vendorsPage() {
  return shell('Vendors that report — SoapBox Business Credit',
    'The net-30 vendors widely documented to extend terms to new businesses and report to a business bureau.',
    `<h1>Vendors that report</h1>
<p class="lede">A tradeline that does not report to a bureau does nothing for your file. You can pay it
perfectly for a year and the file will not know. These are the widely-documented on-ramps —
<b>confirm current terms and reporting with each vendor directly before you order</b>, because both change.</p>
<div class="scroll"><table><tr><th>Vendor</th><th>Terms</th><th>What they sell</th><th>Source</th></tr>
${KB.reportingVendors.map((v) => `<tr><td><b>${esc(v.name)}</b></td><td>${esc(v.terms)}</td>
<td>${esc(v.goods)}</td><td>${esc(v.source)}</td></tr>`).join('')}</table></div>
<div class="warn"><b>Buy things the business actually needs.</b> Ordering goods you have no use for to
manufacture a tradeline is how a real ladder turns into an expensive one. Shipping supplies, office
supplies and MRO are on this list because most operating entities genuinely consume them.</div>
<p><a href="/step/tradelines">← step 6</a></p>`, '/vendors');
}

export function scamsPage() {
  return shell('What is fraud, not credit building — SoapBox',
    'CPN numbers, synthetic identities, bought tradelines, shelf corporations and guaranteed scores — named by category, with why each one is fraud.',
    `<h1>What is fraud, not credit building</h1>
<p class="lede">Everything on this page is sold, openly, to people who are told it is a shortcut. It is
not a shortcut and it is not a grey area. Each one is a way of attaching a payment history to an identity
that did not earn it, which is the definition of the offence.</p>
<div class="warn"><b>All of it is sold around a single step:</b> step 7, the three to six months of on-time
payments. That step is the only one nobody can sell you, which is exactly why every scheme is shaped to
appear to skip it.</div>
${[['CPN / credit privacy number',
      'A "credit privacy number" is presented as a lawful alternative to your SSN. There is no such thing. In practice the numbers sold are either fabricated or belong to someone else — frequently a child or a deceased person — and using one on a credit application is identity theft and loan fraud, on a federal form, in writing.'],
    ['Synthetic identity',
      'A real number combined with fabricated details to create a person who does not exist. It is the fastest-growing form of financial fraud in the country, and the customer who buys the file is the one who signs the application.'],
    ['Buying or renting tradelines',
      'Paying to be added as an authorized user on a stranger\'s aged account so their history appears on your file. The history is not yours, the lender is being told it is, and both bureaus and underwriters detect the pattern — the usual outcome is that the account is stripped and the file is flagged.'],
    ['Aged or shelf corporations',
      'A dormant entity with an old registration date, sold to make a new business look established. The age is cosmetic; there is no trade history under it. Underwriters look at the tradelines, and using the age to imply operating history is misrepresentation on the application.'],
    ['"800 PAYDEX guaranteed" / boost your score fast',
      'PAYDEX is computed from reported, dollar-weighted, on-time trade payments. Nobody can guarantee it, because nobody but your vendors writes to it. A guarantee here is a guarantee that something other than real payment history will be used.'],
  ].map(([h, p]) => `<div class="card"><span class="tag t-trap">Fraud</span><h3>${esc(h)}</h3>
<p style="color:inherit">${esc(p)}</p></div>`).join('')}
<h2>The honest version</h2>
<div class="good">Real tradelines and real on-time payment history, on an entity that really exists, at an
address that really is yours. It takes months and it works, and at the end the file is yours and cannot be
taken back off you. <a href="/" style="color:inherit"><b>That is the ladder.</b></a></div>
<p><a href="/check">→ paste an offer and check it</a></p>`, '/scams');
}

export function checkPage(text = '') {
  const t = String(text || '');
  const r = t.trim() ? guardrail(t) : null;
  return shell('Check an offer — SoapBox Business Credit',
    'Paste what a business-credit service is offering you. The same guardrail the bot runs will tell you whether it is fraud, and which kind.',
    `<h1>Check an offer</h1>
<p class="lede">Paste what someone is selling you — the headline, the pitch, the text of the ad. This runs
the same guardrail the bot runs. <b>Nothing is stored or sent anywhere.</b></p>
<form class="chk" method="get" action="/check">
<input name="q" placeholder="e.g. Guaranteed 800 PAYDEX in 30 days with an aged shelf corp" value="${esc(t)}">
<button type="submit">Check it</button></form>
${r ? (r.ok
      ? `<div class="good"><b>Nothing in that text matches a known fraud pattern.</b> That is not an
endorsement — it means these particular rules did not fire. Check it against
<a href="/" style="color:inherit">the ladder</a>: if the offer skips step 7, or charges for the EIN or the
D-U-N-S number, it is selling you something you do not need.</div>`
      : `<div class="warn"><b>${esc(r.category)}</b><br>${esc(r.reason)}</div>
<p><a href="/scams">→ why this category is fraud</a></p>`) : ''}
<h2>The two questions that catch most of it</h2>
<div class="card"><h3>1. Is it charging for something free?</h3>
<p style="color:inherit">The EIN is free from the IRS. The D-U-N-S number is free from Dun &amp; Bradstreet.
A fee attached to either is a fee for filling in a form.</p></div>
<div class="card"><h3>2. Does it claim to skip the months?</h3>
<p style="color:inherit">Nobody writes to your business file but your vendors, and they write what actually
happened. Any offer that compresses ${esc(String(MIN_HISTORY_MONTHS))}–6 months of payment history into days
is proposing to put someone else's history on your file.</p></div>`, '/check');
}

// ── routes ───────────────────────────────────────────────────────────────────────────────────────────
export const SITEMAP_PATHS = [
  '/', '/bureaus', '/vendors', '/scams', '/check',
  ...STEPS.map((s) => `/step/${s.key}`),
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
    name: 'SoapBox Business Credit',
    baseUrl: BASE_URL,
    summary: 'The eight real steps that build a business credit file — entity, EIN (free), bank account, '
      + 'listed address and phone, D-U-N-S number (free), net-30 vendors that report, 3-6 months of on-time '
      + 'history, then a card. Taught free, with CPN, synthetic-identity, bought-tradeline and shelf-corp '
      + 'schemes named as the fraud they are.',
    links: [...TABS.map(([u, l]) => ({ label: l, url: u })),
      ...STEPS.map((s) => ({ label: `Step ${s.id}: ${s.label}`, url: `/step/${s.key}` }))],
  }), 'text/plain; charset=utf-8');
  if (path === '/healthz') return json(200, { ok: true, steps: STEPS.length, bureaus: KB.bureaus.length, vendors: KB.reportingVendors.length });

  if (path === '/api/steps') return json(200, { ok: true, steps: STEPS, minHistoryMonths: MIN_HISTORY_MONTHS });
  if (path === '/api/check') return json(200, { ok: true, ...guardrail(url.searchParams.get('q') || '') });
  if (path === '/api/advise') {
    // Stateless: the caller names which step keys are done; nothing is stored here.
    let prog = newProgress();
    for (const k of url.searchParams.getAll('done')) {
      const s = stepByKey(k);
      if (s) { const r = completeStep(prog, s.id); if (r && r.progress) prog = r.progress; }
    }
    return json(200, { ok: true, ...advise(prog) });
  }

  if (path === '/') return send(ladderPage());
  if (path === '/bureaus') return send(bureausPage());
  if (path === '/vendors') return send(vendorsPage());
  if (path === '/scams') return send(scamsPage());
  if (path === '/check') return send(checkPage(url.searchParams.get('q') || ''));
  const st = path.match(/^\/step\/([a-z_]+)$/); if (st) { const v = stepPage(st[1]); if (v) return send(v); }

  send(shell('Not found', '', '<h1>Not found</h1><p><a href="/">← the ladder</a></p>'), 'text/html; charset=utf-8', 404);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () =>
    console.log(`business-credit → http://${HOST}:${PORT}  (${STEPS.length} steps)`));
}
