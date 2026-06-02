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
import { topCoins, ourCoins, getCoin, coinChart, coinChartRange, CHART_RANGES, globalStats, trending, hiveEngineExtras, relatedCoins, marketIndex, coinTickers, officialThreads } from '../../integrations/soapbox/condenser.mjs';
import { clarityFromCoin } from '../../integrations/soapbox/clarity.mjs';
import { fetchTeam } from '../../integrations/soapbox/adapters/coinpaprika.mjs';
import { cached, TTL, stats as cacheStats } from '../../integrations/soapbox/cache.mjs';
import { overrideFor, featuredIds } from '../../integrations/soapbox/overrides.mjs';
import { getThread, canPost } from '../../integrations/soapbox/comments.mjs';
import {
  layout, esc, usd, compactUsd, pct, sparkline, clarityBadge, clarityCard, priceChart, supplyBar, card, marketStats,
  holdersPanel, depthPanel, relatedPanel, converter, ogSvg, fngGauge, FAVICON_SVG,
} from './render.mjs';
import { DAPPS, ECOSYSTEM, LEARN } from './content.mjs';
import { DIRECTORY } from './directory.mjs';
import { topProtocols } from '../../integrations/soapbox/adapters/defillama.mjs';
import { newPools } from '../../integrations/soapbox/adapters/geckoterminal.mjs';
import { fearGreed, categories, exchanges, chainsTVL, stablecoins, marketCapsByIds } from '../../integrations/soapbox/markets-extra.mjs';
import { macro, macroSummary, commodities, commoditiesSummary, WHERE_TO_BUY, ENTRY_POINTS, SOURCED_GOODS, DUTY_TOOLS, forex, forexSummary } from '../../integrations/soapbox/macro.mjs';
import { trafficSummary } from '../../integrations/soapbox/analytics.mjs';
import { auditSite } from '../../integrations/soapbox/seo-audit.mjs';
import { stockSearch, stockQuote, stockChart } from '../../integrations/soapbox/stocks.mjs';
import { search as scraperSearch } from '../../integrations/scraper.mjs';
import { cached as memo, TTL as MEMO_TTL } from '../../integrations/soapbox/cache.mjs';
import { listAnnouncements, asPost, SIGNATURE } from '../../integrations/soapbox/announcements.mjs';
import { robotsTxt, INDEXNOW_KEY, submitToIndexNow, pingSitemap } from '../../integrations/soapbox/crawlers.mjs';
import { CHAINS, nativePrices } from '../../integrations/chains/multichain.mjs';
import { chainBalance } from '../../integrations/chains/balances.mjs';

const PORT = +(process.env.PORT || 8088);
// HOST lets the server bind to 127.0.0.1 when it sits behind a TLS reverse proxy (Caddy), so the
// raw HTTP port isn't also exposed publicly. Defaults to all interfaces for local/dev use.
const HOST = process.env.HOST || '0.0.0.0';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const PER_PAGE = 50;

// ── Markets list (the page factory's index) ─────────────────────────────────
// a coin logo for the list: CoinGecko image when we have one, else a colored initial-badge (so
// ecosystem/Hive-Engine tokens without a hosted logo still get a consistent mark).
function coinLogo(c) {
  if (c.image) return `<img src="${esc(c.image)}" width=18 height=18 alt="" loading=lazy style="vertical-align:middle;border-radius:50%">`;
  const ch = (c.symbol || '?')[0].toUpperCase();
  const hue = [...(c.symbol || '?')].reduce((a, x) => a + x.charCodeAt(0), 0) % 360;
  return `<span aria-hidden=true style="display:inline-block;width:18px;height:18px;line-height:18px;text-align:center;border-radius:50%;font-size:10px;font-weight:700;color:#fff;background:hsl(${hue},45%,45%);vertical-align:middle">${esc(ch)}</span>`;
}

function coinRow(c, i) {
  const ov = overrideFor(c.id);
  const badge = c.ours ? `<span class="badge ours">ecosystem</span>` : (ov.badge ? `<span class=badge>${esc(ov.badge)}</span>` : '');
  return `<tr data-name="${esc((c.name + ' ' + c.symbol).toLowerCase())}" data-mcap="${c.market_cap_usd || 0}" data-price="${c.price_usd || 0}" data-vol="${c.volume_24h_usd || 0}" data-chg="${c.change_24h ?? 0}">
    <td>${c.rank ?? (c.ours ? '★' : i)}</td>
    <td><span class=star role=button tabindex=0 aria-label="add ${esc(c.symbol)} to watchlist" data-id="${esc(c.id)}" onclick="sbToggle(this,'${esc(c.id)}')" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();sbToggle(this,'${esc(c.id)}')}" title="watchlist">☆</span> ${coinLogo(c)} <a class=coin href="/coins/${esc(c.id)}">${esc(c.name)}<span class=sym>${esc(c.symbol)}</span></a>${badge}</td>
    <td>${usd(c.price_usd)}</td>
    <td>${pct(c.change_24h)}</td>
    <td>${compactUsd(c.market_cap_usd)}</td>
    <td>${compactUsd(c.volume_24h_usd)}</td>
    <td>${c.sparkline_7d?.length ? sparkline(c.sparkline_7d) : '<span class=muted>—</span>'}</td>
  </tr>`;
}

