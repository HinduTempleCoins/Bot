// chyron.mjs — the SoapBox Data "Chiron": a curated, severity-ranked ticker of things people can
// ACT on, beyond raw price data. Keyless sources only. A hard curation cap keeps it from
// overcrowding — we show the BIGGEST things across each domain, not everything.
//
// Segments (each contributes a few items, then the whole set is severity-sorted + capped):
//   • crypto   — top mover + a headline                          (comms-parser + macro)
//   • macro    — DXY / gold / S&P moves                          (macro)
//   • disaster — major earthquakes (USGS M4.5+) + severe weather (NWS)
//   • global   — war + major world headlines                    (comms-parser world feeds)
// Plus: worldClocks() (8 financial capitals, rendered client-side from tz, no API) and
//       topCryptoNews(n) (ranked + day-rotating "5 biggest crypto stories").
//
//   import { chyronItems, topCryptoNews, worldClocks } from './chyron.mjs'
//   node integrations/soapbox/chyron.mjs            # print the live ticker

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

// ---- world clocks: 8 financial capitals (client renders the time from tz) ----
export const CLOCKS = [
  { city: 'New York', tz: 'America/New_York' },
  { city: 'London', tz: 'Europe/London' },
  { city: 'Frankfurt', tz: 'Europe/Berlin' },
  { city: 'Dubai', tz: 'Asia/Dubai' },
  { city: 'Mumbai', tz: 'Asia/Kolkata' },
  { city: 'Hong Kong', tz: 'Asia/Hong_Kong' },
  { city: 'Tokyo', tz: 'Asia/Tokyo' },
  { city: 'Sydney', tz: 'Australia/Sydney' },
];
export function worldClocks() { return CLOCKS; }

// ---- pure helpers (unit-tested offline) ----

// severity 0..100 → tier label (drives color + ordering)
export function severityTier(score) {
  return score >= 80 ? 'critical' : score >= 55 ? 'high' : score >= 30 ? 'med' : 'low';
}

// earthquake magnitude → severity. M4.5 ~ 30, M6 ~ 60, M7+ ~ 85+.
export function quakeScore(mag) {
  const m = +mag || 0;
  if (m < 4.5) return 0;
  return Math.max(0, Math.min(100, Math.round((m - 3) * 17)));
}

// |percent move| → severity for a market item (3% ~ 30, 8% ~ 80).
export function moveScore(pct) {
  return Math.max(0, Math.min(100, Math.round(Math.abs(+pct || 0) * 10)));
}

// dedup by normalized text, then sort by score desc, then cap. THIS is the anti-overcrowding rule.
export function curate(items, max = 14) {
  const seen = new Set();
  const out = [];
  for (const it of items.filter(Boolean).sort((a, b) => (b.score || 0) - (a.score || 0))) {
    const k = norm(it.text).slice(0, 60);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push({ ...it, tier: severityTier(it.score || 0) });
    if (out.length >= max) break;
  }
  return out;
}

// rank news by recency + source authority + impact keywords; rotate the window by dayKey so the
// "top 5" changes through the day even when the raw feed is slow to move.
const IMPACT = ['sec', 'etf', 'hack', 'exploit', 'ban', 'lawsuit', 'approve', 'crash', 'surge', 'halt', 'launch', 'fork', 'default'];
export function rankNews(items, { dayKey = 0, n = 5 } = {}) {
  const scored = (items || []).filter(Boolean).map((it, i) => {
    const t = norm(it.title || it.text);
    const impact = IMPACT.reduce((a, w) => a + (t.includes(w) ? 1 : 0), 0);
    const recency = it.ageHours != null ? Math.max(0, 24 - it.ageHours) : 6;
    const auth = it.authority || 1;
    return { ...it, _score: impact * 5 + recency + auth * 2 - i * 0.1 };
  }).sort((a, b) => b._score - a._score);
  if (scored.length <= n) return scored;
  // rotate the start offset by dayKey across the ranked list (keeps the strongest in view, varies the tail)
  const off = ((dayKey % scored.length) + scored.length) % scored.length;
  return [...scored.slice(off), ...scored.slice(0, off)].slice(0, n);
}

// ---- live data segments (keyless; each fails soft to []) ----

