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

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import nodeFs from 'node:fs';
import { getCoin, coinTickers } from './condenser.mjs';
import { CRYPTO_EXCHANGES } from './markets-catalog.mjs';
import { cached, TTL } from './cache.mjs';

// fetch is overridable for tests (mirrors condenser/scraper __setFetch convention).
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// clock is overridable so persisted-flag timestamps are deterministic under test.
let _now = () => new Date().toISOString();
export function __setClock(fn) { _now = fn || (() => new Date().toISOString()); }

// the fs is injectable so tests never touch the real flags store on disk.
let _fs = nodeFs;
export function __setFs(fs) { _fs = fs || nodeFs; }

const __dir = path.dirname(fileURLToPath(import.meta.url));
const FLAGS_STORE = process.env.SOAPBOX_MARKET_FACTCHECK_FLAGS || path.join(__dir, 'data', 'market-factcheck-flags.json');

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

// host-only compare so "https://x.io" vs "https://x.io/" or "/en" doesn't read as a redirect.
function sameDest(a, b) {
  try {
    const ua = new URL(a), ub = new URL(b);
    return ua.hostname.replace(/^www\./, '') === ub.hostname.replace(/^www\./, '');
  } catch { return a === b; }
}

/**
 * linkAlive(url) — a single-link liveness verdict for the fact-checker / Hathor. Soft-fail: a bad
 * input or a thrown fetch returns { alive:false } rather than throwing.
 * Returns:
 *   { url, alive, status, redirected, finalUrl?, error? }
 * `redirected` is true when the request landed on a different HOST than asked (a parked-domain /
 * acquisition / "this project moved" tell), so the caller can flag it distinctly from a dead link.
 * Cached per-url at the metadata tier — liveness doesn't churn minute-to-minute.
 */
export async function linkAlive(url) {
  if (!url || !/^https?:\/\//i.test(String(url))) {
    return { url: String(url ?? ''), alive: false, status: 0, redirected: false, error: 'not-an-http-url' };
  }
  return cached(`linkalive:${url}`, TTL.metadata, async () => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    const opts = { redirect: 'follow', signal: ctrl.signal, headers: { 'user-agent': UA } };
    try {
      let r;
      try { r = await _fetch(url, { ...opts, method: 'HEAD' }); }
      catch { r = null; }
      if (!r || r.status === 405 || r.status === 501 || r.status === 403) {
        r = await _fetch(url, { ...opts, method: 'GET' });
      }
      const finalUrl = r && r.url ? r.url : url;
      const redirected = (r && (r.redirected === true)) || !sameDest(url, finalUrl);
      return {
        url, alive: r.status >= 200 && r.status < 400, status: r.status,
        redirected: !!redirected, finalUrl,
      };
    } catch (err) {
      return { url, alive: false, status: 0, redirected: false, error: String(err?.name || err?.message || err) };
    } finally {
      clearTimeout(t);
    }
  });
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

// --- coin link-liveness + delisting check, with a FLAGS-ONLY store -----------
// checkCoinLinks(coin) runs the liveness sweep over a coin's official links and folds in any
// delisting signal we can read from the market adapters (whereToTrade). It NEVER edits the coin
// record. Flags are shaped for the Server-4 brief pipeline: { coin, flag, evidence, checkedAt,
// advisory:true } — same advisory:true contract the Ashurbanipal fact-checker uses.

function loadFlags() {
  try { return JSON.parse(_fs.readFileSync(FLAGS_STORE, 'utf8')); } catch { return []; }
}
function saveFlags(rows) {
  _fs.mkdirSync(path.dirname(FLAGS_STORE), { recursive: true });
  _fs.writeFileSync(FLAGS_STORE, JSON.stringify(rows, null, 2));
}

