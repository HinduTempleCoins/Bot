// cannabis.mjs — SoapBox Cannabis/Hemp vertical (queue #105). AGGREGATION / DIRECTORY + INDEX, not
// scraping piracy. We link OUT to the authoritative strain-lineage genetics databases (SeedFinder /
// Leafly / Cannapedia), read a wholesale-price index where one is publicly accessible (Cannabis
// Benchmarks — soft-fail to null without access), point at the free UNODC/IMF policy + market PDFs,
// and compute a fair seed/pack price band from an array of listing prices with deriveSeedIndex().
//
// Like macro.mjs: keyless, soft-fail (never throw), provenance-tagged outputs. The PURE function
// deriveSeedIndex() is the load-bearing math — median + IQR over listing prices — and is unit-tested
// offline. Network readers are best-effort and degrade to null, mirroring macro.mjs's quote().

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Curated strain-lineage / genetics source directory. These are LINK-OUTS to the public databases
// the cannabis world already treats as authoritative for parentage, breeder, and terpene/cannabinoid
// reference — SoapBox indexes the front doors, it does not mirror or scrape their catalogues.
export const STRAIN_SOURCES = {
  'Genetics & Lineage': [
    ['SeedFinder', 'https://en.seedfinder.eu/', 'Largest open strain-lineage / breeder database (parentage trees)'],
    ['Leafly', 'https://www.leafly.com/strains', 'Strain profiles: effects, terpenes, lineage, reviews'],
    ['Cannapedia', 'https://www.cannapedia.cz/en/', 'Strain catalogue with lab-test cannabinoid/terpene data'],
    ['AllBud', 'https://www.allbud.com/marijuana-strains', 'Strain directory with genetics + dispensary cross-ref'],
    ['Wikileaf', 'https://www.wikileaf.com/strains/', 'Strain encyclopedia + nearby-price context'],
  ],
  'Seed Banks & Breeders (reference)': [
    ['Seedsman', 'https://www.seedsman.com/', 'Large multi-breeder seed catalogue (price reference)'],
    ['ILGM', 'https://ilgm.com/', 'Breeder + growing guides'],
    ['Royal Queen Seeds', 'https://www.royalqueenseeds.com/', 'EU breeder; published per-pack pricing'],
    ['Barneys Farm', 'https://www.barneysfarm.com/', 'Award-line genetics (lineage reference)'],
  ],
  'Lab & Cultivar Standards': [
    ['Medicinal Genomics (Kannapedia)', 'https://www.kannapedia.net/', 'Genome-sequenced cultivar registry'],
    ['PsiloGenetics / Open Cannabis', 'https://opencannabisproject.org/', 'Open genetic-reference project archive'],
  ],
};

// Free, publicly downloadable policy + market PDFs. UNODC's World Drug Report and the IMF country
// reports are the no-paywall macro view of the cannabis economy; we link the report landing pages,
// not deep-linked binaries, so they stay valid as new editions ship.
export const REPORTS = [
  ['UNODC World Drug Report', 'https://www.unodc.org/unodc/en/data-and-analysis/world-drug-report.html', 'Annual global drug market + cannabis production/seizure data (free PDF)'],
  ['UNODC Statistics & Data', 'https://dataunodc.un.org/', 'Open drug-market datasets (cultivation, prices, seizures)'],
  ['IMF Country Reports', 'https://www.imf.org/en/Publications/SPROLLS/imf-staff-country-reports', 'Macro/legalization fiscal context by country (free PDF)'],
  ['UNODC Cannabis Cultivation Surveys', 'https://www.unodc.org/unodc/en/crop-monitoring/index.html', 'Crop-monitoring / cultivation survey reports (free PDF)'],
  ['EMCDDA Cannabis Markets', 'https://www.emcdda.europa.eu/publications/topic-overviews/cannabis_en', 'EU drug-market analyses incl. cannabis (free PDF)'],
];

// Where a wholesale price-INDEX is publicly readable. Cannabis Benchmarks is the reference wholesale
// index but it is gated; without access we soft-fail to null (provenance-tagged), exactly like a
// dead macro symbol. No scraping, no auth — if a public JSON ever exists we read it, else null.
const WHOLESALE_INDEX_URL = 'https://www.cannabisbenchmarks.com/'; // landing page; no public API