async function listPage({ page = 1 } = {}) {
  const [ours, top, g, trend, fng] = await Promise.all([
    ourCoins().catch(() => []),
    topCoins({ limit: PER_PAGE, page }).catch(() => []),
    globalStats().catch(() => null),
    page === 1 ? trending().catch(() => []) : Promise.resolve([]),
    page === 1 ? fearGreed().catch(() => null) : Promise.resolve(null),
  ]);
  const idx = page === 1 ? await marketIndex().catch(() => []) : [];
  const macroSum = page === 1 ? await macroSummary().catch(() => null) : null;
  const commSum = page === 1 ? await commoditiesSummary().catch(() => null) : null;
  const fxSum = page === 1 ? await forexSummary().catch(() => null) : null;
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
    ${fng?.value != null ? `<span>Fear &amp; Greed <b class="${fng.value >= 50 ? 'up' : 'down'}">${fng.value}</b> ${esc(fng.classification)}</span>` : ''}
  </div>` : '';

  // #148 — the current page number is a button that reveals an inline jump-to-page input.
  // We don't know the true last page server-side (the upstream gives no total), so we clamp the
  // lower bound to 1 and use the next page as a soft upper hint; the server returns empty rows
  // gracefully past the end. Pure HTML + inline JS, no framework.
  const hasNext = market.length >= PER_PAGE;
  const pager = `<div class=pager>
    ${page > 1 ? `<a href="/?page=${page - 1}">← prev</a>` : ''}
    <button type=button class=pagejump id=pagejumpbtn aria-label="jump to a page" title="jump to a page">page ${page}</button>
    <span class=pagejumpbox id=pagejumpbox hidden>
      <input type=number id=pagejumpinput min=1 value="${page}" aria-label="page number" style="width:64px">
      <a href="#" id=pagejumpgo>Go</a>
    </span>
    ${hasNext ? `<a href="/?page=${page + 1}">next →</a>` : ''}
  </div>
  <script>
    (function(){
      var btn=document.getElementById('pagejumpbtn'),box=document.getElementById('pagejumpbox'),
          inp=document.getElementById('pagejumpinput'),go=document.getElementById('pagejumpgo');
      if(!btn||!box||!inp||!go)return;
      function jump(){var n=Math.max(1,Math.floor(+inp.value||1));location.href='/?page='+n}
      btn.addEventListener('click',function(){var h=box.hidden;box.hidden=!h;btn.hidden=!h;if(!box.hidden){inp.focus();inp.select()}});
      go.addEventListener('click',function(e){e.preventDefault();jump()});
      inp.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();jump()}else if(e.key==='Escape'){box.hidden=true;btn.hidden=false;btn.focus()}});
    })();
  </script>`;

  const idxCard = idx.length > 1 ? `<div class=card style="display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:0 0 14px">
    <div>
      <div class=k style="color:var(--mut);font-size:12px">Total crypto market — 7-day trend</div>
      <div style="font-size:13px">${pct((idx[idx.length - 1].p / idx[0].p - 1) * 100)} over 7 days
        <span class=muted>· market-cap-weighted index of the top 50 coins (each coin's 7-day price move, weighted by its market cap, rebased to 100)</span></div>
    </div>
    <div style="margin-left:auto" title="A blended index of the top 50 coins' last 7 days, weighted by market cap. Up = the overall market rose; down = it fell.">${sparkline(idx.map((d) => d.p), 160, 40)}</div>
  </div>` : '';
  const body = `${statsbar}<h1>Global Markets</h1>
    <p class=muted>Live prices via the condenser. Ecosystem tokens pinned up top with a Clarity transparency rating + right-of-reply. Search also surfaces global stocks, ETFs &amp; indices.</p>
    <input class=search id=q placeholder="Search crypto, stocks, ETFs, indices…" autocomplete=off aria-label="Search crypto, stocks, ETFs and indices">
    <div id=msr class=msr hidden></div>
    ${macroSum && (macroSum.gold || macroSum.dow) ? `<div class=card style="margin:0 0 14px;font-size:13px"><span class=muted>📈 Macro:</span>
      ${macroSum.gold ? `Gold ${usd(macroSum.gold.price)} ${pct(macroSum.gold.change)}` : ''}
      ${macroSum.dow ? ` · Dow ${pct(macroSum.dow.change)}` : ''}
      ${macroSum.tenY ? ` · 10Y ${(+macroSum.tenY.price).toFixed(2)}%` : ''}
      ${macroSum.vix ? ` · VIX ${(+macroSum.vix.price).toFixed(1)}` : ''}
      <a href="/macro" style="margin-left:8px">See all →</a></div>` : ''}
    ${commSum && (commSum.coffee || commSum.wheat || commSum.oil) ? `<div class=card style="margin:0 0 14px;font-size:13px"><span class=muted>🛢️ Commodities:</span>
      ${commSum.coffee ? `Coffee ${(+commSum.coffee.price).toFixed(1)}¢/lb ${pct(commSum.coffee.change)}` : ''}
      ${commSum.wheat ? ` · Wheat ${(+commSum.wheat.price).toFixed(0)}¢/bu ${pct(commSum.wheat.change)}` : ''}
      ${commSum.corn ? ` · Corn ${(+commSum.corn.price).toFixed(0)}¢/bu` : ''}
      ${commSum.oil ? ` · WTI ${usd(commSum.oil.price)} ${pct(commSum.oil.change)}` : ''}
      <a href="/commodities" style="margin-left:8px">Prices + where to buy →</a></div>` : ''}
    ${fxSum && (fxSum.eurusd || fxSum.dxy) ? `<div class=card style="margin:0 0 14px;font-size:13px"><span class=muted>💱 Forex:</span>
      ${fxSum.eurusd ? `EUR/USD ${(+fxSum.eurusd.price).toFixed(4)} ${pct(fxSum.eurusd.change)}` : ''}
      ${fxSum.gbpusd ? ` · GBP/USD ${(+fxSum.gbpusd.price).toFixed(4)}` : ''}
      ${fxSum.usdjpy ? ` · USD/JPY ${(+fxSum.usdjpy.price).toFixed(2)}` : ''}
      ${fxSum.dxy ? ` · DXY ${(+fxSum.dxy.price).toFixed(2)} ${pct(fxSum.dxy.change)}` : ''}
      <a href="/forex" style="margin-left:8px">See all →</a></div>` : ''}
    ${idxCard}
    ${page === 1 ? fngGauge(fng) : ''}
    ${moversBlock}
    <div id=recent style="margin:0 0 12px"></div>
    <table id=mkt><caption class=skip>Cryptocurrency markets sorted by market cap</caption><thead><tr>
      <th scope=col data-sort="i">#</th><th scope=col data-sort="name">Coin</th><th scope=col data-sort="price">Price</th>
      <th scope=col data-sort="chg">24h</th><th scope=col data-sort="mcap">Market cap</th><th scope=col data-sort="vol">Volume</th><th scope=col>7d</th>
    </tr></thead><tbody>${rows || '<tr><td colspan=7 class=muted>loading…</td></tr>'}</tbody></table>
    ${pager}
    <script>
      var q=document.getElementById('q'),tb=document.querySelector('#mkt tbody');
      var msr=document.getElementById('msr'),tmr;
      function esc(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]})}
      q.addEventListener('input',function(){var v=q.value.toLowerCase();
        [].forEach.call(tb.rows,function(r){r.style.display=(r.dataset.name||'').indexOf(v)>-1?'':'none'});
        clearTimeout(tmr);var term=q.value.trim();
        if(term.length<2){msr.hidden=true;msr.innerHTML='';return}
        tmr=setTimeout(function(){
          fetch('/api/markets-search?q='+encodeURIComponent(term)).then(function(r){return r.json()}).then(function(d){
            var h='';
            if(d.crypto&&d.crypto.length){h+='<div class=msrg><div class=msrh>Crypto</div>'+d.crypto.map(function(c){return '<a href="/coins/'+encodeURIComponent(c.id)+'">'+esc(c.name)+' <span class=muted>'+esc(c.symbol)+'</span></a>'}).join('')+'</div>'}
            if(d.stocks&&d.stocks.length){h+='<div class=msrg><div class=msrh>Stocks, ETFs &amp; Indices</div>'+d.stocks.map(function(s){return '<a href="/stocks/'+encodeURIComponent(s.symbol)+'">'+esc(s.name)+' <span class=muted>'+esc(s.symbol)+' · '+esc(s.typeLabel)+'</span></a>'}).join('')+'</div>'}
            msr.innerHTML=h||'<div class=msrg><span class=muted style="padding:8px;display:block">No matches.</span></div>';msr.hidden=false;
          }).catch(function(){});
        },250);
      });
      document.addEventListener('click',function(e){if(e.target!==q&&!msr.contains(e.target)){msr.hidden=true}});
      [].forEach.call(document.querySelectorAll('th[data-sort]'),function(th){th.addEventListener('click',function(){
        var k=th.dataset.sort,rows=[].slice.call(tb.rows),asc=th._asc=!th._asc;
        rows.sort(function(a,b){var x=k==='name'?a.dataset.name:+a.dataset[k]||0,y=k==='name'?b.dataset.name:+b.dataset[k]||0;
          return (x>y?1:x<y?-1:0)*(asc?1:-1)});
        rows.forEach(function(r){tb.appendChild(r)})})});
    </script>`;

  return layout({
    title: 'Global Markets', active: '/', canonical: `${BASE_URL}/`,
    description: 'Live cryptocurrency prices, market caps, and Clarity transparency ratings. Ecosystem tokens (VKBT, CURE) with first-party on-chain data.',
    body,
  });
}

// ── Coin page (one template → every token) ──────────────────────────────────
async function coinPage(id) {
  const c = await getCoin(id).catch(() => null);
  if (!c) {
    // "did you mean" — suggest close matches from the markets set by symbol/name substring.
    const [ours, top] = await Promise.all([ourCoins().catch(() => []), topCoins({ limit: PER_PAGE }).catch(() => [])]);
    const q = id.toLowerCase().replace(/^hive-engine:/, '');
    const pre = q.slice(0, 3);
    const hits = [...ours, ...top].filter((x) => {
      const hay = `${x.id} ${x.symbol} ${x.name}`.toLowerCase();
      return hay.includes(q) || (pre.length >= 2 && (x.symbol.toLowerCase().startsWith(pre) || x.name.toLowerCase().startsWith(pre) || x.id.startsWith(pre)));
    }).slice(0, 6);
    const sugg = hits.length ? `<p>Did you mean: ${hits.map((x) => `<a class=coin href="/coins/${esc(x.id)}">${esc(x.symbol)}</a>`).join(' · ')}?</p>` : '';
    return { code: 404, html: layout({ title: 'Not found', body: card('Not found', `<p class=muted>No coin "${esc(id)}".</p>${sugg}<p class=muted><a href="/">← markets</a></p>`) }) };
  }
  const ov = overrideFor(id);
  const isHE = c.source === 'hive-engine' || c.source_tier === 2;
  // find official forum threads only when CoinGecko doesn't already give one (our HE tokens, etc.).
  const needThreads = !c.official?.forum;
  const [series, clarity, extras, related, tickers, threads] = await Promise.all([
    coinChart(id, { symbol: c.symbol || '' }).catch(() => []),
    clarityFromCoin(c).catch(() => null),
    isHE ? hiveEngineExtras(c.symbol).catch(() => null) : Promise.resolve(null),
    relatedCoins(c).catch(() => []),
    coinTickers(id).catch(() => []),
    needThreads ? officialThreads(c.name, c.symbol).catch(() => []) : Promise.resolve([]),
  ]);
  // enrich Tier-1 coins lacking team data with CoinPaprika's People (best-effort, cached).
  if (!isHE && !(c.team || []).length) {
    c.team = await cached(`team:${id}`, TTL.metadata, () => fetchTeam(id)).catch(() => []);
  }
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
    ${priceChart(series, id, CHART_RANGES, c.symbol || '')}
    ${marketStats(c.market)}
    ${supplyBar(c.supply)}
    ${extras ? holdersPanel(extras.holders) : ''}
    ${extras ? depthPanel(extras) : ''}
    ${clarityCard(clarity)}
    ${card('Contracts', contracts)}
    ${team ? card('Team', team) : ''}
    ${tickers.length ? card('Where to trade', `<table><thead><tr><th style="text-align:left">Exchange</th><th style="text-align:left">Pair</th><th>Price</th><th>Volume</th><th>Trust</th></tr></thead><tbody>${tickers.map((t) => `<tr>
      <td style="text-align:left">${t.url ? `<a href="${esc(t.url)}">${esc(t.exchange)}</a>` : esc(t.exchange)}</td>
      <td style="text-align:left" class=muted>${esc(t.pair)}</td><td>${usd(t.price_usd)}</td><td>${compactUsd(t.volume_usd)}</td>
      <td>${t.trust ? `<span class="clarity c-${t.trust === 'green' ? 'high' : t.trust === 'yellow' ? 'moderate' : 'limited'}">${esc(t.trust)}</span>` : '—'}</td></tr>`).join('')}</tbody></table>
      <p class=muted style="font-size:12px;margin-top:6px">Verified against the market fact-checker — confirms the coin is actually listed where shown.</p>`) : ''}
    ${links ? card('Links', links) : ''}
    ${(() => {
      const o = c.official || {};
      const rows = [
        o.whitepaper && `<a href="${esc(o.whitepaper)}">📄 Whitepaper</a>`,
        o.forum && `<a href="${esc(o.forum)}">💬 Official thread${/bitcointalk/i.test(o.forum) ? ' (Bitcointalk)' : ''}</a>`,
        ...(threads || []).map((t) => `<a href="${esc(t.url)}">💬 ${esc(t.forum)} thread</a>`),
        o.announcement && `<a href="${esc(o.announcement)}">📢 Announcement</a>`,
        o.reddit && `<a href="${esc(o.reddit)}">Reddit</a>`,
        ...(o.repos || []).map((r) => `<a href="${esc(r)}">GitHub</a>`),
        ...(o.chats || []).map((ch) => `<a href="${esc(ch)}">Chat</a>`),
      ].filter(Boolean);
      return rows.length ? card('Official & community', `<div style="display:flex;flex-wrap:wrap;gap:14px">${rows.join('')}</div><p class=muted style="font-size:12px;margin-top:8px">Official project links — verified by the market fact-checker before they appear.</p>`) : '';
    })()}
    ${card('', `<p class=muted>📚 New to this? Read <a href="/learn/what-gives-a-token-value">what gives a token value</a> and <a href="/learn/recognizing-scam-patterns">how to spot scam patterns</a> — or browse the <a href="https://wiki.soapbox.community">Library of Ashurbanipal</a>.</p>`)}
    ${converter(c)}
    ${relatedPanel(related)}
    ${comments}`;

  const jsonld = {
    '@context': 'https://schema.org', '@type': 'FinancialProduct', name: c.name,
    description: `${c.name} (${c.symbol}) live price, supply, and Clarity transparency rating on SoapBox.`,
    url: `${BASE_URL}/coins/${c.id}`,
  };
  return { code: 200, html: layout({ title: `${c.name} (${c.symbol})`, active: '/', canonical: `${BASE_URL}/coins/${c.id}`, description: `${c.name} live price ${usd(c.price_usd)}, market cap ${compactUsd(c.market_cap_usd)}, and Clarity transparency rating.`, jsonld, body, coinId: c.id, ogImage: `${BASE_URL}/og/${encodeURIComponent(c.id)}.svg` }) };
}