async function getJson(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// USGS earthquakes, M4.5+, past day
export async function earthquakes() {
  const j = await getJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson');
  const feats = (j && j.features) || [];
  return feats.map((f) => {
    const p = f.properties || {};
    const mag = p.mag;
    // data-loss-audit (#284): keep the structured USGS fields (mag/place/time/tsunami/coords) ADDITIVELY
    // so a map/alert consumer isn't stuck re-parsing the `text` headline. The chyron line is unchanged.
    const coords = Array.isArray(f.geometry?.coordinates) ? f.geometry.coordinates : null;
    return {
      kind: 'disaster', icon: '🌎',
      text: `M${(+mag).toFixed(1)} earthquake — ${p.place || 'unknown'}`,
      score: quakeScore(mag), url: p.url,
      mag: typeof mag === 'number' ? mag : null,
      place: p.place || null,
      time: typeof p.time === 'number' ? new Date(p.time).toISOString() : null,
      tsunami: p.tsunami === 1 || p.tsunami === true,
      lon: coords ? coords[0] : null, lat: coords ? coords[1] : null, depthKm: coords ? coords[2] : null,
    };
  }).filter((x) => x.score > 0);
}

// NWS active severe/extreme weather alerts (US, keyless)
export async function weatherAlerts() {
  const j = await getJson('https://api.weather.gov/alerts/active?severity=Severe,Extreme&status=actual&limit=20');
  const feats = (j && j.features) || [];
  const sevScore = (s) => (s === 'Extreme' ? 85 : s === 'Severe' ? 60 : 35);
  const seenEvent = new Set();
  const out = [];
  for (const f of feats) {
    const p = f.properties || {};
    const ev = p.event || 'Weather alert';
    if (seenEvent.has(ev)) continue; // collapse 100 county alerts into one headline per event type
    seenEvent.add(ev);
    // #284: keep the structured NWS fields (event/severity/area/effective/expires/headline) additively.
    out.push({
      kind: 'disaster', icon: '⛈️',
      text: `${ev} — ${p.areaDesc?.split(';')[0] || 'US'}`,
      score: sevScore(p.severity),
      event: ev,
      severity: p.severity || null,
      areaDesc: p.areaDesc || null,
      effective: p.effective || null,
      expires: p.expires || null,
      headline: p.headline || null,
    });
  }
  return out;
}

// headlines via the existing comms-parser (crypto + world/war)
async function headlines(asset, query = '') {
  try {
    const cp = await import('../comms-parser.mjs');
    const items = await cp.fetchHeadlines({ asset, query, limit: 30 });
    return (items || []).map((h) => ({ title: h.title, url: h.url, ageHours: h.ageHours, authority: h.authority || 1, source: h.source }));
  } catch { return []; }
}

// ReliefWeb — UN humanitarian disasters/crises feed (keyless). Newest "current/alert/ongoing"
// disasters; we headline one item per disaster type to avoid flooding (e.g. many floods → one line).
export async function reliefWeb() {
  const url = 'https://api.reliefweb.int/v1/disasters?appname=soapbox.community&profile=list&preset=latest&limit=20';
  const j = await getJson(url);
  const data = (j && j.data) || [];
  const sevScore = (status) => (status === 'alert' ? 75 : status === 'current' || status === 'ongoing' ? 55 : 35);
  const seenType = new Set();
  const out = [];
  for (const d of data) {
    const f = d.fields || {};
    const status = String(f.status || '').toLowerCase();
    if (status === 'past') continue; // only live crises
    const type = (f.type && f.type[0] && f.type[0].name) || 'Crisis';
    if (seenType.has(type)) continue; // collapse repeats of the same disaster type into one headline
    seenType.add(type);
    out.push({ kind: 'crisis', icon: '🆘', text: f.name || `${type} crisis`, severity: status || 'current', score: sevScore(status), url: f.url });
  }
  return out;
}

// GDELT — global news events, reused from comms-parser's GDELT-backed fetchHeadlines via defensive
// import (we don't duplicate the GDELT query/parse). Mapped to {kind:'world'} chyron items.
export async function gdeltWorld({ query = 'crisis OR disaster OR conflict OR outbreak', n = 3 } = {}) {
  const items = await headlines('', query);
  const ranked = rankNews(items, { n });
  return ranked.filter((h) => h.title).map((h) => ({ kind: 'world', icon: '🗞️', text: h.title, score: 48, url: h.url }));
}

// NASA EONET — natural events (wildfires, severe storms, volcanoes, etc.), keyless.
export async function eonetEvents({ n = 4 } = {}) {
  const j = await getJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=30');
  const events = (j && j.events) || [];
  const catScore = (cat) => {
    const c = String(cat || '').toLowerCase();
    if (c.includes('volcano')) return 78;
    if (c.includes('wildfire') || c.includes('fire')) return 62;
    if (c.includes('storm') || c.includes('cyclone')) return 70;
    if (c.includes('flood')) return 60;
    return 50;
  };
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const cat = (e.categories && e.categories[0] && e.categories[0].title) || 'Natural event';
    const title = e.title || cat;
    const k = title.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const url = (e.sources && e.sources[0] && e.sources[0].url) || (e.link) || null;
    out.push({ kind: 'natural', icon: '🌋', text: `${cat} — ${title}`, score: catScore(cat), url });
    if (out.length >= n) break;
  }
  return out;
}

