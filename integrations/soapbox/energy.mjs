// energy.mjs — the SoapBox Energy vertical (queue #100): the prices that move everything else.
// Crude, gasoline, diesel, propane, ethanol, natural gas, electricity — "what energy actually costs"
// the week you read it. Source: EIA Open Data API v2 (https://api.eia.gov), the US Energy Information
// Administration's official feed. Needs a FREE key in process.env.EIA_API_KEY — soft-fail (return
// null) when it's absent so the page degrades gracefully instead of throwing. Cached 60s.
//
// Pattern mirrors macro.mjs: ESM, __setFetch hook, never-throw soft-fail, guarded CLI.
//
//   import { prices, series, ethanolArbSpread, energySummary } from './energy.mjs'

import { cached, TTL } from './cache.mjs';

const BASE = 'https://api.eia.gov/v2';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// the key is read lazily so tests / the spread math never depend on it. Returns null when unset.
function apiKey() { return process.env.EIA_API_KEY || null; }

// Each series: a stable id, a human label, the EIA v2 route + facet that addresses it, and a unit.
// `route` is the v2 data path; `facets` are the EIA facet filters that pin the exact series. We pull
// the latest weekly/monthly observation. WTI/Brent/diesel/propane/gasoline live under petroleum;
// natural gas under natural-gas; electricity under electricity. Ethanol is a fuel-grade spot price.
export const SERIES = {
  'Crude Oil': [
    { id: 'wti', label: 'WTI Crude (Cushing)', route: 'petroleum/pri/spt', facets: { series: ['RWTC'] }, unit: '$/bbl' },
    { id: 'brent', label: 'Brent Crude (Europe)', route: 'petroleum/pri/spt', facets: { series: ['RBRTE'] }, unit: '$/bbl' },
  ],
  'Gasoline': [
    { id: 'gasoline', label: 'Regular Gasoline (US retail)', route: 'petroleum/pri/gnd', facets: { series: ['EMM_EPMR_PTE_NUS_DPG'] }, unit: '$/gal' },
    { id: 'rbob', label: 'RBOB Gasoline (NY Harbor spot)', route: 'petroleum/pri/spt', facets: { series: ['EER_EPMRR_PF4_Y35NY_DPG'] }, unit: '$/gal' },
  ],
  'Diesel': [
    { id: 'diesel', label: 'On-Highway Diesel (US retail)', route: 'petroleum/pri/gnd', facets: { series: ['EMD_EPD2D_PTE_NUS_DPG'] }, unit: '$/gal' },
  ],
  'Propane': [
    { id: 'propane', label: 'Propane (Mont Belvieu spot)', route: 'petroleum/pri/spt', facets: { series: ['EER_EPLLPA_PF4_Y44MB_DPG'] }, unit: '$/gal' },
  ],
  'Ethanol': [
    { id: 'ethanol', label: 'Fuel Ethanol (US spot)', route: 'petroleum/pri/spt', facets: { series: ['EER_EPOOXE_PF4_RGC_DPG'] }, unit: '$/gal' },
  ],
  'Natural Gas': [
    { id: 'natgas', label: 'Henry Hub Natural Gas', route: 'natural-gas/pri/fut', facets: { series: ['RNGWHHD'] }, unit: '$/MMBtu' },
  ],
  'Electricity': [
    { id: 'electricity', label: 'Avg Retail Electricity (US, all sectors)', route: 'electricity/retail-sales', facets: { sectorid: ['ALL'], stateid: ['US'] }, unit: '¢/kWh' },
  ],
};

// flat id → spec lookup, built once.
const BY_ID = new Map();
for (const rows of Object.values(SERIES)) for (const s of rows) BY_ID.set(s.id, s);

// Build the EIA v2 data URL for a series spec. We sort by period desc and take 1 (the latest point).
function urlFor(spec, key) {
  const u = new URL(`${BASE}/${spec.route}/data/`);
  u.searchParams.set('api_key', key);
  u.searchParams.set('frequency', 'daily');           // EIA accepts a coarser frequency if daily n/a
  u.searchParams.append('data[]', 'value');
  for (const [facet, vals] of Object.entries(spec.facets || {})) {
    for (const v of vals) u.searchParams.append(`facets[${facet}][]`, v);
  }
  u.searchParams.set('sort[0][column]', 'period');
  u.searchParams.set('sort[0][direction]', 'desc');
  u.searchParams.set('offset', '0');
  u.searchParams.set('length', '1');
  return u;
}

// Fetch the latest observation for one spec. Returns { value, period } or null. Never throws.
async function fetchLatest(spec, key) {
  try {
    const r = await _fetch(urlFor(spec, key).toString());
    if (!r || !r.ok) return null;
    const j = await r.json();
    const row = j?.response?.data?.[0];
    if (!row || row.value == null) return null;
    const value = typeof row.value === 'string' ? parseFloat(row.value) : row.value;
    if (!Number.isFinite(value)) return null;
    return { value, period: row.period ?? null };
  } catch { return null; }
}

/**
 * One series by id (e.g. 'wti', 'ethanol'). Returns { id, label, unit, value, period } or null on
 * unknown id / missing key / fetch failure. Cached 60s.
 */