// ── Static-ish pages, rendered through the same layout ──────────────────────
async function dappsPage() {
  const cats = [...new Set(DAPPS.map((d) => d.category))];
  const [llama, fresh] = await Promise.all([
    topProtocols({ limit: 15 }).catch(() => []),
    cached('newpools', TTL.list, () => newPools({ limit: 12 })).catch(() => []),
  ]);
  const freshRows = fresh.map((p) => `<tr><td style="text-align:left"><b>${esc(p.name)}</b> <span class=badge>${esc(p.network)}</span></td>
    <td>${p.price ? usd(p.price) : '—'}</td><td>${compactUsd(p.fdv)}</td><td>${compactUsd(p.vol24)}</td></tr>`).join('');
  const llamaRows = llama.map((p, i) => `<tr>
    <td>${i + 1}</td><td style="text-align:left"><b>${esc(p.name)}</b> <span class=badge>${esc(p.chain)}</span></td>
    <td class=muted>${esc(p.category)}</td><td>${compactUsd(p.tvl)}</td><td>${pct(p.change_1d)}</td></tr>`).join('');
  const body = `<h1>dApp Directory</h1><p class=muted>Our ecosystem apps, plus the live DeFi landscape by TVL. One page per app, same factory.</p>
    ${cats.map((cat) => `<div class=card><h2>${esc(cat)}</h2>${DAPPS.filter((d) => d.category === cat).map((d) =>
      `<div style="padding:6px 0;border-bottom:1px solid var(--line)"><b>${d.url ? `<a href="${esc(d.url)}">${esc(d.name)}</a>` : esc(d.name)}</b>
       <span class=badge>${esc(d.chain)}</span> <span class="clarity c-${d.status === 'live' ? 'high' : d.status === 'in progress' ? 'moderate' : 'unknown'}">${esc(d.status)}</span>
       <div class=muted>${esc(d.blurb)}</div></div>`).join('')}</div>`).join('')}
    ${llamaRows ? `<div class=card><h2>Top DeFi protocols by TVL <span class=muted style="font-weight:400">· live via DeFiLlama</span></h2>
      <table><thead><tr><th>#</th><th style="text-align:left">Protocol</th><th style="text-align:left">Category</th><th>TVL</th><th>24h</th></tr></thead><tbody>${llamaRows}</tbody></table></div>` : ''}
    ${freshRows ? `<div class=card><h2>New on DEX <span class=muted style="font-weight:400">· just-listed pools via GeckoTerminal</span></h2>
      <table><thead><tr><th style="text-align:left">Pool</th><th>Price</th><th>FDV</th><th>24h vol</th></tr></thead><tbody>${freshRows}</tbody></table>
      <p class=muted style="font-size:12px">Brand-new pools — unvetted by design. Low Clarity until they earn it. DYOR.</p></div>` : ''}`;
  return layout({ title: 'dApps', active: '/dapps', canonical: `${BASE_URL}/dapps`, description: 'SoapBox dApp directory — ecosystem apps + the live DeFi landscape by TVL (DeFiLlama).', body });
}

async function categoriesPage() {
  const cats = await categories({ limit: 40 }).catch(() => []);
  const rows = cats.map((c, i) => `<tr><td>${i + 1}</td><td style="text-align:left"><b>${esc(c.name)}</b></td>
    <td>${compactUsd(c.market_cap)}</td><td>${pct(c.change_24h)}</td><td>${compactUsd(c.volume_24h)}</td></tr>`).join('');
  const body = `<h1>Categories</h1><p class=muted>Crypto sectors by market cap — L1s, DeFi, memes, and more.</p>
    <table><thead><tr><th>#</th><th style="text-align:left">Category</th><th>Market cap</th><th>24h</th><th>Volume</th></tr></thead><tbody>${rows}</tbody></table>`;
  return layout({ title: 'Categories', active: '/categories', canonical: `${BASE_URL}/categories`, description: 'Crypto categories by market cap — L1, DeFi, memes, and more.', body });
}

async function exchangesPage() {
  const ex = await exchanges({ limit: 30 }).catch(() => []);
  const rows = ex.map((e, i) => `<tr><td>${i + 1}</td><td style="text-align:left"><b>${esc(e.name)}</b> <span class=muted>${esc(e.country)}</span></td>
    <td>${e.trust != null ? `<span class="clarity c-${e.trust >= 8 ? 'high' : e.trust >= 5 ? 'moderate' : 'limited'}">${e.trust}/10</span>` : '—'}</td>
    <td>${e.volume_btc ? '₿' + Math.round(e.volume_btc).toLocaleString() : '—'}</td><td class=muted>${e.year || ''}</td></tr>`).join('');
  const body = `<h1>Exchanges</h1><p class=muted>Top venues by 24h volume and trust score.</p>
    <table><thead><tr><th>#</th><th style="text-align:left">Exchange</th><th>Trust</th><th>24h vol (BTC)</th><th>Est.</th></tr></thead><tbody>${rows}</tbody></table>`;
  return layout({ title: 'Exchanges', active: '/exchanges', canonical: `${BASE_URL}/exchanges`, description: 'Top crypto exchanges by volume and trust score.', body });
}

