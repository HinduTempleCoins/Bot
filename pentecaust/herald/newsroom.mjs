// pentecaust/herald/newsroom.mjs — Herald NEWSROOM: our own wire + portal, the EIN-Presswire replacement.
//
// TWO ZONES, by design:
//   1. OUR NEWS (originating)  — SoapBox Originals. Our own stories, broken here first, on our own pages
//      with canonical + NewsArticle JSON-LD + per-section outbound RSS. Starts EMPTY (except seeds), ours
//      to fill. These feeds are what we SELF-FEED everywhere (crossposter + external submission).
//   2. WIRE CATEGORIES (aggregated) — the full EIN-Presswire industry category set, FILLED IN MSN/Yahoo
//      style by aggregating public RSS sources. POINT posture (like the stream service / license-router):
//      we show a headline + source + an OUTBOUND link to the owner; we never rehost their content.
//
// Everything has an RSS feed; selfFeedTargets() enumerates where our feeds self-feed (our channels via the
// crossporter, plus the external aggregators that ingest a feed URL).
//
//   import { OUR_SECTIONS, WIRE_CATEGORIES, addItem, listItems, getItem, renderRss, handler, selfFeedTargets } from './newsroom.mjs'
//   PORT=8166 NEWS_BASE_URL=https://news.soapbox.community node pentecaust/herald/newsroom.mjs
//
// House style: ESM, esc()/xesc() on every interpolation, injectable fetch + fs, soft-fail-never-throw,
// async handler(req,res) exported for tests, CLI guarded. Holds no key, signs nothing, never rehosts.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { getIndexNowKey } from '../../integrations/soapbox/crawlers.mjs';
// The email arm (news-mailer.mjs) is loaded softly: where it is not deployed the newsroom still serves,
// just without the subscribe box.
let subscribeForm = () => '';
let handleNewsletter = async () => false;
try { ({ subscribeForm, handleNewsletter } = await import('./news-mailer.mjs')); } catch { /* soft: no email arm */ }
import { CATEGORIES as WIKI_CATEGORIES } from '../../site/wiki/categories.mjs';

const env = (k, d = '') => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const BASE_URL = () => env('NEWS_BASE_URL', env('BASE_URL', 'https://news.soapbox.community')).replace(/\/+$/, '');
export const DATA_FILE = () => env('HERALD_NEWS_DATA', join(process.cwd(), 'data', 'herald-news.json'));
const SITE_NAME = () => env('NEWS_SITE_NAME', 'SoapBox Newsroom');
const ORG = () => env('HERALD_ORG_NAME', 'Van Kush Family Research Institute / The Shaivite Temple');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const xesc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const slugify = (s) => String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

// ── ZONE 1: OUR NEWS — originating sections (our wiki niches; separate, ours to fill) ───────────────────
export const OUR_SECTIONS = [
  { slug: 'melek', name: 'MELEK & SoapBox', wiki: 'chains', blurb: 'Our chains, launches, and ecosystem.' },
  { slug: 'crypto', name: 'Crypto & Blockchain', wiki: 'chains', blurb: 'DPoS, mining, tokens, DeFi.' },
  { slug: 'psychedelics', name: 'Psychedelics & Harm Reduction', wiki: 'substances', blurb: 'Entheogens, pharmacology, harm reduction.' },
  { slug: 'cannabis', name: 'Cannabis & Hemp', wiki: 'substances', blurb: 'Cannabinoids, extraction, hemp, policy.' },
  { slug: 'neuro', name: 'Neuroscience & Biohacking', wiki: 'entrainment', blurb: '40 Hz, neurostim, nootropics.' },
  { slug: 'ai', name: 'Artificial Intelligence', wiki: 'start', blurb: 'Agents, RAG, generative media, Angelic AI.' },
  { slug: 'chemistry', name: 'Chemistry & Extraction', wiki: 'chemistry', blurb: 'Synthesis, isomerization, extraction.' },
  { slug: 'history', name: 'Ancient History & Religion', blurb: 'Mystery schools, Egyptology, RFRA.' },
  { slug: 'herbalism', name: 'Herbalism & Plant Medicine', blurb: 'Ethnobotany, preparation, the plant library.' },
];
export const OUR_BY_SLUG = Object.fromEntries(OUR_SECTIONS.map((c) => [c.slug, c]));
export const isOurSection = (s) => Object.prototype.hasOwnProperty.call(OUR_BY_SLUG, s);

// ── ZONE 2: WIRE CATEGORIES — the full EIN-Presswire industry set (aggregated / filled) ──────────────────
const WC = (name) => ({ slug: slugify(name), name });
export const WIRE_CATEGORIES = [
  'Agriculture, Farming & Forestry', 'Amusement, Gaming & Casino', 'Automotive', 'Aviation & Aerospace',
  'Banking, Finance & Investment', 'Beauty & Hair Care', 'Book Publishing', 'Building & Construction',
  'Business & Economy', 'Chemical Industry', 'Companies', 'Conferences & Trade Fairs', 'Consumer Goods',
  'Culture, Society & Lifestyle', 'Education', 'Electronics Industry', 'Emergency Services', 'Energy Industry',
  'Environment', 'Food & Beverage Industry', 'Furniture & Woodworking', 'Gifts, Toys & Hobbies',
  'Healthcare & Pharmaceuticals', 'Human Resources', 'Insurance', 'International Organizations',
  'Internet & Online', 'IT Industry', 'Law', 'Manufacturing', 'Media, Advertising & PR', 'Military Industry',
  'Mining Industry', 'Movie Industry', 'Music Industry', 'Natural Disasters', 'Politics',
  'Real Estate & Property Management', 'Religion', 'Retail', 'Science', 'Shipping, Storage & Logistics',
  'Social Media', 'Sports, Fitness & Recreation', 'Technology', 'Telecommunications', 'Textiles & Fabric',
  'Travel & Tourism', 'U.S. Politics', 'Waste Management', 'World & Regional',
].map(WC);
export const WIRE_BY_SLUG = Object.fromEntries(WIRE_CATEGORIES.map((c) => [c.slug, c]));
export const isWireCategory = (s) => Object.prototype.hasOwnProperty.call(WIRE_BY_SLUG, s);

