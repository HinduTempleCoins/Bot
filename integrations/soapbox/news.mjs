// news.mjs — the SoapBox Data News tab. Keyless starter stack (see NEWS_SOURCES.md): crypto + world
// headlines (via comms-parser), US gov/regulatory (Federal Register, keyless), disasters (reused from
// chyron: USGS quakes + NWS alerts), and embeddable news live streams (link-out to channel /live —
// no key, never a broken iframe). All link-out + attribute; we never republish article bodies.
//
//   import { newsFeed, LIVE_STREAMS } from './news.mjs'
//   node integrations/soapbox/news.mjs

import { earthquakes, weatherAlerts } from './chyron.mjs';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

// HTML escape — every interpolated value below passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// embeddable 24/7 news live streams — link to the channel's /live (always resolves to its current
// live video; no API key, never a stale/broken embed) AND embed the live player via YouTube's keyless
// `embed/live_stream?channel=<ID>` form, which auto-resolves to whatever video the channel is currently
// streaming. The `channelId` is the stable UC… id; verified ids are marked `verified: true`. Any id we
// could not confirm is left null and marked `verified: false` so the renderer link-outs only (honest:
// we never claim a stream is verified when its channel id is a placeholder/unconfirmed).
export const LIVE_STREAMS = [
  // channelId values below are the public UC… ids of each outlet's primary YouTube channel.
  { name: 'Reuters', handle: 'Reuters', channelId: 'UChqUTb7kYRX8-EiaN3XFrSQ', verified: true },
  { name: 'Associated Press', handle: 'AP', channelId: 'UC52X5wxOL_s5yw0dQk7NtgA', verified: true },
  { name: 'Bloomberg TV', handle: 'markets', channelId: 'UCIALMKvObZNtJ6AmdCLP7Lg', verified: true },
  { name: 'DW News', handle: 'dwnews', channelId: 'UCknLrEdhRCp1aegoMqRaCZg', verified: true },
  { name: 'Al Jazeera English', handle: 'aljazeeraenglish', channelId: 'UCNye-wNBqNL5ZzHSJj3l8Bg', verified: true },
  { name: 'NBC News NOW', handle: 'NBCNews', channelId: 'UCeY0bbntWzzVIaj2z3QigXg', verified: true },
  { name: 'ABC News Live', handle: 'ABCNews', channelId: 'UCBi2mrWuNuyYy4gbM6fU18Q', verified: true },
  { name: 'Sky News', handle: 'SkyNews', channelId: 'UCoMdktPbSTixAyNGwb-UYkQ', verified: true },
].map((s) => ({
  ...s,
  url: `https://www.youtube.com/@${s.handle}/live`,
  // keyless live-player embed; auto-resolves to the channel's current live broadcast. Only emitted
  // for channels with a confirmed id (see liveEmbedHtml / verified flag).
  embedUrl: s.channelId ? `https://www.youtube.com/embed/live_stream?channel=${s.channelId}` : null,
}));

// render the curated live streams as escaped <iframe> embeds. Channels without a confirmed id (or with
// verified:false) degrade to a plain link-out instead of emitting an embed for an unverified id.
export function liveEmbedHtml(streams = LIVE_STREAMS) {
  const cards = (streams || []).map((s) => {
    if (s.embedUrl && s.verified) {
      return `<figure class="live-stream"><iframe src="${esc(s.embedUrl)}" title="${esc(s.name)} — live" `
        + `width="100%" height="220" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" `
        + `allowfullscreen loading="lazy"></iframe><figcaption>${esc(s.name)} (live)</figcaption></figure>`;
    }
    // unverified / placeholder channel id → honest link-out, no fabricated embed
    return `<figure class="live-stream live-stream--linkout"><a href="${esc(s.url)}" target="_blank" `
      + `rel="noopener noreferrer">${esc(s.name)} — open live (channel id unverified)</a></figure>`;
  });
  return `<section class="news-live"><h2>Live News Streams</h2>${cards.join('')}</section>`;
}

// dedup by normalized title, cap per section (keeps the tab readable, not overcrowded)
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function dedupCap(items, cap = 12) {
  const seen = new Set(); const out = [];
  for (const it of items.filter(Boolean)) {
    const k = norm(it.title).slice(0, 70);
    if (!k || seen.has(k)) continue;
    seen.add(k); out.push(it);
    if (out.length >= cap) break;
  }
  return out;
}

