// server.mjs — Oversight.SoapBox.Community. The "Who do I call?" / consumer-protection AGENCY
// DIRECTORY as a standalone, zero-dependency HTTP service in the SoapBox house style (mirrors
// site/hemp/server.mjs and site/law/server.mjs). It fronts the keyless oversight directory module
// (integrations/soapbox/oversight-directory.mjs) and binds its readers into ONE surface:
//   - a curated directory of Federal Inspectors General, consumer-protection bodies, ombudsmen,
//     and the 50 State Attorneys General — EACH with full published contact info, and
//   - a "where do I file a complaint?" router that points a person at the RIGHT office.
//
//   PORT=8106 BASE_URL=https://oversight.soapbox.community node site/oversight/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /             portal home — search + category cards + a state filter
//   /agencies     list via agencies({category,state,q}) rendered with contactBlock()
//   /agency       full detail for one office (id=) incl. recent OIG/oversight findings (soft-fail)
//   /file         the "where do I file?" router (topic=, state=) via whereToFile()
//   /health       liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE (inherited from the directory module) ──────────────────────────────────────────────
//   FACTS, NOT VERDICTS. Each office's published contact info + its OWN complaint form. We point a
//   person at the right door; we never render a verdict, never tell someone they have a case, never
//   give legal advice. Filing a complaint is not proof of wrongdoing. esc() on every interpolated
//   value. Soft-fail: every route renders even when the live OIG-reports source returns nothing — the
//   curated directory always works offline. The affiliate slot stays DISABLED (flat-fee-only note,
//   ABA Model Rules 5.4 / 7.2).

import { createServer } from 'node:http';

import {
  agencies, agency, whereToFile, oigReports, contactBlock,
  CATEGORIES, NOT_ADVICE, AFFILIATE_SLOT,
} from '../../integrations/soapbox/oversight-directory.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';

const PORT = +(process.env.PORT || 8106);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://oversight.soapbox.community').replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const LAW = process.env.LAW_SITE || 'https://law.soapbox.community';
const DIRECTORY_SITE = process.env.DIRECTORY_SITE || 'https://directory.soapbox.community';

