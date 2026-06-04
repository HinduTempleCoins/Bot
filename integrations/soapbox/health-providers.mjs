// health-providers.mjs — the SoapBox Healthcare-Provider-Finder vertical (queue task #241). A
// Zocdoc / Medicare-Care-Compare-model reader over two FREE, KEYLESS, host-safe OFFICIAL sources:
//
//   • NPI Registry (npiregistry.cms.hhs.gov) — CMS's open national provider directory. We use it to
//     FIND providers (clinicians + organizations) by specialty + ZIP. It is a directory, not a rating.
//   • Medicare Care Compare / Hospital Compare (Provider Data Catalog, data.cms.gov) — the OFFICIAL
//     hospital quality dataset (overall star rating + measures). We surface its numbers as SOURCED
//     FACTS attributed to CMS — they are CMS's official ratings, NEVER our verdict.
//
// HARD constraints (task #241):
//   • NOT medical advice — the not-medical-advice banner is ALWAYS rendered, unconditionally.
//   • Hospital quality is presented as OFFICIAL FACTS with source + as-of, never as our own judgment;
//     compareHospitals() lines measures up side-by-side and DECLARES NO WINNER.
//   • Right-of-reply note for providers (a hospital may dispute / contextualize a measure with CMS).
//   • No secrets — both sources are keyless; nothing is read from process.env, no tokens anywhere.
//
// Pattern follows cdc-health.mjs + gov-readers.mjs: ESM, an injectable __setFetch() seam, every reader
// SOFT-FAILS (returns [] / null — never throws), as-of timestamps, a guarded CLI, HTML-escaped render.
//
//   import { findProviders, hospitalQuality, compareHospitals, renderPage, dataNote } from './health-providers.mjs'
//   node integrations/soapbox/health-providers.mjs find cardiology 94110

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';

// Official source identities (host-safe, keyless).
const NPI = {
  name: 'NPI Registry (CMS)',
  url: 'https://npiregistry.cms.hhs.gov/',
  api: 'https://npiregistry.cms.hhs.gov/api/',
};
const COMPARE = {
  name: 'Medicare Care Compare (CMS)',
  url: 'https://www.medicare.gov/care-compare/',
  // Provider Data Catalog — Hospital General Information ("Hospital Compare") resource on data.cms.gov.
  // If CMS retires/renames it, hospitalQuality() simply soft-fails to null.
  api: 'https://data.cms.gov/provider-data/api/1/datastore/sql',
  dataset: 'xubh-q36u', // Hospital General Information distribution id
};

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const nowIso = () => new Date().toISOString();

// Escape for safe HTML interpolation (strict-conventions requirement).
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Pick the first present value among candidate keys (source shapes vary).
const pick = (row, ...keys) => { for (const k of keys) { if (row && row[k] != null && row[k] !== '') return row[k]; } return null; };

