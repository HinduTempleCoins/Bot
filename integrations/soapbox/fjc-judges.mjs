// fjc-judges.mjs — Accountability Graph JUDICIARY reader (v3 §6A.3) over the Federal Judicial Center's
// Biographical Directory of Article III Federal Judges. Complements courtlistener-judges.mjs (the
// CourtListener API view of the judiciary) with the FJC's authoritative, FULLY KEYLESS bulk export.
//
//   THE ACTUAL FJC SHAPE (documented here, implemented against fixtures):
//   The FJC publishes the directory as bulk downloads at  https://www.fjc.gov/history/judges
//   under "Export the complete directory". The canonical machine file is the CSV
//     https://www.fjc.gov/sites/default/files/history/judges.csv
//   (a JSON sibling is also offered via the site's export UI). It is FLAT and DENORMALIZED: ONE ROW PER
//   (judge × appointment), so a judge who held two Article III seats appears in multiple rows joined by a
//   stable `nid` (the FJC node id). Real column headers include:
//     nid, "Last Name","First Name","Middle Name","Suffix","Birth Year","Death Year",
//     "Court Type (1)","Court Name (1)","Appointment Title (1)","Appointing President (1)",
//     "Party of Appointing President (1)","Nomination Date (1)","Confirmation Date (1)",
//     "Commission Date (1)","Termination Date (1)","Termination Reason (1)", … (2),(3)… repeated per seat
//     within the same row, AND additionally as separate rows in the long-form export.
//   This reader targets the LONG-FORM one-row-per-appointment export (the simplest stable shape):
//   columns nid, judge name parts, birth/death year, and the (1)-suffixed appointment block. We coalesce
//   rows sharing a nid back into one judge card with an appointments[] array. No key, ever.
//
// DISCIPLINE (v3 §6A.3 — non-negotiable):
//   • FACTS + CONNECTIONS ONLY. Who served on which Article III court, when, appointed by whom. No
//     verdicts, no characterization of rulings or temperament.
//   • PUBLIC-CAPACITY DATA ONLY. Judicial service facts. (Birth/death year is part of the FJC record.)
//   • LINK EVERY SOURCE. Each card carries source + license (FJC = U.S.-Gov public domain) + fetchedAt
//     + the fjc.gov biography URL (https://www.fjc.gov/node/<nid>).
//   • RIGHT OF REPLY. Corrections route to the FJC, the authoritative maintainer.
//
// Pattern follows congress-legislators.mjs: ESM, zero deps, KEYLESS, __setFetch seam, soft-fail (return
// []/null, NEVER throw), injectable data for tests, guarded CLI, escaped HTML. CSV is parsed by a small
// RFC-4180-ish reader (no deps); a JSON export is also accepted.
//
//   import { judges, findByNid, findByName, parseCsv, normalizeRows, bioUrl,
//            renderPage, dataNote, SOURCE_URL, __setFetch } from './fjc-judges.mjs'
//   node integrations/soapbox/fjc-judges.mjs name "Ginsburg"
//   node integrations/soapbox/fjc-judges.mjs nid 1392736

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxFJC/1.0 (+https://data.soapbox.community)' };
const SRC = 'Federal Judicial Center — Biographical Directory of Article III Federal Judges';
const LICENSE = 'U.S. Government work (public domain)';
/** The keyless FJC bulk CSV export (long form, one row per appointment). */
export const SOURCE_URL = 'https://www.fjc.gov/sites/default/files/history/judges.csv';
/** Per-judge biography page on fjc.gov, keyed by the FJC node id. */
export function bioUrl(nid) { return nid ? `https://www.fjc.gov/node/${encodeURIComponent(String(nid))}` : ''; }

// ---- pure helpers (unit-tested offline) ----
const str = (v) => (v == null ? '' : String(v)).trim();
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const now = () => new Date().toISOString();
const tag = (extra = {}) => ({ source: SRC, license: LICENSE, fetchedAt: now(), ...extra });

/**
 * Minimal RFC-4180-ish CSV parser (zero deps): handles quoted fields, embedded commas/quotes/newlines,
 * and a header row. Returns an array of objects keyed by header. Soft-returns [] for empty/garbage input.
 * @param {string} text
 */
export function parseCsv(text) {
  const s = String(text == null ? '' : text);
  if (!s.trim()) return [];
  const rows = [];
  let field = '', row = [], inQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      // handle \r\n as one break
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  // flush trailing field/row (no terminating newline)
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return [];
  const header = rows[0].map((h) => str(h));
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === '') continue; // skip blank lines
    const obj = {};
    for (let c = 0; c < header.length; c++) obj[header[c]] = rows[r][c] != null ? rows[r][c] : '';
    out.push(obj);
  }
  return out;
}