// ---- public: the rotating "5 biggest crypto news stories" ----
export async function topCryptoNews({ n = 5, dayKey = Math.floor(Date.now() / 86400000) } = {}) {
  const items = await headlines('crypto');
  return rankNews(items, { dayKey, n });
}

// ---- public: the fused, capped ticker ----
export async function chyronItems({ max = 14 } = {}) {
  const out = [];

  // markets (crypto top mover + macro) — best-effort
  try {
    const macro = await import('./macro.mjs');
    const m = await macro.macro().catch(() => null);
    for (const row of (m?.indices || m?.metals || []).slice(0, 3)) {
      if (row && row.changePct != null) out.push({ kind: 'macro', icon: '📈', text: `${row.name || row.symbol} ${row.changePct >= 0 ? '▲' : '▼'} ${Math.abs(row.changePct).toFixed(2)}%`, score: moveScore(row.changePct) });
    }
  } catch { /* soft */ }

  // top crypto headline (single, strongest)
  const news = await headlines('crypto');
  const topNews = rankNews(news, { n: 1 });
  if (topNews[0]) out.push({ kind: 'crypto', icon: '🪙', text: topNews[0].title, url: topNews[0].url, score: 45 });

  // war + major global stories (one strongest headline)
  const world = await headlines('', 'war OR conflict OR election OR sanctions');
  const topWorld = rankNews(world, { n: 1 });
  if (topWorld[0]) out.push({ kind: 'global', icon: '🌐', text: topWorld[0].title, url: topWorld[0].url, score: 50 });

  // disasters
  out.push(...(await earthquakes()));
  out.push(...(await weatherAlerts()));

  // broader global coverage — humanitarian crises (ReliefWeb), world news events (GDELT),
  // and natural events (NASA EONET). Each fails soft to []; curate() caps + dedupes the union.
  out.push(...(await reliefWeb()));
  out.push(...(await gdeltWorld()));
  out.push(...(await eonetEvents()));

  return curate(out, max);
}

// ============================================================================
// Task #203 — cycling topic panels for the homepage ticker (ADDITIVE).
//
// The front-page ticker rotates through topic PANELS every ~4s client-side:
//   Top 5 Crypto, Top 5 Bitcoin, Top 5 ETH, Top 5 Altcoins, World, Markets.
// An algorithm (topFive) keeps each panel fresh: as items age their relevance
// decays and fresher/bigger items DISPLACE the stale ones out of the Top 5.
// Everything below is pure + deterministic (given `now`) or injectable, so it
// tests fully offline. Nothing above this line is modified.
// ============================================================================

// ordered topic panels the homepage cycles through
export const TOPICS = [
  { key: 'crypto', label: 'Top 5 Crypto' },
  { key: 'bitcoin', label: 'Top 5 Bitcoin' },
  { key: 'ethereum', label: 'Top 5 ETH' },
  { key: 'altcoins', label: 'Top 5 Altcoins' },
  { key: 'world', label: 'World' },
  { key: 'markets', label: 'Markets' },
];

// keyword maps for topic classification. Word-boundary matched on normalized text.
const BTC_WORDS = ['bitcoin', 'btc', 'satoshi', 'sats', 'lightning network', 'ordinals', 'taproot'];
const ETH_WORDS = ['ethereum', 'eth', 'ether', 'erc20', 'erc 20', 'vitalik', 'staking', 'l2', 'rollup', 'evm'];
// other coin tickers / names → altcoins
const ALT_WORDS = ['solana', 'sol', 'xrp', 'ripple', 'cardano', 'ada', 'dogecoin', 'doge', 'bnb', 'binance coin',
  'polkadot', 'dot', 'avalanche', 'avax', 'chainlink', 'link', 'litecoin', 'ltc', 'tron', 'trx', 'polygon',
  'matic', 'shiba', 'shib', 'altcoin', 'altcoins', 'memecoin', 'meme coin'];
