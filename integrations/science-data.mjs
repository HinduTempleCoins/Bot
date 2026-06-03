// science-data.mjs — Hathor's hard-science data readers (v3 §12 computational/scientific layer).
//
// Compute-and-cite for the empirical world: chemistry, fundamental constants, solar-system ephemeris,
// and the catalog of known exoplanets. Like compute-cite.mjs, every payload names its source and an
// as-of label, so the Witness reports a measured value with its provenance, never an invented one.
//
//   Four keyless sources:
//     • PubChem PUG REST    — compound by name → molecular weight / formula / CID (NIH/NLM).
//          NOTE: integrations/soapbox/pharma.mjs has a richer site-facing PubChem reader (IUPAC, SMILES,
//          XLogP, cache-backed). This is the standalone zero-dependency identity lookup for the
//          compute-and-cite core; keep the two in sync if PubChem's field set changes.
//     • NIST CODATA         — a STATIC table of the ~20 most-used physical constants, each with its
//          CODATA source citation. NIST publishes CODATA as HTML / an ASCII dump, NOT a clean keyless
//          JSON API, so the authoritative recommended values are embedded here verbatim (CODATA 2018)
//          rather than fetched. This is deliberate: a vetted static table is MORE trustworthy than
//          scraping, and constants change only every ~4 years. Update on the next CODATA release.
//     • JPL Horizons        — ssd.jpl.nasa.gov/api/horizons.api — ephemeris for a solar-system body.
//     • NASA Exoplanet Archive TAP — count / lookup confirmed exoplanets (keyless ADQL over TAP).
//
// Pattern mirrors integrations/soapbox/worldbank.mjs: ESM, zero deps, keyless, __setFetch seam,
// soft-fail (return null / [] / a typed empty, NEVER throw), provenance baked in, guarded CLI,
// offline-testable pure helpers.
//
//   import { compound, constant, CONSTANTS, horizons, exoplanetCount, exoplanet } from './science-data.mjs'
//   node integrations/science-data.mjs compound water
//   node integrations/science-data.mjs constant c
//   node integrations/science-data.mjs horizons 499        # Mars
//   node integrations/science-data.mjs exoplanets

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'HathorScienceData/1.0 (+https://melek; compute-and-cite)' };

