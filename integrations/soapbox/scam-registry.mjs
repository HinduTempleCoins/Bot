// scam-registry.mjs — the scam/legit TRUST-DATA layer for the SoapBox condenser (operator tasks
// #183/#184). The operator saw granular GOVERNMENT crypto-fraud collections (the "Jane in Minnesota
// was contacted, formed a relationship, eventually crypto came up" pig-butchering write-ups) and
// wants our coin/site pages — and the Clarity score and the Directory — to carry REAL fraud signals,
// not just CoinGecko market data. This module is two things:
//
//   1. A STRUCTURED CATALOG (SCAM_SOURCES) of the government scam trackers + reputable scam/legit
//      registries, in the same shape-as-index discipline as govtech-catalog.mjs / api-catalog.mjs.
//      Each entry says what it covers and — crucially — whether it has a real queryable API, or is
//      reports/CSV/scrape-only. This is knowledge, not a live client. Verify before relying on a quota.
//
//   2. Best-effort LIVE LOOKUPS over the few sources that expose a keyless query surface, aggregated
//      by scamSignals(nameOrDomainOrAddress). Every live call is best-effort (returns null/empty on
//      failure, NEVER throws) and cached via cache.mjs so the public site can't hammer a regulator.
//
// Plus LEGIT_ALLOWLIST hooks (verified exchanges / regulated entities) so the layer can mark
// "regulated / legit" vs "reported scam", tied to the markets-catalog us-availability concept.
//
//   import { SCAM_SOURCES, scamSignals, secPauseList, checkChainabuse, LEGIT_ALLOWLIST } from './scam-registry.mjs'
//   const sig = await scamSignals('coinbase.com');   // → { query, kind, reports, sources, legit, riskHint }
//
// SECURITY NOTE: keyless reads only. No WIF, no secrets, no keys. Any source that needs an API key
// (Chainabuse Public API, OpenSanctions live /search, FTC Tableau export) is cataloged but NOT called
// here — its `api` field documents the endpoint for the day a key is provisioned in the vault.

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; SoapBox-ScamRegistry/1.0; +https://data.soapbox.community)';
const T = (ms) => AbortSignal.timeout(ms);

// Injectable fetch seam (house pattern) so the keyless live lookups + aggregation/risk logic are
// offline-testable without touching the network. Defaults to the global fetch.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Trust-layer TTL bands. Fraud lists move slowly; a registry refresh of an hour is plenty and keeps
// us well under any regulator's implicit rate budget.
const TTL_SCAM = {
  list: 6 * 3_600_000,   // bulk gov/registry lists (PAUSE, RED List): 6 h
  lookup: 3_600_000,     // a per-query aggregate: 1 h
};

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 1. THE CATALOG.  kind: 'gov' | 'community' | 'commercial'.  `api` = a real queryable endpoint we
//    could call (keyless or keyed); absence of `api` means reports/CSV/Tableau/scrape-only. `keyless`
//    = callable with no signup/key today. `coverage` = what kind of fraud signal it carries.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
export const KINDS = ['gov', 'community', 'commercial'];

