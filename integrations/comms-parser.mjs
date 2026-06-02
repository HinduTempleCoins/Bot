// comms-parser.mjs — the "communications parser" (task #179). It turns news/article feeds
// (crypto, forex, markets) into the uniform "Diagnostics" layer the briefs read: a structured
// summary of WHAT THE NEWS IS SAYING, not the raw text. This is the news/sentiment counterpart to
// resource-center.mjs's price/volume diagnostics — together they answer "what's the market doing AND
// what's the market talking about."
//
// Pipeline (operator's vision, #179):
//   news / old articles / "what the news says about crypto + ForEx"
//      → fetchHeadlines()  (keyless RSS feeds + a scraper news-search, normalized + cached)
//      → toDiagnostics()   (sentiment hint + ticker mentions + extracted themes — the uniform shape)
//      → newsDigest()      (per-asset crunch → a compact object + a brief-ready markdown block)
//      → Resource Center / bots / Data / briefs consume it.
//
// Keyless, cached, best-effort: every network call is wrapped so the parser NEVER throws — a dead
// feed yields an empty list, the digest still completes (same contract as resource-center.runPass).
//
//   node integrations/comms-parser.mjs crypto         # print the diagnostics digest for crypto
//   node integrations/comms-parser.mjs forex gold      # multiple assets
//   node integrations/comms-parser.mjs --json crypto   # raw digest JSON

import { cached, TTL } from './soapbox/cache.mjs';
import { search } from './scraper.mjs';

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
const FEED_TTL = +(process.env.COMMS_FEED_TTL_MS || TTL.list);     // 60s — headlines move, but not by the second
const TIMEOUT_MS = +(process.env.COMMS_TIMEOUT_MS || 15000);

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function withTimeout(url, opts = {}, ms = TIMEOUT_MS) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), ms);
  try { return await _fetch(url, { ...opts, signal: ctrl.signal, headers: { 'user-agent': UA, ...(opts.headers || {}) } }); }
  finally { clearTimeout(t); }
}

