// server.mjs — the SoapBox aggregator "browser" (CMC-style front end). Server-rendered HTML for SEO
// (brief §10). Reads from the condenser (one source of truth). This is the AGGREGATOR subdomain
// surface (AMENDMENT 1: the root SoapBox.Community is a separate hub that links here). MVP: a coin
// list + per-coin pages + a Clarity-Score placeholder + the comments-under-graph slot. No keys.
//
//   node site/soapbox/server.mjs            # http://localhost:8088
//   PORT=8088 node site/soapbox/server.mjs

import { createServer } from 'node:http';
import { topCoins, getCoin } from '../../integrations/soapbox/condenser.mjs';

const PORT = +(process.env.PORT || 8088);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const usd = (n) => (n == null ? '—' : '$' + (+n).toLocaleString(undefined, { maximumFractionDigits: +n < 1 ? 6 : 2 }));
const pct = (n) => (n == null ? '' : `<span style="color:${n >= 0 ? '#1a7f37' : '#cf222e'}">${n >= 0 ? '+' : ''}${(+n).toFixed(2)}%</span>`);

const STYLE = `<style>
  body{font:15px/1.5 system-ui,sans-serif;margin:0;background:#0d1117;color:#e6edf3}
  header{padding:16px 24px;background:#161b22;border-bottom:1px solid #30363d}
  header a{color:#e6edf3;text-decoration:none;font-weight:700;font-size:18px}
  .wrap{max-width:1000px;margin:0 auto;padding:24px}
  table{width:100%;border-collapse:collapse} th,td{text-align:left;padding:10px 8px;border-bottom:1px solid #21262d}
  th{color:#8b949e;font-weight:600;font-size:13px} tr:hover{background:#161b22}
  a.coin{color:#58a6ff;text-decoration:none;font-weight:600}
  .clarity{display:inline-block;padding:2px 8px;border-radius:10px;background:#21262d;font-size:12px;color:#8b949e}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:20px;margin:16px 0}
  .muted{color:#8b949e;font-size:13px} h1{margin:0 0 4px}
</style>`;

const page = (title, body) => `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)} — SoapBox</title>
<meta name=description content="${esc(title)} — live price, market cap, and Clarity transparency rating on SoapBox.">${STYLE}</head>
<body><header><a href="/">◈ SoapBox <span class=muted style="font-weight:400">markets</span></a></header><div class=wrap>${body}</div></body></html>`;

async function listPage() {
  const coins = await topCoins({ limit: 50 }).catch(() => []);
  const rows = coins.map((c) => `<tr>
    <td>${c.rank ?? ''}</td>
    <td><a class=coin href="/coins/${esc(c.id)}">${esc(c.name)}</a> <span class=muted>${esc(c.symbol)}</span></td>
    <td>${usd(c.price_usd)}</td><td>${pct(c.change_24h)}</td>
    <td>${usd(c.market_cap_usd)}</td><td>${usd(c.volume_24h_usd)}</td>
    <td><span class=clarity title="transparency rating (coming soon)">Clarity —</span></td></tr>`).join('');
  return page('Markets', `<h1>Markets</h1><p class=muted>Live prices via the condenser. Every listing gets a Clarity transparency rating + right-of-reply comments.</p>
    <table><thead><tr><th>#</th><th>Coin</th><th>Price</th><th>24h</th><th>Market cap</th><th>Volume</th><th>Clarity</th></tr></thead><tbody>${rows || '<tr><td colspan=7 class=muted>loading…</td></tr>'}</tbody></table>`);
}

async function coinPage(id) {
  const c = await getCoin(id).catch(() => null);
  if (!c) return page('Not found', `<div class=card><h1>Not found</h1><p class=muted>No coin "${esc(id)}". <a class=coin href="/">Back to markets</a></p></div>`);
  return page(c.name || id, `
    <h1>${esc(c.name)} <span class=muted>${esc(c.symbol)}</span></h1>
    <div class=card>
      <div style="font-size:28px;font-weight:700">${usd(c.price_usd)}</div>
      <div class=muted>Market cap ${usd(c.market_cap_usd)} · 24h vol ${usd(c.volume_24h_usd)} · source: ${esc(c.source)} (tier ${c.source_tier})</div>
    </div>
    <div class=card><b>Clarity Score</b> <span class=clarity>computing…</span>
      <p class=muted>Transparency/verifiability from observable on-chain facts (holder distribution, supply locks, contract behaviour, activity). A low score means opaque, not "scam".</p></div>
    <div class=card><b>Discussion</b> <span class=muted>(right-of-reply — coming)</span>
      <p class=muted>If a project was called out, they reply right here. Fact-and-debate, not a verdict machine.</p></div>
    ${c.links?.website ? `<p class=muted>Links: <a class=coin href="${esc(c.links.website)}">website</a></p>` : ''}
    <p><a class=coin href="/">← markets</a></p>`);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let html;
    if (url.pathname === '/' || url.pathname === '/coins') html = await listPage();
    else if (url.pathname.startsWith('/coins/')) html = await coinPage(decodeURIComponent(url.pathname.slice('/coins/'.length)));
    else if (url.pathname === '/health') { res.writeHead(200); return res.end('ok'); }
    else { res.writeHead(404); html = page('404', '<div class=card><h1>404</h1></div>'); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  } catch (e) { res.writeHead(500); res.end('error: ' + e.message); }
}).listen(PORT, () => console.log(`SoapBox markets browser on http://localhost:${PORT}`));