// generic crypto signal
const CRYPTO_WORDS = ['crypto', 'cryptocurrency', 'blockchain', 'defi', 'stablecoin', 'usdt', 'usdc', 'tether',
  'nft', 'token', 'coinbase', 'binance', 'exchange', 'wallet', 'web3', 'on chain', 'onchain', 'mining', 'miner'];
// macro / equities → markets
const MARKET_WORDS = ['stocks', 'stock', 'equities', 'equity', 's p 500', 'sp500', 's p500', 'nasdaq', 'dow',
  'dxy', 'dollar', 'gold', 'oil', 'treasury', 'yields', 'yield', 'fed', 'rate hike', 'rate cut', 'inflation',
  'cpi', 'gdp', 'recession', 'bonds', 'bond', 'index'];
// world events → world
const WORLD_WORDS = ['earthquake', 'quake', 'war', 'conflict', 'weather', 'storm', 'cyclone', 'hurricane',
  'flood', 'wildfire', 'volcano', 'disaster', 'crisis', 'outbreak', 'sanctions', 'election', 'tsunami'];

// match: does normalized text `t` contain any of `words` as a token-ish substring?
function hasWord(t, words) {
  for (const w of words) {
    // normalized text is space-delimited a-z0-9; pad to enforce loose word boundaries
    if (` ${t} `.includes(` ${w} `) || t.includes(w)) return true;
  }
  return false;
}

// classifyTopic(item) → array of topic keys the item belongs to. Pure.
// BTC keywords → bitcoin; ETH → ethereum; other coin tickers → altcoins; any crypto → crypto;
// quake/war/weather → world; macro/stocks → markets. An item can match several panels.
export function classifyTopic(item) {
  const t = norm(item && (item.text || item.title));
  const k = String((item && item.kind) || '').toLowerCase();
  const topics = new Set();

  // kind-based hints from the existing feeds
  if (['disaster', 'crisis', 'world', 'global', 'natural'].includes(k)) topics.add('world');
  if (k === 'macro') topics.add('markets');
  if (k === 'crypto') topics.add('crypto');

  if (!t) return [...topics];

  const isBtc = hasWord(t, BTC_WORDS);
  const isEth = hasWord(t, ETH_WORDS);
  const isAlt = hasWord(t, ALT_WORDS);
  const isCrypto = hasWord(t, CRYPTO_WORDS);
  if (isBtc) { topics.add('bitcoin'); topics.add('crypto'); }
  if (isEth) { topics.add('ethereum'); topics.add('crypto'); }
  if (isAlt) { topics.add('altcoins'); topics.add('crypto'); }
  if (isCrypto) topics.add('crypto');

  if (hasWord(t, WORLD_WORDS)) topics.add('world');
  // markets only if it reads macro AND isn't already a crypto-coin story
  if (hasWord(t, MARKET_WORDS) && !(isBtc || isEth || isAlt)) topics.add('markets');

  return [...topics];
}

// source authority weight (0..1). Higher → more durable in the Top 5.
function sourceWeight(item) {
  const a = item && (item.authority != null ? item.authority : null);
  if (a != null) return Math.max(0, Math.min(1, +a / 3)); // comms-parser authority is ~1..3
  const w = item && item.sourceWeight;
  if (w != null) return Math.max(0, Math.min(1, +w));
  return 0.4; // unknown source → modest floor
}

// magnitude of "how big" an item is, 0..1 (severity for disasters, |move| for markets, impact words for news)
function magnitude(item) {
  if (!item) return 0;
  if (item.score != null) return Math.max(0, Math.min(1, +item.score / 100));
  if (item.changePct != null) return Math.max(0, Math.min(1, moveScore(item.changePct) / 100));
  return 0.3;
}

// age in hours for an item given `now` (ms). Prefers explicit ageHours, else ts/timestamp.
function ageHoursOf(item, now) {
  if (item && item.ageHours != null) return Math.max(0, +item.ageHours);
  const ts = item && (item.ts != null ? item.ts : item.timestamp);
  if (ts != null) return Math.max(0, (now - +ts) / 3600000);
  return 6; // unknown → assume a few hours old
}