async function getJson(url) {
  try {
    const r = await _fetch(url, { headers: { ...UA, Accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}
async function getText(url) {
  try {
    const r = await _fetch(url, { headers: { ...UA, Accept: 'text/plain' } });
    if (!r || !r.ok) return null;
    return await r.text();
  } catch { return null; }
}

const num = (x) => { if (x == null || x === '') return null; const n = Number(x); return Number.isFinite(n) ? n : null; };

// ───────────────────────────────────────────────────────────────────────────────────────────────────
//  PubChem PUG REST — compound identity by name.
// ───────────────────────────────────────────────────────────────────────────────────────────────────
const PUBCHEM = 'https://pubchem.ncbi.nlm.nih.gov/rest/pug';

/**
 * Resolve a chemical/drug name to its core identity via PubChem.
 * Returns { found, query, cid, formula, molecularWeight, iupacName, url, source } — soft-fails to
 * { found:false } on any error / no match.
 *   compound('water')  →  { found:true, formula:'H2O', molecularWeight:18.015, cid:962, ... }
 */
export async function compound(name) {
  const q = String(name == null ? '' : name).trim();
  if (!q) return { found: false, query: '', source: 'PubChem (NIH/NLM)' };
  const props = 'MolecularFormula,MolecularWeight,IUPACName,CID';
  const url = `${PUBCHEM}/compound/name/${encodeURIComponent(q)}/property/${props}/JSON`;
  const j = await getJson(url);
  const rec = j?.PropertyTable?.Properties?.[0];
  if (!rec) return { found: false, query: q, source: 'PubChem (NIH/NLM)' };
  const cid = rec.CID ?? null;
  return {
    found: true,
    query: q,
    cid,
    formula: rec.MolecularFormula ?? null,
    molecularWeight: num(rec.MolecularWeight),
    iupacName: rec.IUPACName ?? null,
    url: cid != null ? `https://pubchem.ncbi.nlm.nih.gov/compound/${cid}` : null,
    source: 'PubChem (NIH/NLM)',
  };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
//  NIST CODATA — static table of the most-used fundamental physical constants (CODATA 2018).
//
//  WHY STATIC: NIST does not expose a clean keyless JSON API for the CODATA recommended values (they
//  ship HTML pages and a fixed-width ASCII "allascii.txt" dump). Embedding the vetted values is both
//  safer (no parse drift) and stable (CODATA revises on a ~4-year cadence). Each entry carries its own
//  source citation so a quoted constant is always attributable.
//  Values: CODATA 2018 recommended values, https://physics.nist.gov/cuu/Constants/
// ───────────────────────────────────────────────────────────────────────────────────────────────────
const CODATA_SOURCE = 'NIST CODATA 2018 recommended values (physics.nist.gov/cuu/Constants/)';

export const CONSTANTS = {
  c:        { name: 'speed of light in vacuum',        symbol: 'c',     value: 299792458,            unit: 'm/s',        exact: true,  source: CODATA_SOURCE },
  h:        { name: 'Planck constant',                 symbol: 'h',     value: 6.62607015e-34,       unit: 'J·s',        exact: true,  source: CODATA_SOURCE },
  hbar:     { name: 'reduced Planck constant',         symbol: 'ħ',     value: 1.054571817e-34,      unit: 'J·s',        exact: false, source: CODATA_SOURCE },
  G:        { name: 'Newtonian constant of gravitation', symbol: 'G',   value: 6.67430e-11,          unit: 'm³/(kg·s²)', exact: false, source: CODATA_SOURCE },
  e:        { name: 'elementary charge',               symbol: 'e',     value: 1.602176634e-19,      unit: 'C',          exact: true,  source: CODATA_SOURCE },
  k:        { name: 'Boltzmann constant',              symbol: 'k_B',   value: 1.380649e-23,         unit: 'J/K',        exact: true,  source: CODATA_SOURCE },
  NA:       { name: 'Avogadro constant',               symbol: 'N_A',   value: 6.02214076e23,        unit: '1/mol',      exact: true,  source: CODATA_SOURCE },
  R:        { name: 'molar gas constant',              symbol: 'R',     value: 8.314462618,          unit: 'J/(mol·K)',  exact: true,  source: CODATA_SOURCE },
  me:       { name: 'electron mass',                   symbol: 'm_e',   value: 9.1093837015e-31,     unit: 'kg',         exact: false, source: CODATA_SOURCE },
  mp:       { name: 'proton mass',                     symbol: 'm_p',   value: 1.67262192369e-27,    unit: 'kg',         exact: false, source: CODATA_SOURCE },
  mn:       { name: 'neutron mass',                    symbol: 'm_n',   value: 1.67492749804e-27,    unit: 'kg',         exact: false, source: CODATA_SOURCE },
  u:        { name: 'atomic mass constant',            symbol: 'u',     value: 1.66053906660e-27,    unit: 'kg',         exact: false, source: CODATA_SOURCE },
  alpha:    { name: 'fine-structure constant',         symbol: 'α',     value: 7.2973525693e-3,      unit: '',           exact: false, source: CODATA_SOURCE },
  Ry:       { name: 'Rydberg constant',                symbol: 'R_∞',   value: 10973731.568160,      unit: '1/m',        exact: false, source: CODATA_SOURCE },
  eps0:     { name: 'vacuum electric permittivity',    symbol: 'ε_0',   value: 8.8541878128e-12,     unit: 'F/m',        exact: false, source: CODATA_SOURCE },
  mu0:      { name: 'vacuum magnetic permeability',    symbol: 'μ_0',   value: 1.25663706212e-6,     unit: 'N/A²',       exact: false, source: CODATA_SOURCE },
  F:        { name: 'Faraday constant',                symbol: 'F',     value: 96485.33212,          unit: 'C/mol',      exact: true,  source: CODATA_SOURCE },
  sigma:    { name: 'Stefan–Boltzmann constant',       symbol: 'σ',     value: 5.670374419e-8,       unit: 'W/(m²·K⁴)',  exact: true,  source: CODATA_SOURCE },
  g0:       { name: 'standard acceleration of gravity', symbol: 'g_0',  value: 9.80665,              unit: 'm/s²',       exact: true,  source: CODATA_SOURCE },
  atm:      { name: 'standard atmosphere',             symbol: 'atm',   value: 101325,               unit: 'Pa',         exact: true,  source: CODATA_SOURCE },
};

// Friendly aliases → canonical key, so callers can ask by common name/symbol.
const CONSTANT_ALIASES = {
  'speed of light': 'c', 'lightspeed': 'c',
  'planck': 'h', 'planck constant': 'h',
  'reduced planck': 'hbar', 'h-bar': 'hbar', 'hbar': 'hbar',
  'gravitational constant': 'G', 'gravitation': 'G', 'big g': 'G',
  'elementary charge': 'e', 'electron charge': 'e',
  'boltzmann': 'k', 'kb': 'k', 'k_b': 'k',
  'avogadro': 'NA', 'na': 'NA', 'n_a': 'NA',
  'gas constant': 'R', 'molar gas constant': 'R',
  'electron mass': 'me', 'proton mass': 'mp', 'neutron mass': 'mn',
  'atomic mass unit': 'u', 'amu': 'u', 'dalton': 'u',
  'fine structure': 'alpha', 'fine-structure': 'alpha', 'alpha': 'alpha',
  'rydberg': 'Ry',
  'permittivity': 'eps0', 'epsilon0': 'eps0', 'epsilon_0': 'eps0', 'vacuum permittivity': 'eps0',
  'permeability': 'mu0', 'mu_0': 'mu0', 'vacuum permeability': 'mu0',
  'faraday': 'F',
  'stefan boltzmann': 'sigma', 'stefan-boltzmann': 'sigma', 'sigma': 'sigma',
  'gravity': 'g0', 'standard gravity': 'g0', 'little g': 'g0',
  'atmosphere': 'atm', 'standard atmosphere': 'atm',
};

/**
 * Look up a fundamental physical constant by key, symbol, or common name. PURE / offline.
 * Returns a { name, symbol, value, unit, exact, source } record, or null if unknown.
 *   constant('c')  →  { name:'speed of light…', value:299792458, unit:'m/s', source:'NIST CODATA…' }
 */
export function constant(query) {
  const q = String(query == null ? '' : query).trim();
  if (!q) return null;
  if (Object.prototype.hasOwnProperty.call(CONSTANTS, q)) return CONSTANTS[q];
  const lower = q.toLowerCase();
  const aliased = CONSTANT_ALIASES[lower];
  if (aliased && CONSTANTS[aliased]) return CONSTANTS[aliased];
  // last resort: case-insensitive key match (e.g. 'C' → 'c', but not 'NA' vs 'na' ambiguity handled above)
  const keyHit = Object.keys(CONSTANTS).find((k) => k.toLowerCase() === lower);
  return keyHit ? CONSTANTS[keyHit] : null;
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
//  JPL Horizons — ephemeris for a solar-system body. The API returns a text "result" block; we surface
//  the raw block plus a few parsed header fields. Body id examples: 499 = Mars, 301 = Moon, 10 = Sun.
// ───────────────────────────────────────────────────────────────────────────────────────────────────
const HORIZONS = 'https://ssd.jpl.nasa.gov/api/horizons.api';

/**
 * Fetch an ephemeris block for a body from JPL Horizons (observer table by default).
 * Returns { found, body, result, source } where `result` is the Horizons text block, or
 * { found:false } on any error. Soft-fails; never throws.
 *   horizons('499')  →  Mars ephemeris text
 */
export async function horizons(body, { center = '500@399', start, stop, step = '1 d' } = {}) {
  const id = String(body == null ? '' : body).trim();
  if (!id) return { found: false, body: '', source: 'JPL Horizons (ssd.jpl.nasa.gov)' };
  const today = new Date();
  const tomorrow = new Date(Date.now() + 86400000);
  const fmt = (d) => d.toISOString().slice(0, 10);
  const params = new URLSearchParams({
    format: 'json',
    COMMAND: `'${id}'`,
    EPHEM_TYPE: 'OBSERVER',
    CENTER: `'${center}'`,
    START_TIME: `'${start || fmt(today)}'`,
    STOP_TIME: `'${stop || fmt(tomorrow)}'`,
    STEP_SIZE: `'${step}'`,
    QUANTITIES: "'1,9,20,23,24'",
  });
  const j = await getJson(`${HORIZONS}?${params.toString()}`);
  const result = j && typeof j.result === 'string' ? j.result : null;
  if (!result) return { found: false, body: id, source: 'JPL Horizons (ssd.jpl.nasa.gov)' };
  return { found: true, body: id, result, source: 'JPL Horizons (ssd.jpl.nasa.gov)' };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────────
//  NASA Exoplanet Archive — TAP service (ADQL over the `ps` / `pscomppars` tables). Keyless.
// ───────────────────────────────────────────────────────────────────────────────────────────────────
const EXO_TAP = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';

async function tapQuery(adql) {
  const url = `${EXO_TAP}?query=${encodeURIComponent(adql)}&format=json`;
  const j = await getJson(url);
  return Array.isArray(j) ? j : [];
}

/**
 * Count of confirmed exoplanets in the NASA Exoplanet Archive.
 * Returns { count, source } — soft-fails to { count:null } on error.
 */
export async function exoplanetCount() {
  const rows = await tapQuery('select count(*) as n from pscomppars');
  const n = rows[0] ? num(rows[0].n ?? rows[0].N ?? rows[0].count) : null;
  return { count: n, source: 'NASA Exoplanet Archive (exoplanetarchive.ipac.caltech.edu)' };
}

/**
 * Look up a confirmed exoplanet by (case-insensitive substring) name.
 * Returns { found, query, planets:[{ name, hostname, discoveryYear, orbitalPeriodDays, radiusEarth,
 * massEarth }], source }. Soft-fails to { found:false, planets:[] }.
 *   exoplanet('Kepler-22 b')
 */
export async function exoplanet(name, { limit = 5 } = {}) {
  const q = String(name == null ? '' : name).trim();
  const src = 'NASA Exoplanet Archive (exoplanetarchive.ipac.caltech.edu)';
  if (!q) return { found: false, query: '', planets: [], source: src };
  // Escape single quotes for ADQL string literal safety.
  const safe = q.replace(/'/g, "''");
  const cols = 'pl_name,hostname,disc_year,pl_orbper,pl_rade,pl_bmasse';
  const adql = `select top ${Math.max(1, Math.min(50, Number(limit) || 5))} ${cols} `
    + `from pscomppars where upper(pl_name) like upper('%${safe}%')`;
  const rows = await tapQuery(adql);
  const planets = rows.map((r) => ({
    name: r.pl_name ?? null,
    hostname: r.hostname ?? null,
    discoveryYear: num(r.disc_year),
    orbitalPeriodDays: num(r.pl_orbper),
    radiusEarth: num(r.pl_rade),
    massEarth: num(r.pl_bmasse),
  })).filter((p) => p.name);
  return { found: planets.length > 0, query: q, planets, source: src };
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('science-data.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  const show = (x) => console.log(JSON.stringify(x, null, 2));
  if (cmd === 'compound') show(await compound(arg || 'water'));
  else if (cmd === 'constant') show(constant(arg || 'c'));
  else if (cmd === 'horizons') show(await horizons(arg || '499'));
  else if (cmd === 'exoplanet') show(await exoplanet(arg));
  else if (cmd === 'exoplanets') show(await exoplanetCount());
  else {
    console.log('usage: science-data.mjs <compound|constant|horizons|exoplanet|exoplanets> [arg]');
    console.log('Constants table:');
    for (const [k, v] of Object.entries(CONSTANTS)) console.log(`  ${k.padEnd(7)} ${v.name} = ${v.value} ${v.unit}`);
  }
}