// Aggregation SOURCES (public RSS; POINT posture — headline + link out, never rehost). Overridable via
// HERALD_NEWS_SOURCES (JSON file). Every wire category ALSO gets a Google News topic feed by default
// (see fetchWire), which legally surfaces AP / Reuters / AFP headlines (links back to the source) — the
// way MSN/Yahoo fill their pages. AP/Reuters/AFP/Getty themselves are LICENSED (no free full RSS); we do
// not scrape them. GOV feeds below are free AND public-domain (U.S. government works) — fully republishable.
export const GNEWS = (q) => 'https://news.google.com/rss/search?q=' + encodeURIComponent(String(q) + ' when:7d') + '&hl=en-US&gl=US&ceid=US:en';
// Free, public-domain U.S. government / agency feeds — republishable, high-signal for the legal/accountability work.
export const GOV_FEEDS = {
  whitehouse: 'https://www.whitehouse.gov/feed/',
  doj: 'https://www.justice.gov/feeds/opa/justice-news.xml',
  sec: 'https://www.sec.gov/news/pressreleases.rss',
  fda: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml',
  ftc: 'https://www.ftc.gov/feeds/press-release.xml',
  nasa: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',
  federal_register: 'https://www.federalregister.gov/documents/current.rss',
  congress: 'https://www.congress.gov/rss/most-viewed-bills.xml',
};
// Premium free/CC outlets to ADD on top of Google News for key categories (The Conversation is CC-republishable).
const DEFAULT_SOURCES = {
  'technology': ['https://feeds.arstechnica.com/arstechnica/technology-lab', 'https://www.theverge.com/rss/index.xml'],
  'it-industry': ['https://feeds.arstechnica.com/arstechnica/information-technology'],
  'science': ['https://www.sciencedaily.com/rss/all.xml', 'https://theconversation.com/us/science/articles.atom', GOV_FEEDS.nasa],
  'business-economy': ['https://feeds.marketwatch.com/marketwatch/topstories/'],
  'banking-finance-investment': ['https://feeds.marketwatch.com/marketwatch/marketpulse/', GOV_FEEDS.sec],
  'politics': ['https://feeds.npr.org/1014/rss.xml', GOV_FEEDS.whitehouse],
  'u-s-politics': ['https://feeds.npr.org/1014/rss.xml', GOV_FEEDS.whitehouse, GOV_FEEDS.congress],
  'law': [GOV_FEEDS.doj, GOV_FEEDS.ftc, GOV_FEEDS.federal_register],
  'healthcare-pharmaceuticals': ['https://www.sciencedaily.com/rss/health_medicine.xml', GOV_FEEDS.fda],
  'environment': ['https://www.sciencedaily.com/rss/earth_climate.xml'],
  'world-regional': ['https://feeds.npr.org/1004/rss.xml', 'https://www.aljazeera.com/xml/rss/all.xml'],
  'energy-industry': ['https://www.sciencedaily.com/rss/matter_energy.xml'],
  'aviation-aerospace': [GOV_FEEDS.nasa],
};
function loadSources() {
  const f = env('HERALD_NEWS_SOURCES', '');
  if (f) { try { const o = JSON.parse(realFs.read(f) || '{}'); return { ...DEFAULT_SOURCES, ...o }; } catch { /* soft-fail */ } }
  return DEFAULT_SOURCES;
}

// ── store (our origin items only) ───────────────────────────────────────────────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} try { writeFileSync(p, s); return true; } catch { return false; } },
};
const ctx = (o = {}) => ({ fs: o.fs || realFs, file: o.file || DATA_FILE() });
function load({ fs, file }) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { items: [] };
  try { const o = JSON.parse(raw); return o && Array.isArray(o.items) ? o : { items: [] }; } catch { return { items: [] }; }
}
function save({ fs, file }, s) { (fs.write || realFs.write)(file, JSON.stringify(s, null, 1)); return s; }

export function addItem(item = {}, opts = {}) {
  const c = ctx(opts); const store = load(c);
  const title = String(item.title || '').trim();
  if (!title) return { ok: false, error: 'title required' };
  let section = String(item.category || item.section || 'melek').toLowerCase();
  if (!isOurSection(section)) section = 'melek';
  const date = item.date ? new Date(item.date) : new Date();
  const iso = isNaN(date) ? new Date().toISOString() : date.toISOString();
  let slug = slugify(item.slug || title) || ('story-' + Date.now());
  let n = 2; const base = slug; while (store.items.some((x) => x.slug === slug)) slug = `${base}-${n++}`;
  const rec = {
    id: String(item.id || slug), slug, title,
    dek: String(item.dek || '').trim(), body: String(item.body || '').trim(),
    category: section, author: String(item.author || 'Hathor · ' + ORG()).trim(),
    date: iso, origin: true, source: String(item.source || SITE_NAME()).trim(),
    canonical: String(item.canonical || '').trim(), image: String(item.image || '').trim(),
  };
  store.items.push(rec); save(c, store);
  return { ok: true, item: rec };
}
export function listItems({ category = null, limit = 50, offset = 0 } = {}, opts = {}) {
  let items = load(ctx(opts)).items.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  if (category && isOurSection(category)) items = items.filter((x) => x.category === category);
  return items.slice(offset, offset + Math.max(0, limit));
}
export function getItem(slug, opts = {}) { return load(ctx(opts)).items.find((x) => x.slug === slug) || null; }

// ── ZONE 2 aggregation: fetch public feeds, parse, cache, soft-fail. POINT posture (link out). ───────────
const _aggCache = new Map(); // slug -> { at, items }
const AGG_TTL = () => Math.max(60000, Number(env('HERALD_NEWS_AGG_TTL', '600000')) || 600000);
export function __clearAggCache() { _aggCache.clear(); }

export function parseFeed(xml, source = '') {
  const out = []; const s = String(xml || '');
  const grab = (block, tag) => { const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')); return m ? m[1] : ''; };
  const unc = (t) => String(t).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').trim();
  // RSS <item>
  for (const m of s.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)) {
    const b = m[0];
    const title = unc(grab(b, 'title'));
    let link = unc(grab(b, 'link'));
    const date = unc(grab(b, 'pubDate')) || unc(grab(b, 'dc:date'));
    if (title) out.push({ title, link, date, source });
  }
  // Atom <entry>
  if (!out.length) for (const m of s.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)) {
    const b = m[0]; const title = unc(grab(b, 'title'));
    let link = ''; const lm = b.match(/<link[^>]*href="([^"]+)"/i); if (lm) link = lm[1];
    const date = unc(grab(b, 'updated')) || unc(grab(b, 'published'));
    if (title) out.push({ title, link, date, source });
  }
  return out;
}
async function fetchOne(url) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': 'SoapBoxNewsroom/1.0 (+aggregator; point-posture)' } });
    if (!r || !r.ok) return [];
    const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } })();
    return parseFeed(await r.text(), host);
  } catch { return []; }
}
export async function fetchWire(slug, { limit = 12, now = Date.now() } = {}) {
  const sources = (loadSources()[slug] || []);
  if (!sources.length) return [];
  const hit = _aggCache.get(slug);
  if (hit && now - hit.at < AGG_TTL()) return hit.items.slice(0, limit);
  const batches = await Promise.all(sources.map(fetchOne));
  let items = [].concat(...batches).filter((x) => x && x.title && x.link);
  items.sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  // de-dupe by link
  const seen = new Set(); items = items.filter((x) => (seen.has(x.link) ? false : (seen.add(x.link), true)));
  _aggCache.set(slug, { at: now, items });
  return items.slice(0, limit);
}

