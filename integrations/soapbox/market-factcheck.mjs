// market-factcheck.mjs — the market fact-checker. Cross-checks a coin's basic facts against
// independent sources so a coin page (or the Clarity score, or Hathor answering "can I buy X in
// the US?") can flag claims that don't hold up: a dead homepage, an exchange that no longer lists
// the token, a coin that only trades on venues a US person can't legally use.
//
// ADVISORY / FLAG-ONLY. Like the Ashurbanipal fact-checker, this NEVER edits a data record — it
// returns flags for the page and the operator to read. Verdicts are best-effort and fallible
// (an upstream 429, a homepage behind Cloudflare, a venue CoinGecko hasn't re-scraped). Treat the
// flags as "look here," not "this is false." Source of truth stays the records; this only reports.
//
// Everything here is keyless + best-effort + cached:
//   - getCoin / coinTickers (CoinGecko, keyless)         → does the coin resolve, who lists it
//   - markets-catalog (CRYPTO_EXCHANGES, us-tags)        → is a listing venue US-usable
//   - a light HEAD/GET link checker                      → does the homepage / outbound link load
//   - cache.cached(...)                                  → never hammers upstreams into a rate-limit
//
//   import { verifyCoin, whereToTrade, checkLinks, factCheckReport } from './market-factcheck.mjs'
//   const wt = await whereToTrade('bitcoin')   // { id, exchanges:[{name, us, ...}], usSummary, ... }
//   node integrations/soapbox/market-factcheck.mjs bitcoin

import { getCoin, coinTickers } from './condenser.mjs';
import { CRYPTO_EXCHANGES } from './markets-catalog.mjs';
import { cached, TTL } from './cache.mjs';