export const SCAM_SOURCES = [
  // ── GOVERNMENT ─────────────────────────────────────────────────────────────────────────────────
  {
    name: 'FTC Consumer Sentinel Network',
    agency: 'Federal Trade Commission',
    url: 'https://www.ftc.gov/enforcement/consumer-sentinel-network',
    kind: 'gov',
    keyless: false,
    coverage: 'Aggregate consumer-fraud complaints (incl. crypto/imposter/romance "pig-butchering") shared with ~2,800 law-enforcement users.',
    notes: 'Not a per-entity lookup API. Public surface = the annual Data Book (PDF) + the interactive Tableau dashboards at ftc.gov/exploredata (quarterly). $1.42B crypto-fraud losses reported in 2024. Aggregate stats only — no individual-scammer query. Use for site-wide context numbers, not entity checks.',
  },
  {
    name: 'FTC Data Spotlight / data.gov',
    agency: 'Federal Trade Commission',
    url: 'https://www.ftc.gov/news-events/data-visualizations',
    kind: 'gov',
    api: 'https://api.gsa.gov/technology/datagov/v3/action/package_search?q=cryptocurrency+fraud&api_key=DEMO_KEY',
    keyless: true,  // via api.data.gov DEMO_KEY (free signup lifts the limit)
    coverage: 'FTC fraud "Data Spotlight" reporting + FTC datasets cataloged on data.gov (CKAN).',
    notes: 'data.gov CKAN gateway is queryable with the public DEMO_KEY (api.data.gov). Returns dataset metadata, not live scammer records. Discovery layer: find the FTC fraud dataset, then pull its (often CSV) resource. NOTE: bare catalog.data.gov/api/3 path 404s from some networks — use the api.gsa.gov gateway form.',
  },
  {
    name: 'FBI IC3 (Internet Crime Complaint Center)',
    agency: 'Federal Bureau of Investigation',
    url: 'https://www.ic3.gov/',
    kind: 'gov',
    keyless: false,
    coverage: 'Internet-crime complaint intake + annual Internet Crime Report (crypto-investment fraud is the largest loss category).',
    notes: 'Intake portal + annual PDF reports (ic3.gov/AnnualReport). No public per-complaint query API — complaint data is law-enforcement-only. Use the annual report figures for context; intake link is what we point victims to.',
  },
  {
    name: 'CFTC RED List',
    agency: 'Commodity Futures Trading Commission',
    url: 'https://www.cftc.gov/check/',
    kind: 'gov',
    keyless: true,  // HTML page is reachable; no JSON API
    coverage: 'Registration Deficient (RED) List — unregistered FOREIGN entities the CFTC has found soliciting US residents (a frequent crypto/forex-scam vector).',
    notes: 'No structured API — the RED List + fraud advisories are an HTML page (cftc.gov/check) + SmartCheck. Scrape-only. Good signal: a site/entity name appearing here is a strong negative. Pair with SEC PAUSE.',
  },
  {
    name: 'SEC PAUSE List',
    agency: 'Securities and Exchange Commission',
    url: 'https://www.sec.gov/enforcement-litigation/public-alerts-unregistered-soliciting-entities',
    kind: 'gov',
    // The SEC itself publishes PAUSE only as HTML, but OpenSanctions mirrors it as a structured,
    // KEYLESS bulk dataset (names.txt / CSV / FtM JSON) — that's what secPauseList() reads.
    api: 'https://data.opensanctions.org/datasets/latest/us_sec_pause/names.txt',
    keyless: true,
    coverage: 'Public Alert: Unregistered Soliciting Entities — names of entities falsely claiming SEC registration/US location, impersonating real firms, or posing as fake regulators (~1,670 names).',
    notes: 'SEC publishes PAUSE as HTML only; the queryable form is the OpenSanctions mirror (us_sec_pause), a keyless bulk dataset refreshed regularly. A name match here is a high-confidence "reported impostor" signal. Inclusion ≠ adjudicated violation (SEC disclaimer) — surface as "listed on SEC PAUSE", not "convicted".',
  },
  {
    name: 'SEC EDGAR Full-Text Search',
    agency: 'Securities and Exchange Commission',
    url: 'https://efts.sec.gov/LATEST/search-index',
    kind: 'gov',
    api: 'https://efts.sec.gov/LATEST/search-index?q=%22{term}%22',
    keyless: true,
    coverage: 'Full-text search across all EDGAR filings — surfaces whether an entity/token name appears in real SEC filings, litigation releases, or enforcement actions.',
    notes: 'Keyless JSON API (efts.sec.gov). NOT a scam list per se, but the legitimacy counter-signal: a real registrant has filings; a pure scam usually does not (or appears only inside an enforcement/litigation document). Use to corroborate "is this a real registered entity?". Rate-limit politely; set a descriptive User-Agent.',
  },
  {
    name: 'SEC Litigation / Enforcement releases (RSS)',
    agency: 'Securities and Exchange Commission',
    url: 'https://www.sec.gov/about/data-resources/secgov-rss-feeds',
    kind: 'gov',
    api: 'https://www.sec.gov/news/pressreleases.rss',
    keyless: true,
    coverage: 'SEC litigation releases + enforcement actions (frequently crypto). RSS/Atom feeds.',
    notes: 'RSS feeds are keyless. Crypto-fraud defendants show up by name. Ingest the feed, index defendant names → a "named in an SEC enforcement action" flag. Feed shape varies; treat as best-effort text.',
  },
  {
    name: 'CFTC Enforcement / Press (RSS)',
    agency: 'Commodity Futures Trading Commission',
    url: 'https://www.cftc.gov/RSS',
    kind: 'gov',
    api: 'https://www.cftc.gov/RSS/RSSENF/enfrss.xml',
    keyless: true,
    coverage: 'CFTC enforcement actions + fraud advisories — digital-asset / forex fraud defendants by name.',
    notes: 'Keyless RSS. Companion to the RED List for the actually-charged (vs merely-listed) set.',
  },
  {
    name: 'State Attorneys General / NASAA / CSBS',
    agency: 'State securities & banking regulators (via NASAA / CSBS)',
    url: 'https://www.nasaa.org/contact-your-regulator/',
    kind: 'gov',
    keyless: false,
    coverage: 'State-level enforcement, investor alerts, and money-transmitter licensing — NASAA (securities) + CSBS/NMLS (money services).',
    notes: 'No single national API. NMLS Consumer Access (nmlsconsumeraccess.org) is a per-license lookup (web form). NASAA aggregates state alerts. Fragmented & per-state — catalog as the authoritative escalation target, scrape selectively. A licensed money transmitter (NMLS ID) is a legit signal.',
  },

  // ── COMMUNITY / COMMERCIAL ───────────────────────────────────────────────────────────────────────
  {
    name: 'Chainabuse',
    agency: 'TRM Labs (community-sourced)',
    url: 'https://www.chainabuse.com/',
    kind: 'commercial',
    api: 'https://api.chainabuse.com/v0/reports?address={address}',  // Public API v1.2 — KEY REQUIRED
    keyless: false,
    coverage: 'Largest multi-chain community scam-report DB (16 abuse categories) keyed by wallet address / domain / handle. Shared with FBI & regulators.',
    notes: 'Public API exists but requires an API key (401 without). The richest per-ADDRESS scam signal available — wire it the moment a key lands in the vault. The website itself is scrape-able but ToS-bound; prefer the keyed API. CATALOGED, not called here.',
  },
  {
    name: 'CryptoScamDB',
    agency: 'MyCrypto / community (open data)',
    url: 'https://cryptoscamdb.org/',
    kind: 'community',
    api: 'https://api.cryptoscamdb.org/v1/scams',
    keyless: true,
    coverage: 'Open-source registry of scam domains + malicious addresses (classic phishing/fake-ICO era). MIT-licensed dataset on GitHub.',
    notes: 'Hosted API has been flaky (502 observed). The durable source is the GitHub data repo (MyCrypto/cryptoscamdb-blacklist) — mirror it. Coverage skews older but still a free address/domain blocklist. Best-effort live; fall back to a cached mirror.',
  },
  {
    name: 'ScamAdviser',
    agency: 'ScamAdviser (commercial)',
    url: 'https://www.scamadviser.com/',
    kind: 'commercial',
    api: 'https://api.scamadviser.com/v2/trust/single?domain={domain}',  // KEY REQUIRED
    keyless: false,
    coverage: 'Per-DOMAIN trust score (0–100) from ~40 signals (registration, hosting, reviews, blocklists).',
    notes: 'Trust-score API requires a key. The free website gives a per-domain score (scrape-able, ToS-bound). Good for the Directory site-trust panel once keyed. We already have a keyless domain-trust proxy in domain-insights.mjs (Tranco + RDAP age) — ScamAdviser layers on top when funded.',
  },
  {
    name: "Whale Alert Scam Alert",
    agency: 'Whale Alert (commercial)',
    url: 'https://scam-alert.io/',
    kind: 'commercial',
    api: 'https://api.whale-alert.io/v1/',  // KEY REQUIRED
    keyless: false,
    coverage: 'Reported scam addresses + on-chain scam-flow tracking (giveaway/impersonation scams).',
    notes: 'API keyed. scam-alert.io has a public report search. Catalog as an address-reputation source for when a key is provisioned.',
  },
  {
    name: 'Etherscan address labels',
    agency: 'Etherscan (commercial)',
    url: 'https://etherscan.io/labelcloud',
    kind: 'commercial',
    api: 'https://api.etherscan.io/v2/api?chainid=1&module=account&action=...',  // KEY REQUIRED (V2)
    keyless: false,
    coverage: 'Curated address LABELS — "Phish/Hack", "Fake_Phishing####", exchange hot wallets, etc. The de-facto on-chain reputation tags.',
    notes: 'Labels are surfaced on the website; the API (now V2, single key across chains) needs a key for most modules. A "Fake_Phishing" tag is a strong negative; an exchange-wallet label is a legit signal. CATALOGED — wire with the existing Etherscan key if/when available.',
  },
  {
    name: 'urlscan.io',
    agency: 'urlscan GmbH (commercial, free tier)',
    url: 'https://urlscan.io/',
    kind: 'commercial',
    api: 'https://urlscan.io/api/v1/search/?q=domain:{domain}',
    keyless: true,  // public search reads are keyless
    coverage: 'Sandbox scans of URLs/domains incl. community "malicious" verdicts and phishing flags.',
    notes: 'Public search API is keyless (submitting new scans needs a key). A domain with many malicious-verdict scans is a phishing signal. Used as the keyless live domain-reputation probe in scamSignals().',
  },
  {
    name: 'OpenSanctions',
    agency: 'OpenSanctions (open data + commercial API)',
    url: 'https://www.opensanctions.org/',
    kind: 'community',
    api: 'https://api.opensanctions.org/search/default?q={q}',  // live /search KEY REQUIRED
    keyless: true,  // BULK static datasets (incl. us_sec_pause) are keyless; only live /search is keyed
    coverage: 'Consolidated sanctions, PEPs, and regulator alert lists — including a structured mirror of the SEC PAUSE list (us_sec_pause).',
    notes: 'The live match/search API needs a key (401), but the bulk dataset files (names.txt / targets.simple.csv / entities.ftm.json) are KEYLESS at data.opensanctions.org. We read the PAUSE names.txt directly (see secPauseList).',
  },
];

