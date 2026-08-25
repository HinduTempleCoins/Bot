// server.mjs — Jobs.SoapBox.Community. The "find work + learn the skill" vertical as a standalone,
// zero-dependency HTTP service in the SoapBox house style (mirrors site/insurance/server.mjs). It fronts
// the already-built jobs/courses engine (integrations/soapbox/jobs-courses.mjs) and the GENERAL affiliate
// engine, binding them into ONE honest labor-market surface:
//   - a home directory (jobs / freelance gigs / courses),
//   - per-lane search rendered by the engine (renderPage) after honest ranking (rankResults),
//   - every outbound provider link routed through the affiliate engine (id by env NAME; plain url when
//     unset), FREE/open courses surfaced first, FTC disclosure on every page.
//
//   PORT=8187 BASE_URL=https://jobs.soapbox.community node site/jobs/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                    portal home — three search entries (jobs / freelance / courses)
//   /jobs?q=&loc=&gov=   job search (gov + private boards), ranked + rendered
//   /freelance?skill=    freelance-gig search, ranked + rendered
//   /courses?topic=      online-course search, free-first + rendered
//   /health              liveness probe
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   CONTENT + AFFILIATE, NOT A RECRUITER. We do not collect PII (outbound links only). Ranking is by
//   RELEVANCE + RECENCY, never commission (proven in jobs-courses.mjs). Affiliate ids come from the
//   environment BY NAME; none are stored or fabricated (plain url when unset). FTC disclosure on every
//   page. esc() on every interpolated value. Soft-fail: every route renders even when the engine returns
//   nothing (honest empty), and never throws.

import { createServer } from 'node:http';

import * as jobsEngine from '../../integrations/soapbox/jobs-courses.mjs';
import * as affiliate from '../../integrations/affiliate.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8187);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const INSURANCE = process.env.INSURANCE_SITE || 'https://insurance.soapbox.community';
const SITE_NAME = 'SoapBox Jobs';

