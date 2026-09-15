// site/benefits/server.mjs — the SoapBox Benefits Navigator (benefits.soapbox.community).
//
// One honest map of what a person is actually owed. 100+ real US programmes, every one verified against
// its official government or nonprofit source, every one classified by MECHANISM — grant, loan,
// cost-share, tax credit, insurance, free service — so that nothing is ever called free money that is not.
//
// THE HOUSE RULE, and the only thing that makes this different from every "benefits finder" that exists:
//   Never call a loan free money, and always name the free or cheaper path the person has not been told
//   about. Where a for-profit middleman charges for something free, the entry says so by name.
//
// Data is benefits-navigator.mjs (pure, verified, link-out). This server renders it: a home grid by
// mechanism, a per-mechanism list, a per-programme detail, and search. SEO (robots/sitemap/llms.txt) +
// the shared ecosystem nav. Pure render, esc() everywhere, handler(req,res) exported, CLI guarded.
//
//   PORT=8141 node site/benefits/server.mjs
//   import { handler, homePage, mechanismView, programView } from './server.mjs'

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { PROGRAMS, MECHANISM_BADGE, MECHANISMS, truthCheck, NOT_ADVICE } from '../../integrations/soapbox/benefits-navigator.mjs';
import { navBar, NAV_STYLE } from '../../integrations/ecosystem-nav.mjs';

const PORT = +(process.env.PORT || 8141);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || 'https://benefits.soapbox.community';

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const slug = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
export const programSlug = (p) => slug(p.name);
export const findProgram = (s) => PROGRAMS.find((p) => programSlug(p) === String(s || ''));
export const byMechanism = (m) => PROGRAMS.filter((p) => (p.mechanism || 'varies') === m);

/** Free-first ordering: services and grants before anything you repay. */
const RANK = { service: 0, grant: 1, 'tax-credit': 2, 'cost-share-reimbursement': 3, insurance: 4, varies: 5, loan: 6 };
export const freeFirst = (list) => [...list].sort((a, b) =>
  (RANK[a.mechanism] ?? 9) - (RANK[b.mechanism] ?? 9) || String(a.name).localeCompare(String(b.name)));

export function search(q) {
  const t = String(q || '').toLowerCase().trim();
  if (!t) return [];
  return freeFirst(PROGRAMS.filter((p) =>
    [p.name, p.agency, p.honest_summary, p.eligibility_notes].join(' ').toLowerCase().includes(t)));
}

const STYLE = `<style>
:root{--bg:#f6f7f8;--card:#fff;--ink:#101214;--dim:#5d646d;--line:#e3e6ea;--free:#0a6b55;--warn:#8a5a00;--loan:#8a2f2f}
@media(prefers-color-scheme:dark){:root{--bg:#0d0f11;--card:#16191d;--ink:#eef1f4;--dim:#98a0a9;--line:#232830;--free:#4fd6ae;--warn:#e0b44c;--loan:#ff9c9c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.w{max-width:860px;margin:0 auto;padding:0 18px 64px}
h1{font-size:34px;letter-spacing:-1px;margin:26px 0 6px}
.lede{color:var(--dim);font-size:18px;margin:0 0 22px;max-width:62ch}
form{display:flex;gap:8px;margin:0 0 26px}
input{flex:1;padding:13px 15px;border:1px solid var(--line);border-radius:11px;background:var(--card);color:var(--ink);font:inherit}
button{padding:13px 20px;border:0;border-radius:11px;background:var(--ink);color:var(--bg);font:600 16px/1 inherit;cursor:pointer}
h2{font-size:22px;margin:32px 0 12px;letter-spacing:-.4px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:12px}
a.card,.card{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:16px;text-decoration:none;color:inherit}
a.card:hover{border-color:var(--ink)}
.card b{display:block;font-size:17px;margin-bottom:4px;letter-spacing:-.2px}
.card .ag{color:var(--dim);font-size:13px}
.card p{color:var(--dim);margin:9px 0 0;font-size:14px}
.badge{display:inline-block;font-size:11px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;border:1px solid currentColor;border-radius:6px;padding:3px 7px;margin-bottom:9px}
.m-service,.m-grant{color:var(--free)}.m-loan{color:var(--loan)}
.m-cost-share-reimbursement,.m-tax-credit,.m-insurance,.m-varies{color:var(--warn)}
.det{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:22px;margin:18px 0}
.det h3{margin:0 0 6px;font-size:15px;color:var(--dim);text-transform:uppercase;letter-spacing:1px}
.det p{margin:0 0 18px}
.src{display:inline-block;background:var(--ink);color:var(--bg);text-decoration:none;padding:12px 18px;border-radius:11px;font-weight:600}
.note{color:var(--dim);font-size:13px;border-top:1px solid var(--line);margin-top:34px;padding-top:16px}
a{color:inherit}
</style>`;