/** Catalog filters (parity with govtech-catalog/api-catalog helpers). */
export const govSources = () => SCAM_SOURCES.filter((s) => s.kind === 'gov');
export const queryableSources = () => SCAM_SOURCES.filter((s) => !!s.api);
export const keylessSources = () => SCAM_SOURCES.filter((s) => s.keyless);
export const byKind = (kind) => SCAM_SOURCES.filter((s) => s.kind === kind);

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 3. LEGIT ALLOWLIST.  Verified / regulated entities, so the layer can mark "regulated legit" instead
//    of leaving silence read as suspicion. Seeded from the markets-catalog us-availability concept:
//    US-regulated venues (us:'full') are the strongest legit anchor. Keep this small and high-trust;
//    expand from markets-catalog at call time so we don't duplicate that list here.
// ─────────────────────────────────────────────────────────────────────────────────────────────────
export const LEGIT_ALLOWLIST = [
  // domain, label, basis. These are regulated US entities — strong "not a scam" anchors.
  { domain: 'coinbase.com', label: 'Coinbase', basis: 'US-public (NASDAQ: COIN), state MTLs, SEC-registered affiliate' },
  { domain: 'kraken.com', label: 'Kraken', basis: 'US-based; NY/various state regulation' },
  { domain: 'gemini.com', label: 'Gemini', basis: 'NYDFS trust charter' },
  { domain: 'crypto.com', label: 'Crypto.com', basis: 'US MSB / state MTLs' },
  { domain: 'binance.us', label: 'Binance.US', basis: 'US entity, state MTLs (product set restricted)' },
  { domain: 'bitstamp.net', label: 'Bitstamp', basis: 'US-supported (Robinhood-owned)' },
  { domain: 'robinhood.com', label: 'Robinhood', basis: 'US broker-dealer (FINRA/SEC), NASDAQ: HOOD' },
  { domain: 'paypal.com', label: 'PayPal', basis: 'US-regulated MSB' },
  { domain: 'fidelity.com', label: 'Fidelity', basis: 'US registered broker-dealer / RIA' },
];