async function chainsPage() {
  const tvlChains = await chainsTVL({ limit: 30 }).catch(() => []);
  const [stables, prices, mcaps] = await Promise.all([
    stablecoins({ limit: 12 }).catch(() => []),
    nativePrices().catch(() => ({})),
    marketCapsByIds(tvlChains.map((c) => c.gecko_id)).catch(() => ({})),
  ]);
  const chains = tvlChains;
  const crows = chains.map((c, i) => {
    const px = c.gecko_id ? prices[c.gecko_id]?.usd : null;
    const mc = c.gecko_id ? mcaps[c.gecko_id]?.market_cap : null;
    return `<tr><td>${i + 1}</td><td style="text-align:left"><b>${esc(c.name)}</b> ${c.symbol ? `<span class=muted>${esc(c.symbol)}</span>` : ''}</td><td>${px != null ? usd(px) : '—'}</td><td>${mc ? compactUsd(mc) : '—'}</td><td>${compactUsd(c.tvl)}</td></tr>`;
  }).join('');
  const srows = stables.map((s) => `<tr><td style="text-align:left"><b>${esc(s.symbol)}</b> <span class=muted>${esc(s.name)}</span></td>
    <td>${compactUsd(s.circulating)}</td><td>${s.peg_off != null ? pct(s.peg_off) : '—'}</td><td class=muted>${esc(s.mechanism)}</td></tr>`).join('');
  const body = `<h1>Chains</h1><p class=muted>Multi-chain overview. <b>Market cap</b> = native coin price × circulating supply (the coin's total worth). <b>TVL</b> = value of assets locked in that chain's DeFi contracts (DeFiLlama) — a different measure of on-chain activity.</p>
    <table><thead><tr><th>#</th><th style="text-align:left">Chain</th><th>Native price</th><th>Market cap</th><th>TVL</th></tr></thead><tbody>${crows}</tbody></table>
    ${srows ? `<div class=card><h2>Stablecoins <span class=muted style="font-weight:400">· peg deviation</span></h2>
      <table><thead><tr><th style="text-align:left">Coin</th><th>Circulating</th><th>Peg</th><th style="text-align:left">Mechanism</th></tr></thead><tbody>${srows}</tbody></table></div>` : ''}`;
  return layout({ title: 'Chains', active: '/chains', canonical: `${BASE_URL}/chains`, description: 'Multi-chain TVL overview + stablecoin peg monitor.', body });
}

// best-effort news/research for a stock page — pulled by the scraper (operator: "get it from Google and
// other news articles bots are looking for"). Cached so the page stays fast; falls back to research links.
async function stockNews(name) {
  return memo(`stk:news:${name.toLowerCase()}`, MEMO_TTL.clarity, async () => {
    try { return await scraperSearch(`${name} stock news`, { provider: 'duckduckgo', limit: 6 }); } catch { return []; }
  });
}

async function stockPage(symbol) {
  const sym = String(symbol).toUpperCase();
  const [q, series] = await Promise.all([stockQuote(sym).catch(() => null), stockChart(sym, '7d').catch(() => [])]);
  if (!q) return { code: 404, html: layout({ title: sym, robots: 'noindex', body: `<h1>${esc(sym)}</h1><p class=muted>No market data found for this symbol. Try the <a href="/">Global Markets</a> search.</p>` }) };
  const news = await stockNews(q.name).catch(() => []);
  const stat = (k, v) => v == null ? '' : `<div class=stat><div class=k>${esc(k)}</div><div class=v>${v}</div></div>`;
  const research = [
    ['Yahoo Finance', `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}`],
    ['Google Finance', `https://www.google.com/finance/quote/${encodeURIComponent(sym)}`],
    ['Google News', `https://news.google.com/search?q=${encodeURIComponent(q.name + ' stock')}`],
    ['MarketWatch', `https://www.marketwatch.com/investing/stock/${encodeURIComponent(sym.toLowerCase())}`],
    ['SEC EDGAR', `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&company=${encodeURIComponent(q.name)}&type=10-K`],
  ];
  const newsHtml = news.length ? `<div class=card><h2>Latest news &amp; research</h2>${news.map((n) => `<div style="padding:7px 0;border-bottom:1px solid var(--line)"><a href="${esc(n.url)}" rel="noopener" target=_blank>${esc(n.title)}</a>${n.snippet ? `<div class=muted style="font-size:13px">${esc(n.snippet)}</div>` : ''}</div>`).join('')}<p class=muted style="font-size:11px;margin-top:8px">Aggregated via web search — verify with primary sources.</p></div>` : '';
  const body = `<div data-stock="${esc(sym)}">
    <h1>${esc(q.name)} <span class=muted style="font-size:18px">${esc(sym)}</span></h1>
    <div class=muted>${esc(q.typeLabel || 'Stock')} · ${esc(q.exchange)} · <a href="/">← Global Markets</a></div>
    <div class=price style="margin:8px 0">${usd(q.price)} <span style="font-size:16px">${pct(q.change)}</span> <span class=muted style="font-size:13px">${esc(q.currency)}</span></div>
    ${priceChart(series, `stock:${sym}`, CHART_RANGES, '')}
    <div class=card><h2>Key stats</h2><div class=grid>
      ${stat('Day range', q.dayLow && q.dayHigh ? `${usd(q.dayLow)} – ${usd(q.dayHigh)}` : null)}
      ${stat('52-week range', q.fiftyTwoLow && q.fiftyTwoHigh ? `${usd(q.fiftyTwoLow)} – ${usd(q.fiftyTwoHigh)}` : null)}
      ${stat('Volume', q.volume ? (+q.volume).toLocaleString() : null)}
      ${stat('Exchange', q.exchange)}
    </div></div>
    ${newsHtml}
    <div class=card><h2>Research</h2><div class=muted style="font-size:13px">${research.map(([n, u]) => `<a href="${esc(u)}" rel="noopener" target=_blank>${esc(n)}</a>`).join(' · ')}</div>
      <p class=muted style="font-size:11px;margin-top:8px">Stock data via Yahoo Finance (keyless). Informational only — not investment advice.</p></div>
    </div>`;
  return { code: 200, html: layout({ title: `${q.name} (${sym})`, active: '', canonical: `${BASE_URL}/stocks/${sym}`, description: `${q.name} (${sym}) stock price, chart, key stats, and latest news on SoapBox Data.`, body }) };
}

// a small block of "where to enter this market" links (brokers / dealers / ETFs).
const entryBlock = (cat) => {
  const eps = ENTRY_POINTS[cat];
  if (!eps) return '';
  return `<div class=muted style="font-size:12px;margin-top:6px">Where to enter: ${eps.map(([n, u, note]) => `<a href="${esc(u)}" rel="nofollow noopener" target=_blank title="${esc(note || '')}">${esc(n)}</a>`).join(' · ')}</div>`;
};

async function macroPage() {
  const m = await macro().catch(() => ({}));
  const fmt = (r) => r.kind === 'pct' ? `${(+r.price).toFixed(2)}%` : r.kind === 'fx' ? (+r.price).toFixed(4) : r.kind === 'index' ? (+r.price).toLocaleString(undefined, { maximumFractionDigits: 2 }) : usd(r.price);
  const sections = Object.entries(m).map(([cat, rows]) => rows.length ? `<div class=card><h2>${esc(cat)}</h2>
    <table><tbody>${rows.map((r) => `<tr><td style="text-align:left">${esc(r.label)}</td><td>${fmt(r)}</td><td>${pct(r.change)}</td></tr>`).join('')}</tbody></table>${entryBlock(cat)}</div>` : '').join('');
  const body = `<h1>Macro Markets</h1>
    <p class=muted>Traditional-market data people watch before going into a market — metals, US + global stock indexes, rates &amp; yields, energy, volatility &amp; currency. Live via Yahoo Finance. Each block links the major <b>entry points</b> — brokers, dealers, and the headline ETF tickers. (Fed Funds target: add a free FRED key; the US 10Y yield is the live rate proxy.)</p>
    <p class=muted style="font-size:13px">Tracking physical goods (coffee, grain, metals, oil) and where to buy them? See <a href="/commodities">Commodities →</a></p>
    ${sections || '<p class=muted>Macro data temporarily unavailable.</p>'}`;
  return layout({ title: 'Macro Markets', active: '/macro', canonical: `${BASE_URL}/macro`, description: 'Gold, silver, Dow, S&P 500, Nasdaq, global indexes, Treasury yields, oil, VIX — live traditional-market data, with the major entry points for each market.', body });
}

