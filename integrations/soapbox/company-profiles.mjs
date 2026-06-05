// company-profiles.mjs — the Directory's "Crunchbase-style" company profile assembler (operator
// task #161 + the 2026-06-02 government-API ask). Given a company name or ticker, it stitches a
// best-effort dossier out of KEYLESS, public-record sources — no API keys, no paid tiers:
//
//   SEC EDGAR  (data.sec.gov)        US public-company registry: CIK, ticker, exchange, SIC
//                                    industry, fiscal-year, and the recent EDGAR filings list.
//   GLEIF      (api.gleif.org)       Global Legal Entity Identifier: legal name, registered HQ
//                                    address, jurisdiction, legal form, status — worldwide, not US-only.
//   Wikidata   (wikidata.org)        Human description, founding year, industry label, website,
//                                    headquarters city — the encyclopedic top-of-card text.
//   USAspending(api.usaspending.gov) Federal money a company has received: contract + grant totals
//                                    and a few recent awards. This is the government-data layer.
//
// Each source is independent and best-effort: a failure (or a private company SEC has never heard of)
// yields null for that slice, never an exception that sinks the whole profile. Everything is cached
// through the condenser's TTL cache so a profile page doesn't re-hammer four public APIs on reload.
//
// Notes on sources we deliberately DON'T wire (they need keys or are paid):
//   SAM.gov (api.sam.gov)            — federal-entity registration; free but requires an API key.
//   UK Companies House               — full UK registry; free but requires an API key.
//   OpenCorporates                   — cross-jurisdiction registry; free tier exists but is rate-
//                                      limited and key-gated for anything beyond a trickle.
//   Crunchbase                       — the namesake; fully paid. We reconstruct its shape keylessly.
//
//   import { companyProfile } from './company-profiles.mjs'
//   const p = await companyProfile('apple');
//
// CLI:  node company-profiles.mjs apple

import { cached, TTL } from './cache.mjs';
import { whereToComplain } from './oversight-directory.mjs';
// sec-edgar.mjs optionally exposes companyFacts (XBRL Revenues/NetIncome). Imported lazily/soft so a
// missing or refactored module never sinks a profile — see headlineFinancials() below.
import * as secEdgar from './sec-edgar.mjs';

// How many recent SEC filings to carry in a profile. Was hard-capped at 8; raised to a sensible,
// configurable cap so the filings list isn't silently truncated (A5 data-loss fix).
const SEC_FILINGS_CAP = +(process.env.SEC_FILINGS_CAP || 25);

// SEC asks every automated caller to send a descriptive User-Agent with contact info (their fair-
// access policy). The operator contact is intentionally generic; this is the Witness account's bot.
const SEC_UA = 'MELEK-Witness-Bot/1.0 (data.soapbox.community; contact mahatmajapa@gmail.com)';
const GEN_UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const jget = async (url, headers = {}) => {
  const r = await _fetch(url, { headers });
  if (!r.ok) throw new Error('http ' + r.status + ' ' + url);
  return r.json();
};
const jpost = async (url, body, headers = {}) => {
  const r = await _fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('http ' + r.status + ' ' + url);
  return r.json();
};

const norm = (s) => String(s || '').trim().toLowerCase();
const pad10 = (cik) => String(cik).padStart(10, '0');

// ── SEC EDGAR ───────────────────────────────────────────────────────────────────────────────────
// The full ticker→CIK map is a single ~1MB keyless JSON. Cache it hard (metadata TTL); it changes
// slowly. Match by ticker first (exact), else by title (exact, then prefix).
async function secTickerMap() {
  return cached('co:sec:tickers', TTL.metadata, async () => {
    const d = await jget('https://www.sec.gov/files/company_tickers.json', { 'user-agent': SEC_UA });
    return Object.values(d); // [{ cik_str, ticker, title }, ...]
  });
}

/** Resolve a query (ticker or name) to { cik, ticker, title } via SEC's map, or null. */
async function secResolve(query) {
  const q = norm(query);
  const rows = await secTickerMap().catch(() => null);
  if (!rows) return null;
  let hit = rows.find((r) => norm(r.ticker) === q);
  if (!hit) hit = rows.find((r) => norm(r.title) === q);
  if (!hit) hit = rows.find((r) => norm(r.title).startsWith(q) || norm(r.title).replace(/[.,]/g, '') === q.replace(/[.,]/g, ''));
  if (!hit) hit = rows.find((r) => norm(r.title).includes(q) && q.length >= 4);
  return hit ? { cik: hit.cik_str, ticker: hit.ticker, title: hit.title } : null;
}