const _legitIndex = new Map(LEGIT_ALLOWLIST.map((e) => [e.domain.toLowerCase(), e]));

/** Is this domain on our regulated/legit allowlist? Returns the entry or null. Also tries the
 *  markets-catalog us:'full' venues if available (best-effort, no hard dependency). */
export async function checkLegit(domain) {
  const d = normalizeDomain(domain);
  if (!d) return null;
  if (_legitIndex.has(d)) return { ..._legitIndex.get(d), source: 'allowlist' };
  // Best-effort cross-reference against the markets catalog's US-full venues.
  try {
    const mc = await import('./markets-catalog.mjs');
    const venues = (mc.CRYPTO_EXCHANGES || []).concat(mc.TRADFI_VENUES || []);
    const hit = venues.find((v) => v.us === 'full' && v.url && normalizeDomain(v.url) === d);
    if (hit) return { domain: d, label: hit.name, basis: `markets-catalog: US-full venue — ${hit.note || ''}`.trim(), source: 'markets-catalog' };
  } catch { /* markets-catalog optional */ }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// 2. LIVE LOOKUPS — keyless sources only. Every function best-effort: null/[] on any failure.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/** Classify a free-text query so the right sources get hit. */
export function classifyQuery(q) {
  const s = String(q || '').trim();
  if (!s) return { kind: 'empty', value: '' };
  if (/^0x[a-fA-F0-9]{40}$/.test(s)) return { kind: 'eth-address', value: s.toLowerCase() };
  if (/^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(s)) return { kind: 'btc-address', value: s };
  const d = normalizeDomain(s);
  if (d) return { kind: 'domain', value: d };
  return { kind: 'name', value: s };
}

export function normalizeDomain(input) {
  let h = String(input || '').trim().toLowerCase();
  if (!h) return '';
  if (h.includes('://')) { try { h = new URL(h).hostname; } catch { h = h.replace(/^.*:\/\//, '').split('/')[0]; } }
  else h = h.split('/')[0];
  h = h.replace(/^www\./, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(h) ? h : '';
}

/**
 * The SEC PAUSE list (keyless, via the OpenSanctions mirror). Returns a lowercased Set of listed
 * names, cached 6h. Returns an empty Set on any failure (never throws).
 */
export async function secPauseList() {
  return cached('scam:pause:names', TTL_SCAM.list, async () => {
    try {
      const r = await _fetch('https://data.opensanctions.org/datasets/latest/us_sec_pause/names.txt', { headers: { 'user-agent': UA }, signal: T(12_000) });
      if (!r.ok) return new Set();
      const text = await r.text();
      return new Set(text.split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean));
    } catch { return new Set(); }
  });
}

/** Best-effort PAUSE membership check for a name. Substring-aware (PAUSE has many alias rows). */
export async function checkPause(name) {
  const q = String(name || '').trim().toLowerCase();
  if (!q || q.length < 3) return null;
  const set = await secPauseList();
  if (!set.size) return null;
  if (set.has(q)) return { listed: true, match: q, list: 'SEC PAUSE', exact: true };
  // light substring scan for entity names embedded in a longer query (cap work)
  for (const n of set) { if (n.length >= 5 && (q.includes(n) || n.includes(q))) return { listed: true, match: n, list: 'SEC PAUSE', exact: false }; }
  return { listed: false, list: 'SEC PAUSE' };
}

/**
 * SEC EDGAR full-text search — keyless legitimacy counter-signal. Returns { hits, sample } where
 * `hits` is the (possibly capped) total and `sample` is a few matching display names. null on failure.
 */
export async function edgarFullText(term) {
  const q = String(term || '').trim();
  if (!q) return null;
  return cached(`scam:edgar:${q.toLowerCase()}`, TTL_SCAM.lookup, async () => {
    try {
      const r = await _fetch(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${q}"`)}`, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: T(12_000) });
      if (!r.ok) return null;
      const d = await r.json();
      const hits = d?.hits?.total?.value ?? 0;
      const sample = (d?.hits?.hits || []).slice(0, 3).map((h) => (h?._source?.display_names || [])[0]).filter(Boolean);
      return { hits, sample, hasFilings: hits > 0 };
    } catch { return null; }
  });
}

/**
 * urlscan.io keyless domain-reputation probe. Returns { scans, malicious } counts, or null.
 * A nonzero `malicious` is a phishing/scam signal.
 */
export async function urlscanDomain(domain) {
  const d = normalizeDomain(domain);
  if (!d) return null;
  return cached(`scam:urlscan:${d}`, TTL_SCAM.lookup, async () => {
    try {
      const r = await _fetch(`https://urlscan.io/api/v1/search/?q=domain:${encodeURIComponent(d)}&size=20`, { headers: { 'user-agent': UA }, signal: T(12_000) });
      if (!r.ok) return null;
      const data = await r.json();
      const results = data?.results || [];
      const malicious = results.filter((x) => x?.verdicts?.overall?.malicious || x?.task?.tags?.some?.((t) => /phish|malicious|scam/i.test(t))).length;
      return { scans: data?.total ?? results.length, malicious, malicious_seen: malicious > 0 };
    } catch { return null; }
  });
}

/**
 * CryptoScamDB hosted lookup (keyless, often flaky → best-effort). Accepts a domain or address.
 * Returns { reported, entries } or null. Falls back to null silently on 5xx.
 */
export async function checkCryptoScamDB(query) {
  const q = String(query || '').trim();
  if (!q) return null;
  const isAddr = /^0x[a-fA-F0-9]{40}$/.test(q);
  return cached(`scam:csdb:${q.toLowerCase()}`, TTL_SCAM.lookup, async () => {
    try {
      const path = isAddr ? `addresses/${encodeURIComponent(q)}` : `domains/${encodeURIComponent(normalizeDomain(q) || q)}`;
      const r = await _fetch(`https://api.cryptoscamdb.org/v1/${path}`, { headers: { 'user-agent': UA }, signal: T(10_000) });
      if (!r.ok) return null;
      const d = await r.json();
      if (!d?.success) return null;
      const result = d.result;
      const entries = Array.isArray(result) ? result : (result ? [result] : []);
      return { reported: entries.length > 0, entries: entries.slice(0, 5) };
    } catch { return null; }
  });
}

/**
 * Chainabuse per-address reports — CATALOGED but key-gated. With CHAINABUSE_API_KEY in env we make
 * the call; without it we return null (and the catalog tells the operator how to enable it). Never
 * throws, never logs the key.
 */
export async function checkChainabuse(query) {
  const key = process.env.CHAINABUSE_API_KEY;
  const q = String(query || '').trim();
  if (!key || !q) return null;
  return cached(`scam:chainabuse:${q.toLowerCase()}`, TTL_SCAM.lookup, async () => {
    try {
      const r = await _fetch(`https://api.chainabuse.com/v0/reports?address=${encodeURIComponent(q)}`, {
        headers: { 'user-agent': UA, accept: 'application/json', authorization: `Basic ${Buffer.from(`${key}:${key}`).toString('base64')}` },
        signal: T(12_000),
      });
      if (!r.ok) return null;
      const d = await r.json();
      const reports = d?.reports || d?.results || (Array.isArray(d) ? d : []);
      return { reported: reports.length > 0, count: reports.length, categories: [...new Set(reports.map((x) => x?.scamCategory || x?.category).filter(Boolean))] };
    } catch { return null; }
  });
}

// Map raw findings → a coarse risk hint for the UI. Conservative: scam signals are advisory, and the
// legit allowlist can lift an otherwise-quiet entity to "verified".
function deriveRiskHint({ legit, pause, urlscan, csdb, chainabuse, edgar }) {
  // SEC PAUSE / hard scam-DB hits override everything — even an allowlist entry (a regulated firm
  // shouldn't be on PAUSE; if it is, that's the story).
  if (pause?.listed) return 'high';                                  // named on SEC PAUSE
  if (csdb?.reported) return 'high';                                 // known scam-DB hit (domain/address)
  if (chainabuse?.reported && chainabuse.count > 1) return 'high';   // multiple community scam reports
  // For an allowlisted / regulated entity, urlscan "malicious" verdicts are almost always
  // IMPERSONATION pages scanned under its domain, not the entity itself — don't let that noise
  // demote a verified brand. The raw urlscan count still rides along in `signals`/`reports`.
  if (legit) return 'verified';                                      // regulated / allowlisted
  if (urlscan?.malicious_seen) return 'elevated';                    // malicious URL verdicts
  if (chainabuse?.reported) return 'elevated';
  if (edgar?.hasFilings) return 'low';                               // appears in real SEC filings
  return 'unknown';                                                  // no signal either way (default)
}

/**
 * scamSignals — the aggregator. Hits every keyless source that fits the query kind, in parallel,
 * best-effort. Returns:
 *   { query, kind, normalized, legit, reports: [{ source, detail }...], sources: [names hit],
 *     signals: { pause, urlscan, csdb, chainabuse, edgar }, riskHint, checked_at }
 * Never throws. Cached 1h on the normalized query.
 */
export async function scamSignals(input) {
  const cls = classifyQuery(input);
  if (cls.kind === 'empty') return { query: '', kind: 'empty', reports: [], sources: [], riskHint: 'unknown' };

  return cached(`scam:signals:${cls.kind}:${cls.value}`, TTL_SCAM.lookup, async () => {
    const isDomain = cls.kind === 'domain';
    const isAddr = cls.kind === 'eth-address' || cls.kind === 'btc-address';
    const isName = cls.kind === 'name';
    const nameOrDomain = cls.value;

    const [legit, pause, urlscan, csdb, chainabuse, edgar] = await Promise.all([
      isDomain ? checkLegit(nameOrDomain) : (isName ? checkLegit(nameOrDomain) : Promise.resolve(null)),
      (isName || isDomain) ? checkPause(nameOrDomain).catch(() => null) : Promise.resolve(null),
      isDomain ? urlscanDomain(nameOrDomain).catch(() => null) : Promise.resolve(null),
      (isDomain || cls.kind === 'eth-address') ? checkCryptoScamDB(nameOrDomain).catch(() => null) : Promise.resolve(null),
      isAddr ? checkChainabuse(nameOrDomain).catch(() => null) : Promise.resolve(null),
      (isName || isDomain) ? edgarFullText(isDomain ? nameOrDomain.split('.')[0] : nameOrDomain).catch(() => null) : Promise.resolve(null),
    ]);

    const reports = [];
    const sources = [];
    if (pause?.listed) reports.push({ source: 'SEC PAUSE', kind: 'gov', detail: `listed (${pause.exact ? 'exact' : 'partial'} match: ${pause.match})` });
    if (pause) sources.push('SEC PAUSE');
    if (urlscan) { sources.push('urlscan.io'); if (urlscan.malicious_seen) reports.push({ source: 'urlscan.io', kind: 'commercial', detail: `${urlscan.malicious} malicious scan verdict(s)` }); }
    if (csdb) { sources.push('CryptoScamDB'); if (csdb.reported) reports.push({ source: 'CryptoScamDB', kind: 'community', detail: `${csdb.entries.length} scam entr(y/ies)` }); }
    if (chainabuse) { sources.push('Chainabuse'); if (chainabuse.reported) reports.push({ source: 'Chainabuse', kind: 'commercial', detail: `${chainabuse.count} report(s)${chainabuse.categories.length ? ': ' + chainabuse.categories.join(', ') : ''}` }); }
    if (edgar) sources.push('SEC EDGAR');

    const riskHint = deriveRiskHint({ legit, pause, urlscan, csdb, chainabuse, edgar });

    return {
      query: String(input).trim(),
      kind: cls.kind,
      normalized: cls.value,
      legit: legit || null,
      reports,
      sources,
      signals: { pause: pause || null, urlscan: urlscan || null, csdb: csdb || null, chainabuse: chainabuse || null, edgar: edgar || null },
      riskHint,
      checked_at: new Date().toISOString(),
    };
  });
}

/** Catalog summary for a /health or admin view. */
export function summary() {
  return {
    total: SCAM_SOURCES.length,
    gov: byKind('gov').length,
    community: byKind('community').length,
    commercial: byKind('commercial').length,
    queryable: queryableSources().length,
    keyless: keylessSources().length,
    legit_allowlist: LEGIT_ALLOWLIST.length,
  };
}

// CLI proof: `node scam-registry.mjs coinbase.com`
if (process.argv[1] && process.argv[1].endsWith('scam-registry.mjs')) {
  const q = process.argv[2] || 'coinbase.com';
  console.log('catalog summary:', JSON.stringify(summary()));
  console.log(`\nscamSignals(${JSON.stringify(q)}):`);
  console.log(JSON.stringify(await scamSignals(q), null, 2));
}