async function forexPage() {
  const f = await forex().catch(() => ({}));
  const fmt = (r) => r.kind === 'index' ? (+r.price).toLocaleString(undefined, { maximumFractionDigits: 2 }) : (+r.price).toFixed(r.price >= 50 ? 2 : 4);
  const sections = Object.entries(f).map(([cat, rows]) => rows.length ? `<div class=card><h2>${esc(cat)}</h2>
    <table><thead><tr><th style="text-align:left">Pair</th><th>Rate</th><th>24h</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><td style="text-align:left">${esc(r.label)}</td><td>${fmt(r)}</td><td>${pct(r.change)}</td></tr>`).join('')}</tbody></table>${entryBlock('Risk & Currency')}</div>` : '').join('');
  const body = `<h1>Foreign Exchange</h1>
    <p class=muted>Live currency rates — major pairs, crosses, USD vs emerging/Asia, and the US Dollar Index (DXY). A rate is how much of the quote currency one unit of the base buys (EUR/USD = dollars per euro). Live via Yahoo Finance.</p>
    <p class=muted style="font-size:13px">See also <a href="/macro">Macro Markets →</a> · <a href="/commodities">Commodities →</a></p>
    ${sections || '<p class=muted>Forex data temporarily unavailable.</p>'}`;
  return layout({ title: 'Foreign Exchange', active: '/forex', canonical: `${BASE_URL}/forex`, description: 'Live forex rates — EUR/USD, GBP/USD, USD/JPY, major pairs, crosses, emerging-market currencies, and the US Dollar Index.', body });
}

async function commoditiesPage() {
  const c = await commodities().catch(() => ({}));
  const sections = Object.entries(c).map(([cat, rows]) => {
    if (!rows.length) return '';
    const buy = WHERE_TO_BUY[cat] || [];
    const buyRow = buy.length ? `<div class=muted style="font-size:12px;margin-top:8px"><b>Where to buy:</b> ${buy.map(([n, u, note]) => `<a href="${esc(u)}" rel="nofollow noopener" target=_blank title="${esc(note || '')}">${esc(n)}</a>`).join(' · ')}</div>` : '';
    return `<div class=card><h2>${esc(cat)}</h2>
      <table><thead><tr><th style="text-align:left">Commodity</th><th>Price</th><th>Unit</th><th>24h</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td style="text-align:left">${esc(r.label)}</td><td>${(+r.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td><td class=muted style="font-size:12px">${esc(r.unit || '')}</td><td>${pct(r.change)}</td></tr>`).join('')}</tbody></table>${buyRow}</div>`;
  }).join('');
  // basic raw resources without a live futures ticker — indicative price + HS code + where to buy.
  const sourced = Object.entries(SOURCED_GOODS).map(([cat, rows]) => {
    const buy = WHERE_TO_BUY[cat] || [];
    const buyRow = buy.length ? `<div class=muted style="font-size:12px;margin-top:8px"><b>Where to buy:</b> ${buy.map(([n, u, note]) => `<a href="${esc(u)}" rel="nofollow noopener" target=_blank title="${esc(note || '')}">${esc(n)}</a>`).join(' · ')}</div>` : '';
    return `<div class=card><h2>${esc(cat)}</h2>
      <table><thead><tr><th style="text-align:left">Item</th><th>Indicative price</th><th title="Harmonized System code — used for customs duty + VAT lookup">HS code</th></tr></thead>
      <tbody>${rows.map((r) => `<tr><td style="text-align:left">${esc(r.name)}</td><td>${esc(r.typical)}</td><td class=muted style="font-size:12px"><a href="https://hts.usitc.gov/?query=${encodeURIComponent(r.hs)}" rel="nofollow noopener" target=_blank title="Look up the duty rate for HS ${esc(r.hs)}">${esc(r.hs)}</a></td></tr>`).join('')}</tbody></table>${buyRow}</div>`;
  }).join('');
  // the taxes / VAT / tariffs primer — what you pay before you even find a seller.
  const taxCard = `<div class=card><h2>💸 Before you order: taxes, VAT &amp; tariffs</h2>
    <p class=muted style="font-size:13px">The sticker price is rarely the final cost. Your real <b>landed cost</b> is:
      <code style="background:var(--panel);padding:2px 6px;border-radius:4px">unit price + freight + import duty + import VAT + customs/brokerage</code>.
      Duty and VAT depend on the product's <b>HS code</b> and the <b>importing country</b> — look them up before you commit:</p>
    <ul style="margin:6px 0 10px;padding-left:18px;line-height:1.9">
      <li><b>Import duty / tariff</b> — a % of value set per HS code by the destination country (e.g. textiles often 8–32%; raw fibers and many industrial inputs are lower or duty-free under trade agreements).</li>
      <li><b>Import VAT / GST</b> — charged on (value + duty) in most of the world: EU ~17–27%, UK 20%, many others 5–18%. <b>The US has no VAT</b> — but does charge tariffs + a small merchandise-processing fee.</li>
      <li><b>Rules of origin / FTAs</b> — goods from a free-trade partner can qualify for reduced or zero duty with the right certificate.</li>
      <li><b>China export VAT rebates</b> — some goods are cheaper ex-China because export VAT is rebated to the seller; ask suppliers for the FOB vs landed breakdown.</li>
    </ul>
    <div class=muted style="font-size:12px"><b>Look it up:</b> ${DUTY_TOOLS.map(([n, u, note]) => `<a href="${esc(u)}" rel="nofollow noopener" target=_blank title="${esc(note || '')}">${esc(n)}</a>`).join(' · ')}</div>
    <p class=muted style="font-size:11px;margin-top:8px">Indicative ranges and duty notes are for orientation only — confirm current rates with the official tools above and your customs broker.</p></div>`;
  const body = `<h1>Commodities</h1>
    <p class=muted>Live prices for the things people actually buy — grains, softs (coffee, sugar, cocoa), livestock, metals, and energy — plus basic raw resources (hemp, textiles, gemstones, industrial inputs) — with <b>where to source them</b> and <b>what it really costs to import</b> (taxes, VAT &amp; tariffs). Futures price is the honest reference (shown with its unit); links go to bulk B2B marketplaces (Alibaba, IndiaMART) for physical goods, and bullion dealers for metals (some accept crypto). Live via Yahoo Finance. Outbound links — do your own research.</p>
    <p class=muted style="font-size:13px">Looking for stock indexes, yields, and FX instead? See <a href="/macro">Macro Markets →</a> · Curated sourcing &amp; dealer links live in the <a href="/directory">Directory →</a></p>
    ${taxCard}
    <h2 style="margin:22px 0 4px">Exchange-traded (live futures price)</h2>
    ${sections || '<p class=muted>Commodity data temporarily unavailable.</p>'}
    <h2 style="margin:22px 0 4px">Basic resources &amp; textiles <span class=muted style="font-size:13px;font-weight:400">· indicative price + HS code for duty lookup</span></h2>
    ${sourced}`;
  return layout({ title: 'Commodities — prices + where to buy', active: '/commodities', canonical: `${BASE_URL}/commodities`, description: 'Live commodity prices — coffee, wheat, corn, sugar, gold, silver, oil — and where to buy them in bulk (Alibaba, IndiaMART, bullion dealers).', body });
}

