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
    const n = Math.min((f.form || []).length, 8);
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

/** Wikidata description / founded / industry / website / hq for a company name. */
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
    const [industry, hqCity] = await Promise.all([wdLabel(industryId), wdLabel(hqId)]);
    return {
      qid,
      description: ent.descriptions?.en?.value || null,
      founded: inception?.time ? inception.time.slice(1, 5) : null, // "+1976-..." → "1976"
      industry: industry || null,
      website: website || null,
      hq: hqCity || null,
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
  if (!results.length) return { label, count: 0, total: 0, top: [] };
  return {
    label,
    count: results.length, // page-bounded sample count, not lifetime total
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

// ── Assembler ─────────────────────────────────────────────────────────────────────────────────────
/**
 * Assemble a best-effort, Crunchbase-style company profile from keyless public records.
 * @param {string} query company name or ticker, e.g. "Apple", "AAPL", "Tesla Inc"
 * @returns {Promise<object>} { name, ticker, cik, lei, description, website, founded, industry, hq, secFilings, govContracts, sources }
 */
export async function companyProfile(query) {
  const q = String(query || '').trim();
  if (!q) throw new Error('companyProfile: empty query');

  // SEC first — it gives us the canonical legal name to feed the other lookups.
  const sec = await secResolve(q).catch(() => null);
  const canonName = sec?.title || q;

  const [secMeta, gleif, wiki, gov] = await Promise.all([
    sec ? secProfile(sec.cik).catch(() => null) : Promise.resolve(null),
    gleifProfile(canonName).catch(() => null),
    wikidataProfile(canonName).catch(() => null),
    govContracts(canonName).catch(() => null),
  ]);

  const sources = [];
  if (secMeta) sources.push('SEC EDGAR');
  if (gleif) sources.push('GLEIF');
  if (wiki) sources.push('Wikidata');
  if (gov && (gov.contracts?.count || gov.grants?.count)) sources.push('USAspending');

  const name = secMeta?.name || gleif?.legalName || canonName;

  return {
    name,
    ticker: sec?.ticker || secMeta?.tickers?.[0] || null,
    cik: sec ? pad10(sec.cik) : null,
    lei: gleif?.lei || null,
    description: wiki?.description || null,
    website: secMeta?.website || wiki?.website || null,
    founded: wiki?.founded || null,
    industry: secMeta?.sicDescription || wiki?.industry || null,
    hq: gleif?.hq || wiki?.hq || null,
    jurisdiction: gleif?.jurisdiction || secMeta?.stateOfIncorporation || null,
    legalStatus: gleif?.status || null,
    exchanges: secMeta?.exchanges || [],
    fiscalYearEnd: secMeta?.fiscalYearEnd || null,
    secFilings: secMeta?.filings || [],
    govContracts: gov || null,
    sources,
  };
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
      console.log(`  CIK:        ${p.cik || '—'}`);
      console.log(`  LEI:        ${p.lei || '—'}`);
      console.log(`  Founded:    ${p.founded || '—'}`);
      console.log(`  Industry:   ${p.industry || '—'}`);
      console.log(`  HQ:         ${p.hq || '—'}`);
      console.log(`  Website:    ${p.website || '—'}`);
      console.log(`  Exchanges:  ${p.exchanges?.join(', ') || '—'}`);
      console.log(`  Status:     ${p.legalStatus || '—'}  (${p.jurisdiction || '—'})`);
      if (p.secFilings?.length) {
        console.log('\n  Recent SEC filings:');
        for (const f of p.secFilings.slice(0, 5)) console.log(`    ${(f.form || '').padEnd(8)} ${f.filed || ''}`);
      }
      if (p.govContracts) {
        const c = p.govContracts.contracts, g = p.govContracts.grants;
        console.log('\n  Federal awards (USAspending, top-5 sample):');
        if (c?.count) console.log(`    contracts: ${c.count} sampled, ${fmt(c.total)}`);
        if (g?.count) console.log(`    grants:    ${g.count} sampled, ${fmt(g.total)}`);
        if (!c?.count && !g?.count) console.log('    none found');
      }
      console.log(`\n  sources: ${p.sources.join(', ') || 'none'}\n`);
    })
    .catch((e) => { console.error('error:', e.message); process.exit(1); });
}
