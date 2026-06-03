// nhtsa.mjs — the SoapBox NHTSA vehicle-safety reader. This is the VEHICLES recall surface, distinct
// from the other recall readers (fda-recalls = FDA food/device, cpsc-recalls = consumer products,
// fsis-recalls = USDA meat/poultry). It covers three keyless federal NHTSA APIs:
//   • Recalls     — https://api.nhtsa.gov/recalls/recallsByVehicle?make=&model=&modelYear=
//   • Complaints  — https://api.nhtsa.gov/complaints/complaintsByVehicle?make=&model=&modelYear=
//   • vPIC VIN    — https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/{VIN}?format=json
//
// All three are FREE and work KEYLESS (no auth token). No secret ever lives in this file. Same shape as
// the sibling soapbox readers (fda-recalls.mjs / worldbank.mjs): ESM, a __setFetch() seam for tests, and
// graceful soft-fail — list readers return [] and never throw; the VIN decoder returns null on failure.
// Every emitted record carries provenance (source / license: public-domain / fetchedAt) per v3 §6.
//
//   import { recalls, complaints, decodeVin, summary, renderPage, dataNote } from './nhtsa.mjs'
//   node integrations/soapbox/nhtsa.mjs Honda Civic 2020
//   node integrations/soapbox/nhtsa.mjs --vin 1HGCM82633A004352

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Keyless NHTSA endpoints.
export const ENDPOINTS = {
  recalls: 'https://api.nhtsa.gov/recalls/recallsByVehicle',
  complaints: 'https://api.nhtsa.gov/complaints/complaintsByVehicle',
  vpicDecode: 'https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues',
};

// Provenance applied to every emitted record (v3 §6).
export const SOURCE = 'NHTSA';
export const LICENSE = 'public-domain';

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const clean = (s) => String(s == null ? '' : s).trim();
const num = (n, d) => { const v = Number(n); return Number.isFinite(v) ? v : d; };
const capLimit = (n) => Math.min(Math.max(num(n, 10), 1), 100);

// NHTSA recall/complaint dates arrive in a few shapes: "DD/MM/YYYY", an ISO timestamp, or an epoch-ish
// "/Date(…)/". Render YYYY-MM-DD when we can; else pass the trimmed value through (null when empty).
function fmtDate(s) {
  const d = clean(s);
  if (!d) return null;
  let m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);            // ISO
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);          // DD/MM/YYYY or MM/DD/YYYY
  if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  return d;
}

// A VIN is 17 alphanumeric chars (no I/O/Q). Validate before building a URL; reject anything else so a
// hostile string can't be smuggled into the path. Returns the uppercased VIN or null.
export function normalizeVin(vin) {
  const v = clean(vin).toUpperCase();
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(v) ? v : null;
}

// Build a vehicle-query URL (recalls / complaints). URLSearchParams encodes everything — raw input never
// touches the query grammar directly.
function buildVehicleUrl(base, { make, model, modelYear } = {}) {
  const p = new URLSearchParams();
  if (clean(make)) p.set('make', clean(make));
  if (clean(model)) p.set('model', clean(model));
  if (clean(modelYear)) p.set('modelYear', clean(modelYear));
  return `${base}?${p.toString()}`;
}

// fetch JSON with soft-fail: any network/parse/non-ok error resolves to null, never throws.
async function getJSON(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── recalls({ make, model, modelYear, limit }): recalls for a vehicle ────────────────────────────────
// NHTSA returns { Count, results: [ { Component, Summary, Consequence, Remedy, NHTSACampaignNumber,
// ReportReceivedDate, Manufacturer, ... } ] }. Normalize to the SoapBox row, cap to limit. Soft-fails to [].
export async function recalls({ make = '', model = '', modelYear = '', limit = 10 } = {}) {
  if (!clean(make) || !clean(model) || !clean(modelYear)) return [];
  const fetchedAt = new Date().toISOString();
  const j = await getJSON(buildVehicleUrl(ENDPOINTS.recalls, { make, model, modelYear }));
  const rows = j?.results;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, capLimit(limit)).map((r) => ({
    campaign: clean(r.NHTSACampaignNumber) || null,
    component: clean(r.Component) || null,
    summary: clean(r.Summary) || null,
    consequence: clean(r.Consequence) || null,
    remedy: clean(r.Remedy) || null,
    manufacturer: clean(r.Manufacturer) || null,
    date: fmtDate(r.ReportReceivedDate),
    make: clean(make).toUpperCase(),
    model: clean(model),
    modelYear: clean(modelYear),
    source: SOURCE,
    license: LICENSE,
    fetchedAt,
  }));
}

