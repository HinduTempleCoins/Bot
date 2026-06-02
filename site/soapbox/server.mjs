// server.mjs — the SoapBox aggregator ("the front door"). A data-driven PAGE FACTORY: one template
// (render.mjs) renders any token from the condenser's one normalized schema, so adding coins/chains
// never means building new pages (spec §0/§5). Server-rendered HTML for SEO (every token = a keyword),
// read-only, no keys, no custody. This is the AGGREGATOR subdomain surface (Data.SoapBox.Community);
// the root SoapBox.Community is a separate hub that links here (AMENDMENT 1).
//
//   node site/soapbox/server.mjs            # http://localhost:8088
//   PORT=8088 BASE_URL=https://data.soapbox.community node site/soapbox/server.mjs
//
// Routes: /  /coins  /coins/:id  /dapps  /ecosystem  /learn  /learn/:slug
//         /api/coins  /api/coins/:id  /api/global  /sitemap.xml  /robots.txt  /health

import { createServer } from 'node:http';
import { topCoins, ourCoins, getCoin, coinChart, globalStats, trending } from '../../integrations/soapbox/condenser.mjs';
import { clarityFromCoin } from '../../integrations/soapbox/clarity.mjs';
import { overrideFor, featuredIds } from '../../integrations/soapbox/overrides.mjs';
import { getThread, canPost } from '../../integrations/soapbox/comments.mjs';
import {
  layout, esc, usd, compactUsd, pct, sparkline, clarityBadge, clarityCard, priceChart, supplyBar, card,
} from './render.mjs';
import { DAPPS, ECOSYSTEM, LEARN } from './content.mjs';
import { topProtocols } from '../../integrations/soapbox/adapters/defillama.mjs';

const PORT = +(process.env.PORT || 8088);
// HOST lets the server bind to 127.0.0.1 when it sits behind a TLS reverse proxy (Caddy), so the
// raw HTTP port isn't also exposed publicly. Defaults to all interfaces for local/dev use.
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PER_PAGE = 50;

// ── Markets list (the page factory's index) ─────────────────────────────────
function coinRow(c, i) {
  const ov = overrideFor(c.id);
  const badge = c.ours ? `<span class="badge ours">ecosystem</span>` : (ov.badge ? `<span class=badge>${esc(ov.badge)}</span>` : '');
  return `<tr data-name="${esc((c.name + ' ' + c.symbol).toLowerCase())}" data-mcap="${c.market_cap_usd || 0}" data-price="${c.price_usd || 0}" data-vol="${c.volume_24h_usd || 0}" data-chg="${c.change_24h ?? 0}">
    <td>${c.rank ?? (c.ours ? '★' : i)}</td>
    <td><a class=coin href="/coins/${esc(c.id)}">${esc(c.name)}<span class=sym>${esc(c.symbol)}</span></a>${badge}</td>
    <td>${usd(c.price_usd)}</td>
    <td>${pct(c.change_24h)}</td>
    <td>${compactUsd(c.market_cap_usd)}</td>
    <td>${compactUsd(c.volume_24h_usd)}</td>
    <td>${c.sparkline_7d?.length ? sparkline(c.sparkline_7d) : '<span class=muted>—</span>'}</td>
  </tr>`;
}