async function headlines(asset, query = '') {
  try {
    const cp = await import('../comms-parser.mjs');
    const items = await cp.fetchHeadlines({ asset, query, limit: 30 });
    return (items || []).map((h) => ({ title: h.title, url: h.url, source: h.source || '', ageHours: h.ageHours }));
  } catch { return []; }
}

// US gov / regulatory — Federal Register (keyless, public domain). Crypto-relevant rulemaking etc.
export async function govItems({ query = 'cryptocurrency OR digital asset OR blockchain', limit = 8 } = {}) {
  try {
    const u = `https://www.federalregister.gov/api/v1/documents.json?per_page=${limit}&order=newest&conditions[term]=${encodeURIComponent(query)}&fields[]=title&fields[]=html_url&fields[]=publication_date&fields[]=type`;
    const r = await _fetch(u, { headers: UA });
    if (!r || !r.ok) return [];
    const j = await r.json();
    return (j.results || []).map((d) => ({ title: d.title, url: d.html_url, source: `Federal Register · ${d.type || ''}`.trim(), date: d.publication_date }));
  } catch { return []; }
}

// GDELT Doc 2.0 — keyless global full-text news index. Surfaces global breaking events as their own
// News section. We hit the public ArtList endpoint directly through our injectable _fetch (so tests run
// offline) and defensively reuse comms-parser's GDELT date normalizer when it's available; if anything
// fails we soft-fail to []. Never republishes bodies — title + link + domain only.
const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
export async function gdeltItems({ query = 'breaking OR crisis OR conflict OR disaster OR election', limit = 12 } = {}) {
  try {
    const u = `${GDELT_DOC_URL}?query=${encodeURIComponent(query)}&mode=ArtList&format=json&maxrecords=${limit}&sort=DateDesc&timespan=2d`;
    const r = await _fetch(u, { headers: { ...UA, accept: 'application/json' } });
    if (!r || !r.ok) return [];
    const j = await r.json().catch(() => ({}));
    // optionally reuse comms-parser's GDELT seendate normalizer (defensive import; never required)
    let gdeltDate = null;
    try { const cp = await import('../comms-parser.mjs'); gdeltDate = cp.gdeltDate || null; } catch { /* optional */ }
    return (j.articles || [])
      .map((a) => ({
        title: a.title || '',
        url: a.url || '',
        source: a.domain ? `GDELT · ${a.domain}` : 'GDELT',
        date: a.seendate && gdeltDate ? gdeltDate(a.seendate) : (a.seendate || null),
      }))
      .filter((h) => h.title);
  } catch { return []; }
}

// the whole News tab feed, sectioned. Each section keyless + capped.
export async function newsFeed() {
  const [crypto, world, gov, gdelt, quakes, weather] = await Promise.all([
    headlines('crypto'),
    headlines('', 'war OR conflict OR election OR sanctions OR economy'),
    govItems(),
    gdeltItems(),
    earthquakes().catch(() => []),
    weatherAlerts().catch(() => []),
  ]);
  const disasters = [
    ...quakes.map((q) => ({ title: q.text, url: q.url, source: 'USGS' })),
    ...weather.map((w) => ({ title: w.text, source: 'NWS' })),
  ];
  return {
    crypto: dedupCap(crypto, 12),
    world: dedupCap(world, 10),
    gov: dedupCap(gov, 8),
    gdelt: dedupCap(gdelt, 12),
    disasters: dedupCap(disasters, 8),
    live: LIVE_STREAMS,
  };
}

if (process.argv[1] && process.argv[1].endsWith('news.mjs')) {
  const f = await newsFeed().catch((e) => ({ error: e.message }));
  if (f.error) { console.error(f.error); process.exit(1); }
  for (const sec of ['crypto', 'world', 'gov', 'gdelt', 'disasters']) {
    console.log(`\n== ${sec.toUpperCase()} ==`);
    for (const it of f[sec]) console.log(`  • ${it.title}${it.source ? `  [${it.source}]` : ''}`);
  }
  console.log('\n== LIVE ==');
  for (const s of f.live) console.log(`  ▶ ${s.name} — ${s.embedUrl || s.url}${s.verified ? '' : ' (unverified)'}`);
}