// ── complaints({ make, model, modelYear, limit }): consumer complaints for a vehicle ─────────────────
// NHTSA returns { count, results: [ { odiNumber, components, summary, crash, fire, numberOfInjuries,
// numberOfDeaths, dateOfIncident, dateComplaintFiled, ... } ] }. Normalize to a row. Soft-fails to [].
export async function complaints({ make = '', model = '', modelYear = '', limit = 10 } = {}) {
  if (!clean(make) || !clean(model) || !clean(modelYear)) return [];
  const fetchedAt = new Date().toISOString();
  const j = await getJSON(buildVehicleUrl(ENDPOINTS.complaints, { make, model, modelYear }));
  const rows = j?.results;
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, capLimit(limit)).map((r) => ({
    odiNumber: r.odiNumber != null ? String(r.odiNumber) : null,
    components: clean(r.components) || null,
    summary: clean(r.summary) || null,
    crash: r.crash === true || /^y/i.test(clean(r.crash)),
    fire: r.fire === true || /^y/i.test(clean(r.fire)),
    injuries: num(r.numberOfInjuries, 0),
    deaths: num(r.numberOfDeaths, 0),
    dateOfIncident: fmtDate(r.dateOfIncident),
    dateFiled: fmtDate(r.dateComplaintFiled),
    make: clean(make).toUpperCase(),
    model: clean(model),
    modelYear: clean(modelYear),
    source: SOURCE,
    license: LICENSE,
    fetchedAt,
  }));
}

// ── decodeVin(vin): vPIC VIN decode ──────────────────────────────────────────────────────────────────
// Returns a normalized { vin, make, model, modelYear, bodyClass, ... } object, or null on bad VIN /
// failure. vPIC returns { Results: [ { Make, Model, ModelYear, BodyClass, ... } ] }.
export async function decodeVin(vin) {
  const v = normalizeVin(vin);
  if (!v) return null;
  const fetchedAt = new Date().toISOString();
  const url = `${ENDPOINTS.vpicDecode}/${encodeURIComponent(v)}?format=json`;
  const j = await getJSON(url);
  const r = Array.isArray(j?.Results) ? j.Results[0] : null;
  if (!r) return null;
  return {
    vin: v,
    make: clean(r.Make) || null,
    model: clean(r.Model) || null,
    modelYear: clean(r.ModelYear) || null,
    bodyClass: clean(r.BodyClass) || null,
    vehicleType: clean(r.VehicleType) || null,
    manufacturer: clean(r.Manufacturer) || null,
    plantCountry: clean(r.PlantCountry) || null,
    engineCylinders: clean(r.EngineCylinders) || null,
    fuelType: clean(r.FuelTypePrimary) || null,
    source: SOURCE,
    license: LICENSE,
    fetchedAt,
  };
}

// ── summary({ make, model, modelYear }): small dashboard — recall + complaint counts for a vehicle ───
// Soft-fails to a zeroed dashboard; never throws. Always carries provenance.
export async function summary({ make = '', model = '', modelYear = '' } = {}) {
  const [rec, comp] = await Promise.all([
    recalls({ make, model, modelYear, limit: 100 }).catch(() => []),
    complaints({ make, model, modelYear, limit: 100 }).catch(() => []),
  ]);
  const totalInjuries = comp.reduce((a, c) => a + (c.injuries || 0), 0);
  const totalDeaths = comp.reduce((a, c) => a + (c.deaths || 0), 0);
  const fires = comp.filter((c) => c.fire).length;
  const crashes = comp.filter((c) => c.crash).length;
  return {
    source: SOURCE,
    license: LICENSE,
    asOf: new Date().toISOString(),
    vehicle: { make: clean(make).toUpperCase(), model: clean(model), modelYear: clean(modelYear) },
    recalls: rec.length,
    complaints: comp.length,
    crashes,
    fires,
    injuries: totalInjuries,
    deaths: totalDeaths,
  };
}

// ── dataNote(): provenance + disclaimer ──────────────────────────────────────────────────────────────
export function dataNote() {
  const asOf = new Date().toISOString().slice(0, 10);
  return `Source: NHTSA (National Highway Traffic Safety Administration) recalls, complaints & vPIC, ` +
    `public domain, as of ${asOf}. Reports are as filed and may be updated; not safety or legal advice.`;
}