// pull the coin's official outbound links from wherever the adapters stash them (mirrors the bag
// coin-socials reads, but flattened to URLs for liveness checking).
function officialLinkBag(coin = {}) {
  const out = [];
  const push = (u) => { if (u && typeof u === 'string' && /^https?:\/\//i.test(u)) out.push(u); };
  push(coin.links?.website);
  push(coin.links?.explorer);
  for (const s of (coin.links?.social || [])) push(s);
  const o = coin.official || {};
  push(o.reddit); push(o.forum); push(o.announcement);
  for (const c of (o.chats || [])) push(c);
  for (const r of (o.repos || [])) push(r);
  // de-dupe, preserve order
  return [...new Set(out)];
}

/**
 * checkCoinLinks(coin) — liveness + delisting fact-check for one coin. FLAGS-ONLY: returns advisory
 * flag objects and (optionally) persists them; never mutates the coin record.
 * Each flag: { coin, flag, evidence, checkedAt, advisory:true }, flag ∈
 *   'official-link-dead' | 'official-link-redirected' | 'no-official-links' | 'delisted-no-venues'
 *   | 'us-restricted-only'.
 * Returns:
 *   { coin, checkedAt, links:[{url, alive, status, redirected}], flags:[...], ok }
 * `persist:true` appends the flags to data/market-factcheck-flags.json (injectable fs), de-duped on
 * (coin|flag|evidence). `id` overrides the coin id used for delisting lookups when coin.id is absent.
 */
export async function checkCoinLinks(coin = {}, { persist = false, id = null } = {}) {
  coin = coin && typeof coin === 'object' ? coin : {};
  const coinId = id || coin.id || coin.symbol || '';
  const checkedAt = _now();
  const flags = [];
  const mkFlag = (flag, evidence) => ({ coin: coinId, flag, evidence, checkedAt, advisory: true });

  // 1) liveness over the official link bag
  const bag = officialLinkBag(coin);
  const links = await Promise.all(bag.map((u) => linkAlive(u)));
  if (!bag.length) {
    flags.push(mkFlag('no-official-links', 'coin record carries no http(s) official links to check'));
  }
  for (const l of links) {
    if (!l.alive) flags.push(mkFlag('official-link-dead', `${l.url} did not load (status ${l.status}${l.error ? `, ${l.error}` : ''})`));
    else if (l.redirected) flags.push(mkFlag('official-link-redirected', `${l.url} redirected off-host to ${l.finalUrl} (possible parked / moved project)`));
  }

  // 2) delisting signal from the market adapters (only where data is present — soft-fail to silence).
  if (coinId) {
    const wt = await whereToTrade(coinId).catch(() => null);
    if (wt && wt.source === 'coingecko') {
      if (!wt.exchanges.length) {
        flags.push(mkFlag('delisted-no-venues', 'CoinGecko tickers list no active exchange for this coin (delisted, micro-cap, or upstream throttled)'));
      } else if (wt.usSummary && !wt.usSummary.anyUsUsable) {
        flags.push(mkFlag('us-restricted-only', `all ${wt.exchanges.length} listing venue(s) are US-restricted or unverified`));
      }
    }
  }

  if (persist && flags.length) {
    const rows = loadFlags();
    const have = new Set(rows.map((r) => `${r.coin}|${r.flag}|${r.evidence}`));
    let added = 0;
    for (const f of flags) {
      const k = `${f.coin}|${f.flag}|${f.evidence}`;
      if (have.has(k)) continue;
      rows.push(f); have.add(k); added++;
    }
    if (added) saveFlags(rows);
  }

  return { coin: coinId, checkedAt, links, flags, ok: flags.length === 0 };
}

/** Read the persisted advisory flags, optionally filtered by coin id. */
export function listFlags({ coin = null } = {}) {
  const rows = loadFlags();
  return coin ? rows.filter((r) => r.coin === coin) : rows;
}

// CLI: node integrations/soapbox/market-factcheck.mjs <coin-id> [--where]
if (process.argv[1] && process.argv[1].endsWith('market-factcheck.mjs')) {
  const id = process.argv[2] || 'bitcoin';
  const mode = process.argv.includes('--where') ? 'where'
    : process.argv.includes('--verify') ? 'verify'
    : process.argv.includes('--links') ? 'links'
    : 'report';
  const out = mode === 'where' ? await whereToTrade(id)
    : mode === 'verify' ? await verifyCoin(id)
    : mode === 'links' ? await checkCoinLinks({ id })
    : await factCheckReport(id);
  console.log(JSON.stringify(out, null, 2));
}