async function listPage({ page = 1 } = {}) {
  const [ours, top, g, trend] = await Promise.all([
    ourCoins().catch(() => []),
    topCoins({ limit: PER_PAGE, page }).catch(() => []),
    globalStats().catch(() => null),
    page === 1 ? trending().catch(() => []) : Promise.resolve([]),
  ]);
  const ourIds = new Set(ours.map((c) => c.id));
  const market = top.filter((c) => !ourIds.has(c.id));
  const rows = (page === 1 ? [...ours, ...market] : market).map((c, i) => coinRow(c, (page - 1) * PER_PAGE + i + 1)).join('');

  // trending strip + top movers (computed from the visible market set) — page 1 only.
  const moversBlock = (() => {
    if (page !== 1 || !market.length) return '';
    const withChg = market.filter((c) => Number.isFinite(c.change_24h));
    const gainers = [...withChg].sort((a, b) => b.change_24h - a.change_24h).slice(0, 3);
    const losers = [...withChg].sort((a, b) => a.change_24h - b.change_24h).slice(0, 3);
    const chip = (c) => `<a class=coin href="/coins/${esc(c.id)}">${esc(c.symbol)}</a> ${pct(c.change_24h)}`;
    const trendChips = trend.map((c) => `<a class=coin href="/coins/${esc(c.id)}">${esc(c.symbol)}</a>`).join(' · ');
    return `<div class=grid style="margin:0 0 14px">
      ${trend.length ? `<div class=card style="margin:0"><div class=k style="color:var(--mut);font-size:12px">🔥 Trending</div><div>${trendChips}</div></div>` : ''}
      <div class=card style="margin:0"><div class=k style="color:var(--mut);font-size:12px">▲ Top gainers (24h)</div><div>${gainers.map(chip).join(' · ')}</div></div>
      <div class=card style="margin:0"><div class=k style="color:var(--mut);font-size:12px">▼ Top losers (24h)</div><div>${losers.map(chip).join(' · ')}</div></div>
    </div>`;
  })();

  const statsbar = g ? `<div class=statsbar>
    <span>Market cap <b>${compactUsd(g.total_market_cap_usd)}</b> ${pct(g.market_cap_change_24h)}</span>
    <span>24h vol <b>${compactUsd(g.total_volume_usd)}</b></span>
    <span>BTC dominance <b>${g.btc_dominance.toFixed(1)}%</b></span>
    <span>ETH <b>${g.eth_dominance.toFixed(1)}%</b></span>
    <span>Coins <b>${g.active_cryptocurrencies.toLocaleString()}</b></span>
  </div>` : '';

  const pager = `<div class=pager>
    ${page > 1 ? `<a href="/coins?page=${page - 1}">← prev</a>` : ''}
    <span class=muted style="padding:7px">page ${page}</span>
    ${market.length >= PER_PAGE ? `<a href="/coins?page=${page + 1}">next →</a>` : ''}
  </div>`;

  const body = `${statsbar}<h1>Markets</h1>
    <p class=muted>Live prices via the condenser. Ecosystem tokens pinned up top with a Clarity transparency rating + right-of-reply.</p>
    ${moversBlock}
    <input class=search id=q placeholder="Search name or symbol…" autocomplete=off>
    <table id=mkt><thead><tr>
      <th data-sort="i">#</th><th data-sort="name">Coin</th><th data-sort="price">Price</th>
      <th data-sort="chg">24h</th><th data-sort="mcap">Market cap</th><th data-sort="vol">Volume</th><th>7d</th>
    </tr></thead><tbody>${rows || '<tr><td colspan=7 class=muted>loading…</td></tr>'}</tbody></table>
    ${pager}
    <script>
      var q=document.getElementById('q'),tb=document.querySelector('#mkt tbody');
      q.addEventListener('input',function(){var v=q.value.toLowerCase();
        [].forEach.call(tb.rows,function(r){r.style.display=(r.dataset.name||'').indexOf(v)>-1?'':'none'})});
      [].forEach.call(document.querySelectorAll('th[data-sort]'),function(th){th.addEventListener('click',function(){
        var k=th.dataset.sort,rows=[].slice.call(tb.rows),asc=th._asc=!th._asc;
        rows.sort(function(a,b){var x=k==='name'?a.dataset.name:+a.dataset[k]||0,y=k==='name'?b.dataset.name:+b.dataset[k]||0;
          return (x>y?1:x<y?-1:0)*(asc?1:-1)});
        rows.forEach(function(r){tb.appendChild(r)})})});
    </script>`;

  return layout({
    title: 'Markets', active: '/', canonical: `${BASE_URL}/`,
    description: 'Live cryptocurrency prices, market caps, and Clarity transparency ratings. Ecosystem tokens (VKBT, CURE) with first-party on-chain data.',
    body,
  });
}