// Private traffic dashboard. Gated by STATS_TOKEN (?token=…). First-party, no third-party tracker.
function statsPage(token = '') {
  let s; try { s = trafficSummary(); } catch (e) { s = null; }
  const seoLink = token ? `<p class=muted style="font-size:13px">See also: <a href="/seo?token=${encodeURIComponent(token)}">SEO audit →</a></p>` : '';
  if (!s || !s.total) return layout({ title: 'Traffic', active: '', canonical: `${BASE_URL}/stats`, robots: 'noindex,nofollow', body: `<h1>Traffic</h1><p class=muted>No access logs found yet (looked in ${esc(process.env.CADDY_LOG_DIR || '/var/log/caddy')}). Once Caddy access logging is on for a subdomain, numbers appear here.</p>` });
  const bar = (rows, fmt = (k) => k) => `<table><tbody>${rows.map(([k, v]) => `<tr><td style="text-align:left">${fmt(esc(String(k)))}</td><td>${v.toLocaleString()}</td></tr>`).join('')}</tbody></table>`;
  const body = `<h1>Traffic <span class=muted style="font-size:14px">· first-party, privacy-safe</span></h1>
    <p class=muted>From Caddy's own access logs on the server — no cookies, no third-party tracker, no stored IPs. Sources: ${esc(s.files.join(', '))}.</p>${seoLink}
    <div class=card><h2>Overview</h2><table><tbody>
      <tr><td style="text-align:left">Total requests</td><td>${s.total.toLocaleString()}</td></tr>
      <tr><td style="text-align:left">Human pageviews</td><td>${s.human.toLocaleString()}</td></tr>
      <tr><td style="text-align:left">Unique visitors</td><td>${s.uniqueVisitors.toLocaleString()}</td></tr>
      <tr><td style="text-align:left">Crawlers / bots</td><td>${s.bot.toLocaleString()} (${s.uniqueBots} sources)</td></tr>
      <tr><td style="text-align:left">404s (not found)</td><td>${s.notFound.toLocaleString()}</td></tr>
    </tbody></table></div>
    <div class=card><h2>Top pages</h2>${bar(s.topPages)}</div>
    <div class=card><h2>By subdomain</h2>${bar(s.byHost)}</div>
    <div class=card><h2>By status</h2>${bar(s.byStatus)}</div>
    ${s.topReferrers.length ? `<div class=card><h2>Referrers</h2>${bar(s.topReferrers)}</div>` : ''}
    ${s.topBots.length ? `<div class=card><h2>Crawlers</h2>${bar(s.topBots)}</div>` : ''}
    ${s.byDay.length > 1 ? `<div class=card><h2>By day</h2>${bar(s.byDay)}</div>` : ''}`;
  return layout({ title: 'Traffic', active: '', canonical: `${BASE_URL}/stats`, robots: 'noindex,nofollow', body });
}

// Gated SEO dashboard — runs the technical-SEO audit over our core pages. Cached 10 min (it fetches).
let _seoCache = { t: 0, html: '' };
async function seoPage() {
  const now = Date.now();
  if (_seoCache.html && now - _seoCache.t < 600000) return _seoCache.html;
  const paths = ['/', '/commodities', '/macro', '/directory', '/ecosystem', '/learn'];
  let r; try { r = await auditSite(BASE_URL, paths); } catch (e) { r = null; }
  if (!r) return layout({ title: 'SEO', active: '', robots: 'noindex,nofollow', body: '<h1>SEO</h1><p class=muted>Audit unavailable.</p>' });
  const dot = (lvl) => lvl === 'ok' ? '<span style="color:var(--up)">●</span>' : lvl === 'warn' ? '<span style="color:var(--gold)">●</span>' : '<span style="color:var(--down)">●</span>';
  const sc = (n) => `<b style="color:${n >= 90 ? 'var(--up)' : n >= 70 ? 'var(--gold)' : 'var(--down)'}">${n}</b>`;
  const pages = r.pages.map((p) => `<div class=card><h2 style="margin:0 0 6px">${sc(p.score)}/100 · <a href="${esc(p.url)}">${esc(p.url.replace(BASE_URL, '') || '/')}</a></h2>
    <table><tbody>${p.checks.map((c) => `<tr><td style="width:18px">${dot(c.level)}</td><td style="text-align:left">${esc(c.msg)}</td></tr>`).join('')}</tbody></table></div>`).join('');
  const body = `<h1>SEO audit <span class=muted style="font-size:14px">· pre-search-engine technical checks</span></h1>
    <p class=muted>What a search engine checks before it ranks us — titles, descriptions, canonical, indexability, Open Graph, structured data, mobile, language, headings, links, alt text. Site average <b>${sc(r.summary.avgScore)}/100</b> across ${r.summary.pages} pages · ${r.summary.fails} fails · ${r.summary.warns} warnings. Cached 10 min.</p>
    <div class=card><h2>Site files</h2><table><tbody>${r.site.map((s) => `<tr><td style="width:18px">${dot(s.level)}</td><td style="text-align:left">${esc(s.msg)}</td></tr>`).join('')}</tbody></table></div>
    ${pages}`;
  _seoCache = { t: now, html: layout({ title: 'SEO audit', active: '', canonical: '', robots: 'noindex,nofollow', body }) };
  return _seoCache.html;
}

function directoryPage() {
  const body = `<h1>Crypto Resources Directory</h1>
    <p class=muted>A curated directory of useful crypto resources — data sites, forums, wallets, browser extensions, explorers, tools, security, faucets, and learning. Ecosystem items marked ⭐. Outbound links; do your own research.</p>
    ${DIRECTORY.map((g) => `<div class=card><h2>${esc(g.cat)}</h2>${g.note ? `<p class=muted style="font-size:12px">${esc(g.note)}</p>` : ''}
      ${g.items.map((it) => `<div style="padding:7px 0;border-bottom:1px solid var(--line)">
        <b><a href="${esc(it.url)}" rel="noopener">${esc(it.name)}</a></b>${it.ours ? ' <span class="badge ours">⭐ ecosystem</span>' : ''}
        <div class=muted>${esc(it.blurb)}</div></div>`).join('')}</div>`).join('')}`;
  return layout({ title: 'Directory', active: '/directory', canonical: `${BASE_URL}/directory`, description: 'A curated crypto resources directory — data sites, forums, wallets, extensions, explorers, tools, security, faucets, learning.', body });
}

function ecosystemPage() {
  const body = `<h1>Ecosystem</h1><p>${esc(ECOSYSTEM.intro)}</p>
    <div class=card><h2>Pillars</h2>${ECOSYSTEM.pillars.map((p) =>
      `<div style="padding:7px 0;border-bottom:1px solid var(--line)"><b><a href="/ecosystem/${esc(p.slug)}">${esc(p.name)}</a></b> <span class=badge>${esc(p.kind)}</span><div class=muted>${esc(p.role)}</div></div>`).join('')}</div>
    <div class=card><p class=gold>${esc(ECOSYSTEM.note)}</p></div>`;
  return layout({ title: 'Ecosystem', active: '/ecosystem', canonical: `${BASE_URL}/ecosystem`, description: ECOSYSTEM.intro.slice(0, 150), body });
}

function ecosystemPillar(slug) {
  const p = ECOSYSTEM.pillars.find((x) => x.slug === slug);
  if (!p) return { code: 404, html: layout({ title: 'Not found', active: '/ecosystem', body: card('Not found', `<p class=muted><a href="/ecosystem">← ecosystem</a></p>`) }) };
  const jsonld = { '@context': 'https://schema.org', '@type': 'Article', headline: p.name, description: p.role, url: `${BASE_URL}/ecosystem/${slug}` };
  const body = `<p class=muted><a href="/ecosystem">← ecosystem</a></p><h1>${esc(p.name)} <span class=badge>${esc(p.kind)}</span></h1>
    <p>${esc(p.role)}</p><div class=card><p>${esc(p.detail || '')}</p></div>`;
  return { code: 200, html: layout({ title: `${p.name} — Ecosystem`, active: '/ecosystem', canonical: `${BASE_URL}/ecosystem/${slug}`, description: p.role, jsonld, body }) };
}

// READ-ONLY portfolio: native balances for a pasted PUBLIC address across the EVM chains, priced.
// This is the PRANA wallet-connect slot in its safest form — no keys, no custody, no signing, never
// stores the address. One 0x address works across all EVM chains.
async function portfolioData(address) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return { error: 'paste a public EVM address (0x…)' };
  const evm = Object.entries(CHAINS).filter(([, v]) => v.kind === 'evm');
  const prices = await nativePrices().catch(() => ({}));
  const rows = await Promise.all(evm.map(async ([name, v]) => {
    const b = await chainBalance(name, address).catch(() => null);
    const bal = b?.balance || 0;
    const px = prices[v.cg]?.usd || 0;
    return { chain: name, balance: bal, usd: bal * px };
  }));
  const held = rows.filter((r) => r.balance > 0).sort((a, b) => b.usd - a.usd);
  return { address, total: held.reduce((a, r) => a + r.usd, 0), held };
}

