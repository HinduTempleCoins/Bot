// coliving.mjs — the SoapBox cost-of-living vertical (queue task #101). Answers "what does it
// actually cost to live here, and is that number trustworthy?" by fusing official US gov series
// into ONE provenance-tagged record. Sources, each soft-failing independently:
//   • FRED   (St. Louis Fed, api.stlouisfed.org) — CPI series. Needs FRED_API_KEY (soft-fail if absent).
//   • BLS    (api.bls.gov) — has a KEYLESS v1 path; BLS_API_KEY upgrades to v2 (higher limits) if present.
//   • Census (api.census.gov) — ACS metro economics. CENSUS_API_KEY optional (keyless works, lower limit).
//   • USDA NASS QuickStats (quickstats.nass.usda.gov) — grocery/food commodity prices. Needs USDA_API_KEY
//     (soft-fail if absent).
//
// Pattern matches macro.mjs / weather.mjs: ESM, __setFetch hook, graceful soft-fail (return
// null on error, NEVER throw), a guarded CLI, and PURE fusion/provenance helpers unit-tested offline.
//
//   import { cpi, groceryPrices, byMetro, costOfLiving } from './coliving.mjs'
//   node integrations/soapbox/coliving.mjs "New York"
//
// Keys are read from process.env at call time and used only in request URLs/bodies — never logged,
// never printed, never returned in any record.

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxCoLiving/1.0 (+https://data.soapbox.community)' };

// ---------------------------------------------------------------------------
// PURE fusion + provenance-tagging logic (unit-tested offline, no network)
// ---------------------------------------------------------------------------

// How old (ms) a reading may be before we down-rank its freshness. Gov macro series update
// monthly/annually, so the bands are generous compared to the price feeds in macro.mjs.
export const FRESHNESS_BANDS = {
  fresh: 35 * 24 * 60 * 60 * 1000,   // < ~35 days: this month's print
  recent: 100 * 24 * 60 * 60 * 1000, // < ~100 days: last quarter
  aging: 400 * 24 * 60 * 60 * 1000,  // < ~400 days: within the year
  // older than that → 'stale'
};

// Classify an observation's age into a freshness label. Inputs are ms-since-epoch; null asOf
// (we don't know when it was measured) → 'unknown'.
export function freshnessLabel(observedAtMs, nowMs = Date.now()) {
  if (observedAtMs == null || !Number.isFinite(Number(observedAtMs))) return 'unknown';
  const age = nowMs - Number(observedAtMs);
  if (age < 0) return 'fresh'; // future-dated print, treat as fresh
  if (age < FRESHNESS_BANDS.fresh) return 'fresh';
  if (age < FRESHNESS_BANDS.recent) return 'recent';
  if (age < FRESHNESS_BANDS.aging) return 'aging';
  return 'stale';
}

// freshness label → 0..1 weight, used in the confidence calc.
export function freshnessWeight(label) {
  switch (label) {
    case 'fresh': return 1.0;
    case 'recent': return 0.8;
    case 'aging': return 0.55;
    case 'stale': return 0.3;
    default: return 0.4; // unknown
  }
}

// Per-source base trust. Official primary series (FRED/BLS/Census) outrank a commodity proxy (USDA).
export const SOURCE_TRUST = {
  fred: 0.95,
  bls: 0.9,
  census: 0.9,
  usda: 0.7,
  fused: 0.85,
};

// Parse a gov date string ("2026-04-01", "2026-04", "2026") → ms-since-epoch, or null.
export function parseObsDate(s) {
  if (s == null) return null;
  const str = String(s).trim();
  if (!str) return null;
  let iso = str;
  if (/^\d{4}$/.test(str)) iso = `${str}-01-01`;
  else if (/^\d{4}-\d{2}$/.test(str)) iso = `${str}-01`;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/**
 * Wrap a raw reading into a provenance-tagged record. This is the single tagging primitive
 * every public getter funnels through, so the shape is identical everywhere.
 *   { value, source, fetched_at, freshness, confidence }
 * confidence = source-trust × freshness-weight, clamped to [0,1], rounded to 2dp.
 */
export function provenanceTag({ value, source, observedAt, nowMs = Date.now(), trust } = {}) {
  const freshness = freshnessLabel(observedAt, nowMs);
  const baseTrust = trust != null ? trust : (SOURCE_TRUST[source] ?? 0.5);
  const confidence = value == null
    ? 0
    : Math.max(0, Math.min(1, Math.round(baseTrust * freshnessWeight(freshness) * 100) / 100));
  return {
    value: value == null ? null : value,
    source,
    fetched_at: new Date(nowMs).toISOString(),
    freshness,
    confidence,
  };
}

/**
 * Fuse several provenance-tagged component records into ONE. The fused value is a
 * confidence-weighted average of the numeric components (skipping nulls); the fused
 * confidence is the mean component confidence scaled by coverage (how many of the
 * requested components actually returned a value). Components are kept under `.components`.
 * Returns a single {value, source, fetched_at, freshness, confidence, components} record.
 */
export function fuseRecords(components = {}, { nowMs = Date.now() } = {}) {
  const entries = Object.entries(components).filter(([, v]) => v && typeof v === 'object');
  const present = entries.filter(([, v]) => v.value != null && Number.isFinite(Number(v.value)));

  let value = null;
  let weightSum = 0;
  let valueSum = 0;
  for (const [, v] of present) {
    const w = (v.confidence ?? 0) || 0.01; // avoid all-zero collapse
    weightSum += w;
    valueSum += Number(v.value) * w;
  }
  if (weightSum > 0) value = Math.round((valueSum / weightSum) * 100) / 100;

  // coverage: requested components that produced a usable value
  const requested = entries.length || 1;
  const coverage = present.length / requested;

  // confidence: mean component confidence × coverage, clamped/rounded
  const meanConf = present.length
    ? present.reduce((a, [, v]) => a + (v.confidence ?? 0), 0) / present.length
    : 0;
  const confidence = value == null
    ? 0
    : Math.max(0, Math.min(1, Math.round(meanConf * coverage * 100) / 100));

  // fused freshness = the WORST (most pessimistic) present component, so the headline
  // never claims to be fresher than its stalest input.
  const order = ['stale', 'unknown', 'aging', 'recent', 'fresh'];
  let worst = 'fresh';
  for (const [, v] of present) {
    if (order.indexOf(v.freshness) < order.indexOf(worst)) worst = v.freshness;
  }
  const freshness = present.length ? worst : 'unknown';

  return {
    value,
    source: 'fused',
    fetched_at: new Date(nowMs).toISOString(),
    freshness,
    confidence,
    components,
  };
}

// ---------------------------------------------------------------------------
// vehicle ownership-cost (queue task #119) — fold transportation into cost-of-living
// ---------------------------------------------------------------------------

// A sensible national-average fallback fuel price ($/gal) used only when no live price is
// available and the caller didn't pass one. Live prices come from gasProxy()/the BLS series.
export const DEFAULT_FUEL_PRICE_PER_GAL = 3.5;

// Minimal HTML-escape for any rendered text line (matches the convention in the sibling
// soapbox modules). Used by vehicleSummaryLine so rendered output is always safe.
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const num = (x) => { const n = Number(x); return Number.isFinite(n) ? n : null; };
const round2 = (n) => Math.round(n * 100) / 100;

/**
 * PURE all-in monthly vehicle ownership cost. Sums the four monthly cost buckets:
 *   fuel        = (milesPerYear / mpg) × fuelPricePerGal / 12
 *   insurance   = insuranceMonthly
 *   maintenance = maintenanceYearly / 12
 *   payment     = paymentMonthly
 * Any missing/non-finite input is treated as 0 for that bucket (soft-fail, never throws).
 * If fuelPricePerGal is omitted it falls back to DEFAULT_FUEL_PRICE_PER_GAL. Fuel cost is
 * only added when both a positive mpg and milesPerYear are present.
 * Returns { monthly, fuel, insurance, maintenance, payment, breakdown:{annualMiles,mpg,fuelPricePerGal} }
 * with all dollar figures rounded to 2dp, or { monthly: null } when there is no usable input.
 */
export function vehicleOwnershipCost({
  mpg, milesPerYear, fuelPricePerGal,
  insuranceMonthly, maintenanceYearly, paymentMonthly,
} = {}) {
  const mpgN = num(mpg);
  const milesN = num(milesPerYear);
  const priceN = num(fuelPricePerGal);
  const insN = num(insuranceMonthly);
  const maintN = num(maintenanceYearly);
  const payN = num(paymentMonthly);

  // fuel only when we have a positive mpg and annual mileage
  const usedPrice = priceN != null && priceN >= 0 ? priceN : DEFAULT_FUEL_PRICE_PER_GAL;
  const fuel = (mpgN != null && mpgN > 0 && milesN != null && milesN >= 0)
    ? round2((milesN / mpgN) * usedPrice / 12)
    : 0;
  const insurance = insN != null && insN >= 0 ? round2(insN) : 0;
  const maintenance = maintN != null && maintN >= 0 ? round2(maintN / 12) : 0;
  const payment = payN != null && payN >= 0 ? round2(payN) : 0;

  const anyInput = [mpgN, milesN, insN, maintN, payN].some((v) => v != null);
  if (!anyInput) return { monthly: null, fuel: 0, insurance: 0, maintenance: 0, payment: 0, breakdown: null };

  return {
    monthly: round2(fuel + insurance + maintenance + payment),
    fuel, insurance, maintenance, payment,
    breakdown: {
      annualMiles: milesN,
      mpg: mpgN,
      fuelPricePerGal: (mpgN != null && mpgN > 0 && milesN != null && milesN >= 0) ? usedPrice : null,
    },
  };
}

/**
 * A safe, escaped one-line "Transportation" summary for the rendered output. Returns null when
 * there is no vehicle cost to surface (so callers add the line additively, never blank).
 */
export function vehicleSummaryLine(vehicleCost) {
  if (!vehicleCost || vehicleCost.monthly == null) return null;
  const parts = [];
  if (vehicleCost.fuel) parts.push(`fuel $${esc(vehicleCost.fuel)}`);
  if (vehicleCost.insurance) parts.push(`insurance $${esc(vehicleCost.insurance)}`);
  if (vehicleCost.maintenance) parts.push(`maintenance $${esc(vehicleCost.maintenance)}`);
  if (vehicleCost.payment) parts.push(`payment $${esc(vehicleCost.payment)}`);
  const detail = parts.length ? ` (${parts.join(' + ')})` : '';
  return `Transportation: $${esc(vehicleCost.monthly)}/mo${esc(detail)}`;
}

/**
 * Defensively resolve a live fuel price ($/gal) for the vehicle calc, reusing the existing
 * BLS gas series via gasProxy(). Soft-fails to null (never throws); callers fall back to a
 * passed price or DEFAULT_FUEL_PRICE_PER_GAL. Kept separate so the pure helper stays pure.
 */
export async function liveFuelPrice({ nowMs = Date.now() } = {}) {
  try {
    const rec = await gasProxy({ nowMs });
    return rec && rec.value != null && Number.isFinite(Number(rec.value)) ? Number(rec.value) : null;
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// live data (each source soft-fails to a null-valued provenance record, never throws)
// ---------------------------------------------------------------------------

async function getJson(url, opts = {}) {
  try {
    const r = await _fetch(url, { headers: UA, ...opts });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

async function postJson(url, body) {
  try {
    const r = await _fetch(url, {
      method: 'POST',
      headers: { ...UA, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// A null-valued provenance record for a source that couldn't deliver (no key / network fail).
function emptyRecord(source, nowMs = Date.now()) {
  return provenanceTag({ value: null, source, observedAt: null, nowMs });
}

/**
 * Consumer Price Index (all-items, US city average) latest reading.
 * Tries FRED first (series CPIAUCSL) when FRED_API_KEY is set; falls back to BLS's keyless v1
 * path (series CUUR0000SA0). Returns a provenance-tagged record (value=index level), or a
 * null-valued record on total failure. Never throws.
 */
export async function cpi({ nowMs = Date.now() } = {}) {
  const fredKey = process.env.FRED_API_KEY;
  if (fredKey) {
    const url = 'https://api.stlouisfed.org/fred/series/observations'
      + '?series_id=CPIAUCSL&sort_order=desc&limit=1&file_type=json'
      + `&api_key=${encodeURIComponent(fredKey)}`;
    const j = await getJson(url);
    const obs = j && Array.isArray(j.observations) ? j.observations[0] : null;
    if (obs && obs.value != null && obs.value !== '.') {
      return provenanceTag({
        value: Number(obs.value),
        source: 'fred',
        observedAt: parseObsDate(obs.date),
        nowMs,
      });
    }
  }

  // BLS keyless v1 fallback (registration key, BLS_API_KEY, lifts the v2 daily limit if present).
  const blsKey = process.env.BLS_API_KEY;
  const base = blsKey
    ? 'https://api.bls.gov/publicAPI/v2/timeseries/data/'
    : 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
  const body = { seriesid: ['CUUR0000SA0'], ...(blsKey ? { registrationkey: blsKey } : {}) };
  const j = await postJson(base, body);
  const series = j && j.Results && Array.isArray(j.Results.series) ? j.Results.series[0] : null;
  const latest = series && Array.isArray(series.data) ? series.data[0] : null;
  if (latest && latest.value != null) {
    // BLS gives period like "M04" + year "2026" → 2026-04
    const m = /^M(\d{2})$/.exec(latest.period || '');
    const date = m ? `${latest.year}-${m[1]}` : latest.year;
    return provenanceTag({
      value: Number(latest.value),
      source: 'bls',
      observedAt: parseObsDate(date),
      nowMs,
    });
  }

  return emptyRecord('fred', nowMs);
}

/**
 * Grocery / food-commodity price proxy via USDA NASS QuickStats. Requires USDA_API_KEY;
 * soft-fails to a null-valued record otherwise. Pulls a recent national price series for a
 * staple commodity (default: milk) as the basket proxy. Returns a provenance-tagged record.
 */
export async function groceryPrices({ commodity = 'MILK', nowMs = Date.now() } = {}) {
  const key = process.env.USDA_API_KEY;
  if (!key) return emptyRecord('usda', nowMs);

  const url = 'https://quickstats.nass.usda.gov/api/api_GET/'
    + `?key=${encodeURIComponent(key)}`
    + `&commodity_desc=${encodeURIComponent(commodity)}`
    + '&statisticcat_desc=PRICE+RECEIVED'
    + '&agg_level_desc=NATIONAL'
    + '&format=JSON';
  const j = await getJson(url);
  const rows = j && Array.isArray(j.data) ? j.data : [];
  // pick the most recent row by year (QuickStats returns `year` + `Value` strings).
  let best = null;
  for (const row of rows) {
    const yr = Number(row.year);
    const val = Number(String(row.Value).replace(/,/g, ''));
    if (!Number.isFinite(yr) || !Number.isFinite(val)) continue;
    if (!best || yr > best.yr) best = { yr, val, period: row.reference_period_desc };
  }
  if (!best) return emptyRecord('usda', nowMs);
  return provenanceTag({
    value: best.val,
    source: 'usda',
    observedAt: parseObsDate(String(best.yr)),
    nowMs,
  });
}

/**
 * Per-metro economics via the Census ACS (median household income, B19013_001E) for a metro
 * area name match. CENSUS_API_KEY is optional (keyless works at a lower limit). Returns a
 * provenance-tagged record (value = median household income), or a null-valued record.
 * @param {string} metro  metro-area name (substring matched against ACS metro names)
 */
export async function byMetro(metro, { nowMs = Date.now(), year = 2022 } = {}) {
  if (!metro) return emptyRecord('census', nowMs);
  const key = process.env.CENSUS_API_KEY;
  const url = `https://api.census.gov/data/${year}/acs/acs1`
    + '?get=NAME,B19013_001E'
    + '&for=metropolitan+statistical+area/micropolitan+statistical+area:*'
    + (key ? `&key=${encodeURIComponent(key)}` : '');
  const j = await getJson(url);
  // ACS returns [[header...],[row...]]; first row is the header.
  if (!Array.isArray(j) || j.length < 2) return emptyRecord('census', nowMs);
  const header = j[0];
  const nameIdx = header.indexOf('NAME');
  const valIdx = header.indexOf('B19013_001E');
  if (nameIdx < 0 || valIdx < 0) return emptyRecord('census', nowMs);
  const needle = String(metro).toLowerCase();
  let match = null;
  for (let i = 1; i < j.length; i++) {
    const name = String(j[i][nameIdx] || '');
    if (name.toLowerCase().includes(needle)) { match = j[i]; break; }
  }
  if (!match) return emptyRecord('census', nowMs);
  const val = Number(match[valIdx]);
  if (!Number.isFinite(val) || val < 0) return emptyRecord('census', nowMs);
  return provenanceTag({
    value: val,
    source: 'census',
    observedAt: parseObsDate(String(year)),
    nowMs,
    // attach the resolved metro name without leaking it into the tagging math
  });
}

/**
 * THE fusion entry point. Combines CPI + grocery prices + (optionally) the metro income signal
 * into one provenance-tagged cost-of-living record. Each component soft-fails independently and
 * is preserved under `.components`. Never throws.
 *   returns { value, source:'fused', fetched_at, freshness, confidence, components, metro }
 *
 * OPTIONAL transportation (queue task #119): pass `vehicle` with vehicleOwnershipCost inputs to
 * fold an all-in monthly vehicle cost into the record ADDITIVELY. When `vehicle` is omitted the
 * return shape and values are EXACTLY as before — existing callers see no change. When provided,
 * the record gains a `vehicle` field ({ ...cost, line }) and `monthlyTotal` = fused value (when
 * numeric) + vehicle.monthly. The fused `value`/`components`/`confidence` are left untouched.
 * @param {{metro?:string, includeGas?:boolean, nowMs?:number, vehicle?:object}} opts
 */
export async function costOfLiving({ metro, includeGas = false, nowMs = Date.now(), vehicle } = {}) {
  const tasks = {
    cpi: cpi({ nowMs }).catch(() => emptyRecord('fred', nowMs)),
    groceries: groceryPrices({ nowMs }).catch(() => emptyRecord('usda', nowMs)),
  };
  if (metro) tasks.metro = byMetro(metro, { nowMs }).catch(() => emptyRecord('census', nowMs));
  if (includeGas) {
    // gas is a CPI sub-index in FRED (series CUSR0000SETB01 via BLS, or APU00074714 etc.); we fold
    // in the energy CPI as the gas proxy through the same cpi() path keyed differently if available.
    tasks.gas = gasProxy({ nowMs }).catch(() => emptyRecord('fred', nowMs));
  }

  const keys = Object.keys(tasks);
  const results = await Promise.all(keys.map((k) => tasks[k]));
  const components = {};
  keys.forEach((k, i) => { components[k] = results[i]; });

  const fused = fuseRecords(components, { nowMs });
  if (metro) fused.metro = metro;

  // OPTIONAL: fold vehicle ownership cost in additively. Only touches the record when the caller
  // opts in with vehicle inputs — otherwise the shape/values are exactly as before.
  if (vehicle && typeof vehicle === 'object') {
    // resolve a live fuel price if the caller didn't supply one (soft-fail to default)
    let fuelPricePerGal = vehicle.fuelPricePerGal;
    if (fuelPricePerGal == null) {
      const live = await liveFuelPrice({ nowMs });
      if (live != null) fuelPricePerGal = live;
    }
    const cost = vehicleOwnershipCost({ ...vehicle, fuelPricePerGal });
    if (cost.monthly != null) {
      fused.vehicle = { ...cost, line: vehicleSummaryLine(cost) };
      fused.monthlyTotal = Number.isFinite(Number(fused.value))
        ? round2(Number(fused.value) + cost.monthly)
        : cost.monthly;
    }
  }

  return fused;
}

/**
 * Gasoline price proxy via BLS (keyless v1 path) — series APU000074714 (US city avg, gasoline
 * all types, $/gal). Used only when costOfLiving({includeGas:true}). Soft-fails to null record.
 */
export async function gasProxy({ nowMs = Date.now() } = {}) {
  const blsKey = process.env.BLS_API_KEY;
  const base = blsKey
    ? 'https://api.bls.gov/publicAPI/v2/timeseries/data/'
    : 'https://api.bls.gov/publicAPI/v1/timeseries/data/';
  const body = { seriesid: ['APU000074714'], ...(blsKey ? { registrationkey: blsKey } : {}) };
  const j = await postJson(base, body);
  const series = j && j.Results && Array.isArray(j.Results.series) ? j.Results.series[0] : null;
  const latest = series && Array.isArray(series.data) ? series.data[0] : null;
  if (latest && latest.value != null) {
    const m = /^M(\d{2})$/.exec(latest.period || '');
    const date = m ? `${latest.year}-${m[1]}` : latest.year;
    return provenanceTag({ value: Number(latest.value), source: 'bls', observedAt: parseObsDate(date), nowMs });
  }
  return emptyRecord('bls', nowMs);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('coliving.mjs')) {
  const metro = process.argv.slice(2).join(' ') || undefined;
  const rec = await costOfLiving({ metro, includeGas: true }).catch((e) => { console.error(e.message); return null; });
  if (!rec) { console.log('No data.'); }
  else {
    console.log(`SoapBox Cost of Living${metro ? ` — ${metro}` : ''}`);
    console.log('─'.repeat(50));
    console.log(`  fused value : ${rec.value ?? 'n/a'}`);
    console.log(`  freshness   : ${rec.freshness}   confidence: ${rec.confidence}`);
    console.log(`  fetched_at  : ${rec.fetched_at}`);
    console.log('  components:');
    for (const [k, v] of Object.entries(rec.components)) {
      console.log(`    ${k.padEnd(10)} ${String(v.value ?? 'n/a').padEnd(12)} [${v.source}] ${v.freshness} conf=${v.confidence}`);
    }
    // additive: surface a Transportation line only when vehicle cost was folded in
    if (rec.vehicle && rec.vehicle.line) {
      console.log(`  ${rec.vehicle.line}`);
      console.log(`  monthly total (incl. vehicle): $${rec.monthlyTotal}`);
    }
  }
}
