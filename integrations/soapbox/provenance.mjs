// provenance.mjs — the reusable cross-vertical PROVENANCE + Source-Confidence layer (queue #99, doc 6).
//
// Every record SoapBox surfaces (a price quote, a stock profile, a news item, a wiki fact, a chain
// lookup) should carry WHERE it came from, WHEN it was fetched, and HOW fresh/reliable that makes it.
// This module is the single, shared way to do that across all the verticals, so confidence is
// *computed* the same way everywhere — never bought, never editorial. Pure functions, NO network:
// the caller does the fetching and hands us {source, fetchedAt, freshnessClass}; we attach an
// envelope and derive scores from it.
//
//   tag(record, {source, fetchedAt, freshnessClass})  → record with a `_provenance` envelope attached
//   freshnessScore(record, now)                        → 0..1, decays by freshness class + age
//   sourceReliability(source)                          → 0..1, lookup of known sources (default mid)
//   sourceConfidence(record, now)                      → 0..100, freshness × reliability (computed)
//   validate(record)                                   → { ok, errors[] }, asserts envelope fields
//
//   import { tag, freshnessScore, sourceReliability, sourceConfidence, validate } from './integrations/soapbox/provenance.mjs'
//   node integrations/soapbox/provenance.mjs        # demo with a tiny offline fixture
//
// freshnessClass vocabulary (the standard set):
//   'LIVE'            — pulled live this request (real-time price, live search)
//   'DAILY'           — refreshed on a daily cadence (daily snapshot, cron job)
//   'collected-YYYY'  — a point-in-time scrape/dataset stamped with its collection year
//   'static'          — reference data that does not go stale (definitions, historical facts)

// ── source reliability table ──────────────────────────────────────────────────────────────────────
// Known sources mapped to a baseline reliability 0..1. Tiers:
//   gov / official / primary-source ...... high   (0.90–0.98)
//   curated / reputable aggregator ....... high-ish (0.80–0.88)
//   freemium / commercial API ............ mid    (0.55–0.72)
//   community / crowdsourced ............. mid-low (0.45–0.60)
//   raw scrape / unverified web .......... lower  (0.25–0.40)
// Keys are matched case-insensitively, and as a substring of the source string (so
// 'coingecko-pro' still matches 'coingecko'). Longest matching key wins.
export const SOURCE_RELIABILITY = {
  // gov / official / primary
  'sec': 0.97,
  'edgar': 0.97,
  'sec-edgar': 0.97,
  'federalreserve': 0.97,
  'fred': 0.95,
  'treasury': 0.96,
  'bls': 0.95,
  'census': 0.95,
  'who': 0.95,
  'nasa': 0.96,
  'gov': 0.92,

  // chain / on-chain primary (the data IS the ledger)
  'melek': 0.95,
  'steemd': 0.9,
  'hive-engine': 0.85,
  'hiveengine': 0.85,
  'on-chain': 0.95,
  'onchain': 0.95,

  // curated / reputable aggregator / reference
  'wikipedia': 0.85,
  'wikidata': 0.85,
  'crossref': 0.9,
  'openalex': 0.88,
  'arxiv': 0.85,
  'pubmed': 0.9,
  'archive.org': 0.82,
  'reuters': 0.88,
  'apnews': 0.88,
  'ap': 0.88,
  'bbc': 0.84,

  // freemium / commercial API (mid)
  'coingecko': 0.7,
  'coinmarketcap': 0.7,
  'cmc': 0.7,
  'coinpaprika': 0.65,
  'cryptocompare': 0.65,
  'alphavantage': 0.68,
  'alpha-vantage': 0.68,
  'finnhub': 0.68,
  'yahoo': 0.62,
  'yahoo-finance': 0.62,
  'yfinance': 0.62,
  'newsapi': 0.6,
  'gnews': 0.58,
  'crunchbase': 0.72,
  'clearbit': 0.6,

  // community / crowdsourced
  'reddit': 0.5,
  'quora': 0.45,
  'stackoverflow': 0.6,
  'bitcointalk': 0.5,
  'community': 0.5,
  'user-submitted': 0.48,
  'submitted': 0.48,

  // raw scrape / unverified
  'scrape': 0.35,
  'scraper': 0.35,
  'metasearch': 0.4,
  'web': 0.35,
  'duckduckgo': 0.4,
  'rss': 0.45,
  'unknown': 0.3,
};

