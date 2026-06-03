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
    const mag = f.properties?.mag;
    return { kind: 'disaster', icon: '🌎', text: `M${(+mag).toFixed(1)} earthquake — ${f.properties?.place || 'unknown'}`, score: quakeScore(mag), url: f.properties?.url };
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
    const ev = f.properties?.event || 'Weather alert';
    if (seenEvent.has(ev)) continue; // collapse 100 county alerts into one headline per event type
    seenEvent.add(ev);
    out.push({ kind: 'disaster', icon: '⛈️', text: `${ev} — ${f.properties?.areaDesc?.split(';')[0] || 'US'}`, score: sevScore(f.properties?.severity) });
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

// CLI
if (process.argv[1] && process.argv[1].endsWith('chyron.mjs')) {
  const items = await chyronItems({ max: 14 }).catch((e) => { console.error(e.message); return []; });
  console.log('SoapBox Chiron — live ticker (curated, capped):\n' + '─'.repeat(60));
  for (const it of items) console.log(`  [${it.tier.toUpperCase().padEnd(8)}] ${it.icon} ${it.text}`);
  console.log('\nTop crypto news (rotating 5):');
  const top = await topCryptoNews({ n: 5 }).catch(() => []);
  top.forEach((t, i) => console.log(`  ${i + 1}. ${t.title}`));
}