// ── Coin page (one template → every token) ──────────────────────────────────
async function coinPage(id) {
  const c = await getCoin(id).catch(() => null);
  if (!c) return { code: 404, html: layout({ title: 'Not found', body: card('Not found', `<p class=muted>No coin "${esc(id)}". <a href="/">← markets</a></p>`) }) };
  const ov = overrideFor(id);
  const [series, clarity] = await Promise.all([
    coinChart(id).catch(() => []),
    clarityFromCoin(c).catch(() => null),
  ]);
  const thread = getThread(c.comments_ref);

  const chains = (c.chains || []).map((ch) => `<span class=badge>${esc(ch)}</span>`).join(' ');
  const contracts = (c.contracts || []).filter((x) => x.address).map((x) =>
    `<div class=muted style="font-family:monospace;font-size:12px">${esc(x.chain)}: ${esc(x.address)}</div>`).join('') || '<span class=muted>—</span>';
  const team = (c.team || []).filter((t) => t.name).map((t) => `<div>${esc(t.name)} <span class=muted>${esc(t.role)}</span></div>`).join('') || '';
  const links = [
    c.links?.website && `<a href="${esc(c.links.website)}">website</a>`,
    c.links?.explorer && `<a href="${esc(c.links.explorer)}">explorer</a>`,
    ...(c.links?.social || []).map((s) => `<a href="${esc(s)}">${esc(s.replace(/^https?:\/\/(www\.)?/, '').split('/')[0])}</a>`),
  ].filter(Boolean).join(' · ');

  const comments = `<div class=card><h2>Discussion <span class=muted style="font-weight:400">· right-of-reply</span></h2>
    <p class=muted>If a project was called out, they reply right here — fact-and-debate, not a verdict machine.</p>
    ${thread.length ? thread.map((m) => `<div class="cmt ${m.kind === 'reply' ? 'reply' : ''}">
      <span class=who>${esc(m.author)}</span>${m.kind === 'reply' ? ' <span class="badge">official reply</span>' : ''}
      <span class=when>${esc((m.ts || '').slice(0, 16))}</span><div>${esc(m.body)}</div></div>`).join('')
      : '<p class=muted>No comments yet.</p>'}
    <p class=muted style="font-size:12px;margin-top:10px">${canPost() ? 'Posting open.' : 'Comments are read-only at launch (open once accounts/auth exist).'}</p></div>`;

  const body = `<p class=muted><a href="/">← markets</a></p>
    <h1>${esc(c.name)} <span class=muted>${esc(c.symbol)}</span> ${ov.badge ? `<span class=badge>${esc(ov.badge)}</span>` : ''} ${clarityBadge(clarity)}</h1>
    ${ov.blurb ? `<p>${esc(ov.blurb)}</p>` : ''}
    <div class=card>
      <div class=price>${usd(c.price_usd)}</div>
      <div class=muted>Market cap ${compactUsd(c.market_cap_usd)} · 24h vol ${compactUsd(c.volume_24h_usd)} · source: ${esc(c.source)} (tier ${c.source_tier})${chains ? ' · ' + chains : ''}</div>
    </div>
    ${priceChart(series)}
    ${supplyBar(c.supply)}
    ${clarityCard(clarity)}
    ${card('Contracts', contracts)}
    ${team ? card('Team', team) : ''}
    ${links ? card('Links', links) : ''}
    ${comments}`;

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'FinancialProduct', name: c.name,
    description: `${c.name} (${c.symbol}) live price, supply, and Clarity transparency rating on SoapBox.`,
    url: `${BASE_URL}/coins/${c.id}`,
  };
  return { code: 200, html: layout({ title: `${c.name} (${c.symbol})`, active: '/', canonical: `${BASE_URL}/coins/${c.id}`, description: `${c.name} live price ${usd(c.price_usd)}, market cap ${compactUsd(c.market_cap_usd)}, and Clarity transparency rating.`, jsonld, body }) };
}

// ── Static-ish pages, rendered through the same layout ──────────────────────
async function dappsPage() {
  const cats = [...new Set(DAPPS.map((d) => d.category))];
  const llama = await topProtocols({ limit: 15 }).catch(() => []);
  const llamaRows = llama.map((p, i) => `<tr>
    <td>${i + 1}</td><td style="text-align:left"><b>${esc(p.name)}</b> <span class=badge>${esc(p.chain)}</span></td>
    <td class=muted>${esc(p.category)}</td><td>${compactUsd(p.tvl)}</td><td>${pct(p.change_1d)}</td></tr>`).join('');
  const body = `<h1>dApp Directory</h1><p class=muted>Our ecosystem apps, plus the live DeFi landscape by TVL. One page per app, same factory.</p>
    ${cats.map((cat) => `<div class=card><h2>${esc(cat)}</h2>${DAPPS.filter((d) => d.category === cat).map((d) =>
      `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${d.url ? `<a href="${esc(d.url)}">${esc(d.name)}</a>` : esc(d.name)}</b>
       <span class=badge>${esc(d.chain)}</span> <span class="clarity c-${d.status === 'live' ? 'high' : d.status === 'in progress' ? 'moderate' : 'unknown'}">${esc(d.status)}</span>
       <div class=muted>${esc(d.blurb)}</div></div>`).join('')}</div>`).join('')}
    ${llamaRows ? `<div class=card><h2>Top DeFi protocols by TVL <span class=muted style="font-weight:400">· live via DeFiLlama</span></h2>
      <table><thead><tr><th>#</th><th style="text-align:left">Protocol</th><th style="text-align:left">Category</th><th>TVL</th><th>24h</th></tr></thead><tbody>${llamaRows}</tbody></table></div>` : ''}`;
  return layout({ title: 'dApps', active: '/dapps', canonical: `${BASE_URL}/dapps`, description: 'SoapBox dApp directory — ecosystem apps + the live DeFi landscape by TVL (DeFiLlama).', body });
}