// ── US LAW: hemp vs marijuana classifier ────────────────────────────────────────────────────────
// The 2018 Farm Bill (Agriculture Improvement Act of 2018) defines "hemp" at 7 U.S.C. § 1639o as the
// Cannabis sativa L. plant with a delta-9 THC concentration of NOT MORE THAN 0.3 percent on a DRY
// WEIGHT basis. Cannabis above that line is "marihuana" under the Controlled Substances Act, 21 U.S.C.
// § 802(16), Schedule I. These are STATUTORY CITATIONS — facts, not our verdict. State law varies and
// federal rescheduling is in motion; we encode the nuances as data + notes and link the official text.

export const THC_LIMIT_PCT = 0.3;             // 7 U.S.C. § 1639o — delta-9 THC, dry weight basis.

export const STATUTES = {
  hempDefinition: ['7 U.S.C. § 1639o', 'https://www.law.cornell.edu/uscode/text/7/1639o', 'Farm Bill (2018) statutory definition of "hemp" (≤0.3% delta-9 THC, dry weight)'],
  csaMarihuana: ['21 U.S.C. § 802(16)', 'https://www.law.cornell.edu/uscode/text/21/802', 'Controlled Substances Act definition of "marihuana"'],
  csaSchedules: ['21 U.S.C. § 812', 'https://www.law.cornell.edu/uscode/text/21/812', 'CSA drug schedules (marihuana = Schedule I federally, pending reschedule)'],
  farmBill: ['Pub. L. 115-334 (Agriculture Improvement Act of 2018)', 'https://www.congress.gov/bill/115th-congress/house-bill/2', 'The 2018 Farm Bill that legalized hemp'],
};

// The legal nuances people actually trip over — stated as facts with citations, never as advice.
export const LAW_NOTES = [
  ['Total-THC vs delta-9', 'The federal hemp line at 7 U.S.C. § 1639o is DELTA-9 THC ≤0.3% dry weight. USDA testing rules (7 CFR Part 990) measure "total THC" = delta-9 + (0.877 × THCA), which can push compliant-looking flower over the line. The statute and the testing regulation are not the same number.', 'https://www.law.cornell.edu/cfr/text/7/part-990'],
  ['Hemp-derived cannabinoids (delta-8, etc.)', 'Delta-8 THC and similar cannabinoids synthesized from hemp-derived CBD sit in a legal gray area. The 2018 Farm Bill defines hemp by delta-9 content only; courts (e.g. AK Futures v. Boyd St. Distro, 9th Cir. 2022) have read delta-8 as hemp-derived, while DEA and several states treat synthesized cannabinoids differently. Status is contested and changing.', 'https://www.govinfo.gov/'],
  ['DEA Schedule III reschedule (in progress)', 'In 2024 HHS recommended and DOJ/DEA proposed moving marijuana from Schedule I to Schedule III. As of writing the rulemaking is NOT final — marijuana remains Schedule I federally until a final rule issues. Track the Federal Register docket.', 'https://www.federalregister.gov/'],
  ['State law varies', 'Many states have legalized medical and/or adult-use cannabis under state law; it remains federally controlled regardless. Some states ban hemp-derived intoxicants the Farm Bill leaves open. Always check the specific state.', 'https://www.ncsl.org/civil-and-criminal-justice/state-medical-cannabis-laws'],
];

// Official, no-paywall sources to send people to for the specifics we will NOT fabricate.
export const LAW_SOURCES = [
  ['Cornell LII — 7 U.S.C. § 1639o', 'https://www.law.cornell.edu/uscode/text/7/1639o', 'The hemp definition, official statutory text'],
  ['Cornell LII — 21 U.S.C. § 802', 'https://www.law.cornell.edu/uscode/text/21/802', 'CSA "marihuana" definition'],
  ['DEA — Drug Scheduling', 'https://www.dea.gov/drug-information/drug-scheduling', 'Federal controlled-substance schedules (source of record)'],
  ['USDA — Hemp Production Program', 'https://www.ams.usda.gov/rules-regulations/hemp', 'Federal hemp program + testing rules (7 CFR 990)'],
  ['NCSL — State Medical Cannabis Laws', 'https://www.ncsl.org/civil-and-criminal-justice/state-medical-cannabis-laws', 'State-by-state legality (the per-state specifics we link, not fabricate)'],
  ['DISA — State Marijuana Laws Map', 'https://disa.com/marijuana-legality-by-state', 'Continuously updated state legality map'],
];

/**
 * PURE. Classify cannabis material as 'hemp' or 'marijuana' by the federal delta-9 THC line.
 * @param {number} delta9Pct  delta-9 THC concentration as a PERCENT (e.g. 0.25 means 0.25%).
 * @param {{dryWeight?: boolean}} opts  the statute is on a DRY WEIGHT basis; pass dryWeight:true to
 *   assert the measurement is dry-weight (default true). A non-dry-weight measurement is flagged.
 * Returns a facts-not-verdicts record: { classification, delta9Pct, limitPct, dryWeight, citation,
 *   note } — or null on a non-finite/negative input.
 */