// ── feeds (OUR news → OUTBOUND, self-fed) ───────────────────────────────────────────────────────────────
const rfc822 = (iso) => { const d = new Date(iso); return isNaN(d) ? new Date().toUTCString() : d.toUTCString(); };
const itemUrl = (it) => `${BASE_URL()}/item/${encodeURIComponent(it.slug)}`;
const ourUrl = (slug) => `${BASE_URL()}/our/${encodeURIComponent(slug)}`;
const wireUrl = (slug) => `${BASE_URL()}/c/${encodeURIComponent(slug)}`;
const firstLine = (b) => String(b || '').split(/\n+/).map((s) => s.trim()).filter(Boolean)[0] || '';

export function renderRss({ section = null, items = null, opts = {} } = {}) {
  const sec = section && isOurSection(section) ? OUR_BY_SLUG[section] : null;
  const list = items || listItems(sec ? { category: section, limit: 50 } : { limit: 50 }, opts);
  const self = sec ? `${BASE_URL()}/our/${encodeURIComponent(section)}/rss.xml` : `${BASE_URL()}/rss.xml`;
  const entries = list.map((it) => [
    '  <item>',
    `    <title>${xesc(it.title)}</title>`,
    `    <link>${xesc(it.canonical || itemUrl(it))}</link>`,
    `    <guid isPermaLink="true">${xesc(itemUrl(it))}</guid>`,
    `    <pubDate>${xesc(rfc822(it.date))}</pubDate>`,
    `    <dc:creator>${xesc(it.author)}</dc:creator>`,
    `    <category>${xesc((OUR_BY_SLUG[it.category] || {}).name || it.category)}</category>`,
    `    <description>${xesc(it.dek || firstLine(it.body))}</description>`,
    it.image ? `    <enclosure url="${xesc(it.image)}" type="image/jpeg" />` : '',
    '  </item>',
  ].filter(Boolean).join('\n')).join('\n');
  return ['<?xml version="1.0" encoding="UTF-8"?>',
    '<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">',
    '<channel>',
    `  <title>${xesc(SITE_NAME())}${sec ? ' — ' + xesc(sec.name) : ''}</title>`,
    `  <link>${xesc(sec ? ourUrl(section) : BASE_URL())}</link>`,
    `  <description>${xesc(sec ? sec.blurb : 'SoapBox Originals — our own wire.')}</description>`,
    '  <language>en-us</language>',
    `  <lastBuildDate>${xesc(rfc822(list[0] ? list[0].date : new Date().toISOString()))}</lastBuildDate>`,
    `  <atom:link href="${xesc(self)}" rel="self" type="application/rss+xml" />`,
    `  <atom:link href="${xesc(env('HERALD_WEBSUB_HUB', 'https://pubsubhubbub.appspot.com/'))}" rel="hub" />`,
    entries, '</channel>', '</rss>'].join('\n');
}

// ── TOPICS (from the 243 wiki subjects) — the big crawlable niche-news network ──────────────────────────
function loadTopics() { try { const o = JSON.parse(realFs.read(env('HERALD_NEWS_TOPICS', join(process.cwd(), 'data', 'news-topics.json'))) || '{}'); return Array.isArray(o.topics) ? o.topics : []; } catch { return []; } }
export const TOPICS = loadTopics();
const TOPIC_BY_SLUG = Object.fromEntries(TOPICS.map((t) => [t.slug, t]));
export const isTopic = (s) => Object.prototype.hasOwnProperty.call(TOPIC_BY_SLUG, s);
export async function fetchTopic(slug, { limit = 25, now = Date.now() } = {}) {
  const t = TOPIC_BY_SLUG[slug]; if (!t) return [];
  const key = 'topic:' + slug; const hit = _aggCache.get(key);
  if (hit && now - hit.at < AGG_TTL()) return hit.items.slice(0, limit);
  let items = await fetchOne(GNEWS(t.query));
  const seen = new Set(); items = items.filter((x) => x && x.title && x.link && (seen.has(x.link) ? false : (seen.add(x.link), true)));
  _aggCache.set(key, { at: now, items });
  return items.slice(0, limit);
}
export async function renderTopicRss(slug) {
  const t = TOPIC_BY_SLUG[slug]; if (!t) return null;
  const list = await fetchTopic(slug, { limit: 25 });
  const entries = list.map((x) => ['  <item>', `    <title>${xesc(x.title)}</title>`, `    <link>${xesc(x.link)}</link>`, `    <guid isPermaLink="true">${xesc(x.link)}</guid>`, x.date ? `    <pubDate>${xesc(rfc822(x.date))}</pubDate>` : '', `    <source>${xesc(x.source)}</source>`, '  </item>'].filter(Boolean).join('\n')).join('\n');
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">', '<channel>', `  <title>${xesc(SITE_NAME())} — ${xesc(t.name)} news</title>`, `  <link>${xesc(BASE_URL())}/topic/${esc(slug)}</link>`, `  <description>Latest ${xesc(t.name)} news, aggregated.</description>`, entries, '</channel>', '</rss>'].join('\n');
}

// ── WIKI SUBJECTS — one news category per subject category of the wiki (site/wiki/categories.mjs) ──────
// Names come straight from the wiki so the two stay in step. Each is filled the same way the topic beats
// are: a Google News query (headline + link out, never rehosted). Wiki categories that are about the site
// itself (Start here, Posting help, Tools, the verticals) are not news subjects and are left out. A subject
// whose feed comes back empty is not shown (nav, portal) until it has headlines.
const SUBJECT_QUERIES = {
  chains: 'blockchain OR "proof of stake" OR "crypto mining" OR "Hive blockchain" OR Steem',
  entrainment: '"gamma entrainment" OR "40 Hz" OR neurostimulation OR tDCS OR "brain stimulation"',
  substances: 'psilocybin OR "psychedelic therapy" OR pharmacology OR "harm reduction"',
  chemistry: '"organic chemistry" OR "total synthesis" OR "chemical synthesis" OR "natural product synthesis"',
  plants: 'ethnobotany OR "medicinal plants" OR herbalism OR "plant medicine"',
  religion: '"religious freedom" OR theology OR interfaith',
  history: 'archaeology OR "ancient DNA" OR Egyptology OR "ancient history"',
  people: '"history of science" OR "history of philosophy"',
  law: '"Supreme Court" OR "civil rights" OR "court ruling" OR "constitutional law"',
  philosophy: '"political philosophy" OR anarchism OR libertarianism OR "political theory"',
};
// which topic-beat groups and which of our own sections sit under each subject (for the "more" links)
const SUBJECT_GROUPS = {
  chains: ['Crypto & Blockchain'], entrainment: ['Neuroscience & Biohacking'], substances: ['Psychedelics', 'Drug Policy & Harm Reduction', 'Cannabis & Hemp'],
  chemistry: ['Chemistry & Science'], plants: ['Plant Medicine & Herbal'], religion: ['History & Religion'], history: ['History & Religion'],
};
export const WIKI_SUBJECTS = WIKI_CATEGORIES.filter((c) => SUBJECT_QUERIES[c.id])
  .map((c) => ({ slug: c.id, name: c.name, blurb: c.blurb, query: SUBJECT_QUERIES[c.id], wiki: `https://wiki.soapbox.community/category/${c.id}` }));
