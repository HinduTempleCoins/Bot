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

// embeddable 24/7 news live streams — link to the channel's /live (always resolves to its current
// live video; no API key, never a stale/broken embed). Embedding the iframe is a later refinement.
export const LIVE_STREAMS = [
  { name: 'Reuters', handle: 'Reuters' },
  { name: 'Associated Press', handle: 'AP' },
  { name: 'Bloomberg TV', handle: 'markets' },
  { name: 'DW News', handle: 'dwnews' },
  { name: 'Al Jazeera English', handle: 'aljazeeraenglish' },
  { name: 'NBC News NOW', handle: 'NBCNews' },
  { name: 'ABC News Live', handle: 'ABCNews' },
  { name: 'Sky News', handle: 'SkyNews' },
].map((s) => ({ ...s, url: `https://www.youtube.com/@${s.handle}/live` }));

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

// the whole News tab feed, sectioned. Each section keyless + capped.
export async function newsFeed() {
  const [crypto, world, gov, quakes, weather] = await Promise.all([
    headlines('crypto'),
    headlines('', 'war OR conflict OR election OR sanctions OR economy'),
    govItems(),
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
    disasters: dedupCap(disasters, 8),
    live: LIVE_STREAMS,
  };
}

if (process.argv[1] && process.argv[1].endsWith('news.mjs')) {
  const f = await newsFeed().catch((e) => ({ error: e.message }));
  if (f.error) { console.error(f.error); process.exit(1); }
  for (const sec of ['crypto', 'world', 'gov', 'disasters']) {
    console.log(`\n== ${sec.toUpperCase()} ==`);
    for (const it of f[sec]) console.log(`  • ${it.title}${it.source ? `  [${it.source}]` : ''}`);
  }
  console.log('\n== LIVE ==');
  for (const s of f.live) console.log(`  ▶ ${s.name} — ${s.url}`);
}
