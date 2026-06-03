// fsis-recalls.mjs — the SoapBox USDA FSIS meat / poultry / egg recalls reader. This is the fourth
// recall surface, deliberately distinct from the other three:
//   • fda-recalls.mjs  (openFDA) — FDA FOOD / DEVICE / COSMETIC recalls & adverse events
//   • cpsc-recalls.mjs (CPSC)    — consumer products (toys, electronics, appliances, furniture…)
//   • nhtsa.mjs        (NHTSA)   — vehicles / tires / car-seats
//   • THIS module (FSIS)         — USDA-regulated MEAT, POULTRY and EGG products (the half of the food
//                                  supply the FDA does NOT cover — FSIS is the USDA arm that does).
//
// Source: the USDA Food Safety & Inspection Service public recall JSON feed —
//   https://www.fsis.usda.gov/fsis/api/recall/v/1
// It is FREE and works KEYLESS (no auth token). No secret ever lives in this file. Same shape as
// fda-recalls.mjs / cpsc-recalls.mjs / macro.mjs: ESM, a __setFetch() seam for tests, and graceful
// soft-fail — list readers return [] and never throw. Every emitted row carries provenance
// (source / license: public-domain / fetchedAt) per the v3 §6 gov-records spec.
//
//   import { recalls, recentRecalls, byClass, byReason, summary, renderPage, dataNote } from './fsis-recalls.mjs'
//   node integrations/soapbox/fsis-recalls.mjs salmonella

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// USDA FSIS public recall JSON endpoint. Keyless.
export const ENDPOINT = 'https://www.fsis.usda.gov/fsis/api/recall/v/1';

// Provenance applied to every emitted record (v3 §6: source name, public-domain license, fetchedAt).
export const SOURCE = 'USDA FSIS';
export const LICENSE = 'public-domain';

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const clean = (s) => String(s == null ? '' : s).trim();
const num = (n, d) => { const v = Number(n); return Number.isFinite(v) ? v : d; };
const capLimit = (n) => Math.min(Math.max(num(n, 10), 1), 100);

// FSIS field values arrive in a few shapes — a bare string, or a "field_*" object with a `value`, or an
// array of such objects. Flatten any of them to a single trimmed, "; "-joined string. Soft-fails to ''.
function fieldText(v) {
  if (v == null) return '';
  if (Array.isArray(v)) return v.map(fieldText).filter(Boolean).join('; ');
  if (typeof v === 'object') return clean(v.value != null ? v.value : (v.name != null ? v.name : ''));
  return clean(v);
}

// FSIS recall dates arrive as ISO-ish strings (e.g. "2026-03-10T00:00:00" or "2026-03-10"). Render the
// date part as YYYY-MM-DD when we can, else pass the trimmed value through (null when empty).
function fmtDate(s) {
  const d = clean(s);
  const m = d.match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : (d || null);
}

