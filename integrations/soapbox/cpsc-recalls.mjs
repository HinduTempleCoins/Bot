// cpsc-recalls.mjs — the SoapBox CPSC consumer-product safety-recalls reader. This is the third recall
// surface, deliberately distinct from the other two:
//   • fda-recalls.mjs  (openFDA)  — FOOD / DEVICE / COSMETIC recalls & adverse events
//   • NHTSA (vehicles)            — automobile / tire / car-seat recalls
//   • THIS module (CPSC)          — everything else a consumer buys: toys, electronics, appliances,
//                                   furniture, kids' products, tools, sporting goods, etc.
//
// Source: the U.S. Consumer Product Safety Commission's SaferProducts.gov Recalls REST web service —
//   https://www.saferproducts.gov/RestWebServices/Recall
// It is FREE and works KEYLESS (no auth token). No secret ever lives in this file. Same shape as
// fda-recalls.mjs / macro.mjs: ESM, a __setFetch() seam for tests, and graceful soft-fail — list readers
// return [] and never throw.
//
//   import { recalls, recentRecalls, byHazard, summary, renderPage, dataNote } from './cpsc-recalls.mjs'
//   node integrations/soapbox/cpsc-recalls.mjs lithium

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// CPSC SaferProducts.gov Recalls REST endpoint. JSON is the default format. Keyless.
export const ENDPOINT = 'https://www.saferproducts.gov/RestWebServices/Recall';

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const clean = (s) => String(s == null ? '' : s).trim();
const num = (n, d) => { const v = Number(n); return Number.isFinite(v) ? v : d; };
const capLimit = (n) => Math.min(Math.max(num(n, 10), 1), 100);

// CPSC RecallDate arrives as an ISO-ish timestamp (e.g. "2026-01-15T00:00:00"). Render the date part as
// YYYY-MM-DD when we can, else pass the trimmed value through.
function fmtDate(s) {
  const d = clean(s);
  const m = d.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : (d || null);
}

// Build the request URL. CPSC takes a free-text `RecallTitle` filter plus `format=json`. We never
// interpolate raw input into a query grammar — URLSearchParams encodes everything.
function buildUrl({ query, format = 'json' } = {}) {
  const p = new URLSearchParams();
  p.set('format', format);
  const q = clean(query);
  if (q) p.set('RecallTitle', q);
  return `${ENDPOINT}?${p.toString()}`;
}