export function classifyByThc(delta9Pct, { dryWeight = true } = {}) {
  const v = Number(delta9Pct);
  if (!Number.isFinite(v) || v < 0) return null;
  const isHemp = v <= THC_LIMIT_PCT;
  const [cite, citeUrl] = STATUTES.hempDefinition;
  const [csaCite, csaUrl] = STATUTES.csaMarihuana;
  let note = isHemp
    ? `At ${v}% delta-9 THC this is at or below the ${THC_LIMIT_PCT}% line, so it meets the federal statutory definition of "hemp" (${cite}). Hemp-derived cannabinoid products and state law can still differ — see notes.`
    : `At ${v}% delta-9 THC this exceeds the ${THC_LIMIT_PCT}% line, so it falls outside the "hemp" definition and is "marihuana" under the federal Controlled Substances Act (${csaCite}, Schedule I). State law varies.`;
  if (!dryWeight) {
    note = `MEASUREMENT NOT ASSERTED AS DRY WEIGHT — the federal limit (${cite}) is a DRY WEIGHT basis, so this classification is indicative only. ` + note;
  }
  return {
    classification: isHemp ? 'hemp' : 'marijuana',
    delta9Pct: v,
    limitPct: THC_LIMIT_PCT,
    dryWeight: !!dryWeight,
    citation: { hemp: cite, hempUrl: citeUrl, csa: csaCite, csaUrl },
    note,
  };
}

/**
 * Facts-not-verdicts legal-status helper for a US state. We do NOT fabricate per-state specifics; we
 * return the cited FEDERAL line plus a note that state law varies and link the official trackers.
 * @param {string} [state]  optional state name/abbreviation (echoed back, not adjudicated).
 */
export function legalStatus(state) {
  const st = String(state == null ? '' : state).trim();
  const [hempCite, hempUrl] = STATUTES.hempDefinition;
  const [csaCite, csaUrl] = STATUTES.csaMarihuana;
  return {
    state: st || null,
    federal: {
      line: `Federally, hemp (Cannabis sativa L. with ≤${THC_LIMIT_PCT}% delta-9 THC on a dry-weight basis) is legal under ${hempCite}; cannabis above that line is "marihuana", a Schedule I controlled substance under ${csaCite} (a Schedule III reschedule is proposed but not final).`,
      citations: [STATUTES.hempDefinition, STATUTES.csaMarihuana, STATUTES.csaSchedules],
    },
    stateNote: st
      ? `State law for ${st} varies and is not adjudicated here. Check the official trackers below for ${st}'s current medical/adult-use and hemp-intoxicant status.`
      : 'State law varies widely (medical, adult-use, and hemp-intoxicant rules differ). Check the official trackers below for a specific state.',
    sources: LAW_SOURCES,
    asOf: nowIso(),
    disclaimer: 'Educational summary of public statutory text — not legal advice. For advice, consult a licensed attorney.',
  };
}

