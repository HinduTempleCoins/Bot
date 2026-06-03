// fec.mjs — Accountability Graph base reader (v3 §6A.2) over the FEC OpenFEC API (api.open.fec.gov/v1).
// Campaign-finance public record: candidates, their authorized committees, and per-candidate receipt/
// disbursement totals by election cycle. KEYLESS-FIRST: OpenFEC ships a shared "DEMO_KEY" that works
// out of the box at a low rate; a personal key (env FEC_API_KEY, by name) lifts the rate but is OPTIONAL.
//
// This is distinct from gov-readers.mjs::openFecDonors (which reads Schedule A individual contributions
// and needs a data.gov key). This reader covers the candidate / committee / totals surface and works
// keyless via DEMO_KEY — it is the campaign-finance JOIN target for the legislator id crosswalk
// (a legislator's id.fec[] values are exactly the candidate_ids used here).
//
// DISCIPLINE (v3 §6A.2 — non-negotiable):
//   • FACTS + CONNECTIONS ONLY. Dollar totals and committee links as the FEC reports them. No verdicts,
//     no "too much money" characterization, no scoring. The numbers are the numbers.
//   • PUBLIC-CAPACITY DATA ONLY. Candidates for / holders of federal office, in that capacity.
//   • LINK EVERY SOURCE. Each record carries source + license (FEC data is U.S.-Gov public domain) +
//     fetchedAt. FEC.gov is the citable origin.
//   • RIGHT OF REPLY. Filers may dispute via amended FEC filings; this mirrors the official filing record.
//
// Pattern follows worldbank.mjs / gov-readers.mjs: ESM, zero deps, __setFetch seam, soft-fail (return
// []/null, NEVER throw), injectable data for tests, guarded CLI demo, escaped rendered HTML.
//
//   import { candidateSearch, candidate, committeesForCandidate, candidateTotals,
//            renderPage, dataNote, apiKey, __setFetch } from './fec.mjs'
//   node integrations/soapbox/fec.mjs search "Warren"
//   node integrations/soapbox/fec.mjs totals S0MA00170 2024

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxFEC/1.0 (+https://data.soapbox.community)' };
const BASE = 'https://api.open.fec.gov/v1';
const SRC = 'FEC OpenFEC API';
const LICENSE = 'U.S. Government work (public domain)';

// ---- key handling: env FEC_API_KEY by NAME, soft-fall-back to the public DEMO_KEY (keyless-first) ----
/** The FEC API key in effect: a personal FEC_API_KEY if set, else the public DEMO_KEY. */
export function apiKey() {
  return process.env.FEC_API_KEY || 'DEMO_KEY';
}

// ---- pure helpers (unit-tested offline) ----
const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const now = () => new Date().toISOString();
const tag = (extra = {}) => ({ source: SRC, license: LICENSE, fetchedAt: now(), ...extra });

function fmtUsd(v) {
  if (v == null || !Number.isFinite(Number(v))) return '—';
  const n = Number(v);
  const abs = Math.abs(n);
  if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + (Math.round(n * 100) / 100).toString();
}

/** Build a URL with the api_key always attached (DEMO_KEY by default), plus the given params. */
function url(path, params = {}) {
  const p = new URLSearchParams();
  p.set('api_key', apiKey());
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    p.set(k, String(v));
  }
  return `${BASE}${path}?${p.toString()}`;
}

// ---- normalizers (pure) ----
export function normalizeCandidate(c) {
  if (!c || typeof c !== 'object') return null;
  const id = str(c.candidate_id);
  const name = str(c.name);
  if (!id && !name) return null;
  return tag({
    candidateId: id,
    name,
    party: str(c.party_full || c.party),
    office: str(c.office_full || c.office),
    state: str(c.state),
    district: str(c.district),
    incumbentChallenge: str(c.incumbent_challenge_full || c.incumbent_challenge),
    cycles: Array.isArray(c.cycles) ? c.cycles.map(num).filter((x) => x != null) : [],
    electionYears: Array.isArray(c.election_years) ? c.election_years.map(num).filter((x) => x != null) : [],
  });
}

export function normalizeCommittee(cm) {
  if (!cm || typeof cm !== 'object') return null;
  const id = str(cm.committee_id);
  if (!id) return null;
  return tag({
    committeeId: id,
    name: str(cm.name),
    designation: str(cm.designation_full || cm.designation),
    type: str(cm.committee_type_full || cm.committee_type),
    party: str(cm.party_full || cm.party),
  });
}

export function normalizeTotals(t) {
  if (!t || typeof t !== 'object') return null;
  return tag({
    candidateId: str(t.candidate_id),
    cycle: num(t.cycle),
    receipts: num(t.receipts),
    disbursements: num(t.disbursements),
    cashOnHandEnd: num(t.last_cash_on_hand_end_period),
    debtsOwed: num(t.last_debts_owed_by_committee),
    coverageEnd: str(t.coverage_end_date),
  });
}

