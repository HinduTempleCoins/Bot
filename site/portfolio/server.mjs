// site/portfolio/server.mjs — THE PORTFOLIO (portfolio.soapbox.community).
//
// The single page you hand an advertiser, an investor, a grant officer, or anyone who asks what this
// is. It is also the thing that fixes findability: 89 of 105 surfaces were in no public registry, so
// nothing linked them and no crawler had a path to most of the network. This page is that path.
//
// ⚠️ THE ONE RULE: every row states a PROBED state, not a claim. `live` means an HTTPS GET returned
// 200 on the probe date. `built` means the code exists and its tests pass but the host does not
// resolve — said in those words, because "we have not deployed it" and "it is broken" are different
// sentences and only one is true. A portfolio whose third link is dead is worse than a portfolio with
// three links.
//
// Pure render from portfolio.mjs. esc() everywhere, handler(req,res) exported, CLI guarded, no network.
//
//   PORT=8322 BASE_URL=https://portfolio.soapbox.community node site/portfolio/server.mjs

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import { robotsTxt, sitemapXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import {
  CATEGORIES, SURFACES, REPO_FACTS, STATE_LABEL, PROBED_ON, counts, inCategory, bySlug, live,
} from '../../integrations/soapbox/portfolio.mjs';

const PORT = +(process.env.PORT || 8322);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://portfolio.soapbox.community').replace(/\/$/, '');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const STYLE = `<style>
:root{--bg:#0e1013;--card:#171a1f;--ink:#eef1f4;--dim:#98a0a9;--line:#252a32;--live:#4fd6ae;--built:#e0b44c}
@media(prefers-color-scheme:light){:root{--bg:#f6f7f8;--card:#fff;--ink:#101214;--dim:#5d646d;--line:#e3e6ea;--live:#0a6b55;--built:#8a5a00}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.w{max-width:940px;margin:0 auto;padding:0 18px 80px}
h1{font-size:40px;letter-spacing:-1.4px;margin:34px 0 8px;line-height:1.08}
h2{font-size:24px;margin:44px 0 6px;letter-spacing:-.5px}
h3{font-size:17px;margin:0 0 5px}
.lede{color:var(--dim);font-size:19px;margin:0 0 8px;max-width:62ch}
.blurb{color:var(--dim);font-size:15px;margin:0 0 18px;max-width:66ch}
.kpi{display:flex;flex-wrap:wrap;gap:12px;margin:24px 0 8px}
.kpi div{background:var(--card);border:1px solid var(--line);border-radius:13px;padding:13px 17px;min-width:120px}
.kpi b{display:block;font-size:27px;letter-spacing:-.6px;font-variant-numeric:tabular-nums}
.kpi span{font-size:11px;text-transform:uppercase;letter-spacing:.7px;color:var(--dim)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(270px,1fr));gap:12px}
.s{display:block;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:15px 16px;text-decoration:none;color:inherit}
a.s:hover{border-color:var(--ink)}
.s .h{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.s p{color:var(--dim);font-size:14px;margin:7px 0 0}
.s .u{color:var(--dim);font-size:12.5px;font-variant-numeric:tabular-nums;word-break:break-all}
.tag{font-size:10px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;border:1px solid currentColor;border-radius:5px;padding:2px 6px;white-space:nowrap}
.t-live{color:var(--live)}.t-built{color:var(--built)}.t-soon{color:var(--dim)}
.note{color:var(--built);font-size:13px;margin:8px 0 0}
table{width:100%;border-collapse:collapse;font-size:14.5px;margin:10px 0 0}
th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line)}
th{font-size:11px;letter-spacing:.7px;text-transform:uppercase;color:var(--dim)}
td.n{text-align:right;font-variant-numeric:tabular-nums;font-weight:700}
td.how{color:var(--dim);font-size:13px}
.honest{border:1px solid var(--built);color:var(--built);border-radius:13px;padding:15px 17px;margin:22px 0;font-size:15px;line-height:1.55}
.foot{color:var(--dim);font-size:13px;border-top:1px solid var(--line);margin-top:46px;padding-top:18px}
a{color:inherit}
</style>`;

const shell = (title, desc, body, canon = '') => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(BASE_URL)}${esc(canon)}">
<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:type" content="website"><meta property="og:url" content="${esc(BASE_URL)}${esc(canon)}">
${STYLE}<script defer src="https://analytics.soapbox.community/b.js"></script><noscript><img src="https://analytics.soapbox.community/px.gif" alt="" width="1" height="1" style="position:absolute;left:-9999px"></noscript></head><body><div class="w">${body}
<p class="foot">Reachability probed ${esc(PROBED_ON)} by HTTPS GET from outside the network.
"Live" means a 200 was returned on that date and nothing else. Re-probe before quoting it.</p>
</div></body></html>`;

function card(s) {
  const cls = s.state === 'live' ? 't-live' : s.state === 'built' ? 't-built' : 't-soon';
  const inner = `<div class="h"><h3>${esc(s.name)}</h3><span class="tag ${cls}">${esc(STATE_LABEL[s.state])}</span></div>
<div class="u">${esc(s.host)}</div>
${s.blurb ? `<p>${esc(s.blurb)}</p>` : ''}
${s.note ? `<p class="note">${esc(s.note)}</p>` : ''}`;
  // Only a LIVE surface gets a hyperlink. A dead link in a portfolio costs more than a missing one.
  return s.state === 'live'
    ? `<a class="s" href="https://${esc(s.host)}/">${inner}</a>`
    : `<div class="s">${inner}</div>`;
}

export function homePage() {
  const c = counts();
  return shell(
    'Portfolio — SoapBox & MELEK',
    `${c.live} live web properties, a Graphene chain with an AI witness producing blocks, and ${c.built} more built and awaiting deployment. Probed ${PROBED_ON}.`,
    `<h1>What we have built</h1>
<p class="lede">A network of public web properties, a blockchain with an AI witness account producing
blocks on it, and a library. Everything on this page is a link you can click and check.</p>
<div class="kpi">
<div><b>${esc(String(c.live))}</b><span>Live properties</span></div>
<div><b>${esc(String(c.built))}</b><span>Built, undeployed</span></div>
${REPO_FACTS.slice(0, 3).map((f) => `<div><b>${esc(f.v)}</b><span>${esc(f.k.replace(/^Web surfaces with a server$/, 'Surfaces in the repo'))}</span></div>`).join('')}
</div>
<div class="honest"><b>Two things this page will not do.</b> It will not link a host that does not
resolve — the ${esc(String(c.built))} surfaces marked <i>Built, not deployed</i> have passing tests and
no DNS, and they are shown unlinked rather than dressed up. And it does not quote a traffic number,
because the network was only instrumented on ${esc(PROBED_ON)} and thirty days of real data do not exist
yet. Both of those will change; neither is going to be guessed at in the meantime.</div>
${CATEGORIES.map((cat) => {
      const list = inCategory(cat.id);
      if (!list.length) return '';
      return `<h2>${esc(cat.name)}</h2><p class="blurb">${esc(cat.blurb)}</p>
<div class="grid">${list.map(card).join('')}</div>`;
    }).join('')}
<h2>The repository</h2>
<p class="blurb">Counted, not estimated. Each row names the command that produced it.</p>
<table><tr><th>Fact</th><th>Value</th><th>How</th></tr>
${REPO_FACTS.map((f) => `<tr><td>${esc(f.k)}</td><td class="n">${esc(f.v)}</td><td class="how">${esc(f.how)}</td></tr>`).join('')}
</table>`,
  );
}

export function categoryPage(id) {
  const cat = CATEGORIES.find((c) => c.id === String(id || ''));
  if (!cat) return null;
  const list = inCategory(cat.id);
  return shell(`${cat.name} — Portfolio`, cat.blurb,
    `<h1>${esc(cat.name)}</h1><p class="lede">${esc(cat.blurb)}</p>
<div class="grid">${list.map(card).join('')}</div>
<p style="margin-top:28px"><a href="/">← the whole portfolio</a></p>`, `/c/${cat.id}`);
}

// A machine-readable copy, because half the people who ask for a portfolio want to ingest it.
export const asJson = () => ({
  probed_on: PROBED_ON,
  counts: counts(),
  categories: CATEGORIES,
  surfaces: SURFACES.map((s) => ({ ...s, url: `https://${s.host}/` })),
  repo: REPO_FACTS,
});

export const SITEMAP_PATHS = ['/', ...CATEGORIES.map((c) => `/c/${c.id}`)];

export async function handler(req, res) {
  const url = new URL(req.url, BASE_URL);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const send = (body, type = 'text/html; charset=utf-8', code = 200) => {
    res.statusCode = code; res.setHeader('content-type', type); res.end(body);
  };

  if (path === '/robots.txt') return send(robotsTxt(BASE_URL), 'text/plain; charset=utf-8');
  if (path === '/sitemap.xml') {
    const today = new Date().toISOString().slice(0, 10);
    return send(sitemapXml(BASE_URL, SITEMAP_PATHS.map((p) => ({
      path: p, lastmod: today, changefreq: 'weekly', priority: p === '/' ? '1.0' : '0.7',
    }))), 'application/xml; charset=utf-8');
  }
  if (path === '/llms.txt') return send(llmsTxt({
    name: 'SoapBox & MELEK — Portfolio',
    baseUrl: BASE_URL,
    summary: `Everything built: ${counts().live} live web properties probed ${PROBED_ON}, a Graphene `
      + 'blockchain with an AI witness account producing blocks, a benefits and grants shelf, and a '
      + 'plant-medicine and harm-reduction library. Reachability is probed, never claimed.',
    // Only live hosts are advertised to an AI crawler — a model that follows a dead link learns
    // the wrong thing about us and repeats it.
    links: live().map((s) => ({ label: s.name, url: `https://${s.host}/`, note: s.blurb || '' })),
  }), 'text/plain; charset=utf-8');
  if (path === '/portfolio.json' || path === '/api/portfolio') {
    return send(JSON.stringify(asJson(), null, 2), 'application/json; charset=utf-8');
  }
  if (path === '/healthz') return send(JSON.stringify({ ok: true, ...counts() }), 'application/json; charset=utf-8');

  if (path === '/') return send(homePage());
  const c = path.match(/^\/c\/([a-z-]+)$/); if (c) { const v = categoryPage(c[1]); if (v) return send(v); }

  send(shell('Not found', '', '<h1>Not found</h1><p><a href="/">← the portfolio</a></p>'), 'text/html; charset=utf-8', 404);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const c = counts();
  createServer(handler).listen(PORT, HOST, () =>
    console.log(`portfolio → http://${HOST}:${PORT}  (${c.live} live, ${c.built} built)`));
}