// ── NEWS_FEEDS — keyless news sources. asset is the bucket the feed mostly serves; kind selects the
// fetch path. RSS feeds are parsed for <item>; the GDELT 'api' returns JSON; 'search' is handled by
// the scraper. Override the set via env COMMS_FEEDS (JSON) if a feed dies / a new one is added. ────
export const NEWS_FEEDS = [
  // crypto
  { name: 'CryptoPanic', url: 'https://cryptopanic.com/news/rss/', asset: 'crypto', kind: 'rss' },
  { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', asset: 'crypto', kind: 'rss' },
  { name: 'Cointelegraph', url: 'https://cointelegraph.com/rss', asset: 'crypto', kind: 'rss' },
  { name: 'Bitcoin Magazine', url: 'https://bitcoinmagazine.com/feed', asset: 'crypto', kind: 'rss' },
  { name: 'Decrypt', url: 'https://decrypt.co/feed', asset: 'crypto', kind: 'rss' },
  // forex / macro
  { name: 'FXStreet', url: 'https://www.fxstreet.com/rss/news', asset: 'forex', kind: 'rss' },
  { name: 'Investing.com Forex', url: 'https://www.investing.com/rss/news_1.rss', asset: 'forex', kind: 'rss' },
  { name: 'Reuters Markets', url: 'https://www.reutersagency.com/feed/?best-topics=markets&post_type=best', asset: 'markets', kind: 'rss' },
  { name: 'Investing.com Commodities', url: 'https://www.investing.com/rss/news_11.rss', asset: 'gold', kind: 'rss' },
  // keyless aggregator API — GDELT Doc 2.0 (no key). Query is filled in per-asset at fetch time.
  { name: 'GDELT', url: 'https://api.gdeltproject.org/api/v2/doc/doc', asset: 'any', kind: 'api' },
  // generic news-search fallback via the scraper (DuckDuckGo) — always available, asset-agnostic.
  { name: 'NewsSearch', asset: 'any', kind: 'search' },
];

function feedsFor(asset) {
  if (!asset || asset === 'any') return NEWS_FEEDS;
  return NEWS_FEEDS.filter((f) => f.asset === asset || f.asset === 'any');
}

// ── RSS/Atom parsing — extract <item>/<entry> title, link, pubDate. Dependency-free, tolerant of the
// many slightly-different feed dialects in the wild. Never throws — returns [] on any malformation. ─
function decodeEntities(s = '') {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .replace(/&#x27;/gi, "'").replace(/&nbsp;/g, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}
function tag(block, name) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return m ? m[1] : '';
}
function atomLink(block) {
  // Atom <link href="..."/> (prefer rel="alternate"); fall back to RSS <link>text</link>.
  const alt = block.match(/<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i);
  if (alt) return alt[1];
  const any = block.match(/<link[^>]*href=["']([^"']+)["']/i);
  if (any) return any[1];
  return decodeEntities(tag(block, 'link'));
}
function parseFeed(xml, { source, asset }) {
  const out = [];
  const blocks = [...String(xml || '').matchAll(/<(item|entry)[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  for (const b of blocks) {
    const title = decodeEntities(tag(b, 'title'));
    if (!title) continue;
    const url = (atomLink(b) || '').trim();
    const date = decodeEntities(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    const t = Date.parse(date);
    out.push({ title, url, source, ts: Number.isFinite(t) ? new Date(t).toISOString() : null, asset });
  }
  return out;
}

async function fetchRss(feed) {
  try {
    const r = await withTimeout(feed.url, { headers: { accept: 'application/rss+xml, application/xml, text/xml, */*' } });
    if (!r.ok) return [];
    return parseFeed(await r.text(), { source: feed.name, asset: feed.asset });
  } catch { return []; }
}

// GDELT Doc 2.0 — keyless full-text news index. We ask for the article list as JSON for the query.
async function fetchGdelt(feed, query, asset) {
  try {
    const q = `${query || 'cryptocurrency OR forex OR markets'}`;
    const u = `${feed.url}?query=${encodeURIComponent(q)}&mode=ArtList&format=json&maxrecords=25&sort=DateDesc&timespan=2d`;
    const r = await withTimeout(u, { headers: { accept: 'application/json' } });
    if (!r.ok) return [];
    const d = await r.json().catch(() => ({}));
    return (d.articles || []).map((a) => ({
      title: decodeEntities(a.title || ''), url: a.url || '',
      source: a.domain ? `GDELT:${a.domain}` : 'GDELT',
      ts: a.seendate ? gdeltDate(a.seendate) : null, asset,
    })).filter((h) => h.title);
  } catch { return []; }
}
function gdeltDate(s) {                                  // GDELT seendate is YYYYMMDDTHHMMSSZ
  const m = String(s).match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (!m) { const t = Date.parse(s); return Number.isFinite(t) ? new Date(t).toISOString() : null; }
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z`;
}

// Scraper news-search path — "<query> crypto news", keyless DuckDuckGo via scraper.search().
async function fetchSearch(query, asset) {
  const q = `${query || asset || 'crypto'} news`;
  try {
    const rows = await search(q, { limit: 10 });
    return rows.map((r) => ({ title: r.title, url: r.url, source: hostOf(r.url) || 'web-search', ts: null, asset }));
  } catch { return []; }
}
function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } }

/**
 * Pull recent headlines best-effort for an asset (and/or a free-text query). Hits the RSS feeds for
 * that asset, GDELT, and the scraper news-search in parallel, normalizes to a uniform shape, dedupes
 * by title, sorts newest-first, and caches. Never throws.
 *
 * @returns {Promise<Array<{title,url,source,ts,asset}>>}
 */
export async function fetchHeadlines({ asset = 'crypto', query = '', limit = 40 } = {}) {
  const key = `comms:headlines:${asset}:${query}`;
  return cached(key, FEED_TTL, async () => {
    const feeds = feedsFor(asset);
    const jobs = feeds.map((f) => {
      if (f.kind === 'rss') return fetchRss(f);
      if (f.kind === 'api') return fetchGdelt(f, query || queryFor(asset), asset);
      if (f.kind === 'search') return fetchSearch(query || asset, asset);
      return Promise.resolve([]);
    });
    const all = (await Promise.all(jobs.map((p) => p.catch(() => [])))).flat();
    // dedupe by normalized title, prefer entries that carry a timestamp
    const byTitle = new Map();
    for (const h of all) {
      if (!h.title) continue;
      const k = h.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().slice(0, 120);
      const prev = byTitle.get(k);
      if (!prev || (!prev.ts && h.ts)) byTitle.set(k, h);
    }
    const rows = [...byTitle.values()];
    rows.sort((a, b) => (Date.parse(b.ts || 0) || 0) - (Date.parse(a.ts || 0) || 0));
    return rows.slice(0, limit);
  }).catch(() => []);
}

// per-asset default search/GDELT query.
function queryFor(asset) {
  return ({
    crypto: 'cryptocurrency OR bitcoin OR ethereum',
    forex: 'forex OR "exchange rate" OR "us dollar"',
    gold: 'gold price OR precious metals',
    markets: 'stock market OR markets',
  })[asset] || asset || 'cryptocurrency';
}

// ── sentiment + theme lexicons (naive keyword scoring — a hint, not a model). The point isn't a
// precise score; it's a cheap, transparent "which way is the coverage leaning" signal the briefs can
// read and a human can sanity-check. ──────────────────────────────────────────────────────────────
const BULL = ['surge', 'surges', 'soar', 'soars', 'rally', 'rallies', 'rallying', 'gain', 'gains', 'jump', 'jumps', 'rise', 'rises', 'rising', 'bullish', 'bull', 'soaring', 'record high', 'all-time high', 'ath', 'breakout', 'moon', 'pump', 'up', 'climbs', 'climb', 'boom', 'recover', 'recovery', 'rebound', 'adoption', 'approval', 'approved', 'inflow', 'inflows', 'upgrade', 'green'];
const BEAR = ['crash', 'crashes', 'plunge', 'plunges', 'plummet', 'plummets', 'slump', 'slumps', 'fall', 'falls', 'falling', 'drop', 'drops', 'dump', 'bearish', 'bear', 'selloff', 'sell-off', 'sell off', 'liquidation', 'liquidations', 'hack', 'hacked', 'exploit', 'scam', 'fraud', 'lawsuit', 'sue', 'sued', 'ban', 'banned', 'crackdown', 'outflow', 'outflows', 'fear', 'fud', 'down', 'tumble', 'tumbles', 'losses', 'loss', 'warning', 'collapse', 'red', 'fine', 'fined', 'sec charges'];

// stop-words excluded from theme extraction.
const STOP = new Set('the a an and or but for to of in on at by with from as is are was were be been being this that these those it its their his her our your my you we they he she will would could should can may might more most than then so up down out over new news price after before amid says said how why what when who which into about against among per via vs amp'.split(' '));

// tickers / assets we count mentions of (uppercase tokens + common aliases). Add to this set freely.
const TICKERS = {
  BTC: ['btc', 'bitcoin'], ETH: ['eth', 'ethereum', 'ether'], SOL: ['sol', 'solana'], XRP: ['xrp', 'ripple'],
  BNB: ['bnb', 'binance coin'], DOGE: ['doge', 'dogecoin'], ADA: ['ada', 'cardano'], HIVE: ['hive'],
  USDT: ['usdt', 'tether'], USDC: ['usdc'], GOLD: ['gold', 'xau'], SILVER: ['silver', 'xag'],
  USD: ['usd', 'dollar', 'dxy'], EUR: ['eur', 'euro'], JPY: ['jpy', 'yen'], GBP: ['gbp', 'pound', 'sterling'],
  OIL: ['oil', 'crude', 'wti', 'brent'], SP500: ['s&p', 'sp500', 's&p 500', 'spx'], NASDAQ: ['nasdaq'],
};

function scoreSentiment(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  let bull = 0, bear = 0;
  for (const w of BULL) if (t.includes(' ' + w + ' ') || (w.includes(' ') && t.includes(w))) bull++;
  for (const w of BEAR) if (t.includes(' ' + w + ' ') || (w.includes(' ') && t.includes(w))) bear++;
  return { bull, bear };
}

function countMentions(text) {
  const t = ' ' + text.toLowerCase() + ' ';
  const counts = {};
  for (const [sym, aliases] of Object.entries(TICKERS)) {
    let n = 0;
    for (const a of aliases) {
      const re = new RegExp(`(^|[^a-z0-9$])${a.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')}([^a-z0-9]|$)`, 'g');
      const mm = t.match(re);
      if (mm) n += mm.length;
    }
    if (n) counts[sym] = n;
  }
  return counts;
}

function extractThemes(titles, topN = 12) {
  const freq = new Map();
  for (const title of titles) {
    for (const raw of title.toLowerCase().split(/[^a-z0-9'&]+/)) {
      const w = raw.replace(/^'+|'+$/g, '');
      if (w.length < 4 || STOP.has(w) || /^\d+$/.test(w)) continue;
      freq.set(w, (freq.get(w) || 0) + 1);
    }
  }
  return [...freq.entries()].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, topN)
    .map(([word, count]) => ({ word, count }));
}

/**
 * Crunch a list of headlines into ONE uniform "Diagnostics" record — the structured summary of "what
 * the news is saying" that the briefs / resource center read. Pure (no network), never throws.
 *
 * Shape:
 *   {
 *     topic,                       // the asset/query this batch is about
 *     headlineCount,               // how many headlines fed the record
 *     sentimentHint,               // 'bullish' | 'bearish' | 'neutral' (naive keyword lean)
 *     sentimentScore,              // signed -1..1 (bull-bear / total), for sorting/trend
 *     mentions,                    // { BTC: 5, ETH: 3, ... } ticker/asset counts across titles
 *     themes,                      // [{word, count}] top extracted keywords (what's being discussed)
 *     topHeadlines,                // a few representative {title, url, source} for citation
 *     sources,                     // distinct source names that contributed
 *     ts                           // when this record was crunched
 *   }
 */
export function toDiagnostics(headlines = [], { topic = '' } = {}) {
  const rows = (headlines || []).filter((h) => h && h.title);
  const titles = rows.map((h) => h.title);
  let bull = 0, bear = 0;
  const mentions = {};
  for (const h of rows) {
    const s = scoreSentiment(h.title); bull += s.bull; bear += s.bear;
    for (const [sym, n] of Object.entries(countMentions(h.title))) mentions[sym] = (mentions[sym] || 0) + n;
  }
  const total = bull + bear;
  const sentimentScore = total ? +((bull - bear) / total).toFixed(2) : 0;
  const sentimentHint = sentimentScore > 0.15 ? 'bullish' : sentimentScore < -0.15 ? 'bearish' : 'neutral';
  const sortedMentions = Object.fromEntries(Object.entries(mentions).sort((a, b) => b[1] - a[1]));
  const sources = [...new Set(rows.map((h) => h.source).filter(Boolean))];
  return {
    topic: topic || rows[0]?.asset || '',
    headlineCount: rows.length,
    sentimentHint, sentimentScore,
    sentimentRaw: { bull, bear },
    mentions: sortedMentions,
    themes: extractThemes(titles),
    topHeadlines: rows.slice(0, 6).map((h) => ({ title: h.title, url: h.url, source: h.source, ts: h.ts })),
    sources,
    ts: new Date().toISOString(),
  };
}

/**
 * Run fetch + toDiagnostics for a set of assets → a compact digest object + a brief-ready markdown
 * block. The single entry point the 24/7 resource-center engine and the brief writers call. Each
 * asset is independent and best-effort; a failed asset yields an empty diagnostics record, the digest
 * still completes.
 *
 * @returns {Promise<{ts, assets: Record<string, Diagnostics>, markdown}>}
 */
export async function newsDigest({ assets = ['crypto', 'forex', 'gold'], query = '', limit = 40 } = {}) {
  const list = Array.isArray(assets) ? assets : [assets];
  const records = await Promise.all(list.map(async (asset) => {
    const headlines = await fetchHeadlines({ asset, query, limit });
    return [asset, toDiagnostics(headlines, { topic: asset })];
  }));
  const byAsset = Object.fromEntries(records);
  const digest = { ts: new Date().toISOString(), assets: byAsset };
  digest.markdown = digestMarkdown(digest);
  return digest;
}

const ARROW = { bullish: '▲', bearish: '▼', neutral: '•' };

/** Brief-ready markdown — the "what the news is saying" section a 12&12 / brief writer drops in. */
export function digestMarkdown(digest) {
  const L = [];
  L.push(`## News Diagnostics — ${String(digest.ts).slice(0, 16).replace('T', ' ')} UTC\n`);
  L.push(`*What the news is talking about (crypto / forex / markets), crunched by the comms-parser.*\n`);
  for (const [asset, d] of Object.entries(digest.assets || {})) {
    if (!d || !d.headlineCount) { L.push(`### ${asset}\n_No headlines this pass._\n`); continue; }
    const mentions = Object.entries(d.mentions).slice(0, 6).map(([s, n]) => `${s}×${n}`).join(', ') || '—';
    const themes = d.themes.slice(0, 8).map((t) => t.word).join(', ') || '—';
    L.push(`### ${asset} — ${ARROW[d.sentimentHint]} ${d.sentimentHint} (${d.sentimentScore >= 0 ? '+' : ''}${d.sentimentScore})`);
    L.push(`- **Headlines:** ${d.headlineCount} from ${d.sources.length} sources.`);
    L.push(`- **Most-mentioned:** ${mentions}.`);
    L.push(`- **Themes:** ${themes}.`);
    for (const h of d.topHeadlines.slice(0, 3)) L.push(`  - ${h.title}${h.source ? ` _(${h.source})_` : ''}`);
    L.push('');
  }
  L.push(`*Engine: comms-parser.mjs · keyless, cached, advisory · sentiment is a naive keyword hint.*`);
  return L.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('comms-parser.mjs')) {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const assets = args.filter((a) => !a.startsWith('--'));
  const digest = await newsDigest({ assets: assets.length ? assets : ['crypto', 'forex', 'gold'] });
  if (json) console.log(JSON.stringify(digest, null, 2));
  else console.log(digest.markdown);
}