// Reliability for a source not in the table — deliberately middling, never 0, so an unknown source
// still gets *some* confidence but is clearly below curated ones.
export const DEFAULT_RELIABILITY = 0.5;

// ── freshness-class vocabulary ──────────────────────────────────────────────────────────────────────
export const FRESHNESS_CLASSES = ['LIVE', 'DAILY', 'static'];
const COLLECTED_RE = /^collected-(\d{4})$/;

export function isValidFreshnessClass(fc) {
  if (typeof fc !== 'string') return false;
  return FRESHNESS_CLASSES.includes(fc) || COLLECTED_RE.test(fc);
}

// Per-class freshness decay. Each returns 0..1 given the age in days. LIVE decays fast (a live quote
// is stale within hours), DAILY over a few days, collected-YYYY slowly over years, static never.
function decayLive(days) {
  // half-life ~0.5 day → near-0 after a couple of days.
  return Math.exp(-Math.LN2 * (days / 0.5));
}
function decayDaily(days) {
  // half-life ~3 days → a daily snapshot is solid for a day or two, fading across a week.
  return Math.exp(-Math.LN2 * (days / 3));
}
function decayCollected(days, yearsOld) {
  // half-life ~3 years → point-in-time datasets age gracefully. yearsOld (from the stamp) takes
  // precedence over wall-clock age when available.
  const y = Number.isFinite(yearsOld) ? Math.max(0, yearsOld) : Math.max(0, days / 365);
  return Math.exp(-Math.LN2 * (y / 3));
}

// ── tag ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Attach a standard provenance envelope to `record` (returns the same record, mutated, for chaining).
 *   tag(rec, { source, fetchedAt, freshnessClass })
 * - source         (required) the origin id, e.g. 'coingecko', 'sec-edgar', 'scrape'.
 * - fetchedAt      ISO string | epoch ms | Date. Defaults to now if omitted.
 * - freshnessClass one of LIVE | DAILY | collected-YYYY | static. Defaults to 'LIVE'.
 * The envelope lives on `record._provenance`.
 */
export function tag(record, { source, fetchedAt, freshnessClass = 'LIVE' } = {}) {
  if (!record || typeof record !== 'object') throw new TypeError('tag(record, …): record must be an object');
  if (!source || typeof source !== 'string') throw new TypeError('tag(): { source } is required and must be a string');
  if (!isValidFreshnessClass(freshnessClass)) {
    throw new RangeError(`tag(): freshnessClass must be LIVE | DAILY | collected-YYYY | static (got ${JSON.stringify(freshnessClass)})`);
  }
  const ms = toMs(fetchedAt, Date.now());
  record._provenance = {
    source: source.trim(),
    fetchedAt: new Date(ms).toISOString(),
    freshnessClass,
  };
  return record;
}

function toMs(v, fallback = NaN) {
  if (v == null) return fallback;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  const p = Date.parse(v);
  return Number.isFinite(p) ? p : fallback;
}

function envelopeOf(record) {
  return record && typeof record === 'object' ? record._provenance : undefined;
}

// ── freshnessScore ──────────────────────────────────────────────────────────────────────────────────
/**
 * 0..1 freshness from the record's envelope, decaying by class + age. Pure.
 *   - static            → always 1.
 *   - LIVE / DAILY      → decay from fetchedAt to `now`.
 *   - collected-YYYY    → decay by years since the stamped year (slow).
 * Records with no envelope, an unparseable date, or future timestamps degrade gracefully.
 */