const SUBJECT_BY_SLUG = Object.fromEntries(WIKI_SUBJECTS.map((x) => [x.slug, x]));
export const isSubject = (s) => Object.prototype.hasOwnProperty.call(SUBJECT_BY_SLUG, s);
const subjectUrl = (slug) => `${BASE_URL()}/subject/${encodeURIComponent(slug)}`;
export async function fetchSubject(slug, { limit = 25, now = Date.now() } = {}) {
  const t = SUBJECT_BY_SLUG[slug]; if (!t) return [];
  const key = 'subject:' + slug; const hit = _aggCache.get(key);
  if (hit && now - hit.at < AGG_TTL()) return hit.items.slice(0, limit);
  let items = await fetchOne(GNEWS(t.query));
  const seen = new Set(); items = items.filter((x) => x && x.title && x.link && (seen.has(x.link) ? false : (seen.add(x.link), true)));
  items.sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
  _aggCache.set(key, { at: now, items });
  return items.slice(0, limit);
}
// Subjects known (from the last fetch) to have headlines — what the nav shows. Synchronous on purpose.
const liveSubjects = () => WIKI_SUBJECTS.filter((x) => { const h = _aggCache.get('subject:' + x.slug); return h && h.items.length; });
export async function renderSubjectRss(slug) {
  const t = SUBJECT_BY_SLUG[slug]; if (!t) return null;
  const list = await fetchSubject(slug, { limit: 25 });
  const entries = list.map((x) => ['  <item>', `    <title>${xesc(x.title)}</title>`, `    <link>${xesc(x.link)}</link>`, `    <guid isPermaLink="true">${xesc(x.link)}</guid>`, x.date ? `    <pubDate>${xesc(rfc822(x.date))}</pubDate>` : '', `    <source>${xesc(x.source)}</source>`, '  </item>'].filter(Boolean).join('\n')).join('\n');
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">', '<channel>', `  <title>${xesc(SITE_NAME())} — ${xesc(t.name)}</title>`, `  <link>${xesc(subjectUrl(slug))}</link>`, `  <description>${xesc(t.blurb)}</description>`, `  <atom:link href="${xesc(subjectUrl(slug))}/rss.xml" rel="self" type="application/rss+xml" />`, entries, '</channel>', '</rss>'].join('\n');
}
export async function renderSubject(slug) {
  const t = SUBJECT_BY_SLUG[slug]; if (!t) return null;
  const items = await fetchSubject(slug, { limit: 30 });
  if (!items.length) return null;
  const groups = SUBJECT_GROUPS[slug] || [];
  const beats = TOPICS.filter((x) => groups.includes(x.group));
  const ours = OUR_SECTIONS.filter((c) => c.wiki === slug);
  const inner = `<h1 class=sec>${esc(t.name)}</h1>
    <p style="color:var(--mut);margin-top:-4px">${esc(t.blurb)} · <a href="${esc(t.wiki)}">Library: ${esc(t.name)}</a> · <a href="${esc(subjectUrl(slug))}/rss.xml">RSS</a></p>
    ${items.map(wireRow).join('')}
    ${ours.length ? `<h1 class=sec style="margin-top:26px">SoapBox Originals</h1><div style="display:flex;flex-wrap:wrap;gap:6px 12px;font-size:14px">${ours.map((c) => `<a href="${esc(ourUrl(c.slug))}">${esc(c.name)}</a>`).join('')}</div>` : ''}
    ${beats.length ? `<h1 class=sec style="margin-top:26px">News feeds</h1><div style="display:flex;flex-wrap:wrap;gap:6px 12px;font-size:14px">${beats.map((x) => `<a href="${esc(BASE_URL())}/topic/${esc(x.slug)}">${esc(x.name)}</a>`).join('')}</div>` : ''}`;
  return PAGE(`${t.name} — ${SITE_NAME()}`, inner, { desc: t.blurb });
}

// aggregated wire category feed — re-points to the sources (headline + source link), never rehosts bodies.
export async function renderWireRss(slug, opts = {}) {
  const cat = WIRE_BY_SLUG[slug]; if (!cat) return null;
  const list = await fetchWire(slug, { limit: 25 });
  const entries = list.map((x) => ['  <item>', `    <title>${xesc(x.title)}</title>`, `    <link>${xesc(x.link)}</link>`,
    `    <guid isPermaLink="true">${xesc(x.link)}</guid>`, x.date ? `    <pubDate>${xesc(rfc822(x.date))}</pubDate>` : '',
    `    <source>${xesc(x.source)}</source>`, '  </item>'].filter(Boolean).join('\n')).join('\n');
  return ['<?xml version="1.0" encoding="UTF-8"?>', '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">', '<channel>',
    `  <title>${xesc(SITE_NAME())} — ${xesc(cat.name)} (aggregated)</title>`, `  <link>${xesc(wireUrl(slug))}</link>`,
    `  <description>Aggregated headlines for ${xesc(cat.name)} — links point to the original source.</description>`,
    `  <atom:link href="${xesc(BASE_URL())}/c/${esc(slug)}/rss.xml" rel="self" type="application/rss+xml" />`,
    entries, '</channel>', '</rss>'].join('\n');
}

export function renderFeedJson({ section = null, opts = {} } = {}) {
  const list = listItems(section && isOurSection(section) ? { category: section, limit: 50 } : { limit: 50 }, opts);
  return JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: SITE_NAME(), home_page_url: BASE_URL(),
    feed_url: `${BASE_URL()}/feed.json`,
    items: list.map((it) => ({ id: itemUrl(it), url: it.canonical || itemUrl(it), title: it.title,
      summary: it.dek || firstLine(it.body), content_text: it.body, date_published: it.date,
      author: { name: it.author }, tags: [(OUR_BY_SLUG[it.category] || {}).name || it.category] })) }, null, 1);
}