// ── Reform organizations + cannabis/entheogen churches registry ──────────────────────────────────
// FACTS + LINKS ONLY. Each entry: { name, type, focus, url, note, rightOfReply }. We make NO verdict
// on any organization's or church's legitimacy — type/focus/note are descriptive, and rightOfReply is
// the path an entity uses to correct its own record. (Like the lawyer/judge readers in Law.SoapBox.)
export const ORGANIZATIONS = [
  // Reform / advocacy organizations
  { name: 'NORML', type: 'reform-org', focus: 'Marijuana law reform; consumer advocacy', url: 'https://norml.org/', note: 'National Organization for the Reform of Marijuana Laws (founded 1970).', rightOfReply: 'https://norml.org/about/contact/' },
  { name: 'Marijuana Policy Project (MPP)', type: 'reform-org', focus: 'State-level legalization campaigns + lobbying', url: 'https://www.mpp.org/', note: 'Focuses on ballot initiatives and state legislative reform.', rightOfReply: 'https://www.mpp.org/about/contact-us/' },
  { name: 'Drug Policy Alliance (DPA)', type: 'reform-org', focus: 'Broad drug-policy reform; decriminalization; harm reduction', url: 'https://drugpolicy.org/', note: 'Works across drug policy, not cannabis alone.', rightOfReply: 'https://drugpolicy.org/contact-us' },
  { name: 'Students for Sensible Drug Policy (SSDP)', type: 'reform-org', focus: 'Student-led drug-policy reform + harm reduction education', url: 'https://ssdp.org/', note: 'International student/grassroots network.', rightOfReply: 'https://ssdp.org/contact/' },
  { name: 'Last Prisoner Project', type: 'reform-org', focus: 'Cannabis criminal-justice reform; release + record-clearing', url: 'https://www.lastprisonerproject.org/', note: 'Works to free people incarcerated for cannabis offenses.', rightOfReply: 'https://www.lastprisonerproject.org/contact' },
  { name: 'Marijuana Justice', type: 'reform-org', focus: 'Equity-centered cannabis reform; community reinvestment', url: 'https://marijuanajustice.org/', note: 'Centers racial-justice and equity in legalization.', rightOfReply: 'https://marijuanajustice.org/contact/' },
  { name: 'Americans for Safe Access (ASA)', type: 'reform-org', focus: 'Medical-cannabis access + patient advocacy', url: 'https://www.safeaccessnow.org/', note: 'Medical-cannabis patient and research advocacy.', rightOfReply: 'https://www.safeaccessnow.org/contact' },
  { name: 'NCIA (National Cannabis Industry Association)', type: 'reform-org', focus: 'Cannabis industry trade association + federal policy', url: 'https://thecannabisindustry.org/', note: 'Represents legal cannabis businesses.', rightOfReply: 'https://thecannabisindustry.org/contact-us/' },
  { name: 'MAPS (Multidisciplinary Assoc. for Psychedelic Studies)', type: 'reform-org', focus: 'Psychedelic + cannabis research and policy', url: 'https://maps.org/', note: 'Research nonprofit; cannabis is part of a broader program.', rightOfReply: 'https://maps.org/contact/' },

  // Cannabis / entheogen churches (descriptive only — NO legitimacy verdict)
  { name: 'Oklevueha Native American Church', type: 'church', focus: 'Entheogen-based ceremony (claims sacramental cannabis/peyote use)', url: 'https://nativeamericanchurches.org/', note: 'Self-described Native American Church branch; legal status of its sacrament claims has been contested in US courts.', rightOfReply: 'https://nativeamericanchurches.org/contact/' },
  { name: 'THC Ministry', type: 'church', focus: 'Cannabis-as-sacrament religious practice', url: 'https://thc-ministry.org/', note: 'Religious organization centering cannabis as a sacrament; legality of sacramental use is jurisdiction-dependent.', rightOfReply: 'https://thc-ministry.org/' },
  { name: 'The First Church of Cannabis', type: 'church', focus: 'Cannabis-centered congregation (Indiana, est. 2015)', url: 'https://www.thecannabist.church/', note: 'Founded under Indiana RFRA; sacramental use claims litigated.', rightOfReply: 'https://www.thecannabist.church/' },
  { name: 'Elevation Ministries / International Church of Cannabis', type: 'church', focus: 'Cannabis-as-sacrament congregation (Denver)', url: 'https://elevationists.org/', note: 'Denver-based "Elevationist" congregation.', rightOfReply: 'https://elevationists.org/contact/' },
];

/** Filter the registry by type ('reform-org' | 'church'), or return all. Facts + links only. */
export function organizations(type) {
  if (!type) return ORGANIZATIONS;
  return ORGANIZATIONS.filter((o) => o.type === type);
}

const nowIso = () => new Date().toISOString();
// freshness band from age-in-ms — mirrors the spirit of macro's live/stale framing.
function freshnessOf(fetchedAtIso) {
  const age = Date.now() - Date.parse(fetchedAtIso);
  if (!(age >= 0)) return 'unknown';
  if (age < 3_600_000) return 'live';        // < 1h
  if (age < 86_400_000) return 'recent';     // < 1d
  if (age < 7 * 86_400_000) return 'stale';  // < 1w
  return 'archival';
}

/**
 * PURE. Compute a fair per-seed / per-pack price range from an array of listing prices.
 * Returns a provenance-tagged record { value:{low,median,high,n}, source, fetched_at, freshness,
 * confidence }, or null if there is nothing usable. low/high are the IQR fences (25th/75th
 * percentile via linear interpolation); median is the 50th. Non-finite / non-positive prices are
 * dropped. Confidence rises with sample size and falls with relative spread.
 *
 * Accepts numbers or objects with a numeric `price` (e.g. listing rows).
 */