/** SEC submissions doc → company metadata + the most recent filings. Keyless. */
async function secProfile(cik) {
  return cached(`co:sec:sub:${cik}`, TTL.metadata, async () => {
    const d = await jget(`https://data.sec.gov/submissions/CIK${pad10(cik)}.json`, { 'user-agent': SEC_UA });
    const f = d.filings?.recent || {};
    const filings = [];
    const n = Math.min((f.form || []).length, SEC_FILINGS_CAP);
    for (let i = 0; i < n; i++) {
      filings.push({
        form: f.form[i],
        filed: f.filingDate?.[i] || null,
        period: f.reportDate?.[i] || null,
        primaryDoc: f.primaryDocument?.[i] || null,
        accession: f.accessionNumber?.[i] || null,
      });
    }
    return {
      name: d.name || null,
      tickers: d.tickers || [],
      exchanges: d.exchanges || [],
      sic: d.sic || null,
      sicDescription: d.sicDescription || null,
      ein: d.ein || null,
      category: d.category || null,
      fiscalYearEnd: d.fiscalYearEnd || null,
      stateOfIncorporation: d.stateOfIncorporation || null,
      addresses: d.addresses || null,
      website: d.website || null,
      filings,
    };
  });
}

// ── GLEIF ─────────────────────────────────────────────────────────────────────────────────────
/** Look up the Legal Entity Identifier record by legal name (best fuzzy via GLEIF's filter). */
async function gleifProfile(name) {
  const q = String(name || '').trim();
  if (!q) return null;
  return cached(`co:gleif:${norm(q)}`, TTL.metadata, async () => {
    const url = `https://api.gleif.org/api/v1/lei-records?filter[entity.legalName]=${encodeURIComponent(q)}&page[size]=1`;
    const d = await jget(url, { 'user-agent': GEN_UA, accept: 'application/vnd.api+json' });
    const rec = d?.data?.[0];
    if (!rec) return null;
    const e = rec.attributes?.entity || {};
    const a = e.headquartersAddress || e.legalAddress || {};
    return {
      lei: rec.id,
      legalName: e.legalName?.name || null,
      jurisdiction: e.jurisdiction || null,
      legalForm: e.legalForm?.id || null,
      status: e.status || null,
      hq: a.city ? [a.city, a.region, a.country].filter(Boolean).join(', ') : null,
      country: a.country || null,
    };
  });
}

// ── Wikidata ────────────────────────────────────────────────────────────────────────────────────
const WD_ENTITY = 'https://www.wikidata.org/wiki/Special:EntityData/';
const WD_API = 'https://www.wikidata.org/w/api.php';

// First mainsnak value for a property, or null.
function wdClaim(claims, prop) {
  const c = claims?.[prop]?.[0]?.mainsnak?.datavalue?.value;
  return c === undefined ? null : c;
}
// Resolve an item id (Qxxxx) to its English label.
async function wdLabel(qid) {
  if (!qid) return null;
  const d = await jget(`${WD_ENTITY}${qid}.json`, { 'user-agent': GEN_UA }).catch(() => null);
  return d?.entities?.[qid]?.labels?.en?.value || null;
}