// relevanceScore(item, {now}) → 0..1. Combines recency decay (half-life ~2h news / ~6h world),
// magnitude (severity/move/impact), and source weight. Pure + deterministic given `now`. THIS is
// what topFive ranks on, so aging items naturally fall and fresher/bigger ones rise.
export function relevanceScore(item, { now = Date.now() } = {}) {
  if (!item) return 0;
  const topics = classifyTopic(item);
  const isWorld = topics.includes('world') || ['disaster', 'crisis', 'world', 'global', 'natural'].includes(String(item.kind || '').toLowerCase());
  const halfLife = isWorld ? 6 : 2; // hours
  const age = ageHoursOf(item, now);
  const recency = Math.pow(0.5, age / halfLife); // 0..1, =1 fresh, halves each half-life
  const mag = magnitude(item);
  const src = sourceWeight(item);
  // weighted blend; recency dominates so the swap algorithm churns, magnitude + source temper it
  const score = 0.55 * recency + 0.30 * mag + 0.15 * src;
  return Math.max(0, Math.min(1, score));
}

// topFive(items, topic, {now}) → the current Top-5 for a topic, ranked by relevanceScore.
// THE swap algorithm: dedup by normalized text, keep only items classified into `topic`, sort by
// relevance (stable for ties), slice 5. As items age their relevanceScore decays and a fresher /
// higher-magnitude item that arrives will outrank and DISPLACE a stale one out of the five.
export function topFive(items, topic, { now = Date.now() } = {}) {
  const seen = new Set();
  const scored = [];
  (items || []).filter(Boolean).forEach((it, i) => {
    if (!classifyTopic(it).includes(topic)) return;
    const k = norm(it.text || it.title).slice(0, 60);
    if (!k || seen.has(k)) return; // dedup
    seen.add(k);
    scored.push({ it, i, rel: relevanceScore(it, { now }) });
  });
  // stable sort: relevance desc, ties broken by original index asc
  scored.sort((a, b) => (b.rel - a.rel) || (a.i - b.i));
  return scored.slice(0, 5).map((s) => ({ ...s.it, relevance: s.rel }));
}

// tickerPanels({now, fetchers}) → assemble all topic panels for the homepage.
// fetchers is injectable (offline tests pass stubs); defaults wire the existing internal feeds.
// Returns { panels:[{key,label,items:[≤5]}], clocks, generatedAt } — the single payload polled.
export async function tickerPanels({ now = Date.now(), fetchers = {} } = {}) {
  const F = {
    crypto: () => headlines('crypto'),
    world: async () => [
      ...(await earthquakes().catch(() => [])),
      ...(await weatherAlerts().catch(() => [])),
      ...(await reliefWeb().catch(() => [])),
      ...(await gdeltWorld().catch(() => [])),
      ...(await eonetEvents().catch(() => [])),
    ],
    markets: async () => {
      try {
        const macro = await import('./macro.mjs');
        const m = await macro.macro().catch(() => null);
        return (m?.indices || []).concat(m?.metals || []).filter(Boolean).map((row) => ({
          kind: 'macro', icon: '📈',
          text: `${row.name || row.symbol} ${row.changePct >= 0 ? '▲' : '▼'} ${Math.abs(+row.changePct || 0).toFixed(2)}%`,
          changePct: row.changePct, score: moveScore(row.changePct), ageHours: 0,
        }));
      } catch { return []; }
    },
    ...fetchers,
  };

  // gather raw items per source (soft-fail each)
  const cryptoItems = await Promise.resolve().then(F.crypto).catch(() => []) || [];
  const worldItems = await Promise.resolve().then(F.world).catch(() => []) || [];
  const marketItems = await Promise.resolve().then(F.markets).catch(() => []) || [];

  // normalize crypto headlines to a chyron-ish shape (they carry title/ageHours/authority)
  const cryptoNorm = cryptoItems.filter(Boolean).map((h) => ({
    kind: 'crypto', icon: '🪙', text: h.text || h.title, url: h.url,
    ageHours: h.ageHours, authority: h.authority, score: h.score,
  }));

  // pool everything; each panel pulls its own classified Top 5 (an item can appear in crypto + bitcoin etc.)
  const pool = [...cryptoNorm, ...worldItems, ...marketItems];

  const panels = TOPICS.map(({ key, label }) => {
    const source = key === 'world' ? [...worldItems, ...pool] : key === 'markets' ? [...marketItems, ...pool] : pool;
    return { key, label, items: topFive(source, key, { now }) };
  });

  return { panels, clocks: worldClocks(), generatedAt: now };
}