function ecosystemPage() {
  const body = `<h1>Ecosystem</h1><p>${esc(ECOSYSTEM.intro)}</p>
    <div class=card><h2>Pillars</h2>${ECOSYSTEM.pillars.map((p) =>
      `<div style="padding:7px 0;border-bottom:1px solid var(--line)"><b>${esc(p.name)}</b> <span class=badge>${esc(p.kind)}</span><div class=muted>${esc(p.role)}</div></div>`).join('')}</div>
    <div class=card><p class=gold>${esc(ECOSYSTEM.note)}</p></div>`;
  return layout({ title: 'Ecosystem', active: '/ecosystem', canonical: `${BASE_URL}/ecosystem`, description: ECOSYSTEM.intro.slice(0, 150), body });
}

function learnIndex() {
  const body = `<h1>Learn</h1><p class=muted>Plain-English explainers, linked to the Library of Ashurbanipal. Every concept is its own page.</p>
    ${Object.entries(LEARN).map(([slug, a]) => `<div class=card><h2><a href="/learn/${slug}">${esc(a.title)}</a></h2><p class=muted>${esc(a.summary)}</p></div>`).join('')}`;
  return layout({ title: 'Learn', active: '/learn', canonical: `${BASE_URL}/learn`, description: 'Learn crypto: what gives a token value, recognizing scam patterns, how SoapBox differs.', body });
}

function learnArticle(slug) {
  const a = LEARN[slug];
  if (!a) return { code: 404, html: layout({ title: 'Not found', active: '/learn', body: card('Not found', `<p class=muted><a href="/learn">← learn</a></p>`) }) };
  const jsonld = { '@context': 'https://schema.org', '@type': 'Article', headline: a.title, description: a.summary, url: `${BASE_URL}/learn/${slug}` };
  const body = `<p class=muted><a href="/learn">← learn</a></p><h1>${esc(a.title)}</h1><p class=muted>${esc(a.summary)}</p><div class=card>${a.body}</div>`;
  return { code: 200, html: layout({ title: a.title, active: '/learn', canonical: `${BASE_URL}/learn/${slug}`, description: a.summary, jsonld, body }) };
}

// ── SEO surfaces + JSON read API (the one source of truth for Hathor/bots) ───
async function sitemap() {
  const top = await topCoins({ limit: PER_PAGE }).catch(() => []);
  const ours = await ourCoins().catch(() => []);
  const urls = ['/', '/dapps', '/ecosystem', '/learn',
    ...Object.keys(LEARN).map((s) => `/learn/${s}`),
    ...[...ours, ...top].map((c) => `/coins/${c.id}`)];
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [...new Set(urls)].map((u) => `  <url><loc>${BASE_URL}${u}</loc></url>`).join('\n') + `\n</urlset>`;
  return body;
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };

// ── Router ──────────────────────────────────────────────────────────────────
createServer(async (req, res) => {
  try {
    const url = new URL(req.url, BASE_URL);
    const p = url.pathname;
    const send = (html, code = 200) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(html); };

    if (p === '/' || p === '/coins') return send(await listPage({ page: Math.max(1, +url.searchParams.get('page') || 1) }));
    if (p.startsWith('/coins/')) { const r = await coinPage(decodeURIComponent(p.slice(7))); return send(r.html, r.code); }
    if (p === '/dapps') return send(await dappsPage());
    if (p === '/ecosystem') return send(ecosystemPage());
    if (p === '/learn') return send(learnIndex());
    if (p.startsWith('/learn/')) { const r = learnArticle(decodeURIComponent(p.slice(7))); return send(r.html, r.code); }

    // internal read API — Hathor + trade bots read the same schema the site renders
    if (p === '/api/global') return json(res, 200, await globalStats().catch(() => ({})));
    if (p === '/api/coins') {
      const [ours, top] = await Promise.all([ourCoins().catch(() => []), topCoins({ limit: PER_PAGE }).catch(() => [])]);
      return json(res, 200, { source: 'condenser', count: ours.length + top.length, ours, market: top });
    }
    if (p.startsWith('/api/coins/')) { const c = await getCoin(decodeURIComponent(p.slice(11))).catch(() => null); return c ? json(res, 200, c) : json(res, 404, { error: 'not found' }); }

    if (p === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(await sitemap()); }
    if (p === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(`User-agent: *\nAllow: /\nSitemap: ${BASE_URL}/sitemap.xml\n`); }
    if (p === '/health') { res.writeHead(200); return res.end('ok'); }

    return send(layout({ title: '404', body: card('404', '<p class=muted><a href="/">← markets</a></p>') }), 404);
  } catch (e) { res.writeHead(500); res.end('error: ' + e.message); }
}).listen(PORT, HOST, () => console.log(`SoapBox markets browser (page factory) on ${BASE_URL} (bound ${HOST}:${PORT})`));