// Wikidata Commons image (P154 logo / P18 image) → a usable thumbnail URL via Special:FilePath.
function wdImageUrl(filename, width = 256) {
  if (!filename) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=${width}`;
}

/** Wikidata description / founded / industry / website / hq + leadership/scale/structure for a company name. */
async function wikidataProfile(name) {
  const q = String(name || '').trim();
  if (!q) return null;
  return cached(`co:wd:${norm(q)}`, TTL.metadata, async () => {
    const s = await jget(`${WD_API}?action=wbsearchentities&search=${encodeURIComponent(q)}&language=en&type=item&limit=1&format=json&origin=*`, { 'user-agent': GEN_UA }).catch(() => null);
    const qid = s?.search?.[0]?.id;
    if (!qid) return null;
    const d = await jget(`${WD_ENTITY}${qid}.json`, { 'user-agent': GEN_UA }).catch(() => null);
    const ent = d?.entities?.[qid];
    if (!ent) return null;
    const claims = ent.claims || {};
    const inception = wdClaim(claims, 'P571');             // founding date
    const industryId = wdClaim(claims, 'P452')?.id || null; // industry (item ref)
    const hqId = wdClaim(claims, 'P159')?.id || null;       // headquarters location (item ref)
    const website = wdClaim(claims, 'P856') || null;        // official website (string)
    const ceoId = wdClaim(claims, 'P169')?.id || null;      // chief executive officer (item ref)
    const countryId = wdClaim(claims, 'P17')?.id || null;   // country (item ref)
    const parentId = wdClaim(claims, 'P749')?.id || null;   // parent organization (item ref)
    const exchangeId = wdClaim(claims, 'P414')?.id || null; // stock exchange (item ref)
    const employeesV = wdClaim(claims, 'P1128');            // employee count (quantity)
    const tickerV = wdClaim(claims, 'P249') || null;        // ticker symbol (string)
    const logoFile = wdClaim(claims, 'P154') || wdClaim(claims, 'P18') || null; // logo / image (commons filename)
    const [industry, hqCity, ceo, country, parent, exchange] = await Promise.all([
      wdLabel(industryId), wdLabel(hqId), wdLabel(ceoId), wdLabel(countryId), wdLabel(parentId), wdLabel(exchangeId),
    ]);
    const employees = employeesV?.amount ? Math.round(Math.abs(Number(String(employeesV.amount).replace('+', '')))) || null : null;
    return {
      qid,
      description: ent.descriptions?.en?.value || null,
      founded: inception?.time ? inception.time.slice(1, 5) : null, // "+1976-..." → "1976"
      industry: industry || null,
      website: website || null,
      hq: hqCity || null,
      ceo: ceo || null,
      country: country || null,
      parent: parent || null,
      stockExchange: exchange || null,
      employees,
      ticker: tickerV || null,
      logo: wdImageUrl(logoFile),
      wikidataUrl: `https://www.wikidata.org/wiki/${qid}`,
    };
  });
}

// ── Wikipedia (encyclopedic extract) ──────────────────────────────────────────────────────────────
/** Wikipedia REST summary: a fuller paragraph than Wikidata's one-liner, + canonical article URL. */
async function wikipediaSummary(name) {
  const q = String(name || '').trim();
  if (!q) return null;
  return cached(`co:wp:${norm(q)}`, TTL.metadata, async () => {
    const d = await jget(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(q.replace(/ /g, '_'))}`, { 'user-agent': GEN_UA }).catch(() => null);
    if (!d || d.type === 'disambiguation' || !d.extract) return null;
    return {
      extract: d.extract || null,
      url: d.content_urls?.desktop?.page || (d.title ? `https://en.wikipedia.org/wiki/${encodeURIComponent(d.title.replace(/ /g, '_'))}` : null),
      thumbnail: d.thumbnail?.source || null,
    };
  });
}

// ── USAspending (government money) ────────────────────────────────────────────────────────────────
const AWARD_TYPES_CONTRACT = ['A', 'B', 'C', 'D'];
const AWARD_TYPES_GRANT = ['02', '03', '04', '05'];

async function usaSpendingCategory(name, awardTypeCodes, label) {
  const body = {
    filters: { recipient_search_text: [name], award_type_codes: awardTypeCodes },
    fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Start Date'],
    sort: 'Award Amount', order: 'desc', limit: 5,
  };
  const d = await jpost('https://api.usaspending.gov/api/v2/search/spending_by_award/', body, { 'user-agent': GEN_UA }).catch(() => null);
  const results = d?.results || [];
  // The REAL total number of matching awards is in page_metadata.total (the page only returns ≤5 rows);
  // the old `count` was the page-sample size mislabeled as a total (A5 data-loss fix). We now surface
  // BOTH: sampleCount (rows we actually fetched) and awardTotal (USAspending's true match count).
  const awardTotal = Number(d?.page_metadata?.total ?? d?.page_metadata?.count) || null;
  if (!results.length) return { label, sampleCount: 0, count: 0, awardTotal: awardTotal || 0, total: 0, top: [] };
  return {
    label,
    sampleCount: results.length,    // rows actually returned on this page (≤ limit)
    count: results.length,          // kept for backward compatibility (= sampleCount)
    awardTotal: awardTotal != null ? awardTotal : results.length, // USAspending's true match count
    total: results.reduce((s, r) => s + (Number(r['Award Amount']) || 0), 0),
    top: results.map((r) => ({
      id: r['Award ID'] || null,
      recipient: r['Recipient Name'] || null,
      amount: Number(r['Award Amount']) || 0,
      agency: r['Awarding Agency'] || null,
      start: r['Start Date'] || null,
    })),
  };
}