// fetch is overridable for tests (mirrors condenser/scraper __setFetch convention).
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// --- link checking ----------------------------------------------------------
// A single HEAD (then GET fallback — some hosts 405 HEAD) with a short timeout. We only care whether
// the URL resolves to *something live and not parked*, so we return the status + an ok flag. This is
// deliberately lighter than scraper.fetchClean (no Jina, no markdown) because all we need is a code.
async function headOrGet(url, ms = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  const opts = { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA } };
  try {
    let r;
    try { r = await _fetch(url, { ...opts, method: 'HEAD' }); }
    catch { r = null; }
    // HEAD blocked/failed → try a GET (still cheap; we don't read the body).
    if (!r || r.status === 405 || r.status === 501 || r.status === 403) {
      r = await _fetch(url, { ...opts, method: 'GET' });
    }
    return { status: r.status, ok: r.status >= 200 && r.status < 400 };
  } catch (err) {
    return { status: 0, ok: false, error: String(err?.name || err?.message || err) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Verify a set of outbound links resolve (not dead / not a network error). Returns one row per url:
 *   { url, ok, status, error? }
 * Cached per-url (links rarely change minute-to-minute). Bad/empty inputs are returned as not-ok
 * rather than thrown, so a caller can pass a coin's whole link bag without pre-filtering.
 */
export async function checkLinks(urls = []) {
  const list = (Array.isArray(urls) ? urls : [urls]).filter(Boolean).map(String);
  return Promise.all(list.map(async (url) => {
    if (!/^https?:\/\//i.test(url)) return { url, ok: false, status: 0, error: 'not-an-http-url' };
    const res = await cached(`linkcheck:${url}`, TTL.metadata, () => headOrGet(url));
    return { url, ...res };
  }));
}

// --- exchange normalization + US-availability lookup -------------------------
// CoinGecko ticker market names ("Coinbase Exchange", "Binance US", "Crypto.com Exchange", "Kraken")
// don't always match our catalog labels ("Coinbase", "Binance.US", "Crypto.com", "Kraken"). Normalize
// both sides to a comparable key so we can attach the catalog's us-tag to a live ticker.
function exKey(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(exchange|global|spot|pro|advanced|trade|international|com)\b/g, ' ')
    .replace(/[.\-_]/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// catalog index by normalized key (built once).
const CATALOG_BY_KEY = (() => {
  const m = new Map();
  for (const e of CRYPTO_EXCHANGES) {
    const k = exKey(e.name);
    if (k && !m.has(k)) m.set(k, e);
  }
  return m;
})();

// Match a CoinGecko exchange name to a catalog venue → its us-tag. Returns the matched catalog entry
// or null. Tries exact normalized key, then a loose first-word match (so "Binance US" finds "Binance.US"
// via 'binance us' and a bare "Binance" finds "Binance"). 'binance us' must NOT collapse to 'binance'.
function catalogFor(name) {
  const k = exKey(name);
  if (!k) return null;
  if (CATALOG_BY_KEY.has(k)) return CATALOG_BY_KEY.get(k);
  // try progressively shorter prefixes so "kraken futures" → "kraken", but keep distinct multi-word
  // venues (binance us vs binance) intact by checking the full key first (done above).
  const parts = k.split(' ');
  for (let n = parts.length - 1; n >= 1; n--) {
    const pref = parts.slice(0, n).join(' ');
    if (CATALOG_BY_KEY.has(pref)) return CATALOG_BY_KEY.get(pref);
  }
  return null;
}

// us-tag → plain meaning, for the page / Hathor.
const US_LABEL = { full: 'US-usable', partial: 'US-usable (with carve-outs)', no: 'US-restricted', unknown: 'US status unverified' };

/**
 * Where a coin actually trades — aggregated from CoinGecko's keyless tickers endpoint, normalized,
 * de-duplicated by exchange, and cross-referenced to the markets catalog for US-availability.
 *
 * Returns:
 *   {
 *     id, source,                          // coin id; 'coingecko' | 'hive-engine' | 'none'
 *     exchanges: [{ name, us, usLabel, inCatalog, pairs:[...], volume_usd, trust, url }],
 *     usSummary: { full, partial, no, unknown, usUsable, anyUsUsable },
 *     flags: [...]
 *   }
 *
 * This is the function that answers the operator's "show people what exchanges they can get each coin
 * on, US-aware." Hive-Engine / node ids have no CoinGecko tickers → exchanges:[] with an explanatory flag.
 */
export async function whereToTrade(id, { limit = 24 } = {}) {
  if (!id) return { id, source: 'none', exchanges: [], usSummary: emptyUsSummary(), flags: ['no-id'] };

  if (id.startsWith('hive-engine:')) {
    return {
      id, source: 'hive-engine', exchanges: [], usSummary: emptyUsSummary(),
      flags: ['hive-engine-token: trades on the Hive-Engine internal market (HIVE pairs), not on listed CEX/DEX venues'],
    };
  }
  if (id.startsWith('node:') || id.startsWith('gt:')) {
    return { id, source: id.split(':')[0], exchanges: [], usSummary: emptyUsSummary(), flags: ['no-cex-tickers-for-this-source'] };
  }

  return cached(`wheretotrade:${id}:${limit}`, TTL.metadata, async () => {
    const tickers = await coinTickers(id, { limit }).catch(() => []);
    // de-dupe by exchange: keep the highest-volume pair as the representative, collect all pairs.
    const byEx = new Map();
    for (const t of tickers) {
      if (!t.exchange) continue;
      const cur = byEx.get(t.exchange);
      if (!cur) {
        byEx.set(t.exchange, { name: t.exchange, pairs: [t.pair].filter(Boolean), volume_usd: t.volume_usd || 0, trust: t.trust, url: t.url || '' });
      } else {
        if (t.pair && !cur.pairs.includes(t.pair)) cur.pairs.push(t.pair);
        cur.volume_usd += t.volume_usd || 0;
        if (!cur.url && t.url) cur.url = t.url;
      }
    }
    const exchanges = [...byEx.values()]
      .map((e) => {
        const cat = catalogFor(e.name);
        const us = cat ? cat.us : 'unknown';
        return { ...e, us, usLabel: US_LABEL[us] || US_LABEL.unknown, inCatalog: !!cat };
      })
      .sort((a, b) => b.volume_usd - a.volume_usd);

    const usSummary = summarizeUs(exchanges);
    const flags = [];
    if (!exchanges.length) flags.push('no-tickers: CoinGecko lists no active exchanges for this coin (delisted, micro-cap, or upstream throttled)');
    else if (!usSummary.anyUsUsable) flags.push('only-on-us-restricted-exchanges: no US-usable venue found among the listed exchanges');
    if (exchanges.length && usSummary.unknown === exchanges.length) flags.push('all-venues-us-unverified: none of the listing venues are in the catalog — US status unknown');

    return { id, source: 'coingecko', exchanges, usSummary, flags };
  });
}

function emptyUsSummary() { return { full: 0, partial: 0, no: 0, unknown: 0, usUsable: 0, anyUsUsable: false }; }
function summarizeUs(exchanges) {
  const s = emptyUsSummary();
  for (const e of exchanges) s[e.us] = (s[e.us] || 0) + 1;
  s.usUsable = (s.full || 0) + (s.partial || 0);
  s.anyUsUsable = s.usUsable > 0;
  return s;
}

/**
 * Cross-check a coin's basic facts against independent sources.
 * Returns:
 *   {
 *     id, resolves,                 // did getCoin return a coin?
 *     name, symbol,
 *     websiteOk, website,           // does the homepage actually load?
 *     exchanges: [{ name, verified, us, usLabel }],   // claimed/listing venues + did CG confirm them
 *     flags: [...]
 *   }
 * `verified` here means "CoinGecko's tickers endpoint confirms this venue currently lists the coin"
 * (an independent read from the coin's own metadata), so a stale "listed on X" claim shows verified:false.
 */
export async function verifyCoin(id) {
  const flags = [];
  if (!id) return { id, resolves: false, websiteOk: false, exchanges: [], flags: ['no-id'] };

  const coin = await getCoin(id).catch(() => null);
  const resolves = !!coin;
  if (!resolves) {
    return { id, resolves: false, name: '', symbol: '', websiteOk: false, website: '', exchanges: [], flags: ['unresolved: no provider returned this coin id'] };
  }

  const website = coin.links?.website || '';
  let websiteOk = null; // null = no website claimed
  if (website) {
    const [res] = await checkLinks([website]);
    websiteOk = !!res?.ok;
    if (!websiteOk) flags.push(`website-dead: homepage ${website} did not load (status ${res?.status ?? 0})`);
  } else {
    flags.push('no-website: coin record lists no homepage link');
  }

  // independent confirmation of where it lists, via the same tickers read whereToTrade uses.
  const wt = await whereToTrade(id).catch(() => null);
  const exchanges = (wt?.exchanges || []).map((e) => ({ name: e.name, verified: true, us: e.us, usLabel: e.usLabel }));
  if (!exchanges.length) flags.push('no-verified-exchanges: CoinGecko confirms no active listing venue');
  for (const f of (wt?.flags || [])) if (!flags.includes(f)) flags.push(f);

  return { id, resolves: true, name: coin.name || '', symbol: coin.symbol || '', websiteOk, website, exchanges, flags };
}

/**
 * One advisory object combining the above — what a coin page or the Clarity score consumes.
 * Returns:
 *   {
 *     id, name, symbol, resolves,
 *     website: { url, ok },
 *     whereToTrade: { exchanges, usSummary },
 *     links: [{ url, ok, status }],          // homepage + explorer + socials, individually checked
 *     flags: [...],                          // merged, de-duped advisory flags
 *     ok                                     // true when nothing flagged (clean bill)
 *   }
 * Cached: the whole report is metadata-tier (homepage/listings don't churn fast).
 */
export async function factCheckReport(id) {
  if (!id) return { id, resolves: false, flags: ['no-id'], ok: false };
  return cached(`factcheck:${id}`, TTL.metadata, async () => {
    const coin = await getCoin(id).catch(() => null);
    if (!coin) return { id, resolves: false, name: '', symbol: '', flags: ['unresolved: no provider returned this coin id'], ok: false };

    // gather the coin's outbound links (homepage, explorer, socials) for a link sweep.
    const linkSet = [
      coin.links?.website,
      coin.links?.explorer,
      ...(coin.links?.social || []),
    ].filter(Boolean);

    const [linkResults, wt] = await Promise.all([
      checkLinks(linkSet),
      whereToTrade(id).catch(() => null),
    ]);

    const website = coin.links?.website || '';
    const websiteRow = linkResults.find((l) => l.url === website);
    const websiteOk = website ? !!websiteRow?.ok : null;

    const flags = [];
    if (!website) flags.push('no-website: coin record lists no homepage link');
    else if (!websiteOk) flags.push(`website-dead: homepage did not load (status ${websiteRow?.status ?? 0})`);
    const deadLinks = linkResults.filter((l) => l.url !== website && !l.ok);
    if (deadLinks.length) flags.push(`dead-links: ${deadLinks.length} of ${linkResults.length} outbound link(s) did not load`);
    for (const f of (wt?.flags || [])) if (!flags.includes(f)) flags.push(f);

    return {
      id, name: coin.name || '', symbol: coin.symbol || '', resolves: true,
      website: { url: website, ok: websiteOk },
      whereToTrade: { exchanges: wt?.exchanges || [], usSummary: wt?.usSummary || emptyUsSummary() },
      links: linkResults,
      flags,
      ok: flags.length === 0,
    };
  });
}

// CLI: node integrations/soapbox/market-factcheck.mjs <coin-id> [--where]
if (process.argv[1] && process.argv[1].endsWith('market-factcheck.mjs')) {
  const id = process.argv[2] || 'bitcoin';
  const mode = process.argv.includes('--where') ? 'where' : process.argv.includes('--verify') ? 'verify' : 'report';
  const out = mode === 'where' ? await whereToTrade(id) : mode === 'verify' ? await verifyCoin(id) : await factCheckReport(id);
  console.log(JSON.stringify(out, null, 2));
}
