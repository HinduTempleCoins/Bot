// fda-recalls.mjs — the SoapBox FDA safety-recalls reader. Covers the openFDA FOOD, DEVICE and
// COSMETIC endpoints, which the existing pharma.mjs reader deliberately does NOT touch (pharma.mjs
// owns the DRUG endpoints: label, FAERS drug events, drug enforcement). This module is the rest of
// openFDA's consumer-safety surface:
//   • /food/enforcement.json  (FDA)  — food recall / enforcement reports
//   • /device/recall.json     (FDA)  — medical-device recalls
//   • /food/event.json        (FDA)  — food adverse-event reports (CAERS), de-identified
//
// openFDA is FREE and works KEYLESS at the low-volume public tier. An API key is optional and only
// raises the rate limit; we read it from an env NAME (never a literal) and append it as ?api_key= when
// present — no secret ever lives in this file. Same shape as pharma.mjs / macro.mjs: ESM, a __setFetch()
// seam for tests, and graceful soft-fail — list readers return [] and never throw.
//
//   import { foodRecalls, deviceRecalls, foodAdverseEvents, summary, renderPage, dataNote } from './fda-recalls.mjs'
//   node integrations/soapbox/fda-recalls.mjs salmonella

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// openFDA base + the consumer-safety endpoints this module owns (drug/* stays in pharma.mjs).
export const ENDPOINTS = {
  foodEnforcement: 'https://api.fda.gov/food/enforcement.json',
  deviceRecall: 'https://api.fda.gov/device/recall.json',
  foodEvent: 'https://api.fda.gov/food/event.json',
};

// The env var NAME holding an optional openFDA api_key. We never inline a key — only read it by name,
// only when set. Absent ⇒ keyless tier (which works); present ⇒ the request gets a higher rate limit.
export const API_KEY_ENV = 'OPENFDA_API_KEY';

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const clean = (s) => String(s == null ? '' : s).trim();
const num = (n, d) => { const v = Number(n); return Number.isFinite(v) ? v : d; };

// openFDA dates arrive as YYYYMMDD; render them as YYYY-MM-DD when we can, else pass through.
function fmtDate(s) {
  const d = clean(s);
  return /^\d{8}$/.test(d) ? `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}` : (d || null);
}

// Build a request URL: optional search, a capped limit, and the api_key ONLY if its env is set.
function buildUrl(base, { search, limit, count } = {}) {
  const p = new URLSearchParams();
  if (search) p.set('search', search);
  if (count) p.set('count', count);
  if (limit != null) p.set('limit', String(limit));
  const key = process.env[API_KEY_ENV];
  if (key) p.set('api_key', key);
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

// fetch JSON with soft-fail: any network/parse/non-ok error resolves to null, never throws.
async function getJSON(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

const capLimit = (n) => Math.min(Math.max(num(n, 10), 1), 100);

// openFDA search syntax: a free-text query is matched against the most relevant field for the endpoint.
// We quote and strip the few chars that would break the query grammar — never interpolate raw input.
const safeTerm = (q) => clean(q).replace(/["\\+:()]/g, ' ').trim();

// ── /food/enforcement.json: foodRecalls({ query, limit }) ────────────────────────────────────────────
// Recent food recall / enforcement reports. Normalized to the row the site renders. Soft-fails to [].
export async function foodRecalls({ query = '', limit = 10 } = {}) {
  const q = safeTerm(query);
  const search = q ? `product_description:"${q}"` : '';
  const j = await getJSON(buildUrl(ENDPOINTS.foodEnforcement, { search, limit: capLimit(limit) }));
  const rows = j?.results;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    product: clean(r.product_description) || null,
    reason: clean(r.reason_for_recall) || null,
    classification: clean(r.classification) || null,
    company: clean(r.recalling_firm) || null,
    state: clean(r.state) || null,
    date: fmtDate(r.recall_initiation_date),
    status: clean(r.status) || null,
  }));
}

// ── /device/recall.json: deviceRecalls({ query, limit }) ─────────────────────────────────────────────
// Medical-device recalls. The device endpoint uses different field names than food enforcement; we
// normalize to the SAME row shape so the site renders one unified recalls table. Soft-fails to [].
export async function deviceRecalls({ query = '', limit = 10 } = {}) {
  const q = safeTerm(query);
  const search = q ? `product_description:"${q}"` : '';
  const j = await getJSON(buildUrl(ENDPOINTS.deviceRecall, { search, limit: capLimit(limit) }));
  const rows = j?.results;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => ({
    product: clean(r.product_description) || null,
    reason: clean(r.reason_for_recall) || null,
    classification: clean(r.product_res_number) || clean(r.openfda?.device_class) || null,
    company: clean(r.recalling_firm) || null,
    state: clean(r.state) || null,
    date: fmtDate(r.event_date_initiated || r.recall_initiation_date),
    status: clean(r.recall_status) || clean(r.status) || null,
  }));
}