// ── FEED-TO-THEM targets — the main point: get OUR news OUT to each destination ──────────────────────────
// Honest about what's possible: some ingest our feed directly (free); AP/Reuters/AFP/Yahoo Finance only
// ingest via a PAID syndicating wire's contract; Getty is a photo-contributor channel, not news.
export function selfFeedTargets() {
  const feeds = [`${BASE_URL()}/rss.xml`, `${BASE_URL()}/feed.json`, `${BASE_URL()}/news-sitemap.xml`, ...OUR_SECTIONS.map((s) => `${BASE_URL()}/our/${s.slug}/rss.xml`)];
  return {
    our_feeds: feeds,
    // 1) PUSH automatically through our OWN stack (no third-party APIs; can't be deplatformed)
    push_native: [
      'MELEK / BLURT / HIVE / STEEM (on-chain, signer-broadcast)', 'Nostr relays (decentralized — undeplatformable)',
      'Mastodon / ActivityPub (fediverse — journalists follow + boost)', 'Telegram · Discord · webhook (dispatcher)',
      'X / social (crossposter)', 'Email newsroom desks (campaign-sender + pr-send-list)', 'HARO / Muck Rack pitches (haro-monitor)',
      'SoapBox Stream + Tune In "News" row', 'the Wiki', 'Herald dashboard',
    ],
    // 2) REGISTER our feed so these INGEST us directly (free)
    ingest_direct_free: [
      { name: 'Google News Publisher Center (RSS + news-sitemap)', url: 'https://publishercenter.google.com' },
      { name: 'Bing News PubHub', url: 'https://pubhub.bing.com' },
      { name: 'Apple News (Apple News Format / Publisher)', url: 'https://www.icloud.com/newspublisher/' },
      { name: 'NewsBreak Contributor', url: 'https://www.newsbreak.com/creators' },
      { name: 'SmartNews Publisher', url: 'https://publishers.smartnews.com' },
      { name: 'Flipboard (magazine from feed)', url: 'https://flipboard.com' },
      { name: 'Ground News / Feedspot / Inoreader directories', url: 'https://www.feedspot.com/rss_submit' },
      { name: 'openPR · Express Press Release · PRLog · IssueWire (free PR sites)', url: '' },
      { name: 'WebSub / PubSubHubbub ping (instant push to subscribers)', url: '' },
    ],
    // 3) AP / Reuters / AFP / Yahoo Finance — NO free direct feed-in; ingest only via a PAID syndicating wire
    via_paid_wire: [
      { name: 'Brandpush (~$195, guaranteed Yahoo Finance / AP affiliates)', reaches: 'AP affiliates, Yahoo Finance, Business Insider' },
      { name: 'eReleases (~$399, PR Newswire partner)', reaches: 'AP / PR Newswire network' },
      { name: 'GlobeNewswire / Business Wire / PR Newswire (tier-1, $1k+)', reaches: 'AP, Reuters, Bloomberg, Nasdaq' },
    ],
    // 4) not a news-distribution channel
    notes: ['Getty = photo CONTRIBUTOR program (license our imagery for royalties), not news distribution.',
      'State/local reach = local outlet submission forms + state press associations + Google News local editions (no public "RSS into a state gov feed").'],
  };
}

// ── HTML (MSN/Yahoo-shaped) ─────────────────────────────────────────────────────────────────────────────
const CATNAV = () => [...OUR_SECTIONS.map((c) => `<a href="${esc(ourUrl(c.slug))}">${esc(c.name)}</a>`),
  ...(liveSubjects().length ? [`<span style="color:var(--line)">│</span>`, ...liveSubjects().map((x) => `<a href="${esc(subjectUrl(x.slug))}">${esc(x.name)}</a>`)] : []),
  `<span style="color:var(--line)">│</span>`, ...WIRE_CATEGORIES.map((c) => `<a href="${esc(wireUrl(c.slug))}">${esc(c.name)}</a>`)].join('');
const PAGE = (title, inner, { desc = '' } = {}) => `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<meta name=description content="${esc(desc || SITE_NAME())}">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE_NAME())}" href="${esc(BASE_URL())}/rss.xml">
<style>
:root{--bg:#0e1016;--fg:#e7e9ee;--mut:#9aa3b2;--line:#232838;--acc:#36d399;--card:#161a26}
@media(prefers-color-scheme:light){:root:not([data-theme=dark]){--bg:#f7f8fb;--fg:#15181f;--mut:#5a6372;--line:#e2e6ef;--acc:#0a7d53;--card:#fff}}
:root[data-theme=dark]{--bg:#0e1016;--fg:#e7e9ee;--mut:#9aa3b2;--line:#232838;--acc:#36d399;--card:#161a26}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
a{color:inherit;text-decoration:none}a:hover{color:var(--acc)}
html{scroll-padding-top:96px}
header{border-bottom:1px solid var(--line);padding:12px 16px;position:sticky;top:0;background:var(--bg);z-index:5}
.wrap{max-width:1100px;margin:0 auto;padding:0 16px}.brand{font-weight:800;font-size:20px;display:flex;gap:12px;align-items:baseline;flex-wrap:wrap}.brand b{color:var(--acc)}
nav.cats{display:flex;gap:12px;flex-wrap:nowrap;overflow-x:auto;margin-top:7px;font-size:13px;-webkit-overflow-scrolling:touch;scrollbar-width:thin;overscroll-behavior-x:contain}
nav.cats a{color:var(--mut);white-space:nowrap}nav.cats a:hover{color:var(--acc)}
nav.cats::-webkit-scrollbar{height:0}
main{max-width:1100px;margin:0 auto;padding:18px 16px 60px}
h1.sec{font-size:14px;text-transform:uppercase;letter-spacing:.08em;color:var(--mut);border-bottom:1px solid var(--line);padding-bottom:6px;margin:24px 0 10px}
.zone{border:1px solid var(--line);border-radius:12px;padding:4px 16px 14px;margin:14px 0;background:var(--card)}
.zone.ours{border-color:var(--acc)}
.story{display:block;padding:10px 0;border-bottom:1px solid var(--line)}.story:last-child{border-bottom:0}
.story .t{font-weight:700;font-size:17px}.story .d{color:var(--mut);font-size:14px;margin-top:3px}.story .m{color:var(--mut);font-size:12px;margin-top:4px}
.cols{display:grid;gap:14px;grid-template-columns:1fr}@media(min-width:800px){.cols{grid-template-columns:repeat(3,1fr)}}
.src{color:var(--acc);font-size:11px;text-transform:uppercase;letter-spacing:.05em}
article.story-full{max-width:720px}article.story-full .body p{margin:0 0 16px}
.repub{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-top:18px;font-size:14px;color:var(--mut)}
.foot{color:var(--mut);font-size:13px;border-top:1px solid var(--line);margin-top:30px;padding-top:14px}
.empty{color:var(--mut);font-size:14px;padding:8px 0}
</style></head><body>
<header><div class=wrap><div class=brand><a href="${esc(BASE_URL())}">SoapBox <b>Newsroom</b></a> <a href="${esc(BASE_URL())}/topics" style="color:var(--acc);font-size:13px">News Feeds</a> <a href="${esc(BASE_URL())}/widgets" style="color:var(--acc);font-size:13px">◱ Embed / Widgets</a> <a href="${esc(env('NEWS_STREAM_URL', 'https://stream.soapbox.community'))}" style="color:var(--acc);font-size:13px">▶ Live News</a></div>
<nav class=cats>${CATNAV()}</nav></div></header>
<main>${inner}</main>
<footer class=wrap><div class=foot>${esc(SITE_NAME())} — an originating wire of ${esc(ORG())}. Our feeds: <a href="${esc(BASE_URL())}/rss.xml">RSS</a> · <a href="${esc(BASE_URL())}/feed.json">JSON</a> · <a href="${esc(BASE_URL())}/sitemap.xml">sitemap</a>. Our stories publish here first and self-feed out; wire categories aggregate public sources (headline + link out, never rehosted).</div></footer>
<script src="https://pentecaust.com/translate.js" defer></script>
</body></html>`;