function portfolioPage() {
  const body = `<h1>Portfolio</h1><p class=muted>Paste a <b>public</b> wallet address to see its native balances across chains. Read-only — no keys, nothing stored, nothing signed. The non-custodial on-ramp into the SoapBox suite.</p>
    <form method=get action=/portfolio style="margin:0 0 14px"><input class=search name=address placeholder="0x… (public EVM address)" value="" style="max-width:480px"> <button class=iconbtn>View</button></form>
    <div id=pf></div>
    <script>
      var qs=new URLSearchParams(location.search),addr=qs.get('address');
      if(addr){document.querySelector('input[name=address]').value=addr;
        var el=document.getElementById('pf');el.innerHTML='<p class=muted>Reading balances across chains…</p>';
        fetch('/api/portfolio?address='+encodeURIComponent(addr)).then(function(r){return r.json()}).then(function(d){
          if(d.error){el.innerHTML='<p class=down>'+d.error+'</p>';return}
          if(!d.held.length){el.innerHTML='<p class=muted>No native balances found on the supported EVM chains.</p>';return}
          el.innerHTML='<div class=card><div class=k style="color:var(--mut)">Total (native coins)</div><div class=price>$'+d.total.toLocaleString(undefined,{maximumFractionDigits:2})+'</div></div><table><thead><tr><th style="text-align:left">Chain</th><th>Balance</th><th>Value</th></tr></thead><tbody>'+d.held.map(function(r){return '<tr><td style="text-align:left">'+r.chain+'</td><td>'+r.balance.toLocaleString(undefined,{maximumFractionDigits:5})+'</td><td>$'+r.usd.toLocaleString(undefined,{maximumFractionDigits:2})+'</td></tr>'}).join('')+'</tbody></table>';
        }).catch(function(){el.innerHTML='<p class=down>Could not read balances right now.</p>'});}
    </script>`;
  return layout({ title: 'Portfolio', active: '/portfolio', canonical: `${BASE_URL}/portfolio`, description: 'Read-only multi-chain portfolio tracker — paste a public address, no custody.', body });
}

function watchlistPage() {
  // the watchlist lives in the browser (localStorage); this page renders it client-side from the
  // read API, so there's no server-side per-user state. Empty for a fresh visitor.
  const body = `<h1>★ Watchlist</h1><p class=muted>Your starred coins, kept in this browser. Star any coin on the markets list.</p>
    <div id=wl><p class=muted>Loading your watchlist…</p></div>
    <script>
      window.sbWlView=function(){
        var ids=[];try{ids=JSON.parse(localStorage.getItem('sb-wl')||'[]')}catch(e){}
        var el=document.getElementById('wl');
        if(!ids.length){el.innerHTML='<p class=muted>No coins yet. Go to <a href="/">markets</a> and tap a ☆.</p>';return}
        el.innerHTML='<p class=muted>'+ids.length+' coins…</p>';
        Promise.all(ids.map(function(id){return fetch('/api/coins/'+encodeURIComponent(id)).then(function(r){return r.ok?r.json():null}).catch(function(){return null})})).then(function(cs){
          var rows=cs.filter(Boolean).map(function(c){return '<tr><td><span class="star on" data-id="'+c.id+'" onclick="sbToggle(this,\\''+c.id+'\\')">★</span> <a class=coin href="/coins/'+c.id+'">'+c.name+' <span class=sym>'+c.symbol+'</span></a></td><td>$'+(+c.price_usd).toLocaleString(undefined,{maximumFractionDigits:6})+'</td><td class=muted>tier '+c.source_tier+'</td></tr>'}).join('');
          el.innerHTML=rows?'<table><thead><tr><th style="text-align:left">Coin</th><th>Price</th><th>Source</th></tr></thead><tbody>'+rows+'</tbody></table>':'<p class=muted>None found.</p>';
        });
      };sbWlView();
    </script>`;
  return layout({ title: 'Watchlist', active: '/watchlist', canonical: `${BASE_URL}/watchlist`, description: 'Your starred coins on SoapBox.', body });
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
  const urls = ['/', '/categories', '/chains', '/dapps', '/exchanges', '/macro', '/commodities', '/forex', '/directory', '/ecosystem', '/learn', '/portfolio', '/watchlist',
    ...Object.keys(LEARN).map((s) => `/learn/${s}`),
    ...ECOSYSTEM.pillars.map((p) => `/ecosystem/${p.slug}`),
    ...[...ours, ...top].map((c) => `/coins/${c.id}`)];
  const today = new Date().toISOString().slice(0, 10);
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    [...new Set(urls)].map((u) => `  <url><loc>${BASE_URL}${encodeURI(u)}</loc><lastmod>${today}</lastmod><changefreq>${u === '/' ? 'hourly' : u.startsWith('/coins/') ? 'daily' : 'weekly'}</changefreq><priority>${u === '/' ? '1.0' : u.startsWith('/coins/') ? '0.8' : '0.6'}</priority></url>`).join('\n') + `\n</urlset>`;
  return body;
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' }); res.end(JSON.stringify(obj)); };

const STARTED = process.hrtime.bigint();
function statusPage() {
  const c = cacheStats();
  const upMin = Number(process.hrtime.bigint() - STARTED) / 6e10;
  const sources = [
    ['Tier 1 — CoinGecko', 'primary market data'], ['Tier 1 — CoinPaprika', 'failover + team metadata'],
    ['Tier 1b — GeckoTerminal', 'on-chain / DEX'], ['Tier 2 — Hive-Engine', 'VKBT / CURE (first-party)'],
    ['Tier 3 — native nodes', 'MELEK / SOAP / PRANA (gated on RPC)'], ['DeFiLlama', 'TVL + stablecoins'],
    ['alternative.me', 'fear & greed'],
  ];
  const body = `<h1>Status</h1><p class=muted>Read-only operational view. One source of truth (the condenser); the site, Hathor, and the trade bots all read it.</p>
    <div class=card><h2>Cache</h2><div class=grid>
      <div class=stat><div class=k>Keys</div><div class=v>${c.keys}</div></div>
      <div class=stat><div class=k>Fresh</div><div class=v>${c.fresh}</div></div>
      <div class=stat><div class=k>Stale</div><div class=v>${c.stale}</div></div>
      <div class=stat><div class=k>In-flight</div><div class=v>${c.inflight}</div></div>
      <div class=stat><div class=k>Uptime</div><div class=v>${upMin.toFixed(1)}m</div></div>
    </div></div>
    <div class=card><h2>Data sources</h2>${sources.map(([n, d]) => `<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--line)"><b>${esc(n)}</b><span class=muted>${esc(d)}</span></div>`).join('')}</div>`;
  return layout({ title: 'Status', active: '', canonical: `${BASE_URL}/status`, description: 'SoapBox operational status — cache + data sources.', body });
}