const shell = (title, desc, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(BASE_URL)}">${NAV_STYLE}${STYLE}<script defer src="https://soapy.blog/b.js"></script><noscript><img src="https://soapy.blog/px.gif" alt="" width="1" height="1" style="position:absolute;left:-9999px"></noscript></head>
<body>${navBar ? navBar('benefits') : ''}<div class="w">${body}
<p class="note">${esc(NOT_ADVICE)}</p></div></body></html>`;

const badge = (m) => `<span class="badge m-${esc(m)}">${esc((MECHANISM_BADGE[m] || m).split('—')[0].trim())}</span>`;

const cardOf = (p) => `<a class="card" href="/p/${esc(programSlug(p))}">
  ${badge(p.mechanism || 'varies')}
  <b>${esc(p.name)}</b><span class="ag">${esc(p.agency || '')}</span>
  <p>${esc(String(p.honest_summary || '').slice(0, 190))}…</p></a>`;

export function homePage() {
  const counts = MECHANISMS.map((m) => ({ m, n: byMechanism(m).length })).filter((x) => x.n);
  const free = freeFirst(PROGRAMS).slice(0, 12);
  return shell(
    'Benefits Navigator — what you are actually owed',
    `${PROGRAMS.length} verified US assistance programmes, each classified honestly: grant, loan, cost-share, tax credit, or free service.`,
    `<h1>What you are actually owed</h1>
     <p class="lede">${PROGRAMS.length} real programmes, every one checked against its official source. Each says plainly what it <em>is</em> — money you keep, money you repay, or free help — and names the free path where somebody normally charges you for it.</p>
     <form action="/search"><input name="q" placeholder="rent, food, teeth, school, a lawyer…" aria-label="Search"><button>Search</button></form>
     <h2>Free help and money you keep</h2><div class="grid">${free.map(cardOf).join('')}</div>
     <h2>By what it actually is</h2><div class="grid">${counts.map(({ m, n }) =>
       `<a class="card" href="/m/${esc(m)}">${badge(m)}<b>${n} programme${n === 1 ? '' : 's'}</b>
        <p>${esc(MECHANISM_BADGE[m] || '')}</p></a>`).join('')}</div>`);
}

export function mechanismView(m) {
  const list = freeFirst(byMechanism(m));
  if (!list.length) return null;
  return shell(`${MECHANISM_BADGE[m] || m} — Benefits Navigator`, MECHANISM_BADGE[m] || '',
    `<h1>${esc((MECHANISM_BADGE[m] || m).split('—')[0].trim())}</h1>
     <p class="lede">${esc(MECHANISM_BADGE[m] || '')}</p>
     <div class="grid">${list.map(cardOf).join('')}</div>
     <p style="margin-top:26px"><a href="/">← all programmes</a></p>`);
}

export function programView(s) {
  const p = findProgram(s);
  if (!p) return null;
  const t = truthCheck(p);
  return shell(`${p.name} — Benefits Navigator`, String(p.honest_summary || '').slice(0, 180),
    `<h1>${esc(p.name)}</h1><p class="lede">${esc(p.agency || '')}</p>
     ${badge(p.mechanism || 'varies')}
     <div class="det"><h3>What this actually is</h3><p>${esc(p.honest_summary || '')}</p>
     ${p.eligibility_notes ? `<h3>Who qualifies, and what trips people up</h3><p>${esc(p.eligibility_notes)}</p>` : ''}
     ${!t.honest ? `<h3>Flag</h3><p>${esc(t.why)}</p>` : ''}
     ${p.source_url ? `<a class="src" href="${esc(p.source_url)}" rel="noopener">Apply at the official source →</a>` : ''}</div>
     <p><a href="/m/${esc(p.mechanism || 'varies')}">← more like this</a> · <a href="/">all programmes</a></p>`);
}

export function searchView(q) {
  const hits = search(q);
  return shell(`“${q}” — Benefits Navigator`, `Programmes matching ${q}`,
    `<h1>${esc(q)}</h1><p class="lede">${hits.length} match${hits.length === 1 ? '' : 'es'}, free help first.</p>
     <form action="/search"><input name="q" value="${esc(q)}" aria-label="Search"><button>Search</button></form>
     <div class="grid">${hits.map(cardOf).join('')}</div>
     <p style="margin-top:26px"><a href="/">← all programmes</a></p>`);
}

export const sitemapEntries = () => [
  { loc: `${BASE_URL}/`, changefreq: 'weekly', priority: 1.0 },
  ...MECHANISMS.filter((m) => byMechanism(m).length).map((m) => ({ loc: `${BASE_URL}/m/${m}`, priority: 0.8 })),
  ...PROGRAMS.map((p) => ({ loc: `${BASE_URL}/p/${programSlug(p)}`, priority: 0.7 })),
];

export async function handler(req, res) {
  const url = new URL(req.url, BASE_URL);
  const send = (body, type = 'text/html; charset=utf-8', code = 200) => {
    res.statusCode = code; res.setHeader('content-type', type); res.end(body);
  };
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (path === '/robots.txt') return send(robotsTxt(BASE_URL), 'text/plain; charset=utf-8');
  if (path === '/sitemap.xml') return send(sitemapXml(BASE_URL, sitemapEntries()), 'application/xml');
  if (path === '/llms.txt') return send(llmsTxt({
    name: 'SoapBox Benefits Navigator', baseUrl: BASE_URL,
    summary: `${PROGRAMS.length} verified US assistance programmes, each classified by mechanism so a loan is never called free money. Free, no account, no data collected.`,
    links: PROGRAMS.slice(0, 60).map((p) => ({ title: p.name, url: `${BASE_URL}/p/${programSlug(p)}` })),
  }), 'text/plain; charset=utf-8');
  if (path === '/healthz') return send(JSON.stringify({ ok: true, programs: PROGRAMS.length }), 'application/json');

  if (path === '/') return send(homePage());
  if (path === '/search') return send(searchView(url.searchParams.get('q') || ''));
  const m = path.match(/^\/m\/([a-z-]+)$/); if (m) { const v = mechanismView(m[1]); if (v) return send(v); }
  const p = path.match(/^\/p\/([a-z0-9-]+)$/); if (p) { const v = programView(p[1]); if (v) return send(v); }

  send(shell('Not found', '', '<h1>Not found</h1><p><a href="/">← all programmes</a></p>'), 'text/html; charset=utf-8', 404);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () =>
    console.log(`benefits → http://${HOST}:${PORT}  (${PROGRAMS.length} programmes)`));
}