export function freshnessScore(record, now = Date.now()) {
  const env = envelopeOf(record);
  if (!env) return 0;
  const fc = env.freshnessClass;
  const nowMs = toMs(now, Date.now());

  if (fc === 'static') return 1;

  const collected = typeof fc === 'string' && COLLECTED_RE.exec(fc);
  if (collected) {
    const year = Number(collected[1]);
    const nowYear = new Date(nowMs).getUTCFullYear();
    const yearsOld = nowYear - year;
    return clamp01(decayCollected(NaN, yearsOld));
  }

  const fetchedMs = toMs(env.fetchedAt, NaN);
  if (!Number.isFinite(fetchedMs)) return 0;
  let days = (nowMs - fetchedMs) / 86400000;
  if (days < 0) days = 0; // future fetchedAt → treat as brand new, not >1.

  if (fc === 'LIVE') return clamp01(decayLive(days));
  if (fc === 'DAILY') return clamp01(decayDaily(days));
  return 0; // unknown class (shouldn't happen — tag() validates)
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

// ── sourceReliability ────────────────────────────────────────────────────────────────────────────────
/**
 * 0..1 baseline reliability for a source id. Case-insensitive; an exact match wins, otherwise the
 * source is split into word tokens (on non-alphanumerics) and the longest table key that appears as
 * a whole token (e.g. 'coingecko' in 'coingecko-pro') wins. Token-boundary matching avoids false
 * hits like short key 'ap' inside 'some-random-api'. Unknown → DEFAULT_RELIABILITY.
 */
export function sourceReliability(source) {
  if (!source || typeof source !== 'string') return DEFAULT_RELIABILITY;
  const s = source.toLowerCase().trim();
  if (Object.prototype.hasOwnProperty.call(SOURCE_RELIABILITY, s)) return SOURCE_RELIABILITY[s];
  const tokens = new Set(s.split(/[^a-z0-9.]+/).filter(Boolean));
  let best = null;
  for (const key of Object.keys(SOURCE_RELIABILITY)) {
    if (tokens.has(key) && (best === null || key.length > best.length)) best = key;
  }
  return best === null ? DEFAULT_RELIABILITY : SOURCE_RELIABILITY[best];
}

// ── sourceConfidence ─────────────────────────────────────────────────────────────────────────────────
/**
 * 0..100 confidence for a record — computed, never bought. confidence = freshness × reliability,
 * scaled to 0..100. Records with no envelope score 0. Pure.
 */
export function sourceConfidence(record, now = Date.now()) {
  const env = envelopeOf(record);
  if (!env) return 0;
  const fresh = freshnessScore(record, now);
  const rel = sourceReliability(env.source);
  return Math.round(fresh * rel * 100);
}

// ── validate ──────────────────────────────────────────────────────────────────────────────────────────
/**
 * Assert the provenance envelope is present and well-formed.
 * Returns { ok:boolean, errors:string[] }. Never throws.
 */
export function validate(record) {
  const errors = [];
  if (!record || typeof record !== 'object') {
    return { ok: false, errors: ['record is not an object'] };
  }
  const env = record._provenance;
  if (!env || typeof env !== 'object') {
    return { ok: false, errors: ['missing _provenance envelope'] };
  }
  if (!env.source || typeof env.source !== 'string') errors.push('missing or invalid _provenance.source');
  if (!env.fetchedAt || typeof env.fetchedAt !== 'string' || !Number.isFinite(Date.parse(env.fetchedAt))) {
    errors.push('missing or unparseable _provenance.fetchedAt');
  }
  if (!isValidFreshnessClass(env.freshnessClass)) {
    errors.push('missing or invalid _provenance.freshnessClass (expected LIVE | DAILY | collected-YYYY | static)');
  }
  return { ok: errors.length === 0, errors };
}

// ── CLI demo (offline) ────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('provenance.mjs')) {
  const now = Date.now();
  const day = 86400000;
  const samples = [
    tag({ id: 'btc-live' }, { source: 'coingecko', freshnessClass: 'LIVE', fetchedAt: now }),
    tag({ id: 'btc-2h-old' }, { source: 'coingecko', freshnessClass: 'LIVE', fetchedAt: now - 2 * 3600000 }),
    tag({ id: 'aapl-filing' }, { source: 'sec-edgar', freshnessClass: 'DAILY', fetchedAt: now - 1 * day }),
    tag({ id: 'census-2020' }, { source: 'census', freshnessClass: 'collected-2020' }),
    tag({ id: 'definition' }, { source: 'wikipedia', freshnessClass: 'static' }),
    tag({ id: 'rumor' }, { source: 'scrape', freshnessClass: 'LIVE', fetchedAt: now - 5 * day }),
  ];
  for (const s of samples) {
    const v = validate(s);
    console.log(
      `${s.id.padEnd(14)} src=${s._provenance.source.padEnd(10)} class=${s._provenance.freshnessClass.padEnd(16)} ` +
      `fresh=${freshnessScore(s, now).toFixed(2)} rel=${sourceReliability(s._provenance.source).toFixed(2)} ` +
      `confidence=${String(sourceConfidence(s, now)).padStart(3)} valid=${v.ok}`
    );
  }
  const bad = validate({ id: 'no-envelope' });
  console.log(`\nvalidate(no-envelope): ok=${bad.ok} errors=[${bad.errors.join('; ')}]`);
}