// FJC long-form column accessors (tolerant of header variants / the JSON export's snake_case keys).
function pick(rowObj, ...keys) {
  for (const k of keys) {
    if (rowObj[k] != null && str(rowObj[k]) !== '') return str(rowObj[k]);
  }
  return '';
}

/** Normalize one long-form FJC row (judge × appointment) into a flat appointment record + name/nid. */
function normalizeRow(r) {
  if (!r || typeof r !== 'object') return null;
  const nid = pick(r, 'nid', 'Nid', 'node_id');
  const last = pick(r, 'Last Name', 'last_name', 'lastName');
  const first = pick(r, 'First Name', 'first_name', 'firstName');
  const middle = pick(r, 'Middle Name', 'middle_name', 'middleName');
  const suffix = pick(r, 'Suffix', 'suffix');
  const name = [first, middle, last].filter(Boolean).join(' ') + (suffix ? ' ' + suffix : '');
  if (!nid && !name.trim()) return null;
  return {
    nid,
    name: name.trim(),
    last, first,
    birthYear: pick(r, 'Birth Year', 'birth_year', 'birthYear'),
    deathYear: pick(r, 'Death Year', 'death_year', 'deathYear'),
    appointment: {
      courtType: pick(r, 'Court Type (1)', 'court_type', 'courtType'),
      court: pick(r, 'Court Name (1)', 'court_name', 'courtName', 'Court Name'),
      title: pick(r, 'Appointment Title (1)', 'appointment_title', 'title'),
      president: pick(r, 'Appointing President (1)', 'appointing_president', 'president'),
      presidentParty: pick(r, 'Party of Appointing President (1)', 'party_of_appointing_president'),
      nominationDate: pick(r, 'Nomination Date (1)', 'nomination_date'),
      confirmationDate: pick(r, 'Confirmation Date (1)', 'confirmation_date'),
      commissionDate: pick(r, 'Commission Date (1)', 'commission_date'),
      terminationDate: pick(r, 'Termination Date (1)', 'termination_date'),
      terminationReason: pick(r, 'Termination Reason (1)', 'termination_reason'),
    },
  };
}

/**
 * Coalesce long-form rows (one per appointment) into one card per judge (keyed by nid, or by name when a
 * nid is missing), with an appointments[] array. PURE. Returns [] for unusable input.
 * @param {object[]} rawRows  parsed CSV/JSON rows
 */
export function normalizeRows(rawRows) {
  if (!Array.isArray(rawRows)) return [];
  const byKey = new Map();
  for (const raw of rawRows) {
    const n = normalizeRow(raw);
    if (!n) continue;
    const key = n.nid || `name:${n.name.toLowerCase()}`;
    if (!byKey.has(key)) {
      byKey.set(key, tag({
        nid: n.nid, name: n.name, last: n.last, first: n.first,
        birthYear: n.birthYear, deathYear: n.deathYear,
        url: bioUrl(n.nid), appointments: [],
      }));
    }
    const card = byKey.get(key);
    // only push an appointment if it carries any content
    if (Object.values(n.appointment).some((v) => v)) card.appointments.push(n.appointment);
  }
  return [...byKey.values()];
}

// ---- live data (keyless; soft-fail to []) ----
async function getText(url) {
  try {
    const r = await _fetch(url, { headers: UA });
    if (!r || !r.ok) return null;
    return await r.text();
  } catch { return null; }
}