export function deriveSeedIndex(listings, { source = 'aggregated listings', fetched_at = nowIso() } = {}) {
  if (!Array.isArray(listings)) return null;
  const prices = listings
    .map((x) => (typeof x === 'number' ? x : x && typeof x.price === 'number' ? x.price : NaN))
    .filter((p) => Number.isFinite(p) && p > 0)
    .sort((a, b) => a - b);
  const n = prices.length;
  if (n === 0) return null;

  // linear-interpolated percentile over the sorted array.
  const pct = (q) => {
    if (n === 1) return prices[0];
    const idx = q * (n - 1);
    const lo = Math.floor(idx);
    const hi = Math.ceil(idx);
    if (lo === hi) return prices[lo];
    return prices[lo] + (prices[hi] - prices[lo]) * (idx - lo);
  };

  const round2 = (x) => Math.round(x * 100) / 100;
  const q1 = pct(0.25);
  const median = pct(0.5);
  const q3 = pct(0.75);

  // confidence: more samples + tighter spread → higher. IQR/median is the relative spread.
  const spread = median > 0 ? (q3 - q1) / median : 1;
  const sampleScore = Math.min(1, n / 8);          // saturates at ~8 listings
  const spreadScore = Math.max(0, 1 - spread);     // 0 spread → 1, IQR == median → 0
  let confidence = round2(0.35 + 0.4 * sampleScore + 0.25 * spreadScore);
  if (confidence > 1) confidence = 1;
  if (n < 3) confidence = Math.min(confidence, 0.5); // never high-confidence on < 3 points

  const fetchedAt = fetched_at || nowIso();
  return {
    value: { low: round2(q1), median: round2(median), high: round2(q3), n },
    source,
    fetched_at: fetchedAt,
    freshness: freshnessOf(fetchedAt),
    confidence,
  };
}

// Illustrative SAMPLE listings — NOT a live price feed. There is no keyless public wholesale/retail
// cannabis price API (Cannabis Benchmarks is gated; scourCannabis returns search hits, not prices), so
// rather than render an empty page we publish a small, clearly-labeled sample so the hemp/marijuana
// split is demonstrable. Each row carries a delta9Pct so it self-classifies on the 7 U.S.C. § 1639o
// line: hemp flower (CBD, ≤0.3%) prices below the legal line, marijuana flower (THC, >0.3%) above it.
// When a real keyless feed exists, inject it as a source and these become unnecessary.
export const SAMPLE_FLOWER_LISTINGS = [
  // hemp / CBD flower (per gram) — delta-9 at or under the 0.3% line
  { price: 4, delta9Pct: 0.2 }, { price: 5, delta9Pct: 0.25 }, { price: 6, delta9Pct: 0.1 },
  { price: 7, delta9Pct: 0.3 }, { price: 5.5, delta9Pct: 0.15 },
  // marijuana / THC flower (per gram) — delta-9 well over the line
  { price: 9, delta9Pct: 18 }, { price: 12, delta9Pct: 22 }, { price: 10, delta9Pct: 15 },
  { price: 14, delta9Pct: 25 }, { price: 11, delta9Pct: 20 },
];
export const SAMPLE_SEED_LISTINGS = [
  // hemp / CBD seed packs (per pack) — bred for ≤0.3% delta-9
  { price: 30, delta9Pct: 0.2 }, { price: 45, delta9Pct: 0.25 }, { price: 40, delta9Pct: 0.1 },
  { price: 50, delta9Pct: 0.3 },
  // marijuana / THC seed packs (per pack) — high-THC genetics
  { price: 60, delta9Pct: 20 }, { price: 90, delta9Pct: 24 }, { price: 75, delta9Pct: 18 },
  { price: 120, delta9Pct: 28 },
];

/**
 * PURE. Partition listings into hemp / marijuana / unknown by the federal delta-9 THC line.
 *
 * THE RULE (7 U.S.C. § 1639o, the 2018 Farm Bill): a listing whose delta-9 THC concentration is
 * NOT MORE THAN 0.3% (dry-weight basis) is "hemp"; ABOVE 0.3% it is "marihuana" under the CSA
 * (21 U.S.C. § 802(16), Schedule I). A listing that does not carry a THC measurement is 'unknown'
 * — we never guess which side of the statutory line it falls on.
 *
 * Each listing may carry an explicit `classification` ('hemp' | 'marijuana'), OR a numeric
 * `delta9Pct` (a percent, e.g. 0.25 means 0.25%) which we run through classifyByThc(). Listings
 * with neither are 'unknown'. Bare numbers cannot self-classify, so they too are 'unknown'.
 *
 * @param {Array<number|object>} listings
 * Returns { hemp:[...], marijuana:[...], unknown:[...] } (always all three arrays). On a non-array
 * input returns the three-empty shape.
 */