// ── shared house-style helpers (same dark theme as Insurance/Coupons) ──────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
  h1{margin:0 0 6px;font-size:26px} h2{font-size:19px;margin:0 0 10px} h3{font-size:15px;margin:14px 0 6px}
  .muted{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  form.hsearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 220px;min-width:160px;max-width:420px}
  input.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--blue)}
  .jobs-courses table{width:100%;border-collapse:collapse;margin:10px 0;font-size:14px}
  .jobs-courses th,.jobs-courses td{text-align:left;padding:9px 8px;border-bottom:1px solid var(--line)}
  .jobs-courses th{color:var(--mut);font-weight:600;font-size:13px}
  .course-list{list-style:none;padding:0;margin:10px 0} .course-list li{padding:8px 0;border-bottom:1px solid var(--line)}
  .course-provider{color:var(--mut);font-size:13px;margin:0 8px}
  .course-badge{font-size:11px;border-radius:8px;padding:1px 7px}
  .course-free{background:#3fb95033;color:var(--up)} .course-paid{background:#8b949e22;color:var(--mut)}
  .data-note,.ftc-disclosure,.note{color:var(--mut);font-size:12px;border-top:1px solid var(--line);padding-top:10px;margin-top:12px}
  .provider-out{color:var(--mut);font-size:13px;margin:10px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>Honest ranking, not pay-to-rank.</b> SoapBox Jobs orders listings by <b>relevance and recency</b> —
  <b>never</b> by what a provider pays us. Free and open courses come first. We are <b>not a recruiter</b>
  and collect no personal information here — we route you to the source board or provider, and
  <b>we never sell your data</b>. Some outbound links are affiliate links; we may earn a commission at no
  extra cost to you. Confirm every listing on the source site before you apply or enroll.
  <div style="margin-top:8px"><a href="/">Jobs</a> · <a href="${esc(INSURANCE)}">Insurance</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

// ── page shell ────────────────────────────────────────────────────────────────────────────────────
function page(title, body, opts = {}) {
  const desc = opts.description || 'Find work and learn the skill — jobs, freelance gigs, and online courses, '
    + 'ranked by relevance and recency, never by commission. Free courses first. Not a recruiter; no data-selling.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  const head = headTags({
    title, description: desc, canonical, siteName: SITE_NAME, robots,
    site: { url: BASE_URL, name: SITE_NAME, searchUrlTemplate: `${BASE_URL}/jobs?q={search_term_string}` },
    jsonld: opts.jsonld || null,
  });
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header class=topbar><a class=brand href="/">💼 SoapBox <span>jobs</span></a>
  <div class=topbar-r><a href="/">Home</a><a href="/jobs">Jobs</a><a href="/freelance">Freelance</a><a href="/courses">Courses</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// A GET search form for one lane. `field` is the query param name; `action` the route.
function searchForm(action, field, placeholder, value = '') {
  return `<form class=hsearch method=get action="${esc(action)}"><div class=row>
    <input class=q name="${esc(field)}" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete=off aria-label="${esc(placeholder)}">
    <button type=submit>Search</button>
  </div></form>`;
}

// ── outbound provider link via the affiliate engine ────────────────────────────────────────────────
// The engine's renderPage already routes each listing's apply/enroll link through the affiliate engine.
// Here we add a single "browse more on the source" outbound, wrapped by affiliate.trackedLink: the
// network fit for the lane comes from verticalAffiliateFit; when its publisher id env is UNSET we get the
// PLAIN url + tracked:false (still works pre-go-live). Never throws; disclosure always paired.
export function providerOut(vertical, targetUrl, label) {
  let fit = null;
  try { fit = affiliate.verticalAffiliateFit(vertical); } catch { fit = null; }
  let link = { url: String(targetUrl || ''), tracked: false, disclosure: '' };
  try {
    link = affiliate.trackedLink(fit && fit.network ? fit.network : null, String(targetUrl || ''));
  } catch { /* soft-fail to plain */ }
  const href = esc(link.url || targetUrl || '#');
  return `<p class="provider-out">${esc(label)}: <a href="${href}" rel="sponsored nofollow noopener" target="_blank">${esc(targetUrl)}</a></p>`;
}

// ── home ──────────────────────────────────────────────────────────────────────────────────────────
export function homePage() {
  const cards = [
    ['/jobs', 'Jobs', 'Government + private job boards, searchable by title and location — ranked by relevance and recency.'],
    ['/freelance', 'Freelance gigs', 'Open freelance projects you can take right now, remote by nature.'],
    ['/courses', 'Courses', 'Online courses to learn the skill — free and open courses surfaced first.'],
  ].map(([href, t, d]) => `<a class=sec href="${esc(href)}"><div class=t>${esc(t)}</div><div class=d>${esc(d)}</div></a>`).join('');
  const body = `<h1>SoapBox Jobs <span class=muted style="font-size:14px">· find work, learn the skill</span></h1>
    <p class=muted>Search jobs, freelance gigs, and courses — ranked by <b>relevance and recency</b>, never by
      what a provider pays us. Free courses come first.</p>
    ${searchForm('/jobs', 'q', 'Search jobs — e.g. nurse, welder, react developer…')}
    <div class=grid style="margin-top:8px">${cards}</div>
    <div class=card><h2>How this stays honest</h2>
      <p class=muted style="font-size:14px">Listings are ordered by relevance and recency — commission is
      deliberately absent from the ranking. Free and open courses are surfaced before paid ones. We are not a
      recruiter, we collect no personal information here, and we <b>never sell your data</b>. Some outbound
      links are affiliate links; ranking is never affected.</p></div>`;
  return page(`${SITE_NAME} — jobs, freelance gigs & courses`, body, { canonical: `${BASE_URL}/` });
}

// ── lane views (each: search via engine → rankResults → renderPage) ─────────────────────────────────
export async function jobsView({ query = '', location = '', includeGov = true } = {}) {
  const rows = await Promise.resolve(jobsEngine.searchJobs({ query, location, includeGov })).catch(() => []);
  const ranked = jobsEngine.rankResults(Array.isArray(rows) ? rows : []);
  const html = jobsEngine.renderPage(ranked);
  const out = providerOut('jobs', 'https://www.indeed.com/jobs?q=' + encodeURIComponent(query || ''), 'Browse more jobs');
  return { rows: ranked, html: html + out };
}

export async function freelanceView({ skill = '' } = {}) {
  const rows = await Promise.resolve(jobsEngine.searchFreelance({ skill })).catch(() => []);
  const ranked = jobsEngine.rankResults(Array.isArray(rows) ? rows : []);
  const html = jobsEngine.renderPage(ranked);
  const out = providerOut('jobs', 'https://www.freelancer.com/jobs/' + encodeURIComponent(skill || ''), 'Browse more gigs');
  return { rows: ranked, html: html + out };
}

export async function coursesView({ topic = '' } = {}) {
  const rows = await Promise.resolve(jobsEngine.searchCourses({ topic })).catch(() => []);
  const courses = Array.isArray(rows) ? rows : [];
  const html = jobsEngine.renderPage({ courses });
  const out = providerOut('courses', 'https://www.classcentral.com/search?q=' + encodeURIComponent(topic || ''), 'Browse more courses');
  return { rows: courses, html: html + out };
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=300' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', '/jobs', '/freelance', '/courses'];

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
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'Find work + learn the skill: jobs, freelance gigs, and online courses ranked by relevance + '
          + 'recency, never commission. Free courses first. Not a recruiter; outbound links to source boards/'
          + 'providers; no data-selling.',
        links: [
          { label: 'Jobs', path: '/jobs' },
          { label: 'Freelance gigs', path: '/freelance' },
          { label: 'Courses', path: '/courses' },
        ],
      }));
    }

    if (path === '/') return sendHtml(res, homePage());

    if (path === '/jobs') {
      const query = url.searchParams.get('q') || '';
      const location = url.searchParams.get('loc') || '';
      const includeGov = url.searchParams.get('gov') !== '0';
      const view = await jobsView({ query, location, includeGov });
      const heading = query || location
        ? `Jobs — ${esc(query || 'all')}${location ? ' in ' + esc(location) : ''}`
        : 'Jobs';
      const body = `<h1>${heading}</h1>
        ${searchForm('/jobs', 'q', 'Search jobs — e.g. nurse, welder, react developer…', query)}
        ${view.html}`;
      return sendHtml(res, page(`Jobs${query ? ' — ' + esc(query) : ''} | ${SITE_NAME}`, body,
        { canonical: `${BASE_URL}/jobs`, description: 'Search government and private job boards, ranked by relevance and recency.' }));
    }

    if (path === '/freelance') {
      const skill = url.searchParams.get('skill') || '';
      const view = await freelanceView({ skill });
      const body = `<h1>Freelance gigs${skill ? ' — ' + esc(skill) : ''}</h1>
        ${searchForm('/freelance', 'skill', 'Search gigs — e.g. logo design, python scraping…', skill)}
        ${view.html}`;
      return sendHtml(res, page(`Freelance gigs${skill ? ' — ' + esc(skill) : ''} | ${SITE_NAME}`, body,
        { canonical: `${BASE_URL}/freelance`, description: 'Open freelance projects you can take right now, ranked honestly.' }));
    }

    if (path === '/courses') {
      const topic = url.searchParams.get('topic') || '';
      const view = await coursesView({ topic });
      const body = `<h1>Courses${topic ? ' — ' + esc(topic) : ''} <span class=muted style="font-size:14px">· free & open first</span></h1>
        ${searchForm('/courses', 'topic', 'Learn a skill — e.g. accounting, welding, machine learning…', topic)}
        ${view.html}`;
      return sendHtml(res, page(`Courses${topic ? ' — ' + esc(topic) : ''} | ${SITE_NAME}`, body,
        { canonical: `${BASE_URL}/courses`, description: 'Online courses to learn the skill — free and open courses first.' }));
    }

    // unknown → home
    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && /server\.mjs$/.test(process.argv[1]) && /site\/jobs\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`SoapBox Jobs on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