/** Federal contracts + grants a company has received (sample, sorted by amount). Keyless. */
async function govContracts(name) {
  const q = String(name || '').trim();
  if (!q) return null;
  return cached(`co:usa:${norm(q)}`, TTL.metadata, async () => {
    const [contracts, grants] = await Promise.all([
      usaSpendingCategory(q, AWARD_TYPES_CONTRACT, 'contracts').catch(() => null),
      usaSpendingCategory(q, AWARD_TYPES_GRANT, 'grants').catch(() => null),
    ]);
    if (!contracts && !grants) return null;
    return { contracts, grants };
  });
}

// ── Headline financials (XBRL via sec-edgar.companyFacts) ─────────────────────────────────────────
// If sec-edgar.mjs exposes companyFacts, pull a couple of headline numbers (latest Revenues + latest
// NetIncome) into the profile. Entirely soft-fail: any missing module / endpoint / value yields null,
// never an exception. Keyless, backward-compatible (the field is simply absent on failure).
async function headlineFinancials(cik) {
  if (!cik || typeof secEdgar.companyFacts !== 'function') return null;
  const latest = (rows) => (Array.isArray(rows) && rows.length ? rows[0] : null); // companyFacts sorts newest-first
  try {
    const [rev, ni] = await Promise.all([
      secEdgar.companyFacts({ cik, concept: 'Revenues' }).catch(() => []),
      secEdgar.companyFacts({ cik, concept: 'NetIncomeLoss' }).catch(() => []),
    ]);
    const r = latest(rev), n = latest(ni);
    if (!r && !n) return null;
    const pick = (x) => (x ? { value: x.val ?? null, end: x.end || null, fy: x.fy ?? null, form: x.form || null } : null);
    return { revenue: pick(r), netIncome: pick(n), source: 'SEC XBRL (companyFacts)' };
  } catch { return null; }
}

// ── Assembler ─────────────────────────────────────────────────────────────────────────────────────
// A profile's "completeness" — how many of the dossier's load-bearing fields we actually filled.
const COMPLETENESS_FIELDS = ['description', 'founded', 'industry', 'hq', 'website', 'ceo', 'employees', 'cik', 'lei', 'ticker'];
function completeness(p) {
  const have = COMPLETENESS_FIELDS.filter((f) => p[f] != null && p[f] !== '' && !(Array.isArray(p[f]) && !p[f].length)).length;
  return Math.round((have / COMPLETENESS_FIELDS.length) * 100);
}

// ── Confidence / data-quality (mirrors price-oracle.mjs's multi-source agreement signal) ───────────
// price-oracle treats a value as "confident" when ≥2 independent sources agree. A company profile is
// stitched from independent registries (SEC / GLEIF / Wikidata / Wikipedia / USAspending), so we score
// confidence the same way: count how many distinct sources corroborate the identity, whether the
// few cross-checkable fields AGREE across sources, and reject obvious outliers (e.g. a nonsensical
// founding year or employee count). Returns a Clarity-style 0–100 + flags surfaced for review.
const FOUNDING_MIN = 1600;                       // older than this for a tradeable company → suspect.
const EMP_MAX = 3_000_000;                       // Walmart (~2.1M) is the practical ceiling.
const _norm = (s) => String(s || '').trim().toLowerCase().replace(/[.,]/g, '');
// GLEIF gives a 2-letter ISO code (e.g. "US"); Wikidata resolves to a full country name (e.g. "United
// States"). Reconcile the common aliases so the cross-check doesn't flag a false contradiction.
const COUNTRY_ALIASES = {
  us: ['united states', 'united states of america', 'usa', 'us'],
  gb: ['united kingdom', 'uk', 'great britain', 'gb'],
  fr: ['france', 'fr'], de: ['germany', 'de'], ca: ['canada', 'ca'],
  cn: ['china', 'cn'], jp: ['japan', 'jp'], in: ['india', 'in'], nl: ['netherlands', 'nl'],
};
function countriesAgree(a, b) {
  const x = _norm(a), y = _norm(b);
  if (!x || !y) return true;            // can't compare → don't penalize
  if (x === y || x.includes(y) || y.includes(x)) return true;
  for (const aliases of Object.values(COUNTRY_ALIASES)) if (aliases.includes(x) && aliases.includes(y)) return true;
  return false;
}