// ── Router ──────────────────────────────────────────────────────────────────
const LOG = process.env.SOAPBOX_LOG === '1';
createServer(async (req, res) => {
  const t0 = LOG ? process.hrtime.bigint() : 0n;
  const url = new URL(req.url, BASE_URL);
  const p = url.pathname;
  if (LOG) res.on('finish', () => console.log(JSON.stringify({ m: req.method, p, s: res.statusCode, ms: Number(process.hrtime.bigint() - t0) / 1e6 })));
  try {
    // short public cache on HTML — pages are already condenser-cached; this lets a CDN/browser help.
    const send = (html, code = 200) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': code === 200 ? 'public, max-age=60' : 'no-store' }); res.end(html); };

    if (p === '/' || p === '/coins') return send(await listPage({ page: Math.max(1, +url.searchParams.get('page') || 1) }));
    if (p.startsWith('/coins/')) { const r = await coinPage(decodeURIComponent(p.slice(7))); return send(r.html, r.code); }
    if (p === '/dapps') return send(await dappsPage());
    if (p === '/categories') return send(await categoriesPage());
    if (p === '/exchanges') return send(await exchangesPage());
    if (p === '/chains') return send(await chainsPage());
    if (p.startsWith('/stocks/')) { const r = await stockPage(decodeURIComponent(p.slice(8))); return send(r.html, r.code); }
    if (p === '/macro') return send(await macroPage());
    if (p === '/commodities') return send(await commoditiesPage());
    if (p === '/forex') return send(await forexPage());
    if (p === '/stats') {
      // private dashboard: require STATS_TOKEN match (constant set in systemd env), else 404 (don't reveal it exists)
      const want = process.env.STATS_TOKEN;
      const got = url.searchParams.get('token') || '';
      if (!want || got !== want) return send('<h1>404</h1>', 404);
      return send(statsPage(got));
    }
    if (p === '/seo') {
      const want = process.env.STATS_TOKEN;
      if (!want || (url.searchParams.get('token') || '') !== want) return send('<h1>404</h1>', 404);
      return send(await seoPage());
    }
    if (p === '/directory') return send(directoryPage());
    if (p === '/ecosystem') return send(ecosystemPage());
    if (p.startsWith('/ecosystem/')) { const r = ecosystemPillar(decodeURIComponent(p.slice('/ecosystem/'.length))); return send(r.html, r.code); }
    if (p === '/watchlist') return send(watchlistPage());
    if (p === '/portfolio') return send(portfolioPage());
    if (p === '/api/portfolio') return json(res, 200, await portfolioData(url.searchParams.get('address') || '').catch((e) => ({ error: e.message })));
    if (p === '/learn') return send(learnIndex());
    if (p.startsWith('/learn/')) { const r = learnArticle(decodeURIComponent(p.slice(7))); return send(r.html, r.code); }

    // internal read API — Hathor + trade bots read the same schema the site renders
    if (p === '/api/global') return json(res, 200, await globalStats().catch(() => ({})));
    if (p === '/api/coins') {
      const [ours, top] = await Promise.all([ourCoins().catch(() => []), topCoins({ limit: PER_PAGE }).catch(() => [])]);
      return json(res, 200, { source: 'condenser', count: ours.length + top.length, ours, market: top });
    }
    if (p === '/api/chart') {
      const id = url.searchParams.get('id') || '';
      const range = url.searchParams.get('range') || '7d';
      const sym = url.searchParams.get('sym') || '';
      // "stock:SYMBOL" ids route to the Yahoo stock chart; everything else is crypto.
      const series = id.startsWith('stock:') ? await stockChart(id.slice(6), range).catch(() => []) : await coinChartRange(id, range, sym).catch(() => []);
      return json(res, 200, { id, range, series });
    }
    // unified markets search — crypto (CoinGecko) + stocks/ETFs/indices (Yahoo). Powers the home dropdown.
    if (p === '/api/markets-search') {
      const q = (url.searchParams.get('q') || '').trim();
      if (q.length < 1) return json(res, 200, { crypto: [], stocks: [] });
      const [stocks, cg] = await Promise.all([
        stockSearch(q, { limit: 6 }).catch(() => []),
        memo(`cg:search:${q.toLowerCase()}`, MEMO_TTL.list, async () => {
          const r = await fetch(`https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(7000) });
          return r.ok ? r.json() : {};
        }).catch(() => ({})),
      ]);
      const crypto = (cg.coins || []).slice(0, 6).map((c) => ({ id: c.id, name: c.name, symbol: (c.symbol || '').toUpperCase() }));
      return json(res, 200, { crypto, stocks });
    }
    if (p.startsWith('/api/coins/')) { const c = await getCoin(decodeURIComponent(p.slice(11))).catch(() => null); return c ? json(res, 200, c) : json(res, 404, { error: 'not found' }); }
    // the steemd query layer over HTTP — the same router Discord/Telegram/Hathor use. ?q=price+VKBT
    // proxy the Library search so data. and wiki. share one knowledge API (operator: connect the APIs)
    if (p === '/api/library') {
      const q = url.searchParams.get('q') || '';
      const wiki = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
      try { const r = await fetch(`${wiki}/api/search?q=${encodeURIComponent(q)}`, { signal: AbortSignal.timeout(8000) }); return json(res, 200, await r.json()); }
      catch (e) { return json(res, 502, { error: e.message }); }
    }
    if (p === '/api/steemd') {
      const { runCommand } = await import('../../integrations/soapbox/steemd.mjs');
      const r = await runCommand(url.searchParams.get('q') || 'help').catch((e) => ({ ok: false, text: e.message, data: null }));
      return json(res, r.ok ? 200 : 400, r);
    }

    if (p.startsWith('/og/') && p.endsWith('.svg')) {
      const cid = decodeURIComponent(p.slice('/og/'.length, -'.svg'.length));
      const c = await getCoin(cid).catch(() => null);
      if (!c) { res.writeHead(404); return res.end('not found'); }
      const clarity = await clarityFromCoin(c).catch(() => null);
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=300' });
      return res.end(ogSvg(c, clarity));
    }
    if (p === '/feed.xml') {
      const [trend, top] = await Promise.all([trending().catch(() => []), topCoins({ limit: PER_PAGE }).catch(() => [])]);
      const movers = [...top].filter((c) => Number.isFinite(c.change_24h)).sort((a, b) => Math.abs(b.change_24h) - Math.abs(a.change_24h)).slice(0, 10);
      const items = [
        ...trend.map((c) => ({ t: `Trending: ${c.name} (${c.symbol})`, l: `${BASE_URL}/coins/${c.id}`, d: `${c.name} is trending on SoapBox.` })),
        ...movers.map((c) => ({ t: `${c.symbol} ${c.change_24h >= 0 ? '▲' : '▼'} ${Math.abs(c.change_24h).toFixed(2)}% (24h)`, l: `${BASE_URL}/coins/${c.id}`, d: `${c.name} at ${usd(c.price_usd)}, ${c.change_24h.toFixed(2)}% over 24h.` })),
      ];
      const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>
        <title>SoapBox Data — trending &amp; movers</title><link>${BASE_URL}</link>
        <description>Trending coins and top 24h movers on SoapBox.</description>
        ${items.map((i) => `<item><title>${esc(i.t)}</title><link>${esc(i.l)}</link><guid isPermaLink="true">${esc(i.l)}</guid><description>${esc(i.d)}</description></item>`).join('')}
        </channel></rss>`;
      res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' }); return res.end(xml);
    }
    // Hathor's Announcements voice — a signed RSS feed an external automation (IFTTT/Zapier/Buffer)
    // broadcasts to Twitter/Reddit/etc. The HTML page is the human view; the .xml is the proxy source.
    if (p === '/announcements' || p === '/announcements.xml') {
      const items = listAnnouncements({ limit: 50 });
      if (p === '/announcements.xml') {
        const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>
          <title>Hathor — Announcements</title><link>${BASE_URL}/announcements</link>
          <description>Official posts from Hathor, the MELEK AI Witness. Each item is signed.</description>
          ${items.map((a) => `<item><title>${esc(a.title)}</title><link>${esc(a.link || `${BASE_URL}/announcements`)}</link>
            <guid isPermaLink="false">${esc(a.id)}</guid><pubDate>${esc(a.ts)}</pubDate>
            <description>${esc(asPost(a, { max: 1000 }))}</description></item>`).join('')}
          </channel></rss>`;
        res.writeHead(200, { 'content-type': 'application/rss+xml; charset=utf-8' }); return res.end(xml);
      }
      const body = `<h1>Announcements</h1><p class=muted>Official posts from Hathor, the MELEK AI Witness. Each is signed. <a href="/announcements.xml">RSS</a> — connect it to IFTTT/Zapier to broadcast to social.</p>
        ${items.map((a) => `<div class=card><h2>${esc(a.title)}</h2><p>${esc(a.body)}</p>
          <p class=muted style="font-size:12px">${esc(a.signed_by)} · ${esc(a.ts.slice(0, 16))} · sig <code>${esc(a.sig)}</code></p></div>`).join('') || '<p class=muted>No announcements yet.</p>'}`;
      return send(layout({ title: 'Announcements', active: '', canonical: `${BASE_URL}/announcements`, description: 'Official announcements from Hathor, the MELEK AI Witness.', body }));
    }
    if (p === '/sitemap.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(await sitemap()); }
    if (p === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (p === `/${INDEXNOW_KEY}.txt`) { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(INDEXNOW_KEY); }
    if (p === '/status') return send(statusPage());
    // favicon — served as a tiny SVG so the browser's implicit /favicon.ico request (and crawlers
    // that fetch it directly) stop 404ing. SVG favicons are widely supported; the .ico path just
    // carries SVG bytes. (#180)
    if (p === '/favicon.ico' || p === '/favicon.svg') {
      res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=604800' });
      return res.end(FAVICON_SVG);
    }
    if (p === '/health') { res.writeHead(200); return res.end('ok'); }

    return send(layout({ title: '404', body: card('404', '<p class=muted><a href="/">← markets</a></p>') }), 404);
  } catch (e) { res.writeHead(500); res.end('error: ' + e.message); }
}).listen(PORT, HOST, async () => {
  console.log(`SoapBox markets browser (page factory) on ${BASE_URL} (bound ${HOST}:${PORT})`);
  // welcome the crawlers: submit core URLs to IndexNow + ping Bing on boot (best-effort, public site).
  if (process.env.SOAPBOX_NO_CRAWL_PING !== '1' && BASE_URL.startsWith('https')) {
    const core = ['/', '/coins', '/categories', '/chains', '/dapps', '/exchanges', '/macro', '/commodities', '/forex', '/directory', '/ecosystem', '/learn', '/announcements'];
    submitToIndexNow(BASE_URL, core).then((r) => console.log('IndexNow:', JSON.stringify(r))).catch(() => {});
    pingSitemap(BASE_URL).then((r) => console.log('Bing sitemap ping:', JSON.stringify(r))).catch(() => {});
  }
});
