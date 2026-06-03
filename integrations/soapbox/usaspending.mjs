// usaspending.mjs — the SoapBox "follow the AWARDED money" reader. Reads the USAspending API
// (api.usaspending.gov — fully KEYLESS) for federal awards by recipient name and/or CFDA program
// number (Assistance Listing). Powers the honest Benefits Navigator's "who actually got this money,
// and how much" surface — the antidote to "free money" claims: these are real, already-made awards.
//
//   POST /api/v2/search/spending_by_award/ with a JSON { filters, fields, sort, order, limit, page }.
//   Returns { results: [ { 'Award ID', 'Recipient Name', 'Awarding Agency', 'Award Amount',
//     'Start Date', 'End Date', 'Award Type', 'CFDA Number', 'Description', ... } ], ... }.
//   CFDA-filtered queries use assistance award types (02 grants, 03 direct payments, 04 cooperative
//   agreements, 05 other) since CFDA only applies to financial-assistance awards, not contracts.
//
// Pattern matches worldbank.mjs / gov-readers.mjs: ESM, zero deps, keyless, __setFetch seam, graceful
// soft-fail (return []/{} on error, NEVER throw), guarded CLI, escaped rendered HTML, no secrets,
// provenance (source + fetched_at) on every row.
//
//   import { awards, byRecipient, byCFDA, normalizeAward, renderPage, dataNote } from './usaspending.mjs'
//   node integrations/soapbox/usaspending.mjs "Lockheed"
//   node integrations/soapbox/usaspending.mjs --cfda 10.902

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxUSASpending/1.0 (+https://data.soapbox.community)' };

export const ENDPOINT = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';

// Award type codes. Contracts: A B C D. Financial assistance (grants etc.): 02 03 04 05.
export const CONTRACT_TYPES = ['A', 'B', 'C', 'D'];
export const ASSISTANCE_TYPES = ['02', '03', '04', '05'];

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const now = () => new Date().toISOString();
const capLimit = (n) => Math.max(1, Math.min(100, num(n) || 25));

// HTML escape — every interpolated value passes through this before reaching markup.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Normalize one USAspending result row → a clean award row with provenance. PURE.
export function normalizeAward(a = {}) {
  return {
    id: str(a['Award ID'] || a.generated_internal_id) || null,
    recipient: str(a['Recipient Name']) || null,
    agency: str(a['Awarding Agency']) || null,
    amount: num(a['Award Amount']),
    award_type: str(a['Award Type']) || null,
    cfda: str(a['CFDA Number']) || null,
    start_date: str(a['Start Date']) || null,
    end_date: str(a['End Date']) || null,
    description: str(a.Description) || null,
    source: 'USAspending',
    fetched_at: now(),
  };
}

// ---- live data (keyless; soft-fails to []) ----

/**
 * Search federal awards by recipient name and/or CFDA program number. Returns normalized rows
 * (or [] on any failure). At least one of `recipient` / `cfda` must be given.
 * @param {{recipient?:string, cfda?:string, agency?:string, limit?:number}} opts
 */
export async function awards({ recipient = '', cfda = '', agency = '', limit = 25 } = {}) {
  const rec = str(recipient);
  const program = str(cfda);
  const ag = str(agency);
  if (!rec && !program && !ag) return [];
  try {
    // CFDA only applies to assistance awards; otherwise default to the contract set + grants.
    const filters = {
      award_type_codes: program ? ASSISTANCE_TYPES : [...CONTRACT_TYPES, ...ASSISTANCE_TYPES],
    };
    if (rec) filters.recipient_search_text = [rec];
    if (program) filters.program_numbers = [program];
    if (ag) filters.agencies = [{ type: 'awarding', tier: 'toptier', name: ag }];
    const body = {
      filters,
      fields: ['Award ID', 'Recipient Name', 'Awarding Agency', 'Award Amount', 'Start Date',
        'End Date', 'Award Type', 'CFDA Number', 'Description'],
      sort: 'Award Amount',
      order: 'desc',
      limit: capLimit(limit),
      page: 1,
    };
    const r = await _fetch(ENDPOINT, {
      method: 'POST',
      headers: { ...UA, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r || !r.ok) return [];
    const j = await r.json();
    const rows = Array.isArray(j?.results) ? j.results : [];
    return rows.map(normalizeAward).filter((x) => x.id || x.recipient);
  } catch { return []; }
}

/** Convenience: awards to one recipient. Soft-fails to []. */
export async function byRecipient(recipient, { agency = '', limit = 25 } = {}) {
  if (!str(recipient)) return [];
  return awards({ recipient, agency, limit });
}

/** Convenience: awards under one CFDA / Assistance Listing program number. Soft-fails to []. */
export async function byCFDA(cfda, { agency = '', limit = 25 } = {}) {
  if (!str(cfda)) return [];
  return awards({ cfda, agency, limit });
}

// Compact USD formatting for display.
function usd(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v); const abs = Math.abs(n);
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + n.toFixed(0);
}

// ---- rendering ----

/** Escaped HTML table of awards. PURE; soft-handles missing fields. */
export function renderPage(rows = []) {
  const list = Array.isArray(rows) ? rows : [];
  const body = list.map((a) => `      <tr>
        <td>${esc(a.recipient)}</td>
        <td>${esc(a.agency)}</td>
        <td>${esc(usd(a.amount))}</td>
        <td>${esc(a.cfda)}</td>
        <td>${esc(a.award_type)}</td>
        <td>${esc(a.end_date)}</td>
      </tr>`).join('\n');
  const tbody = body || '      <tr><td colspan="6">No federal awards found.</td></tr>';
  return `<section class="usaspending">
  <h2>USAspending — Federal Awards (already made)</h2>
  <table>
    <thead>
      <tr><th>Recipient</th><th>Agency</th><th>Amount</th><th>CFDA</th><th>Type</th><th>End Date</th></tr>
    </thead>
    <tbody>
${tbody}
    </tbody>
  </table>
  <p class="data-note">${esc(dataNote())}</p>
</section>`;
}

/** Provenance line — names USAspending + that these are already-made awards. */
export function dataNote() {
  const asOf = new Date().toISOString().slice(0, 10);
  return `Source: USAspending.gov (keyless), as of ${asOf}. These are awards ALREADY MADE — they show ` +
    `who received funding and how much, not money currently available to you.`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('usaspending.mjs')) {
  const argv = process.argv.slice(2);
  let cfda = '';
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--cfda') cfda = argv[++i] || '';
    else rest.push(argv[i]);
  }
  const rows = cfda
    ? await byCFDA(cfda)
    : await byRecipient(rest.join(' ') || 'Lockheed');
  console.log(`\n# USAspending awards ${cfda ? `CFDA ${cfda}` : rest.join(' ')} (${rows.length})\n`);
  for (const a of rows.slice(0, 15)) {
    console.log(`  - ${(a.recipient || '').slice(0, 48)} — ${usd(a.amount)} (${a.agency || ''})`);
  }
  console.log(`\n${dataNote()}`);
}