// ── /food/event.json: foodAdverseEvents({ query, limit }) ────────────────────────────────────────────
// Food / dietary-supplement / cosmetic adverse-event reports (CAERS). These are consumer reports, NOT
// causation. CAERS records can carry consumer demographics (age/sex/weight) — we DE-IDENTIFY here:
// only product, reaction outcomes and reported reactions leave this function; no age/sex/weight/dates of
// birth or any other consumer field is ever copied into the normalized row.
export async function foodAdverseEvents({ query = '', limit = 10 } = {}) {
  const q = safeTerm(query);
  const search = q ? `products.name_brand:"${q}"` : '';
  const j = await getJSON(buildUrl(ENDPOINTS.foodEvent, { search, limit: capLimit(limit) }));
  const rows = j?.results;
  if (!Array.isArray(rows)) return [];
  return rows.map((r) => {
    const products = Array.isArray(r.products)
      ? r.products.map((p) => clean(p?.name_brand)).filter(Boolean)
      : [];
    const reactions = Array.isArray(r.reactions)
      ? r.reactions.map((x) => clean(x)).filter(Boolean)
      : [];
    const outcomes = Array.isArray(r.outcomes)
      ? r.outcomes.map((x) => clean(x)).filter(Boolean)
      : [];
    return {
      // de-identified ONLY — no consumer (age/sex/weight) fields, no free-text identifiers.
      products,
      reactions,
      outcomes,
      date: fmtDate(r.date_started || r.date_created),
    };
  });
}

// ── summary(): small dashboard object — recent recall counts by classification ───────────────────────
// Pulls a recent slice of food + device recalls and tallies them by classification (Class I/II/III).
// Soft-fails to a zeroed dashboard; never throws.
export async function summary({ limit = 50 } = {}) {
  const [food, device] = await Promise.all([
    foodRecalls({ limit }).catch(() => []),
    deviceRecalls({ limit }).catch(() => []),
  ]);
  const byClassification = {};
  const tally = (rows) => {
    for (const r of rows) {
      const k = r.classification || 'Unclassified';
      byClassification[k] = (byClassification[k] || 0) + 1;
    }
  };
  tally(food);
  tally(device);
  return {
    source: 'openFDA (FDA)',
    asOf: new Date().toISOString(),
    foodRecalls: food.length,
    deviceRecalls: device.length,
    total: food.length + device.length,
    byClassification,
  };
}

// ── dataNote(): provenance + disclaimer ──────────────────────────────────────────────────────────────
export function dataNote() {
  const asOf = new Date().toISOString().slice(0, 10);
  return `Source: openFDA (U.S. Food & Drug Administration), as of ${asOf}. ` +
    `Recall and adverse-event reports are as filed and may be updated; not medical advice.`;
}

// ── renderPage(data): escaped HTML recalls table for the SoapBox site ────────────────────────────────
// `data` is { recalls: [...normalized rows...] } (food and/or device rows, same shape). EVERY field is
// escaped before it reaches markup — a hostile product/reason/company name cannot inject HTML.
export function renderPage(data = {}) {
  const recalls = Array.isArray(data.recalls) ? data.recalls
    : Array.isArray(data) ? data : [];
  const rows = recalls.map((r) => `      <tr>
        <td>${esc(r.product)}</td>
        <td>${esc(r.reason)}</td>
        <td>${esc(r.classification)}</td>
        <td>${esc(r.company)}</td>
        <td>${esc(r.state)}</td>
        <td>${esc(r.date)}</td>
        <td>${esc(r.status)}</td>
      </tr>`).join('\n');
  const body = rows || '      <tr><td colspan="7">No recalls found.</td></tr>';
  return `<section class="fda-recalls">
  <h2>FDA Safety Recalls</h2>
  <table>
    <thead>
      <tr><th>Product</th><th>Reason</th><th>Class</th><th>Company</th><th>State</th><th>Date</th><th>Status</th></tr>
    </thead>
    <tbody>
${body}
    </tbody>
  </table>
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
}

// ── CLI: node integrations/soapbox/fda-recalls.mjs <query> ───────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('fda-recalls.mjs')) {
  const q = process.argv.slice(2).join(' ');
  const [food, device, ae, sum] = await Promise.all([
    foodRecalls({ query: q }), deviceRecalls({ query: q }), foodAdverseEvents({ query: q }), summary(),
  ]);
  console.log(`\n# FDA recalls${q ? `: ${q}` : ''}\n`);
  console.log('Food recalls:  ', food.length);
  for (const r of food.slice(0, 5)) console.log(`  - ${(r.product || '').slice(0, 60)} [${r.classification || '?'}] ${r.company || ''}`);
  console.log('Device recalls:', device.length);
  console.log('Food adverse events:', ae.length, '(de-identified)');
  console.log('Summary by classification:', JSON.stringify(sum.byClassification));
  console.log('\n' + dataNote());
}