// ---- HTML rendering: self-contained escaped snippet the server embeds at the top of the page ----

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// renderTickerHTML(panels, {cycleMs}) → a slim bar with a world-clocks row + a rotating topic panel.
// Pure string; CSS + vanilla JS cycle panels every cycleMs (default 4000), pausing on hover.
// No external deps; all user-derived text is HTML-escaped.
export function renderTickerHTML(panels, { cycleMs = 4000 } = {}) {
  const list = Array.isArray(panels) ? panels : (panels && panels.panels) || [];
  const clocks = (panels && panels.clocks) || worldClocks();
  const ms = Math.max(500, Math.floor(+cycleMs || 4000));

  const clocksHtml = clocks.map((c) =>
    `<span class="sbx-clk" data-tz="${escapeHtml(c.tz)}"><b>${escapeHtml(c.city)}</b> <time>--:--</time></span>`
  ).join('');

  const panelsHtml = list.map((p, idx) => {
    const items = (p.items || []).slice(0, 5).map((it) => {
      const txt = escapeHtml(it.text || it.title || '');
      const inner = `<span class="sbx-itm">${it.url ? `<a href="${escapeHtml(it.url)}" rel="noopener noreferrer" target="_blank">${txt}</a>` : txt}</span>`;
      return inner;
    }).join('');
    return `<div class="sbx-panel${idx === 0 ? ' on' : ''}" data-i="${idx}"><b class="sbx-lbl">${escapeHtml(p.label || p.key)}</b>${items}</div>`;
  }).join('');

  return `<div class="sbx-ticker" id="sbx-ticker" aria-label="Data.SoapBox ticker">
<div class="sbx-clocks">${clocksHtml}</div>
<div class="sbx-panels">${panelsHtml}</div>
<style>
#sbx-ticker{font:13px/1.4 system-ui,Arial,sans-serif;background:#0b0e14;color:#e6edf3;border-bottom:1px solid #1f2630;overflow:hidden;white-space:nowrap}
#sbx-ticker .sbx-clocks{display:flex;gap:14px;padding:4px 10px;border-bottom:1px solid #161b22;opacity:.85;overflow-x:auto}
#sbx-ticker .sbx-clk b{color:#9aa7b4;font-weight:600;margin-right:3px}
#sbx-ticker .sbx-clk time{color:#58a6ff;font-variant-numeric:tabular-nums}
#sbx-ticker .sbx-panels{position:relative;padding:6px 10px;min-height:22px}
#sbx-ticker .sbx-panel{display:none;align-items:center;gap:12px}
#sbx-ticker .sbx-panel.on{display:flex}
#sbx-ticker .sbx-lbl{color:#f0883e;font-weight:700;margin-right:6px;flex:none}
#sbx-ticker .sbx-itm{color:#c9d1d9;flex:none}
#sbx-ticker .sbx-itm a{color:#c9d1d9;text-decoration:none}
#sbx-ticker .sbx-itm a:hover{text-decoration:underline}
</style>
<script>
(function(){
  var root=document.getElementById('sbx-ticker'); if(!root) return;
  var panels=root.querySelectorAll('.sbx-panel'); var cur=0; var paused=false;
  function show(i){ for(var j=0;j<panels.length;j++){ panels[j].className='sbx-panel'+(j===i?' on':''); } }
  function tick(){ if(paused||panels.length<2) return; cur=(cur+1)%panels.length; show(cur); }
  if(panels.length) setInterval(tick,${ms});
  root.addEventListener('mouseenter',function(){paused=true;});
  root.addEventListener('mouseleave',function(){paused=false;});
  function clocks(){ var els=root.querySelectorAll('.sbx-clk'); for(var k=0;k<els.length;k++){ var tz=els[k].getAttribute('data-tz'); var t=els[k].querySelector('time'); try{ t.textContent=new Date().toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',timeZone:tz}); }catch(e){} } }
  clocks(); setInterval(clocks,15000);
})();
</script>
</div>`;
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('chyron.mjs')) {
  const items = await chyronItems({ max: 14 }).catch((e) => { console.error(e.message); return []; });
  console.log('SoapBox Chiron — live ticker (curated, capped):\n' + '─'.repeat(60));
  for (const it of items) console.log(`  [${it.tier.toUpperCase().padEnd(8)}] ${it.icon} ${it.text}`);
  console.log('\nTop crypto news (rotating 5):');
  const top = await topCryptoNews({ n: 5 }).catch(() => []);
  top.forEach((t, i) => console.log(`  ${i + 1}. ${t.title}`));
}