// ---- live data (DEMO_KEY keyless; each fails soft to []/null) ----
async function getJson(u) {
  try {
    const r = await _fetch(u, { headers: { ...UA, Accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * Search candidates by name. Returns normalized candidate cards ([] on failure).
 * @param {{q:string, limit?:number, cycle?:number}} opts
 */
export async function candidateSearch({ q = '', limit = 20, cycle } = {}) {
  const query = str(q);
  if (!query) return [];
  const j = await getJson(url('/candidates/search/', {
    q: query, per_page: Math.max(1, Math.min(100, num(limit) || 20)), cycle: num(cycle), sort: 'name',
  }));
  const rows = Array.isArray(j?.results) ? j.results : [];
  return rows.map(normalizeCandidate).filter(Boolean);
}

/**
 * One candidate's detail by FEC candidate_id (e.g. 'S0MA00170'). Returns a card or null.
 * @param {string} candidateId
 */
export async function candidate(candidateId) {
  const id = str(candidateId);
  if (!id) return null;
  const j = await getJson(url(`/candidate/${encodeURIComponent(id)}/`, {}));
  const row = Array.isArray(j?.results) ? j.results[0] : null;
  return normalizeCandidate(row);
}

/**
 * Authorized committees for a candidate. Returns [] on failure.
 * @param {string} candidateId
 */
export async function committeesForCandidate(candidateId) {
  const id = str(candidateId);
  if (!id) return [];
  const j = await getJson(url(`/candidate/${encodeURIComponent(id)}/committees/`, { per_page: 100 }));
  const rows = Array.isArray(j?.results) ? j.results : [];
  return rows.map(normalizeCommittee).filter(Boolean);
}

/**
 * Per-cycle financial totals for a candidate (receipts, disbursements, cash on hand, debts).
 * Returns [] on failure, newest cycle first.
 * @param {string} candidateId
 * @param {{cycle?:number}} [opts]
 */
export async function candidateTotals(candidateId, { cycle } = {}) {
  const id = str(candidateId);
  if (!id) return [];
  const j = await getJson(url(`/candidate/${encodeURIComponent(id)}/totals/`, { cycle: num(cycle), per_page: 100, sort: '-cycle' }));
  const rows = Array.isArray(j?.results) ? j.results : [];
  return rows.map(normalizeTotals).filter(Boolean).sort((a, b) => (b.cycle || 0) - (a.cycle || 0));
}

// ---- rendering (escaped HTML; PURE) ----
/**
 * Escaped HTML for a candidate + their totals. PURE; soft-handles missing fields. Renders the FEC
 * numbers as facts only — no verdict, no "raised too much" framing.
 * @param {{candidate?:object, committees?:object[], totals?:object[]}} data
 */
export function renderPage(data = {}) {
  const c = data.candidate || {};
  const totals = Array.isArray(data.totals) ? data.totals : [];
  const committees = Array.isArray(data.committees) ? data.committees : [];
  const parts = [`<section class="fec-candidate"><h2>Campaign finance — public record</h2>`];
  parts.push(`<p class="fec-who"><strong>${esc(c.name || 'Candidate')}</strong> ${esc(c.party || '')} ${esc(c.office || '')}${c.state ? ' (' + esc(c.state) + (c.district ? '-' + esc(c.district) : '') + ')' : ''} — ${esc(c.candidateId || '')}</p>`);
  if (totals.length) {
    parts.push('<table class="fec-totals"><thead><tr><th>Cycle</th><th>Receipts</th><th>Disbursements</th><th>Cash on hand</th></tr></thead><tbody>');
    for (const t of totals) {
      parts.push(`<tr><td>${esc(t.cycle)}</td><td>${esc(fmtUsd(t.receipts))}</td><td>${esc(fmtUsd(t.disbursements))}</td><td>${esc(fmtUsd(t.cashOnHandEnd))}</td></tr>`);
    }
    parts.push('</tbody></table>');
  } else {
    parts.push('<p class="fec-empty">No totals reported.</p>');
  }
  if (committees.length) {
    parts.push('<ul class="fec-committees">');
    for (const cm of committees) parts.push(`<li>${esc(cm.name)} — ${esc(cm.designation || cm.type || '')} (${esc(cm.committeeId)})</li>`);
    parts.push('</ul>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names the FEC + public-domain status + amended-filing right of reply. */
export function dataNote() {
  return `source: ${SRC} (${LICENSE}); as filed with the FEC; filers correct via amended filings`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('fec.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'search') {
    const rows = await candidateSearch({ q: rest.join(' ') });
    console.log(`SoapBox FEC — ${rows.length} candidates match "${rest.join(' ')}" (key=${apiKey() === 'DEMO_KEY' ? 'DEMO_KEY' : 'set'})`);
    for (const r of rows.slice(0, 25)) console.log(`  • ${r.name} (${r.party}, ${r.office}-${r.state})  id=${r.candidateId}`);
    console.log(`  ${dataNote()}`);
  } else if (cmd === 'totals') {
    const id = rest[0];
    const totals = await candidateTotals(id, { cycle: rest[1] });
    const c = await candidate(id);
    console.log(`SoapBox FEC — totals for ${c ? c.name : id}`);
    for (const t of totals.slice(0, 10)) console.log(`  • cycle ${t.cycle}: receipts ${fmtUsd(t.receipts)}, disbursements ${fmtUsd(t.disbursements)}, COH ${fmtUsd(t.cashOnHandEnd)}`);
    console.log(`  ${dataNote()}`);
  } else if (cmd === 'committees') {
    const cms = await committeesForCandidate(rest[0]);
    console.log(`SoapBox FEC — ${cms.length} committees for ${rest[0]}`);
    for (const cm of cms) console.log(`  • ${cm.name} (${cm.designation || cm.type}) ${cm.committeeId}`);
    console.log(`  ${dataNote()}`);
  } else {
    console.log('usage: fec.mjs <search "name"|totals CANDIDATE_ID [cycle]|committees CANDIDATE_ID>');
    console.log(`  FEC_API_KEY ${process.env.FEC_API_KEY ? 'is set' : 'unset → using public DEMO_KEY'}`);
  }
}