export function splitByThc(listings) {
  const out = { hemp: [], marijuana: [], unknown: [] };
  if (!Array.isArray(listings)) return out;
  for (const row of listings) {
    let cls = null;
    if (row && typeof row === 'object') {
      if (row.classification === 'hemp' || row.classification === 'marijuana') {
        cls = row.classification;
      } else if (Number.isFinite(Number(row.delta9Pct))) {
        const c = classifyByThc(Number(row.delta9Pct));
        cls = c ? c.classification : null;   // null only if negative/non-finite (already filtered)
      }
    }
    if (cls === 'hemp') out.hemp.push(row);
    else if (cls === 'marijuana') out.marijuana.push(row);
    else out.unknown.push(row);
  }
  return out;
}

/**
 * PURE. Split listings on the US-law delta-9 0.3% line, then derive a SEPARATE price index for each
 * side — so hemp and marijuana prices are never lumped into one median (the whole point: they are
 * legally distinct goods, 7 U.S.C. § 1639o vs 21 U.S.C. § 802(16)). Each index is a deriveSeedIndex()
 * result (or null if that side has no usable prices). `unknown` listings (no THC tag) are surfaced as
 * their own index too, so nothing is silently dropped.
 *
 * @param {Array<number|object>} listings  listings tagged with delta9Pct or classification.
 * @param {{ source?: string, fetched_at?: string }} [opts]  forwarded to deriveSeedIndex per side.
 * Returns { hemp, marijuana, unknown, basis } where basis names the legal line used to split.
 */
export function cannabisPriceIndexes(listings, { source = 'aggregated listings', fetched_at = nowIso() } = {}) {
  const parts = splitByThc(listings);
  const idx = (rows, label) => deriveSeedIndex(rows, { source: `${source} — ${label}`, fetched_at });
  return {
    hemp: idx(parts.hemp, 'hemp ≤0.3% delta-9'),
    marijuana: idx(parts.marijuana, 'marijuana >0.3% delta-9'),
    unknown: idx(parts.unknown, 'unclassified (no THC measurement)'),
    basis: 'US-law delta-9 0.3% line (7 U.S.C. § 1639o)',
  };
}

/**
 * Wholesale price-index reader. Best-effort: Cannabis Benchmarks has no public API, so this attempts
 * a keyless read and soft-fails to a provenance-tagged null payload (value:null) rather than throwing.
 * Returns { value, source, fetched_at, freshness, confidence }.
 */
export async function wholesaleIndex() {
  const fetched_at = nowIso();
  const miss = { value: null, source: 'Cannabis Benchmarks', fetched_at, freshness: 'unknown', confidence: 0 };
  try {
    const r = await _fetch(WHOLESALE_INDEX_URL, { headers: { 'user-agent': UA } });
    if (!r || !r.ok) return miss;
    // No public structured feed today — without access we do not fabricate a number.
    return miss;
  } catch {
    return miss;
  }
}

/** The free-report directory, as-is (link-outs to UNODC/IMF/EMCDDA PDFs). */
export function reports() {
  return REPORTS;
}

// ── Price aggregation: flower + seeds (derive our own index, provenance-tagged) ───────────────────
// Like price-oracle: sources are INJECTABLE so tests run offline. Each source fn returns an array of
// listing prices (numbers) or rows ({ price, ... }); we fuse them with deriveSeedIndex() and return a
// normalized { item, low, median, high, sources[], asOf }. Sources soft-fail to [] independently — a
// dead source never takes the aggregate down. We DERIVE the median index from listings (we do not echo
// a single vendor's number), so the index is our own provenance-tagged computation.

function normalizeIndex(item, derived, sourceNames) {
  if (!derived) return { item, low: null, median: null, high: null, n: 0, confidence: 0, sources: sourceNames, asOf: nowIso() };
  return {
    item,
    low: derived.value.low,
    median: derived.value.median,
    high: derived.value.high,
    n: derived.value.n,
    confidence: derived.confidence,
    sources: sourceNames,
    asOf: derived.fetched_at,
  };
}

// Run a set of injectable price sources concurrently; each soft-fails to []. Returns { prices[], names[] }.
async function gatherPrices(sources) {
  const entries = Object.entries(sources || {});
  const results = await Promise.all(entries.map(async ([name, fn]) => {
    try {
      const rows = typeof fn === 'function' ? await fn() : fn;
      return { name, rows: Array.isArray(rows) ? rows : [] };
    } catch { return { name, rows: [] }; }
  }));
  const prices = [];
  const names = [];
  for (const { name, rows } of results) {
    if (rows.length) names.push(name);
    for (const r of rows) prices.push(r);
  }
  return { prices, names };
}