// fetch JSON with soft-fail: any network/parse/non-ok error resolves to null, never throws.
async function getJSON(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// CPSC nests several arrays under each recall record. Pull the human-readable strings, soft-failing each
// nested shape to an empty list / null. We never assume a field is present.
const joinNames = (arr, key) => (Array.isArray(arr)
  ? arr.map((x) => clean(x?.[key])).filter(Boolean)
  : []);

// Hazards live under Hazards[].Name; we surface them as a single "; "-joined string for the row, and the
// raw lowercased set is what byHazard()/summary() match against.
function hazardList(r) {
  return joinNames(r?.Hazards, 'Name');
}

// Normalize one CPSC recall record into the SoapBox row shape. Every consumer of this module sees the
// same flat object regardless of CPSC's deeply-nested source schema.
function normalize(r) {
  const products = joinNames(r?.Products, 'Name');
  const manufacturers = joinNames(r?.Manufacturers, 'Name');
  const remedies = joinNames(r?.Remedies, 'Name');
  const hazards = hazardList(r);
  const url = clean(r?.URL) || clean(r?.RecallUrl) || null;
  return {
    title: clean(r?.Title) || null,
    date: fmtDate(r?.RecallDate),
    hazard: hazards.join('; ') || null,
    remedy: remedies.join('; ') || null,
    products: products.length ? products : null,
    manufacturer: manufacturers.join('; ') || null,
    url,
  };
}

// ── recalls({ query, limit }): the core reader ───────────────────────────────────────────────────────
// Fetches CPSC recalls (optionally filtered by free-text title query), normalized to the SoapBox row.
// Soft-fails to []. CPSC returns the full matching set, so we cap to `limit` after normalizing.
export async function recalls({ query = '', limit = 10 } = {}) {
  const j = await getJSON(buildUrl({ query }));
  if (!Array.isArray(j)) return [];
  return j.map(normalize).slice(0, capLimit(limit));
}

// ── recentRecalls({ limit }): most recent recalls ────────────────────────────────────────────────────
// CPSC returns records newest-first; we sort defensively by date desc then take the top `limit`.
export async function recentRecalls({ limit = 10 } = {}) {
  const all = await recalls({ limit: 100 });
  const sorted = all.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return sorted.slice(0, capLimit(limit));
}

// ── byHazard(hazard): filter recent recalls to one hazard type ───────────────────────────────────────
// Matches the hazard substring case-insensitively (fire / fall / choking / laceration / burn / shock…).
// Soft-fails to [].
export async function byHazard(hazard, { limit = 50 } = {}) {
  const needle = clean(hazard).toLowerCase();
  if (!needle) return [];
  const all = await recalls({ limit: 100 });
  return all.filter((r) => String(r.hazard || '').toLowerCase().includes(needle)).slice(0, capLimit(limit));
}

// ── summary(): counts of recent recalls by hazard type ───────────────────────────────────────────────
// Tallies each recall under every hazard it carries (a recall can list multiple hazards). Soft-fails to
// a zeroed dashboard; never throws.
export async function summary({ limit = 50 } = {}) {
  const rows = await recalls({ limit }).catch(() => []);
  const byHazardType = {};
  for (const r of rows) {
    const hazards = String(r.hazard || '').split(';').map((h) => h.trim()).filter(Boolean);
    if (!hazards.length) {
      byHazardType.Unclassified = (byHazardType.Unclassified || 0) + 1;
      continue;
    }
    for (const h of hazards) byHazardType[h] = (byHazardType[h] || 0) + 1;
  }
  return {
    source: 'CPSC SaferProducts.gov',
    asOf: new Date().toISOString(),
    total: rows.length,
    byHazardType,
  };
}

// ── dataNote(): provenance + disclaimer ──────────────────────────────────────────────────────────────
export function dataNote() {
  const asOf = new Date().toISOString().slice(0, 10);
  return `Source: CPSC SaferProducts.gov (U.S. Consumer Product Safety Commission), as of ${asOf}. ` +
    `Recall reports are as filed and may be updated; not safety or legal advice.`;
}

// ── renderPage(data): escaped HTML recalls table for the SoapBox site ────────────────────────────────
// `data` is { recalls: [...normalized rows...] } (or a bare array). EVERY field is escaped before it
// reaches markup — a hostile product/title/manufacturer name cannot inject HTML.
export function renderPage(data = {}) {
  const list = Array.isArray(data.recalls) ? data.recalls
    : Array.isArray(data) ? data : [];
  const rows = list.map((r) => {
    const products = Array.isArray(r.products) ? r.products.join(', ') : r.products;
    const link = r.url ? `<a href="${esc(r.url)}">link</a>` : '';
    return `      <tr>
        <td>${esc(r.title)}</td>
        <td>${esc(r.date)}</td>
        <td>${esc(r.hazard)}</td>
        <td>${esc(r.remedy)}</td>
        <td>${esc(products)}</td>
        <td>${esc(r.manufacturer)}</td>
        <td>${link}</td>
      </tr>`;
  }).join('\n');
  const body = rows || '      <tr><td colspan="7">No recalls found.</td></tr>';
  return `<section class="cpsc-recalls">
  <h2>CPSC Consumer Product Recalls</h2>
  <table>
    <thead>
      <tr><th>Title</th><th>Date</th><th>Hazard</th><th>Remedy</th><th>Products</th><th>Manufacturer</th><th>Link</th></tr>
    </thead>
    <tbody>
${body}
    </tbody>
  </table>
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
}

// ── CLI: node integrations/soapbox/cpsc-recalls.mjs <query> ──────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('cpsc-recalls.mjs')) {
  const q = process.argv.slice(2).join(' ');
  const [list, sum] = await Promise.all([recentRecalls({ limit: 10 }), summary()]);
  console.log(`\n# CPSC recalls${q ? `: ${q}` : ''}\n`);
  for (const r of list.slice(0, 10)) {
    console.log(`  - ${(r.title || '').slice(0, 70)} [${r.hazard || '?'}] ${r.date || ''}`);
  }
  console.log('\nSummary by hazard:', JSON.stringify(sum.byHazardType));
  console.log('\n' + dataNote());
}