// ── shared house-style helpers (same dark theme as Law/Hemp/Stocks) ───────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const q = (s) => encodeURIComponent(String(s == null ? '' : s));

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
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  form.hsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q,select.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px}
  input.q{flex:1 1 220px;min-width:160px;max-width:420px} input.q:focus,select.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .empty{color:var(--mut);padding:14px 0}
  code{background:#0b0f14;border:1px solid var(--line);border-radius:4px;padding:1px 5px;font-size:12px}
  .rec{padding:12px 0;border-bottom:1px solid var(--line)} .rec:last-child{border-bottom:0}
  .rec .nm{font-weight:600;font-size:15px} .rec .meta{color:var(--mut);font-size:13px;margin-top:2px}
  blockquote{border-left:3px solid var(--line2);margin:8px 0;padding:2px 0 2px 12px;color:var(--mut);font-size:13px}
  /* contactBlock() styling — the directory module emits .oversight-contact cards */
  .oversight-contact{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:16px 18px;margin:12px 0}
  .oversight-contact .office-name{font-size:16px;margin:0 0 6px}
  .oversight-contact .who-for{color:var(--mut);font-size:14px;margin:0 0 8px}
  .contact-list{list-style:none;margin:0;padding:0} .contact-row{padding:3px 0;font-size:14px}
  .contact-row .label{color:var(--mut);display:inline-block;min-width:64px}
  .contact-row .missing{color:var(--mut);font-style:italic}
  .file-here{font-weight:700} .source{font-size:12px;margin:8px 0 0}
  .affiliate-note{color:var(--mut);font-size:12px;border:1px dashed var(--line2);border-radius:8px;padding:8px 12px;margin:14px 0}
  .not-advice{color:var(--gold);font-size:13px;margin:10px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

// Facts-not-verdicts footer — on EVERY page. Names the not-advice posture and the official-form path.
const FOOTER = `<footer>
  <b>Facts, not verdicts.</b> Oversight.SoapBox is a directory of official oversight, ombudsman, and
  consumer-protection offices — each with its <b>published</b> contact info and a link to the office's
  <b>own</b> complaint form. We point you at the right door; we never render a verdict, never tell you
  that you have a case, and never give legal advice. <b>Filing a complaint is not proof of
  wrongdoing.</b> Verify the office and the form at the source before acting.
  <div style="margin-top:8px"><a href="/">Oversight</a> · <a href="${esc(DIRECTORY_SITE)}">Directory</a> · <a href="${esc(LAW)}">Law</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

// Cross-link CTA to the Lawyer directory. Filing a complaint with an oversight office and finding a
// lawyer are different needs; some people who land here need counsel, not (or in addition to) a
// complaint. Points at law.soapbox.community — public bar records + legal-aid + bar referral lines.
// Stays facts-not-verdicts: it offers a directory, never tells anyone they have a case.
const LAWYER_CTA = `<div class="card lawyer-cta" style="border-color:var(--gold)">
  <h2 style="margin-bottom:4px">Need a lawyer, not (just) a complaint?</h2>
  <p class=muted style="margin:0 0 10px">Some matters need counsel. The Lawyer directory lists public bar
    records, legal-aid offices, and official bar referral lines — same facts-not-verdicts, no ratings, no
    pay-for-rank.</p>
  <a class=sec style="display:inline-block;border-color:var(--gold)" href="${esc(LAW)}/lawyers">Lawyer directory →</a>
</div>`;

function page(title, body, opts = {}) {
  const desc = opts.description || 'Oversight.SoapBox — the "Who do I call?" directory of US oversight, '
    + 'Inspector General, ombudsman, and consumer-protection offices, each with published contact info and '
    + 'its own complaint form, plus a where-to-file router. Facts, not verdicts. Not legal advice.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=robots content="${esc(robots)}">
<link rel=canonical href="${esc(canonical)}">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">🏛️ SoapBox <span>oversight</span></a>
  <div class=topbar-r><a href="/agencies">All offices</a><a href="/file">Where to file</a><a href="${esc(DIRECTORY_SITE)}">Directory</a><a href="${esc(LAW)}">Law</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// US state codes for the state filter (matches per-state AG offices + keeps federal offices in view).
const US_STATES = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'],
  ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'],
  ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'],
  ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'],
  ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'],
  ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
  ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
  ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
];

function stateSelect(selected, { name = 'state', allLabel = 'All states (federal offices)' } = {}) {
  const sel = String(selected == null ? '' : selected).toUpperCase();
  const opts = [`<option value="">${esc(allLabel)}</option>`]
    .concat(US_STATES.map(([code, nm]) => `<option value="${esc(code)}"${code === sel ? ' selected' : ''}>${esc(nm)}</option>`));
  return `<select class=q name="${esc(name)}" aria-label="State">${opts.join('')}</select>`;
}

function searchForm(action, { value = '', placeholder = 'Search…', label = 'Search', extra = '', name = 'q' } = {}) {
  return `<form class=hsearch method=get action="${esc(action)}"><div class=row>
    <input class=q name="${esc(name)}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete=off aria-label="${esc(label)}">
    ${extra}<button type=submit>${esc(label)}</button>
  </div></form>`;
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const cards = [
    ['oig', 'Federal Inspectors General', 'Fraud, waste & abuse inside a federal agency — HHS, DoD, SSA, VA, DOJ, DHS and more, each with its hotline.'],
    ['consumer', 'Consumer Protection', 'Scams, bad products, money & financial products — FTC, CFPB, CPSC, NHTSA, and the BBB.'],
    ['ombudsman', 'Ombudsman & Advocates', 'Independent problem-solvers — the IRS Taxpayer Advocate, long-term-care ombudsman, state insurance commissioners.'],
    ['state-ag', 'State Attorneys General', "Your state AG's consumer-protection unit — in-state scams, deceptive practices, unresolved business disputes."],
  ];
  const body = `<h1>Who do I call? <span class=muted style="font-size:14px">· the oversight &amp; consumer-protection directory</span></h1>
    <p class=muted>Every office below is an official oversight, Inspector General, ombudsman, or consumer-protection
      body — with its <b>published</b> contact info and its <b>own</b> complaint form. Describe what went wrong and
      we point you at the right door. We never render a verdict.</p>
    ${searchForm('/file', {
      placeholder: 'What went wrong? e.g. "robocall", "medicare fraud", "denied insurance claim"', label: 'Where do I file?', name: 'topic',
      extra: stateSelect('', { allLabel: 'State (optional)' }),
    })}
    <p class=muted style="font-size:13px;margin-top:-6px">Or browse all offices and filter by category and state.</p>
    <div class=grid style="margin-top:18px">
      ${cards.map(([cat, t, d]) => `<a class=sec href="/agencies?category=${q(cat)}"><div class=t>${esc(t)}</div><div class=d>${esc(d)}</div></a>`).join('')}
    </div>
    <div class=card style="margin-top:18px"><h2>Browse all offices</h2>
      ${searchForm('/agencies', {
        placeholder: 'Search offices by name, scope, or topic…', label: 'Browse',
        extra: stateSelect(''),
      })}
      <p class=muted style="font-size:13px;margin-top:-4px">A per-state filter shows that state's Attorney General plus every federal office (federal offices serve all states).</p></div>
    ${LAWYER_CTA}`;
  return page('Oversight.SoapBox — who do I call? consumer-protection directory', body, { canonical: `${BASE_URL}/` });
}

// ── /agencies — filtered list rendered with contactBlock() ────────────────────────────────────────
export function agenciesView(category, state, qstr) {
  const cat = String(category == null ? '' : category).trim();
  const st = String(state == null ? '' : state).trim();
  const query = String(qstr == null ? '' : qstr).trim();
  const results = agencies({ category: cat, state: st, q: query });

  const catLabel = cat && CATEGORIES[cat] ? CATEGORIES[cat] : '';
  const extra = `<select class=q name="category" aria-label="Category">
      <option value="">All categories</option>
      ${Object.entries(CATEGORIES).map(([k, v]) => `<option value="${esc(k)}"${k === cat ? ' selected' : ''}>${esc(v)}</option>`).join('')}
    </select>${stateSelect(st)}`;
  const form = searchForm('/agencies', { value: query, placeholder: 'Search offices by name, scope, or topic…', label: 'Filter', extra });

  const cards = results.length
    ? results.map((e) => contactBlock(e)).join('\n')
    : '<p class="empty">No offices matched that filter. Try clearing the category or state.</p>';

  const heading = catLabel ? `Offices — ${esc(catLabel)}` : 'All oversight &amp; consumer-protection offices';
  const body = `<h1>${heading}</h1>
    <p class=muted>${esc(results.length)} office(s). Each card is the office's <b>published</b> contact info and a link
      to its <b>own</b> complaint form. Click an office name path for full detail and recent oversight findings.</p>
    ${form}
    <div class="oversight-cards">
${results.map((e) => `      <div style="margin:0 0 8px"><a href="/agency?id=${q(e.id)}">${esc(e.name)} — full detail →</a></div>`).join('\n')}
    </div>
    ${cards}
    <p class="affiliate-note" data-affiliate-enabled="false"><em>${esc(AFFILIATE_SLOT.note)}</em></p>
    <p class="not-advice">${esc(NOT_ADVICE)}</p>`;
  return body;
}

// ── /agency — full detail + recent oversight findings (soft-fail) ──────────────────────────────────
export async function agencyView(id) {
  const e = agency(id);
  if (!e) {
    return `<h1>Office not found</h1>
      <p class=empty>No office matches that id. <a href="/agencies">Browse all offices →</a></p>`;
  }
  // recent OIG/oversight findings — soft-fails to [] so the page always renders.
  let reports = [];
  try { reports = await oigReports({ agency: e.name, size: 6 }); } catch { reports = []; }

  const findings = reports && reports.length
    ? `<div class=card><h2>Recent oversight findings <span class=muted style="font-size:12px">(oversight.gov, may be empty)</span></h2>
        ${reports.map((r) => `<div class=rec>
          <div class=nm>${r.url ? `<a href="${esc(r.url)}" rel="nofollow noopener">${esc(r.title || r.url)}</a>` : esc(r.title)}</div>
          <div class=meta>${esc(r.agency || '')}${r.date ? ` · ${esc(r.date)}` : ''}${r.source ? ` · ${esc(r.source)}` : ''}</div>
        </div>`).join('')}</div>`
    : `<div class=card><h2>Recent oversight findings</h2>
        <p class=empty>No recent published findings retrieved for this office right now (the live oversight.gov
          feed is best-effort and may be empty). The contact info above is the authoritative path.</p></div>`;

  const cat = CATEGORIES[e.category] || e.category;
  const body = `<h1>${esc(e.name)}</h1>
    <p class=muted><code>${esc(cat)}</code>${e.state ? ` · ${esc(e.state)}` : ' · federal'}</p>
    ${contactBlock(e)}
    ${findings}
    <p class="affiliate-note" data-affiliate-enabled="false"><em>${esc(AFFILIATE_SLOT.note)}</em></p>
    <p class="not-advice">${esc(NOT_ADVICE)}</p>`;
  return body;
}

// ── /file — the "where do I file?" router ─────────────────────────────────────────────────────────
export function fileView(topic, state) {
  const t = String(topic == null ? '' : topic).trim();
  const st = String(state == null ? '' : state).trim();
  const extra = stateSelect(st, { allLabel: 'State (optional)' });
  const form = searchForm('/file', {
    value: t, name: 'topic', label: 'Where do I file?',
    placeholder: 'What went wrong? e.g. "robocall", "medicare fraud", "denied insurance claim"', extra,
  });

  let result = '';
  if (t || st) {
    const hits = whereToFile({ topic: t, state: st });
    if (hits.length) {
      result = `<div class="oversight-cards">
        <p class=muted>Best matches for ${t ? `“${esc(t)}”` : 'your area'}${st ? ` in ${esc(st)}` : ''} — start with the office at the top.</p>
        ${hits.slice(0, 8).map((e) => contactBlock(e)).join('\n')}</div>`;
    } else {
      result = `<div class=card><p class=empty>No specific office matched. Start at the official general index
        (USA.gov complaints) and it will route you.</p></div>`;
    }
  }

  const body = `<h1>Where do I file a complaint?</h1>
    <p class=muted>Describe what went wrong (and optionally your state) and we point you at the right oversight
      or consumer-protection office — each with its phone, email, fax, and its <b>own</b> complaint form. We
      route you to the door; we never tell you that you have a case.</p>
    ${form}${result}
    ${LAWYER_CTA}
    <p class="affiliate-note" data-affiliate-enabled="false"><em>${esc(AFFILIATE_SLOT.note)}</em></p>
    <p class="not-advice">${esc(NOT_ADVICE)}</p>`;
  return body;
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

const SITEMAP_PATHS = ['/', '/agencies', '/file'];

// The request handler — exported so offline tests drive routes through a mock req/res (no port bound).
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
        path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.7',
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
        name: 'SoapBox Oversight', baseUrl: BASE_URL,
        summary: 'A directory of US oversight, Inspector General, ombudsman, and consumer-protection offices '
          + '(each with published contact info and its own complaint form), plus a where-to-file router.',
        links: [
          { label: 'All offices', path: '/agencies' },
          { label: 'Federal Inspectors General', path: '/agencies?category=oig' },
          { label: 'Consumer protection', path: '/agencies?category=consumer' },
          { label: 'State Attorneys General', path: '/agencies?category=state-ag' },
          { label: 'Where do I file?', path: '/file' },
        ],
      }));
    }

    const sp = url.searchParams;
    if (path === '/') return sendHtml(res, homePage());

    if (path === '/agencies') {
      const cat = sp.get('category') || '', st = sp.get('state') || '', qq = sp.get('q') || '';
      return sendHtml(res, page('Oversight offices — SoapBox Oversight',
        agenciesView(cat, st, qq),
        { canonical: `${BASE_URL}/agencies`, robots: (cat || st || qq) ? 'noindex,follow' : 'index,follow' }));
    }
    if (path === '/agency') {
      const id = sp.get('id') || '';
      return sendHtml(res, page('Oversight office detail — SoapBox Oversight',
        await agencyView(id),
        { canonical: `${BASE_URL}/agency?id=${q(id)}`, robots: 'noindex,follow' }));
    }
    if (path === '/file') {
      const topic = sp.get('topic') || '', st = sp.get('state') || '';
      return sendHtml(res, page('Where do I file a complaint? — SoapBox Oversight',
        fileView(topic, st),
        { canonical: `${BASE_URL}/file`, robots: (topic || st) ? 'noindex,follow' : 'index,follow' }));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly (`node site/oversight/server.mjs`), not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/oversight\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Oversight on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