/**
 * Retail FLOWER price aggregation → our own median index (per-gram or per-eighth, caller's unit).
 * @param {{ sources?: Record<string, () => (number[]|object[])>, item?: string }} [opts]
 *   `sources` maps a source-name → a fn returning listing prices (numbers or {price} rows). With no
 *   sources configured it returns an empty, honest index (we never fabricate a price). Injectable for
 *   offline tests, exactly like price-oracle.
 * Returns { item, low, median, high, n, confidence, sources[], asOf }.
 */
export async function flowerPrices({ sources = {}, item = 'cannabis flower (per gram)' } = {}) {
  const { prices, names } = await gatherPrices(sources);
  const source = names.join('+') || 'no sources configured';
  const derived = deriveSeedIndex(prices, { source });
  // Backward-compatible single index, PLUS the US-law hemp/marijuana split as the new shape. The
  // 0.3% delta-9 line (7 U.S.C. § 1639o) makes these legally distinct goods, so we never present a
  // lumped median as the only number — split[hemp]/split[marijuana] are the per-side indexes.
  const split = cannabisPriceIndexes(prices, { source });
  return { ...normalizeIndex(item, derived, names), split };
}

/**
 * SEED-BANK price aggregation → our own median index (per-pack/per-seed, caller's unit). Same shape and
 * injectable-source contract as flowerPrices(). SeedFinder-style strain lookup is strainLookup().
 */
export async function seedPrices({ sources = {}, item = 'cannabis seeds (per pack)' } = {}) {
  const { prices, names } = await gatherPrices(sources);
  const source = names.join('+') || 'no sources configured';
  const derived = deriveSeedIndex(prices, { source });
  // Same hemp/marijuana split as flowerPrices() — backward-compatible single index plus the new
  // split shape keyed on the US-law delta-9 0.3% line (7 U.S.C. § 1639o).
  const split = cannabisPriceIndexes(prices, { source });
  return { ...normalizeIndex(item, derived, names), split };
}

/**
 * SeedFinder-style strain / lineage / breeder lookup. Best-effort: SeedFinder has no public JSON API,
 * so by default this builds DIRECTORY link-outs to the authoritative strain databases (search URLs the
 * user can follow) and soft-fails the network probe to null — we never scrape or fabricate lineage. A
 * fetcher is injectable via __setFetch for any future public endpoint. Returns
 *   { query, links:[{source,url}], lineage:null, asOf }.
 */
export async function strainLookup(strain) {
  const q = String(strain == null ? '' : strain).trim();
  const asOf = nowIso();
  if (!q) return { query: '', links: [], lineage: null, asOf };
  const enc = encodeURIComponent(q);
  const links = [
    { source: 'SeedFinder', url: `https://en.seedfinder.eu/search/?q=${enc}` },
    { source: 'Leafly', url: `https://www.leafly.com/search?q=${enc}` },
    { source: 'AllBud', url: `https://www.allbud.com/search?term=${enc}` },
    { source: 'Wikileaf', url: `https://www.wikileaf.com/search/?q=${enc}` },
  ];
  // Best-effort probe — soft-fail to a null lineage rather than throwing or inventing parentage.
  let lineage = null;
  try {
    const r = await _fetch(links[0].url, { headers: { 'user-agent': UA } });
    void r; // no public structured feed — we do not parse a number/lineage out of HTML here.
  } catch { /* probe failed — links still returned */ }
  return { query: q, links, lineage, asOf };
}

// ── Resource-Center cannabis scour ────────────────────────────────────────────────────────────────
// A topic seed list + a query path so the Resource Center / scraper can scour the web for hemp/cannabis
// data on demand. The scraper is INJECTABLE (default: lazy-load integrations/scraper.mjs) so this is
// fully offline-testable. Returns cited results; soft-fails to [] (never throws, never fabricates).

export const CANNABIS_TOPIC_SEEDS = [
  'hemp vs marijuana legal definition 0.3% THC farm bill',
  'cannabis rescheduling Schedule III DEA status',
  'delta-8 THC hemp-derived cannabinoid legality',
  'state cannabis legalization map medical adult-use',
  'cannabis wholesale flower price index',
  'cannabis seed bank pack prices',
  'cannabis strain lineage genetics breeder',
  'cannabis law reform organizations',
];