const ourRow = (it) => `<a class=story href="${esc(itemUrl(it))}"><div class=t>${esc(it.title)}</div>${it.dek ? `<div class=d>${esc(it.dek)}</div>` : ''}<div class=m><b style=color:var(--acc)>EXCLUSIVE</b> · ${esc((OUR_BY_SLUG[it.category] || {}).name || it.category)} · ${esc(String(it.date).slice(0, 10))}</div></a>`;
const wireRow = (x) => `<a class=story href="${esc(x.link)}" target=_blank rel="noopener nofollow"><div class=t>${esc(x.title)}</div><div class=m><span class=src>${esc(x.source)}</span>${x.date ? ' · ' + esc(String(x.date).slice(0, 16)) : ''} ↗</div></a>`;

export async function renderPortal(opts = {}) {
  const ours = listItems({ limit: 10 }, opts);
  const oursZone = `<div class="zone ours"><h1 class=sec>SoapBox Originals — our wire</h1>${ours.length ? ours.map(ourRow).join('') : '<div class=empty>No original stories yet — this zone is ours to fill. Everything here publishes first and self-feeds out.</div>'}</div>`;
  // fill a handful of wire categories that have sources, MSN/Yahoo style
  const filledSlugs = WIRE_CATEGORIES.filter((c) => (loadSources()[c.slug] || []).length).slice(0, 9).map((c) => c.slug);
  const filled = await Promise.all(filledSlugs.map(async (slug) => {
    const items = await fetchWire(slug, { limit: 4 });
    if (!items.length) return '';
    return `<h1 class=sec><a href="${esc(wireUrl(slug))}">${esc(WIRE_BY_SLUG[slug].name)}</a></h1>${items.map(wireRow).join('')}`;
  }));
  const wireBlock = filled.filter(Boolean).length
    ? `<div class=zone><h1 class=sec>Industry Wire — filled from public sources</h1><div class=cols>${filled.filter(Boolean).map((b) => `<div>${b}</div>`).join('')}</div></div>`
    : `<div class=zone><h1 class=sec>Industry Wire</h1><div class=empty>The ${WIRE_CATEGORIES.length} EIN-style categories are set up; add RSS sources (HERALD_NEWS_SOURCES) to fill them.</div></div>`;
  const subjects = await Promise.all(WIKI_SUBJECTS.map(async (x) => {
    const items = await fetchSubject(x.slug, { limit: 4 });
    return items.length ? `<div><h1 class=sec><a href="${esc(subjectUrl(x.slug))}">${esc(x.name)}</a></h1>${items.map(wireRow).join('')}</div>` : '';
  }));
  const subjectZone = subjects.some(Boolean)
    ? `<div class=zone id=subjects><h1 class=sec>By Library subject — <a href="https://wiki.soapbox.community/categories">wiki.soapbox.community</a></h1><div class=cols>${subjects.filter(Boolean).join('')}</div></div>` : '';
  const subZone = subscribeForm({ base: BASE_URL() });
  return PAGE(SITE_NAME(), oursZone + subjectZone + subZone + wireBlock, { desc: 'SoapBox Newsroom — our own wire plus the full industry-category portal.' });
}

export function renderOurSection(slug, opts = {}) {
  const c = OUR_BY_SLUG[slug]; if (!c) return null;
  const items = listItems({ category: slug, limit: 60 }, opts);
  return PAGE(`${c.name} — ${SITE_NAME()}`, `<h1 class=sec>${esc(c.name)} — SoapBox Originals</h1><p style="color:var(--mut);margin-top:-4px">${esc(c.blurb)} · <a href="${esc(ourUrl(slug))}/rss.xml">RSS</a></p>${items.length ? items.map(ourRow).join('') : '<div class=empty>No stories here yet — ours to fill.</div>'}`, { desc: c.blurb });
}
export async function renderWireCategory(slug, opts = {}) {
  const c = WIRE_BY_SLUG[slug]; if (!c) return null;
  const items = await fetchWire(slug, { limit: 40 });
  const hasSrc = (loadSources()[slug] || []).length;
  const body = items.length ? items.map(wireRow).join('')
    : `<div class=empty>${hasSrc ? 'No headlines available right now.' : 'No source feed configured for this category yet — set one in HERALD_NEWS_SOURCES to fill it.'}</div>`;
  return PAGE(`${c.name} — ${SITE_NAME()}`, `<h1 class=sec>${esc(c.name)}</h1><p style="color:var(--mut);margin-top:-4px">Aggregated from public sources — links go to the original. · <a href="${esc(BASE_URL())}/c/${esc(slug)}/rss.xml">RSS</a></p>${body}`, { desc: `${c.name} headlines, aggregated.` });
}
export async function renderTopic(slug) {
  const t = TOPIC_BY_SLUG[slug]; if (!t) return null;
  const items = await fetchTopic(slug, { limit: 30 });
  const related = TOPICS.filter((x) => x.group === t.group && x.slug !== slug);
  const body = items.length ? items.map(wireRow).join('') : '<div class=empty>No headlines in the last week — this beat updates as news breaks.</div>';
  const inner = `<h1 class=sec>${esc(t.name)} — latest news</h1>
    <p style="color:var(--mut);margin-top:-4px">A live news feed for <b>${esc(t.name)}</b>${t.group ? ' · ' + esc(t.group) : ''} — the latest coverage, updated continuously. <a href="${esc(BASE_URL())}/topic/${esc(slug)}/rss.xml">Subscribe (RSS)</a></p>
    ${body}
    ${related.length ? `<h1 class=sec style="margin-top:26px">More ${esc(t.group)} beats</h1><div style="display:flex;flex-wrap:wrap;gap:6px 12px;font-size:14px">${related.map((x) => `<a href="${esc(BASE_URL())}/topic/${esc(x.slug)}">${esc(x.name)}</a>`).join('')}</div>` : ''}`;
  return PAGE(`${t.name} news — ${SITE_NAME()}`, inner, { desc: `Latest ${t.name} news — a live feed from SoapBox Newsroom.` });
}
export function renderTopicsIndex() {
  const groups = {}; for (const t of TOPICS) { (groups[t.group || 'Other'] = groups[t.group || 'Other'] || []).push(t); }
  const inner = `<h1 class=sec>News Feeds — ${TOPICS.length} beats</h1>
    <p style="color:var(--mut);margin-top:-4px">Live news feeds across our beats. Each one aggregates the latest coverage on that subject and has its own RSS feed to subscribe or embed.</p>
    ${Object.keys(groups).map((g) => `<h2 style="color:var(--acc);font-size:15px;margin:18px 0 6px">${esc(g)}</h2><div style="display:flex;flex-wrap:wrap;gap:6px 12px;font-size:14px">${groups[g].map((t) => `<a href="${esc(BASE_URL())}/topic/${esc(t.slug)}">${esc(t.name)}</a> <a href="${esc(BASE_URL())}/topic/${esc(t.slug)}/rss.xml" style="color:var(--mut);font-size:12px">rss</a>`).join(' · ')}</div>`).join('')}`;
  return PAGE(`News Feeds — ${SITE_NAME()}`, inner, { desc: `${TOPICS.length} live niche news feeds.` });
}
export function renderItem(slug, opts = {}) {
  const it = getItem(slug, opts); if (!it) return null;
  const sec = OUR_BY_SLUG[it.category] || {};
  const bodyHtml = String(it.body || '').split(/\n{2,}/).map((p) => `<p>${esc(p.trim())}</p>`).join('');
  const ld = { '@context': 'https://schema.org', '@type': 'NewsArticle', headline: it.title, description: it.dek || firstLine(it.body),
    datePublished: it.date, dateModified: it.date, author: [{ '@type': 'Organization', name: it.author }],
    publisher: { '@type': 'Organization', name: ORG() }, mainEntityOfPage: itemUrl(it), articleSection: sec.name || it.category,
    image: it.image ? [it.image] : undefined };
  return PAGE(`${it.title} — ${SITE_NAME()}`, `<article class=story-full>
    <div style="margin-bottom:6px"><span class=src>EXCLUSIVE · ${esc(sec.name || it.category)}</span></div>
    <h1 style="font-size:28px;line-height:1.2;margin:0 0 8px">${esc(it.title)}</h1>
    ${it.dek ? `<p style="font-size:18px;color:var(--mut);margin:0 0 10px">${esc(it.dek)}</p>` : ''}
    <div class=m style="color:var(--mut);font-size:13px;margin-bottom:16px">By ${esc(it.author)} · ${esc(String(it.date).slice(0, 10))} · ${esc(it.source)}</div>
    ${it.image ? `<img src="${esc(it.image)}" alt="${esc(it.title)}" style="max-width:100%;border-radius:10px;margin-bottom:16px">` : ''}
    <div class=body>${bodyHtml}</div>
    <div class=repub><b>Republishing?</b> This story originated at ${esc(itemUrl(it))}. Pick it up freely — attribute ${esc(SITE_NAME())} and link the canonical URL.</div>
  </article><script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>`, { desc: it.dek || firstLine(it.body) });
}