/**
 * The full Article III biographical directory as judge cards. Accepts either the CSV export (default) or
 * a JSON export (auto-detected by leading '[' / '{'). Returns [] on any failure.
 */
export async function judges() {
  const text = await getText(SOURCE_URL);
  if (text == null) return [];
  const trimmed = text.trimStart();
  let rows;
  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(text);
      rows = Array.isArray(j) ? j : (Array.isArray(j.results) ? j.results : []);
    } catch { return []; }
  } else {
    rows = parseCsv(text);
  }
  return normalizeRows(rows);
}

/** One judge by FJC nid, or null. */
export async function findByNid(nid) {
  const want = str(nid);
  if (!want) return null;
  const all = await judges();
  return all.find((j) => j.nid === want) || null;
}

/** Judges whose name contains the query (case-insensitive substring over full + last name). [] on miss. */
export async function findByName(q) {
  const needle = str(q).toLowerCase();
  if (!needle) return [];
  const all = await judges();
  return all.filter((j) => j.name.toLowerCase().includes(needle) || j.last.toLowerCase().includes(needle));
}

// ---- rendering (escaped HTML; PURE) ----
/**
 * Escaped HTML for a list of judge cards OR a single card. PURE; soft-handles missing fields.
 * Renders the FJC service record as facts only — court, title, appointing president, dates.
 * @param {object|object[]} data
 */
export function renderPage(data) {
  const list = Array.isArray(data) ? data : (data ? [data] : []);
  const parts = ['<section class="fjc-judges"><h2>Article III federal judges — public record</h2>'];
  if (!list.length) {
    parts.push('<p class="fjc-empty">No judges found.</p>');
  } else {
    for (const j of list) {
      const years = [j.birthYear, j.deathYear].some(Boolean) ? ` (${esc(j.birthYear || '?')}–${esc(j.deathYear || '')})` : '';
      parts.push(`<div class="fjc-judge"><h3>${esc(j.name)}${years}</h3>`);
      if (Array.isArray(j.appointments) && j.appointments.length) {
        parts.push('<table class="fjc-appts"><thead><tr><th>Court</th><th>Title</th><th>Appointed by</th><th>Commission</th><th>Terminated</th></tr></thead><tbody>');
        for (const a of j.appointments) {
          parts.push(`<tr><td>${esc(a.court)}</td><td>${esc(a.title)}</td><td>${esc(a.president)}${a.presidentParty ? ' (' + esc(a.presidentParty) + ')' : ''}</td><td>${esc(a.commissionDate)}</td><td>${esc(a.terminationDate)}${a.terminationReason ? ' — ' + esc(a.terminationReason) : ''}</td></tr>`);
        }
        parts.push('</tbody></table>');
      }
      parts.push('</div>');
    }
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names the FJC + public-domain status + the corrections path. */
export function dataNote() {
  return `source: ${SRC} (${LICENSE}); biographical service record; corrections via fjc.gov`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('fjc-judges.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'nid') {
    const j = await findByNid(rest[0]);
    console.log(j ? JSON.stringify({ ...j, fetchedAt: undefined }, null, 2) : 'not found');
  } else if (cmd === 'name') {
    const rows = await findByName(rest.join(' '));
    console.log(`SoapBox FJC — ${rows.length} judge(s) match "${rest.join(' ')}"`);
    for (const j of rows.slice(0, 25)) {
      const a = (j.appointments || [])[0] || {};
      console.log(`  • ${j.name} — ${a.court || '?'} (${a.title || '?'}), appt. ${a.president || '?'}  nid=${j.nid}`);
    }
    console.log(`  ${dataNote()}`);
  } else {
    const all = await judges();
    console.log(`SoapBox FJC — ${all.length} Article III judges`);
    for (const j of all.slice(0, 20)) console.log(`  • ${j.name} (${j.appointments.length} seat(s))  nid=${j.nid}`);
    console.log('usage: fjc-judges.mjs <name "X"|nid NID>');
    console.log(`  ${dataNote()}`);
  }
}