// Build the request URL. The FSIS feed returns the full recent recall set as a JSON array; we filter
// client-side. URLSearchParams encodes everything — we never interpolate raw input into a query string.
function buildUrl({ format = 'json' } = {}) {
  const p = new URLSearchParams();
  p.set('format', format);
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

// Normalize one FSIS recall record into the SoapBox row shape. FSIS uses verbose "field_*" keys; we map
// the load-bearing ones, tolerating both the flat and the field-object variants. Every consumer sees the
// same flat row regardless of the source schema, and every row carries provenance.
function normalize(r, fetchedAt) {
  const title = fieldText(r?.field_title) || fieldText(r?.title) || null;
  const date = fmtDate(fieldText(r?.field_recall_date) || fieldText(r?.field_last_modified_date) || r?.date);
  const recallClass = fieldText(r?.field_recall_classification) || fieldText(r?.field_risk_level) || null;
  const reason = fieldText(r?.field_recall_reason) || fieldText(r?.field_summary) || null;
  const company = fieldText(r?.field_establishment) || fieldText(r?.field_company) || null;
  const states = fieldText(r?.field_states) || fieldText(r?.field_distribution) || null;
  const product = fieldText(r?.field_product_items) || fieldText(r?.field_summary) || null;
  const qty = fieldText(r?.field_qty_recovered) || fieldText(r?.field_amount) || null;
  const recallType = fieldText(r?.field_recall_type) || fieldText(r?.field_active_notice) || null;
  const urlRaw = fieldText(r?.field_url) || fieldText(r?.url) || clean(r?.link?.url);
  return {
    title,
    date,
    recallClass,
    reason,
    company,
    states,
    product,
    quantity: qty || null,
    recallType: recallType || null,
    url: urlRaw || null,
    // provenance (v3 §6): every record is self-describing.
    source: SOURCE,
    license: LICENSE,
    fetchedAt,
  };
}

// ── recalls({ query, limit }): the core reader ───────────────────────────────────────────────────────
// Fetches FSIS recalls, normalizes them, optionally filters by a free-text query (matched against
// title / reason / product / company), caps to `limit`. Soft-fails to [].
export async function recalls({ query = '', limit = 10 } = {}) {
  const fetchedAt = new Date().toISOString();
  const j = await getJSON(buildUrl());
  // The feed is an array of records (some deployments wrap it under .results — tolerate both).
  const arr = Array.isArray(j) ? j : (Array.isArray(j?.results) ? j.results : null);
  if (!Array.isArray(arr)) return [];
  let rows = arr.map((r) => normalize(r, fetchedAt));
  const q = clean(query).toLowerCase();
  if (q) {
    rows = rows.filter((r) => [r.title, r.reason, r.product, r.company]
      .some((f) => String(f || '').toLowerCase().includes(q)));
  }
  return rows.slice(0, capLimit(limit));
}

// ── recentRecalls({ limit }): most recent recalls, sorted by date desc ───────────────────────────────
export async function recentRecalls({ limit = 10 } = {}) {
  const all = await recalls({ limit: 100 });
  const sorted = all.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')));
  return sorted.slice(0, capLimit(limit));
}

// ── byClass(cls): filter recalls to one recall classification (Class I / II / III, High/Low risk) ────
// Matches the class/risk substring case-insensitively. Soft-fails to [].
export async function byClass(cls, { limit = 50 } = {}) {
  const needle = clean(cls).toLowerCase();
  if (!needle) return [];
  const all = await recalls({ limit: 100 });
  return all.filter((r) => String(r.recallClass || '').toLowerCase().includes(needle)).slice(0, capLimit(limit));
}

// ── byReason(reason): filter recalls whose reason mentions a pathogen / contaminant ──────────────────
// (salmonella, listeria, e. coli, undeclared allergen, foreign material…). Case-insensitive substring.
export async function byReason(reason, { limit = 50 } = {}) {
  const needle = clean(reason).toLowerCase();
  if (!needle) return [];
  const all = await recalls({ limit: 100 });
  return all.filter((r) => String(r.reason || '').toLowerCase().includes(needle)).slice(0, capLimit(limit));
}

// ── summary(): small dashboard — recent recall counts by classification ──────────────────────────────
// Soft-fails to a zeroed dashboard; never throws. Always carries provenance.
export async function summary({ limit = 50 } = {}) {
  const rows = await recalls({ limit }).catch(() => []);
  const byClassification = {};
  for (const r of rows) {
    const k = r.recallClass || 'Unclassified';
    byClassification[k] = (byClassification[k] || 0) + 1;
  }
  return {
    source: SOURCE,
    license: LICENSE,
    asOf: new Date().toISOString(),
    total: rows.length,
    byClassification,
  };
}

// ── dataNote(): provenance + disclaimer ──────────────────────────────────────────────────────────────
export function dataNote() {
  const asOf = new Date().toISOString().slice(0, 10);
  return `Source: USDA FSIS (Food Safety & Inspection Service), public domain, as of ${asOf}. ` +
    `Recall notices cover meat, poultry and egg products and may be updated; not food-safety or legal advice.`;
}

// ── renderPage(data): escaped HTML recalls table for the SoapBox site ────────────────────────────────
// `data` is { recalls: [...normalized rows...] } (or a bare array). EVERY field is escaped before it
// reaches markup — a hostile title/company/product name cannot inject HTML.
export function renderPage(data = {}) {
  const list = Array.isArray(data.recalls) ? data.recalls
    : Array.isArray(data) ? data : [];
  const rows = list.map((r) => {
    const link = r.url ? `<a href="${esc(r.url)}">link</a>` : '';
    return `      <tr>
        <td>${esc(r.title)}</td>
        <td>${esc(r.date)}</td>
        <td>${esc(r.recallClass)}</td>
        <td>${esc(r.reason)}</td>
        <td>${esc(r.company)}</td>
        <td>${esc(r.states)}</td>
        <td>${link}</td>
      </tr>`;
  }).join('\n');
  const body = rows || '      <tr><td colspan="7">No recalls found.</td></tr>';
  return `<section class="fsis-recalls">
  <h2>USDA FSIS Meat &amp; Poultry Recalls</h2>
  <table>
    <thead>
      <tr><th>Title</th><th>Date</th><th>Class</th><th>Reason</th><th>Establishment</th><th>States</th><th>Link</th></tr>
    </thead>
    <tbody>
${body}
    </tbody>
  </table>
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
}

// ── CLI: node integrations/soapbox/fsis-recalls.mjs <query> ──────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('fsis-recalls.mjs')) {
  const q = process.argv.slice(2).join(' ');
  const [list, sum] = await Promise.all([
    q ? recalls({ query: q, limit: 10 }) : recentRecalls({ limit: 10 }),
    summary(),
  ]);
  console.log(`\n# USDA FSIS recalls${q ? `: ${q}` : ''}\n`);
  for (const r of list.slice(0, 10)) {
    console.log(`  - ${(r.title || '').slice(0, 70)} [${r.recallClass || '?'}] ${r.date || ''}`);
  }
  console.log('\nSummary by class:', JSON.stringify(sum.byClassification));
  console.log('\n' + dataNote());
}