let _scour = null;
/** Inject the web-scour fn (q, {limit}) -> [{title,url,snippet,...}] for offline tests. null = default. */
export function __setScour(fn) { _scour = typeof fn === 'function' ? fn : null; }

async function defaultScour(q, { limit } = {}) {
  try {
    const mod = await import('../scraper.mjs');
    if (typeof mod.searchAll === 'function') return await mod.searchAll(q, { limit });
    if (typeof mod.search === 'function') return await mod.search(q, { limit });
  } catch { /* scraper absent — soft-fail below */ }
  return [];
}

/**
 * Scour the web for hemp/cannabis data. With no query, fans across the topic seed list; otherwise runs
 * the single query. Returns { query, results:[{title,url,snippet,providers?}], sources, asOf }. Cited,
 * soft-fails to []. The scour fn is injectable (__setScour) so tests never touch the network.
 */
export async function scourCannabis(query, { limit = 8 } = {}) {
  const scour = _scour || defaultScour;
  const asOf = nowIso();
  const q = String(query == null ? '' : query).trim();
  const queries = q ? [q] : CANNABIS_TOPIC_SEEDS;
  const lists = await Promise.all(queries.map((term) =>
    Promise.resolve().then(() => scour(term, { limit })).catch(() => [])));
  // dedup by url, keep first-seen.
  const byUrl = new Map();
  for (const rows of lists) {
    for (const r of (Array.isArray(rows) ? rows : [])) {
      if (r && r.url && !byUrl.has(r.url)) byUrl.set(r.url, r);
    }
  }
  const results = [...byUrl.values()].slice(0, q ? limit : limit * 2);
  return { query: q || '(topic seeds)', results, sources: results.length, asOf };
}

/** Homepage chip: directory counts + a wholesale-index probe (null when ungated source is unreadable). */
export async function cannabisSummary() {
  const wholesale = await wholesaleIndex().catch(() => null);
  const strainSourceCount = Object.values(STRAIN_SOURCES).reduce((a, rows) => a + rows.length, 0);
  return {
    strainSources: strainSourceCount,
    reportCount: REPORTS.length,
    orgCount: organizations('reform-org').length,
    churchCount: organizations('church').length,
    lawNotes: LAW_NOTES.length,
    wholesale,                 // { value:null, ... } when no public access
    fetched_at: nowIso(),
  };
}

if (process.argv[1] && process.argv[1].endsWith('cannabis.mjs')) {
  console.log('Strain-lineage sources:');
  for (const [cat, rows] of Object.entries(STRAIN_SOURCES)) {
    console.log(`\n  ${cat}`);
    for (const [name, url, desc] of rows) console.log(`    ${name.padEnd(28)} ${url}  — ${desc}`);
  }
  console.log('\nFree reports:');
  for (const [name, url] of REPORTS) console.log(`  ${name.padEnd(34)} ${url}`);
  const demo = deriveSeedIndex([12, 15, 18, 20, 25, 60, 11, 14]);
  console.log('\nderiveSeedIndex demo:', JSON.stringify(demo));
  console.log('wholesaleIndex:', JSON.stringify(await wholesaleIndex()));
  console.log('\nclassifyByThc(0.25):', JSON.stringify(classifyByThc(0.25)));
  console.log('classifyByThc(0.9):', JSON.stringify(classifyByThc(0.9)));
  console.log('\nlegalStatus("California").federal.line:', legalStatus('California').federal.line);
  console.log('\nReform orgs:', organizations('reform-org').map((o) => o.name).join(', '));
  console.log('Churches:', organizations('church').map((o) => o.name).join(', '));
  const fp = await flowerPrices({ sources: { demoA: () => [8, 10, 12, 9, 11], demoB: () => [10, 13] } });
  console.log('\nflowerPrices demo:', JSON.stringify(fp));
  const sp = await seedPrices({ sources: { demo: () => [40, 60, 80, 50] } });
  console.log('seedPrices demo:', JSON.stringify(sp));
  console.log('\nsplitByThc(sample flower):', JSON.stringify(
    Object.fromEntries(Object.entries(splitByThc(SAMPLE_FLOWER_LISTINGS)).map(([k, v]) => [k, v.length]))));
  console.log('cannabisPriceIndexes(sample flower):', JSON.stringify(cannabisPriceIndexes(SAMPLE_FLOWER_LISTINGS)));
  console.log('\nstrainLookup("Northern Lights").links:', JSON.stringify((await strainLookup('Northern Lights')).links));
  console.log('\nCANNABIS_TOPIC_SEEDS:', CANNABIS_TOPIC_SEEDS.length, 'seed queries');
}