export function profileConfidence(p) {
  const flags = [];
  // 1) corroboration: how many independent sources contributed (the price-oracle "sources" analog).
  const sourceCount = (p.sources || []).length;

  // 2) cross-source agreement on the few fields more than one source provides.
  //    name: SEC legal name vs GLEIF legal name vs Wikidata-resolved name.
  //    hq:   GLEIF HQ vs Wikidata HQ.  founded: only Wikidata, so no cross-check — counts as neutral.
  let agree = 0, checks = 0;
  if (p._raw) {
    const r = p._raw;
    const names = [r.secMeta?.name, r.gleif?.legalName].filter(Boolean).map(_norm);
    if (names.length >= 2) { checks++; if (names[0].includes(names[1]) || names[1].includes(names[0])) agree++; else flags.push('legal name differs between SEC and GLEIF'); }
    const gc = r.gleif?.country, wc = r.wiki?.country;
    if (gc && wc) { checks++; if (countriesAgree(gc, wc)) agree++; else flags.push('headquarters country differs between GLEIF and Wikidata'); }
    const tickers = [r.sec?.ticker, r.wiki?.ticker].filter(Boolean).map(_norm);
    if (tickers.length >= 2) { checks++; if (tickers[0] === tickers[1]) agree++; else flags.push('ticker differs between SEC and Wikidata'); }
  }

  // 3) outlier rejection on individual numeric fields (don't trust an absurd value; flag it).
  if (p.founded != null) { const y = +p.founded; if (!(y >= FOUNDING_MIN && y <= new Date().getUTCFullYear())) flags.push(`founding year ${p.founded} out of plausible range`); }
  if (p.employees != null) { const e = +p.employees; if (!(e >= 1 && e <= EMP_MAX)) flags.push(`employee count ${p.employees} out of plausible range`); }

  // 4) blend into a 0–100. Corroboration is the backbone (more registries = more trustworthy); the
  //    agreement ratio rewards consistency; flags subtract. ≥2 sources & no contradiction = confident.
  const corrob = Math.min(sourceCount, 4) / 4 * 60;           // up to 60 pts for breadth of sources
  const consistency = checks ? (agree / checks) * 30 : 15;     // up to 30 (neutral 15 when nothing to cross-check)
  const penalty = flags.length * 12;
  const score = Math.max(0, Math.min(100, Math.round(corrob + consistency + 10 - penalty)));
  const contradictions = flags.filter((f) => f.includes('differs')).length;
  return { score, sources: sourceCount, crossChecks: checks, agreements: agree, flags, confident: sourceCount >= 2 && contradictions === 0 };
}

/**
 * Assemble a best-effort, Crunchbase-style company profile from keyless public records.
 * @param {string} query company name or ticker, e.g. "Apple", "AAPL", "Tesla Inc"
 * @returns {Promise<object>} a dossier: identity, description, leadership, scale, structure, registries,
 *   filings, federal awards, sources, a tradedStatus + onboarding block, research links, and completeness.
 */
