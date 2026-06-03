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

/** Homepage chip: directory counts + a wholesale-index probe (null when ungated source is unreadable). */
export async function cannabisSummary() {
  const wholesale = await wholesaleIndex().catch(() => null);
  const strainSourceCount = Object.values(STRAIN_SOURCES).reduce((a, rows) => a + rows.length, 0);
  return {
    strainSources: strainSourceCount,
    reportCount: REPORTS.length,
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
}