// ── renderPage(data): escaped HTML for the SoapBox site ──────────────────────────────────────────────
// `data` can be { recalls:[...] }, { complaints:[...] }, or { vin:{...decoded...} }. EVERY field is
// escaped before it reaches markup — a hostile component/summary/make string cannot inject HTML.
export function renderPage(data = {}) {
  // VIN decode card
  if (data && data.vin && typeof data.vin === 'object') {
    const v = data.vin;
    const cells = [
      ['VIN', v.vin], ['Make', v.make], ['Model', v.model], ['Year', v.modelYear],
      ['Body', v.bodyClass], ['Type', v.vehicleType], ['Fuel', v.fuelType], ['Plant', v.plantCountry],
    ].map(([k, val]) => `      <tr><th>${esc(k)}</th><td>${esc(val)}</td></tr>`).join('\n');
    return `<section class="nhtsa-vin">
  <h2>NHTSA vPIC VIN Decode</h2>
  <table>
${cells}
  </table>
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
  }
  // Complaints table
  if (data && Array.isArray(data.complaints)) {
    const rows = data.complaints.map((c) => `      <tr>
        <td>${esc(c.odiNumber)}</td>
        <td>${esc(c.components)}</td>
        <td>${esc(c.summary)}</td>
        <td>${c.crash ? 'yes' : ''}</td>
        <td>${c.fire ? 'yes' : ''}</td>
        <td>${esc(c.injuries)}</td>
        <td>${esc(c.deaths)}</td>
        <td>${esc(c.dateFiled)}</td>
      </tr>`).join('\n');
    const body = rows || '      <tr><td colspan="8">No complaints found.</td></tr>';
    return `<section class="nhtsa-complaints">
  <h2>NHTSA Vehicle Complaints</h2>
  <table>
    <thead>
      <tr><th>ODI #</th><th>Components</th><th>Summary</th><th>Crash</th><th>Fire</th><th>Injuries</th><th>Deaths</th><th>Filed</th></tr>
    </thead>
    <tbody>
${body}
    </tbody>
  </table>
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
  }
  // Recalls table (default)
  const list = Array.isArray(data.recalls) ? data.recalls : Array.isArray(data) ? data : [];
  const rows = list.map((r) => `      <tr>
        <td>${esc(r.campaign)}</td>
        <td>${esc(r.component)}</td>
        <td>${esc(r.summary)}</td>
        <td>${esc(r.consequence)}</td>
        <td>${esc(r.remedy)}</td>
        <td>${esc(r.date)}</td>
      </tr>`).join('\n');
  const body = rows || '      <tr><td colspan="6">No recalls found.</td></tr>';
  return `<section class="nhtsa-recalls">
  <h2>NHTSA Vehicle Recalls</h2>
  <table>
    <thead>
      <tr><th>Campaign</th><th>Component</th><th>Summary</th><th>Consequence</th><th>Remedy</th><th>Date</th></tr>
    </thead>
    <tbody>
${body}
    </tbody>
  </table>
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
}

// ── CLI: node integrations/soapbox/nhtsa.mjs <make> <model> <year>   |   --vin <VIN> ─────────────────
if (process.argv[1] && process.argv[1].endsWith('nhtsa.mjs')) {
  const argv = process.argv.slice(2);
  const vinIdx = argv.indexOf('--vin');
  if (vinIdx >= 0) {
    const decoded = await decodeVin(argv[vinIdx + 1] || '');
    console.log('\n# NHTSA vPIC VIN decode\n');
    console.log(decoded ? JSON.stringify(decoded, null, 2) : '  (invalid VIN or no data)');
    console.log('\n' + dataNote());
  } else {
    const [make, model, modelYear] = argv;
    const [rec, comp, sum] = await Promise.all([
      recalls({ make, model, modelYear, limit: 10 }),
      complaints({ make, model, modelYear, limit: 10 }),
      summary({ make, model, modelYear }),
    ]);
    console.log(`\n# NHTSA — ${make || '?'} ${model || '?'} ${modelYear || '?'}\n`);
    console.log('Recalls:', rec.length);
    for (const r of rec.slice(0, 5)) console.log(`  - [${r.campaign || '?'}] ${(r.component || '').slice(0, 50)}`);
    console.log('Complaints:', comp.length);
    console.log('Summary:', JSON.stringify({ recalls: sum.recalls, complaints: sum.complaints, crashes: sum.crashes, fires: sum.fires, injuries: sum.injuries, deaths: sum.deaths }));
    console.log('\n' + dataNote());
  }
}