export async function companyProfile(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('companyProfile: empty query');

  // SEC first — it gives us the canonical legal name to feed the other lookups.
  const sec = await secResolve(q).catch(() => null);
  const canonName = sec?.title || q;

  const [secMeta, gleif, wiki, wikiText, gov, financials] = await Promise.all([
    sec ? secProfile(sec.cik).catch(() => null) : Promise.resolve(null),
    gleifProfile(canonName).catch(() => null),
    wikidataProfile(canonName).catch(() => null),
    wikipediaSummary(canonName).catch(() => null),
    govContracts(canonName).catch(() => null),
    sec ? headlineFinancials(sec.cik).catch(() => null) : Promise.resolve(null),
  ]);

  const sources = [];
  if (secMeta) sources.push('SEC EDGAR');
  if (gleif) sources.push('GLEIF');
  if (wiki) sources.push('Wikidata');
  if (wikiText) sources.push('Wikipedia');
  if (gov && (gov.contracts?.count || gov.grants?.count)) sources.push('USAspending');

  const name = secMeta?.name || gleif?.legalName || wiki?.qid && canonName || canonName;
  const ticker = sec?.ticker || secMeta?.tickers?.[0] || wiki?.ticker || null;

  // Traded status: did SEC register it as a US public company (has exchanges), or is it private /
  // not-yet-traded? Drives the onboarding block below for companies with no traded currency.
  const exchanges = (secMeta?.exchanges || []).filter(Boolean);
  const traded = !!(ticker && exchanges.length);
  const tradedStatus = traded ? 'public'
    : (sec ? 'registered'         // SEC-known but no live exchange listing in the submissions doc
    : 'private');                 // not in SEC's registry at all

  const profile = {
    name,
    ticker,
    cik: sec ? pad10(sec.cik) : null,
    lei: gleif?.lei || null,
    qid: wiki?.qid || null,
    description: wikiText?.extract || wiki?.description || null,
    summary: wiki?.description || null,            // the short Wikidata one-liner, kept distinct
    website: secMeta?.website || wiki?.website || null,
    logo: wiki?.logo || wikiText?.thumbnail || null,
    founded: wiki?.founded || null,
    industry: secMeta?.sicDescription || wiki?.industry || null,
    sicCode: secMeta?.sic || null,
    hq: gleif?.hq || wiki?.hq || null,
    country: wiki?.country || gleif?.country || null,
    ceo: wiki?.ceo || null,
    employees: wiki?.employees || null,
    parent: wiki?.parent || null,
    stockExchange: wiki?.stockExchange || null,
    jurisdiction: gleif?.jurisdiction || secMeta?.stateOfIncorporation || null,
    legalForm: gleif?.legalForm || null,
    legalStatus: gleif?.status || null,
    ein: secMeta?.ein || null,
    exchanges,
    fiscalYearEnd: secMeta?.fiscalYearEnd || null,
    secFilings: secMeta?.filings || [],
    financials: financials || null,   // headline XBRL Revenues/NetIncome (soft-fail; null when unavailable)
    govContracts: gov || null,
    tradedStatus,
    traded,
    sources,
    links: {
      wikidata: wiki?.wikidataUrl || null,
      wikipedia: wikiText?.url || null,
      sec: sec ? `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${pad10(sec.cik)}&type=&dateb=&owner=include&count=40` : null,
      gleif: gleif?.lei ? `https://search.gleif.org/#/record/${gleif.lei}` : null,
    },
  };

  // BBB / consumer-protection layer (#288): the right oversight office(s) to complain TO about this
  // company, keyed off its industry/type/state. Each is a full contact card (phone/email/fax + the
  // office's own file-here form). Facts, not a verdict — listing an office is not an accusation. Keyless
  // and soft-fail: a recognized industry routes precisely, an unknown one still gets the general index.
  const industryHint = profile.industry || secMeta?.sicDescription || wiki?.industry || '';
  const complaintState = (gleif?.jurisdiction && /^US-([A-Z]{2})$/.test(gleif.jurisdiction))
    ? gleif.jurisdiction.slice(3)
    : (secMeta?.stateOfIncorporation && /^[A-Z]{2}$/.test(secMeta.stateOfIncorporation) ? secMeta.stateOfIncorporation : '');
  let whereToComplainOffices = [];
  try {
    whereToComplainOffices = whereToComplain({ name: profile.name, industry: industryHint, state: complaintState }) || [];
  } catch { whereToComplainOffices = []; }
  profile.whereToComplain = {
    industry: industryHint || null,
    state: complaintState || null,
    note: 'Official oversight / consumer-protection office(s) to contact about this company. Facts, not a '
      + 'verdict — a complaint is not proof of wrongdoing. Use the office’s own form linked here.',
    offices: whereToComplainOffices.slice(0, 5),
  };

  // Onboarding for companies with no traded currency yet: tell the operator what's missing and what
  // it would take to list. This is the "directory entry for a not-yet-listed company" path (#195).
  if (!traded) {
    const missing = [];
    if (!profile.cik) missing.push('SEC registration (CIK) — file via EDGAR if a US issuer');
    if (!profile.lei) missing.push('Legal Entity Identifier (LEI) — register at GLEIF');
    if (!profile.ticker) missing.push('a ticker symbol — assigned on exchange listing');
    if (!profile.website) missing.push('a public website for the directory card');
    profile.onboarding = {
      status: tradedStatus,
      note: tradedStatus === 'private'
        ? 'Private / not found in SEC’s public-company registry. Listed here as a directory entry.'
        : 'Registered with SEC but no live exchange listing detected.',
      missing,
      // The MELEK angle: a company without a traded currency can still be issued one on-chain.
      melekPath: 'A company with no traded security can be onboarded to the MELEK chain and issued a token/SMT as its on-chain currency — the Directory entry seeds that.',
    };
  }

  profile.completeness = completeness(profile);
  // attach the raw per-source slices (non-enumerable so it doesn't bloat JSON output) so the
  // confidence scorer can cross-check fields, then compute the Clarity-style confidence block.
  Object.defineProperty(profile, '_raw', { value: { sec, secMeta, gleif, wiki, wikiText, gov }, enumerable: false });
  profile.confidence = profileConfidence(profile);
  return profile;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────
const isMain = (() => { try { return import.meta.url === `file://${process.argv[1]}`; } catch { return false; } })();
if (isMain) {
  const q = process.argv.slice(2).join(' ').trim() || 'apple';
  companyProfile(q)
    .then((p) => {
      const fmt = (n) => n == null ? '—' : '$' + Number(n).toLocaleString('en-US');
      console.log(`\n  ${p.name}${p.ticker ? `  (${p.ticker})` : ''}`);
      console.log('  ' + '─'.repeat(48));
      if (p.description) console.log('  ' + p.description);
      console.log(`  Traded:     ${p.tradedStatus}${p.ticker ? ` (${p.ticker})` : ''}`);
      console.log(`  CIK:        ${p.cik || '—'}`);
      console.log(`  LEI:        ${p.lei || '—'}`);
      console.log(`  Founded:    ${p.founded || '—'}`);
      console.log(`  Industry:   ${p.industry || '—'}`);
      console.log(`  CEO:        ${p.ceo || '—'}`);
      console.log(`  Employees:  ${p.employees != null ? Number(p.employees).toLocaleString('en-US') : '—'}`);
      console.log(`  Parent:     ${p.parent || '—'}`);
      console.log(`  HQ:         ${p.hq || '—'}${p.country ? `, ${p.country}` : ''}`);
      console.log(`  Website:    ${p.website || '—'}`);
      console.log(`  Exchanges:  ${p.exchanges?.join(', ') || '—'}`);
      console.log(`  Status:     ${p.legalStatus || '—'}  (${p.jurisdiction || '—'})`);
      console.log(`  Complete:   ${p.completeness}%`);
      console.log(`  Confidence: ${p.confidence.score}/100  (${p.confidence.sources} sources, ${p.confidence.confident ? 'confident' : 'unconfirmed'})`);
      if (p.confidence.flags.length) for (const f of p.confidence.flags) console.log(`    ⚠ ${f}`);
      if (p.onboarding) { console.log(`\n  Onboarding (${p.onboarding.status}): ${p.onboarding.note}`); for (const m of p.onboarding.missing) console.log(`    • needs: ${m}`); }
      if (p.secFilings?.length) {
        console.log('\n  Recent SEC filings:');
        for (const f of p.secFilings.slice(0, 5)) console.log(`    ${(f.form || '').padEnd(8)} ${f.filed || ''}`);
      }
      if (p.financials) {
        console.log('\n  Headline financials (SEC XBRL):');
        if (p.financials.revenue?.value != null) console.log(`    revenue:    ${fmt(p.financials.revenue.value)}  (FY ${p.financials.revenue.fy || p.financials.revenue.end || '—'})`);
        if (p.financials.netIncome?.value != null) console.log(`    net income: ${fmt(p.financials.netIncome.value)}  (FY ${p.financials.netIncome.fy || p.financials.netIncome.end || '—'})`);
      }
      if (p.govContracts) {
        const c = p.govContracts.contracts, g = p.govContracts.grants;
        console.log('\n  Federal awards (USAspending, top-5 sample):');
        if (c?.sampleCount) console.log(`    contracts: ${c.sampleCount} of ${c.awardTotal} awards sampled, ${fmt(c.total)}`);
        if (g?.sampleCount) console.log(`    grants:    ${g.sampleCount} of ${g.awardTotal} awards sampled, ${fmt(g.total)}`);
        if (!c?.sampleCount && !g?.sampleCount) console.log('    none found');
      }
      if (p.whereToComplain?.offices?.length) {
        console.log('\n  Where to complain (oversight offices):');
        for (const o of p.whereToComplain.offices.slice(0, 3)) console.log(`    • ${o.name}${o.phone ? `  ${o.phone}` : ''}`);
      }
      console.log(`\n  sources: ${p.sources.join(', ') || 'none'}\n`);
    })
    .catch((e) => { console.error('error:', e.message); process.exit(1); });
}