// ── findProviders — NPI Registry directory lookup by specialty + ZIP ──────────────────────────────────
// Keyless. Queries the NPI Registry API (taxonomy_description = specialty, postal_code = ZIP) and
// normalizes each result to { npi, name, specialty, address, asOf }. Soft-fails to [].
export async function findProviders({ specialty = '', zip = '' } = {}, { fetch } = {}) {
  const f = fetch || _fetch;
  const spec = str(specialty);
  const z = str(zip);
  if (!spec && !z) return []; // need at least one selector
  return cached(`hp:npi:${spec.toLowerCase()}:${z}`, TTL.list, async () => {
    try {
      const u = new URL(NPI.api);
      u.searchParams.set('version', '2.1');
      if (spec) u.searchParams.set('taxonomy_description', spec);
      if (z) u.searchParams.set('postal_code', z);
      u.searchParams.set('limit', '50');
      const r = await f(u.toString(), { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (!r || !r.ok) return [];
      const j = await r.json();
      const rows = Array.isArray(j?.results) ? j.results : [];
      const asOf = nowIso();
      return rows.map((row) => normalizeNpi(row, asOf)).filter((p) => p.npi && p.name);
    } catch { return []; }
  });
}

// Normalize one NPI Registry result. Handles both NPI-1 (individual) and NPI-2 (organization) shapes.
function normalizeNpi(row, asOf) {
  const basic = row?.basic || {};
  const orgName = str(pick(basic, 'organization_name', 'name'));
  const personName = [str(basic.first_name), str(basic.last_name)].filter(Boolean).join(' ').trim();
  const name = orgName || personName || str(pick(basic, 'authorized_official_first_name')) || '';

  // Primary taxonomy = the specialty.
  const taxes = Array.isArray(row?.taxonomies) ? row.taxonomies : [];
  const primary = taxes.find((t) => t && t.primary) || taxes[0] || {};
  const specialty = str(pick(primary, 'desc', 'description')) || '';

  // Prefer the LOCATION address; fall back to the first listed address.
  const addrs = Array.isArray(row?.addresses) ? row.addresses : [];
  const loc = addrs.find((a) => a && str(a.address_purpose).toUpperCase() === 'LOCATION') || addrs[0] || {};
  const address = [
    str(pick(loc, 'address_1')),
    str(pick(loc, 'address_2')),
    [str(pick(loc, 'city')), str(pick(loc, 'state'))].filter(Boolean).join(', '),
    str(pick(loc, 'postal_code')),
  ].filter(Boolean).join(', ');

  return {
    npi: str(pick(row, 'number', 'npi')),
    name,
    specialty,
    address,
    asOf,
  };
}

// ── hospitalQuality — Medicare Care Compare official quality facts ────────────────────────────────────
// Keyless. Looks up a hospital by CMS Certification Number (id) or by name and returns its OFFICIAL
// CMS quality measures as SOURCED FACTS: { source, sourceUrl, asOf, name, id, measures: [...] }.
// These are CMS's published numbers, attributed to CMS — never our own rating. Soft-fails to null.
export async function hospitalQuality({ id = '', name = '' } = {}, { fetch } = {}) {
  const f = fetch || _fetch;
  const cid = str(id);
  const nm = str(name);
  if (!cid && !nm) return null;
  return cached(`hp:compare:${cid}:${nm.toLowerCase()}`, TTL.metadata, async () => {
    try {
      // Provider Data Catalog SQL endpoint: WHERE on facility id or name (LIKE).
      const where = cid
        ? `[facility_id] = '${cid.replace(/'/g, "''")}'`
        : `LOWER([facility_name]) LIKE '%${nm.toLowerCase().replace(/'/g, "''")}%'`;
      const sql = `[SELECT * FROM ${COMPARE.dataset}][WHERE ${where}][LIMIT 1]`;
      const u = new URL(COMPARE.api);
      u.searchParams.set('query', sql);
      u.searchParams.set('show_db_columns', 'true');
      const r = await f(u.toString(), { headers: { 'user-agent': UA, accept: 'application/json' } });
      if (!r || !r.ok) return null;
      const j = await r.json();
      const rows = Array.isArray(j) ? j : (Array.isArray(j?.results) ? j.results : []);
      const row = rows[0];
      if (!row) return null;
      return normalizeQuality(row);
    } catch { return null; }
  });
}

// Normalize a Hospital Compare row into sourced facts. Each measure is a labelled official value.
function normalizeQuality(row) {
  const id = str(pick(row, 'facility_id', 'provider_id', 'facility id'));
  const name = str(pick(row, 'facility_name', 'hospital_name', 'facility name'));
  const measures = [];
  const add = (label, value) => { const v = str(value); if (v && !/^not available$/i.test(v)) measures.push({ label, value: v }); };

  add('Overall star rating', pick(row, 'hospital_overall_rating', 'overall_rating', 'hospital overall rating'));
  add('Hospital type', pick(row, 'hospital_type', 'hospital type'));
  add('Hospital ownership', pick(row, 'hospital_ownership', 'hospital ownership'));
  add('Emergency services', pick(row, 'emergency_services', 'emergency services'));
  add('Mortality national comparison', pick(row, 'mortality_national_comparison', 'mortality_group_measure_count'));
  add('Safety of care national comparison', pick(row, 'safety_of_care_national_comparison', 'safety_group_measure_count'));
  add('Readmission national comparison', pick(row, 'readmission_national_comparison'));
  add('Patient experience national comparison', pick(row, 'patient_experience_national_comparison'));
  add('Timeliness of care national comparison', pick(row, 'timeliness_of_care_national_comparison'));

  return {
    id,
    name,
    source: COMPARE.name,
    sourceUrl: COMPARE.url,
    asOf: nowIso(),
    measures,
  };
}

// ── compareHospitals — side-by-side of OFFICIAL measures, NO winner declared ──────────────────────────
// Takes a list of hospitalQuality() results and lines their measures up by label. Returns
// { hospitals:[{id,name}], rows:[{ label, values:[perHospital] }], source, asOf }. Pure aggregation:
// it reports CMS's facts in parallel and explicitly DOES NOT compute or declare a "best" hospital.
export function compareHospitals(list = []) {
  const hospitals = (Array.isArray(list) ? list : []).filter((h) => h && (h.id || h.name));
  // union of measure labels, preserving first-seen order.
  const labels = [];
  for (const h of hospitals) {
    for (const m of (Array.isArray(h.measures) ? h.measures : [])) {
      if (m && m.label && !labels.includes(m.label)) labels.push(m.label);
    }
  }
  const rows = labels.map((label) => ({
    label,
    values: hospitals.map((h) => {
      const m = (Array.isArray(h.measures) ? h.measures : []).find((x) => x && x.label === label);
      return m ? m.value : null; // null = this hospital has no value for this measure
    }),
  }));
  return {
    hospitals: hospitals.map((h) => ({ id: str(h.id) || null, name: str(h.name) || null })),
    rows,
    source: COMPARE.name,
    sourceUrl: COMPARE.url,
    asOf: nowIso(),
    note: 'Official CMS measures shown side by side. No "best" ranking is implied — figures are CMS facts, not our judgment.',
  };
}

// ── Provenance note ───────────────────────────────────────────────────────────────────────────────────
export function dataNote(asOf) {
  const when = str(asOf) || nowIso().slice(0, 10);
  return `source: ${NPI.name} + ${COMPARE.name} (official), as of ${when}; informational, not medical advice`;
}

// The not-medical-advice banner — ALWAYS rendered by renderPage(), unconditionally.
const NOT_ADVICE_BANNER =
  '<p class="not-medical-advice" role="note"><strong>Not medical advice.</strong> This is a directory and a '
  + 'presentation of official CMS data for informational use only. It is not a recommendation, diagnosis, or '
  + 'endorsement. Consult a licensed clinician for medical decisions.</p>';

// Right-of-reply note for providers (HARD requirement).
const RIGHT_OF_REPLY =
  '<p class="right-of-reply">Providers: quality figures are published by CMS, not by SoapBox. To dispute or add '
  + 'context to a measure, contact CMS (Medicare Care Compare) — we will reflect official corrections.</p>';

// ── renderPage — escaped HTML provider list + official quality + banners ──────────────────────────────
// data = { providers:[{npi,name,specialty,address}], quality:{...}|null, comparison:{...}|null }.
// EVERY interpolated value is HTML-escaped. The not-medical-advice banner is ALWAYS present.
export function renderPage(data = {}) {
  const providers = Array.isArray(data.providers) ? data.providers : [];
  const quality = data.quality && typeof data.quality === 'object' ? data.quality : null;
  const comparison = data.comparison && typeof data.comparison === 'object' ? data.comparison : null;
  const asOf = (quality && quality.asOf) || (comparison && comparison.asOf)
    || (providers[0] && providers[0].asOf) || nowIso();

  const providerRows = providers.slice(0, 50).map((p) => (
    `<tr><td>${esc(p.name)}</td><td>${esc(p.specialty || '')}</td><td>${esc(p.address || '')}</td>`
    + `<td class="npi">${esc(p.npi || '')}</td></tr>`
  )).join('');
  const providerTable = providerRows
    ? '  <h3>Providers</h3>'
      + '<table class="providers"><thead><tr><th>Name</th><th>Specialty</th><th>Address</th><th>NPI</th></tr></thead>'
      + `<tbody>${providerRows}</tbody></table>`
    : '  <p class="empty">No providers found.</p>';

  let qualityBlock = '';
  if (quality && Array.isArray(quality.measures) && quality.measures.length) {
    const mRows = quality.measures.map((m) => (
      `<tr><td>${esc(m.label)}</td><td>${esc(m.value)}</td></tr>`
    )).join('');
    qualityBlock =
      `  <h3>Hospital quality — ${esc(quality.name || '')} <span class="official">(official CMS data)</span></h3>`
      + '<table class="quality"><thead><tr><th>Measure</th><th>CMS value</th></tr></thead>'
      + `<tbody>${mRows}</tbody></table>`
      + `  <p class="source">Source: <a href="${esc(quality.sourceUrl || COMPARE.url)}">${esc(quality.source || COMPARE.name)}</a>`
      + ` — official CMS figures, not a SoapBox rating.</p>`;
  }

  let comparisonBlock = '';
  if (comparison && Array.isArray(comparison.rows) && comparison.rows.length) {
    const heads = (comparison.hospitals || []).map((h) => `<th>${esc(h.name || h.id || '')}</th>`).join('');
    const cRows = comparison.rows.map((r) => (
      `<tr><td>${esc(r.label)}</td>${(r.values || []).map((v) => `<td>${esc(v == null ? '—' : v)}</td>`).join('')}</tr>`
    )).join('');
    comparisonBlock =
      '  <h3>Side-by-side (official CMS measures)</h3>'
      + `<table class="compare"><thead><tr><th>Measure</th>${heads}</tr></thead><tbody>${cRows}</tbody></table>`
      + `  <p class="no-winner">${esc(comparison.note || 'Official CMS measures shown side by side — no winner implied.')}</p>`;
  }

  return [
    '<section class="health-providers">',
    '  <h2>Healthcare Provider Finder</h2>',
    NOT_ADVICE_BANNER,                 // ALWAYS present
    providerTable,
    qualityBlock,
    comparisonBlock,
    RIGHT_OF_REPLY,
    `  <p class="note">${esc(dataNote(asOf))}</p>`,
    '</section>',
  ].filter(Boolean).join('\n');
}

// ── CLI: node integrations/soapbox/health-providers.mjs <find|quality|page> ... ───────────────────────
if (process.argv[1] && process.argv[1].endsWith('health-providers.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const out = (label, v) => { console.log(`\n== ${label} ==`); console.log(JSON.stringify(v, null, 2)); };
  if (cmd === 'find') out('providers', await findProviders({ specialty: rest[0] || '', zip: rest[1] || '' }));
  else if (cmd === 'quality') out('quality', await hospitalQuality({ name: rest.join(' ') }));
  else if (cmd === 'page') {
    const [providers, quality] = await Promise.all([
      findProviders({ specialty: rest[0] || '', zip: rest[1] || '' }).catch(() => []),
      rest[2] ? hospitalQuality({ name: rest.slice(2).join(' ') }).catch(() => null) : Promise.resolve(null),
    ]);
    console.log(renderPage({ providers, quality }));
  } else console.log('usage: health-providers.mjs <find <specialty> <zip> | quality <name> | page <specialty> <zip> [hospital name]>');
}