// ── EMBEDDABLE WIDGETS — the wire mechanism: other sites drop these in and carry our news ──────────────
const EMBED_CSS = `*{box-sizing:border-box}body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:#fff;color:#15181f}
@media(prefers-color-scheme:dark){body{background:#0e1016;color:#e7e9ee}}
.w{border:0;padding:4px 2px}.h{font-weight:800;font-size:13px;text-transform:uppercase;letter-spacing:.06em;border-bottom:2px solid #36d399;padding:0 0 6px;margin:0 0 6px}
.h a{color:#0a7d53;text-decoration:none}@media(prefers-color-scheme:dark){.h a{color:#36d399}}
a.i{display:block;padding:7px 0;border-bottom:1px solid #e2e6ef;color:inherit;text-decoration:none;font-weight:600}
@media(prefers-color-scheme:dark){a.i{border-color:#232838}}
a.i:hover{color:#0a7d53}a.i .d{display:block;font-size:11px;color:#8a93a2;font-weight:400}
.f{font-size:11px;color:#8a93a2;padding-top:8px}.f a{color:inherit;text-decoration:none}.e{color:#8a93a2;padding:8px 0}`;
export function renderEmbed(category = 'all', opts = {}) {
  const sec = isOurSection(category) ? OUR_BY_SLUG[category] : null;
  const items = listItems(sec ? { category, limit: 8 } : { limit: 8 }, opts);
  const name = sec ? sec.name : 'SoapBox News';
  const rows = items.length ? items.map((it) => `<a class=i href="${esc(it.canonical || itemUrl(it))}"><span class=d>${esc(String(it.date).slice(0, 10))} · ${esc((OUR_BY_SLUG[it.category] || {}).name || it.category)}</span>${esc(it.title)}</a>`).join('') : '<div class=e>No stories yet.</div>';
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>${esc(name)}</title><base target=_blank><style>${EMBED_CSS}</style></head><body><div class=w><div class=h><a href="${esc(BASE_URL())}">${esc(name)} ▸</a></div>${rows}<div class=f><a href="${esc(BASE_URL())}">Powered by SoapBox Newsroom</a></div></div></body></html>`;
}
export function widgetJs(category = 'all') {
  const src = `${BASE_URL()}/embed?cat=${encodeURIComponent(isOurSection(category) ? category : 'all')}`;
  return `(function(){try{var s=document.currentScript||document.scripts[document.scripts.length-1];var f=document.createElement('iframe');f.src=${JSON.stringify(src)};f.title='SoapBox News';f.loading='lazy';f.setAttribute('scrolling','no');f.style.cssText='width:100%;max-width:440px;height:400px;border:1px solid #e2e6ef;border-radius:12px;background:#fff';s.parentNode.insertBefore(f,s);}catch(e){}})();`;
}
export function renderWidgetsPage(opts = {}) {
  const feeds = [{ slug: 'all', name: 'All SoapBox News' }, ...OUR_SECTIONS.map((s) => ({ slug: s.slug, name: s.name }))];
  const block = ({ slug, name }) => {
    const emb = `${BASE_URL()}/embed?cat=${slug}`;
    const js = `<script src="${BASE_URL()}/widget.js?cat=${slug}" async></` + `script>`;
    const ifr = `<iframe src="${emb}" width="440" height="400" style="border:1px solid #e2e6ef;border-radius:12px" loading="lazy" title="${esc(name)}"></iframe>`;
    const rss = slug === 'all' ? `${BASE_URL()}/rss.xml` : `${BASE_URL()}/our/${slug}/rss.xml`;
    return `<h1 class=sec>${esc(name)}</h1>
      <div style="display:grid;gap:14px;grid-template-columns:1fr">
        <div><b>Script embed</b> (easiest — paste anywhere):<pre>${esc(js)}</pre></div>
        <div><b>iframe</b>:<pre>${esc(ifr)}</pre></div>
        <div><b>RSS feed</b>: <a href="${esc(rss)}">${esc(rss)}</a> &nbsp;·&nbsp; <b>Preview / save</b>: <a href="${esc(emb)}" target=_blank>${esc(emb)}</a></div>
      </div>`;
  };
  const inner = `<h1 class=sec>Embed SoapBox News on your site</h1>
    <p style="color:var(--mut);margin-top:-4px">Free news widgets + RSS feeds — drop one on any site (WordPress, Blogger, Wix, raw HTML) and it shows our latest headlines, auto-updating, linking back to the source. This is our wire: our news, carried on your pages. Attribution kept; no key needed; CORS-open.</p>
    <style>pre{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:10px 12px;overflow:auto;font-size:13px;white-space:pre-wrap;word-break:break-all}</style>
    ${feeds.map(block).join('')}`;
  return PAGE(`Widgets & Embeds — ${SITE_NAME()}`, inner, { desc: 'Embeddable SoapBox News widgets + RSS feeds for any website.' });
}

function sitemap(opts = {}) {
  const urls = [BASE_URL(), `${BASE_URL()}/topics`, ...OUR_SECTIONS.map((c) => ourUrl(c.slug)), ...WIRE_CATEGORIES.map((c) => wireUrl(c.slug)), ...TOPICS.map((t) => `${BASE_URL()}/topic/${t.slug}`), ...listItems({ limit: 1000 }, opts).map(itemUrl)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${[...new Set(urls)].map((u) => `  <url><loc>${xesc(u)}</loc></url>`).join('\n')}\n</urlset>`;
}
// Google News sitemap — the format Google News ingests (our ORIGIN stories from the last 2 days).
function newsSitemap(opts = {}) {
  const cutoff = Date.now() - 2 * 864e5;
  const recent = listItems({ limit: 1000 }, opts).filter((it) => { const t = Date.parse(it.date); return isNaN(t) || t >= cutoff; });
  const entries = recent.map((it) => `  <url><loc>${xesc(itemUrl(it))}</loc><news:news><news:publication><news:name>${xesc(SITE_NAME())}</news:name><news:language>en</news:language></news:publication><news:publication_date>${xesc(it.date)}</news:publication_date><news:title>${xesc(it.title)}</news:title></news:news></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">\n${entries}\n</urlset>`;
}

// ── async handler(req,res) ──────────────────────────────────────────────────────────────────────────────
const send = (res, code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'public, max-age=120', 'access-control-allow-origin': '*' }); res.end(body); };
export async function handler(req, res, opts = {}) {
  try {
    const u = new URL(req.url, BASE_URL());
    const p = u.pathname.replace(/\/+$/, '') || '/';
    let m;
    if (/^\/[0-9a-f]{32}\.txt$/.test(p)) { let k = ''; try { k = getIndexNowKey(); } catch {} return (k && p === '/' + k + '.txt') ? send(res, 200, 'text/plain', k) : send(res, 404, 'text/plain', 'no key'); }
    if (p === '/health') return send(res, 200, 'application/json', JSON.stringify({ ok: true, our: listItems({ limit: 1000 }, opts).length, wire_categories: WIRE_CATEGORIES.length }));
    // Email newsletter (double opt-in) — subscribe / confirm / unsubscribe. Delegated to news-mailer.
    if (p === '/api/subscribe' || p === '/api/confirm' || p === '/api/unsubscribe') {
      const handled = await handleNewsletter(req, res, { base: BASE_URL(), ...(opts.newsletter || {}) });
      if (handled) return;
    }
    if (p === '/robots.txt') return send(res, 200, 'text/plain', `User-agent: *\nAllow: /\nSitemap: ${BASE_URL()}/sitemap.xml\n`);
    if (p === '/sitemap.xml') return send(res, 200, 'application/xml', sitemap(opts));
    if (p === '/news-sitemap.xml') return send(res, 200, 'application/xml', newsSitemap(opts));
    if (p === '/self-feed.json') return send(res, 200, 'application/json', JSON.stringify(selfFeedTargets(), null, 1));
    if (p === '/rss.xml') return send(res, 200, 'application/rss+xml', renderRss({ opts }));
    if (p === '/feed.json') return send(res, 200, 'application/feed+json', renderFeedJson({ opts }));
    if (p === '/widget.js') return send(res, 200, 'application/javascript; charset=utf-8', widgetJs(u.searchParams.get('cat') || 'all'));
    if (p === '/embed') return send(res, 200, 'text/html; charset=utf-8', renderEmbed(u.searchParams.get('cat') || 'all', opts));
    if (p === '/widgets') return send(res, 200, 'text/html; charset=utf-8', renderWidgetsPage(opts));
    if ((m = p.match(/^\/subject\/([a-z0-9-]+)\/rss\.xml$/))) { const x = await renderSubjectRss(m[1]); return x ? send(res, 200, 'application/rss+xml', x) : send(res, 404, 'text/plain', 'no feed'); }
    if ((m = p.match(/^\/subject\/([a-z0-9-]+)$/))) { const h = await renderSubject(m[1]); return h ? send(res, 200, 'text/html; charset=utf-8', h) : send(res, 404, 'text/html', PAGE('Not found', '<p>No headlines for that subject right now.</p>')); }
    if (p === '/topics') return send(res, 200, 'text/html; charset=utf-8', renderTopicsIndex());
    if ((m = p.match(/^\/topic\/([a-z0-9-]+)\/rss\.xml$/))) { const x = await renderTopicRss(m[1]); return x ? send(res, 200, 'application/rss+xml', x) : send(res, 404, 'text/plain', 'no feed'); }
    if ((m = p.match(/^\/topic\/([a-z0-9-]+)$/))) { const h = await renderTopic(m[1]); return h ? send(res, 200, 'text/html; charset=utf-8', h) : send(res, 404, 'text/html', PAGE('Not found', '<p>No such news feed.</p>')); }
    if (p === '/') return send(res, 200, 'text/html; charset=utf-8', await renderPortal(opts));
    if ((m = p.match(/^\/our\/([a-z0-9-]+)\/rss\.xml$/))) return isOurSection(m[1]) ? send(res, 200, 'application/rss+xml', renderRss({ section: m[1], opts })) : send(res, 404, 'text/plain', 'no feed');
    if ((m = p.match(/^\/our\/([a-z0-9-]+)$/))) { const h = renderOurSection(m[1], opts); return h ? send(res, 200, 'text/html; charset=utf-8', h) : send(res, 404, 'text/html', PAGE('Not found', '<p>No such section.</p>')); }
    if ((m = p.match(/^\/c\/([a-z0-9-]+)\/rss\.xml$/))) { const x = await renderWireRss(m[1], opts); return x ? send(res, 200, 'application/rss+xml', x) : send(res, 404, 'text/plain', 'no feed'); }
    if ((m = p.match(/^\/c\/([a-z0-9-]+)$/))) { const h = await renderWireCategory(m[1], opts); return h ? send(res, 200, 'text/html; charset=utf-8', h) : send(res, 404, 'text/html', PAGE('Not found', '<p>No such category.</p>')); }
    if ((m = p.match(/^\/item\/([a-z0-9-]+)$/))) { const h = renderItem(m[1], opts); return h ? send(res, 200, 'text/html; charset=utf-8', h) : send(res, 404, 'text/html', PAGE('Not found', '<p>No such story.</p>')); }
    return send(res, 404, 'text/html; charset=utf-8', PAGE('Not found', '<p>Not found.</p>'));
  } catch (e) { try { res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error'); } catch {} }
}

if (typeof process !== 'undefined' && process.argv && import.meta.url === `file://${process.argv[1]}`) {
  const { createServer } = await import('node:http');
  const PORT = Number(env('PORT', '8166'));
  createServer((req, res) => handler(req, res)).listen(PORT, () => console.log(`Herald Newsroom on :${PORT} — ${BASE_URL()} (${WIRE_CATEGORIES.length} wire cats + ${OUR_SECTIONS.length} our sections)`));
}