export async function series(id) {
  const spec = BY_ID.get(id);
  if (!spec) return null;
  const key = apiKey();
  if (!key) return null;
  return cached(`energy:series:${id}`, TTL.price, async () => {
    const got = await fetchLatest(spec, key);
    if (!got) return null;
    return { id: spec.id, label: spec.label, unit: spec.unit, value: got.value, period: got.period };
  });
}

/**
 * Full energy snapshot, grouped by category. Returns null with no key (soft-fail); otherwise an
 * object { category: [ {id,label,unit,value,period}, ... ] } with failed series dropped. Cached 60s.
 */
export async function prices() {
  const key = apiKey();
  if (!key) return null;
  return cached('energy:all', TTL.price, async () => {
    const out = {};
    for (const [cat, rows] of Object.entries(SERIES)) {
      const vals = await Promise.all(rows.map(async (spec) => {
        const got = await fetchLatest(spec, key);
        return got ? { id: spec.id, label: spec.label, unit: spec.unit, value: got.value, period: got.period } : null;
      }));
      out[cat] = vals.filter(Boolean);
    }
    return out;
  });
}

// crude $/bbl → $/gal. One US barrel of oil = 42 US gallons.
const GAL_PER_BBL = 42;
export function crudePerGallon(bblPrice) {
  if (!Number.isFinite(bblPrice)) return null;
  return bblPrice / GAL_PER_BBL;
}

/**
 * PURE arb math (no network): the gasoline-vs-ethanol-vs-crude spread. Given the three $/gal-comparable
 * prices, compute how ethanol stacks up against the fuels it substitutes for. All inputs are plain
 * numbers so this is unit-testable offline.
 *
 * @param {{ gasoline:number, ethanol:number, crude:number }} p
 *   gasoline = $/gal, ethanol = $/gal, crude = $/bbl (converted to $/gal internally).
 * @returns {object|null} spreads + a coarse signal, or null if any required input is missing/invalid.
 *   - gasMinusEthanol: gasoline − ethanol ($/gal). Positive ⇒ ethanol is the cheaper fuel.
 *   - ethanolMinusCrude: ethanol − crude($/gal). The blender's raw margin over the oil it offsets.
 *   - crudePerGal: crude expressed in $/gal (42 gal/bbl).
 *   - ethanolDiscountPct: how far below gasoline ethanol trades, as a % of the gasoline price.
 *   - signal: 'ethanol-favored' | 'gasoline-favored' | 'neutral' (|spread| < 0.05 $/gal ⇒ neutral).
 */
export function ethanolArbSpread(p) {
  if (!p || typeof p !== 'object') return null;
  const gasoline = Number(p.gasoline);
  const ethanol = Number(p.ethanol);
  const crude = Number(p.crude);
  if (![gasoline, ethanol, crude].every(Number.isFinite)) return null;

  const crudePerGal = crudePerGallon(crude);
  const gasMinusEthanol = gasoline - ethanol;
  const ethanolMinusCrude = ethanol - crudePerGal;
  const ethanolDiscountPct = gasoline !== 0 ? (gasMinusEthanol / gasoline) * 100 : null;

  let signal = 'neutral';
  if (gasMinusEthanol > 0.05) signal = 'ethanol-favored';
  else if (gasMinusEthanol < -0.05) signal = 'gasoline-favored';

  const round = (n, d = 4) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);
  return {
    gasoline, ethanol, crude,
    crudePerGal: round(crudePerGal),
    gasMinusEthanol: round(gasMinusEthanol),
    ethanolMinusCrude: round(ethanolMinusCrude),
    ethanolDiscountPct: round(ethanolDiscountPct, 2),
    signal,
  };
}

/**
 * Homepage chip: a few headline energy numbers + the live ethanol arb spread (when the underlying
 * series are available). Returns { available:false } with no key (soft-fail), never throws.
 */
export async function energySummary() {
  const key = apiKey();
  if (!key) return { available: false };
  const [wti, gasoline, ethanol, natgas, electricity] = await Promise.all([
    series('wti').catch(() => null),
    series('gasoline').catch(() => null),
    series('ethanol').catch(() => null),
    series('natgas').catch(() => null),
    series('electricity').catch(() => null),
  ]);
  let arb = null;
  if (wti && gasoline && ethanol) {
    arb = ethanolArbSpread({ gasoline: gasoline.value, ethanol: ethanol.value, crude: wti.value });
  }
  return { available: true, wti, gasoline, ethanol, natgas, electricity, ethanolArb: arb };
}

if (process.argv[1] && process.argv[1].endsWith('energy.mjs')) {
  const p = await prices();
  if (!p) {
    console.log('EIA_API_KEY not set — energy vertical disabled (set a free key from https://www.eia.gov/opendata/).');
  } else {
    for (const [cat, rows] of Object.entries(p)) {
      console.log(`\n${cat}`);
      for (const r of rows) console.log(`  ${r.label.padEnd(34)} ${r.value} ${r.unit}  (${r.period})`);
    }
    const s = await energySummary();
    if (s.ethanolArb) console.log(`\nEthanol arb: ${s.ethanolArb.signal} (gas−ethanol ${s.ethanolArb.gasMinusEthanol} $/gal, ${s.ethanolArb.ethanolDiscountPct}% vs gasoline)`);
  }
}
