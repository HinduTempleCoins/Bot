// courtlistener-judges.mjs — Accountability Graph base reader (v3 §6A.2) over CourtListener's REST v4
// people/positions endpoints (courtlistener.com/api/rest/v4), the Free Law Project's open judicial
// database. KEYLESS at a low rate; a personal token (env COURTLISTENER_TOKEN, by name, sent as
// "Authorization: Token …") raises the rate but is OPTIONAL. Surfaces: judge profile, the positions
// they have held (courts + appointment), who appointed them, a count of authored opinions, and
// pointers to their financial-disclosure records.
//
// DISCIPLINE (v3 §6A.2 — non-negotiable):
//   • FACTS + CONNECTIONS ONLY. Where a judge sits, when, who appointed them, how many opinions they
//     authored, where their disclosures live. NO verdict on their rulings, no ideology score, no
//     characterization. The positions and counts are the facts.
//   • PUBLIC-CAPACITY DATA ONLY. Judges acting in judicial office. We surface pointers to financial
//     disclosures (themselves public records), not the private financial detail.
//   • LINK EVERY SOURCE. Each record carries source + license (Free Law Project / CourtListener) +
//     fetchedAt, plus the CourtListener resource URL. courtlistener.com is the citable origin.
//   • RIGHT OF REPLY. Judges/courts dispute via Free Law Project; this mirrors the open database.
//
// Pattern follows worldbank.mjs / gov-readers.mjs: ESM, zero deps, __setFetch seam, soft-fail (return
// []/null, NEVER throw), injectable data for tests, guarded CLI demo, escaped rendered HTML.
//
//   import { searchJudges, judgeProfile, judgePositions, authoredOpinionCount,
//            financialDisclosures, renderPage, dataNote, __setFetch } from './courtlistener-judges.mjs'
//   node integrations/soapbox/courtlistener-judges.mjs search "Sotomayor"
//   node integrations/soapbox/courtlistener-judges.mjs profile 2724

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxCourtListener/1.0 (+https://data.soapbox.community)' };
const BASE = 'https://www.courtlistener.com/api/rest/v4';
const SRC = 'CourtListener (Free Law Project)';
const LICENSE = 'CourtListener API — Free Law Project (attribution)';

// ---- key handling: env COURTLISTENER_TOKEN by NAME, optional (keyless works at lower rate) ----
function authHeaders() {
  const key = process.env.COURTLISTENER_TOKEN;
  return key ? { ...UA, Accept: 'application/json', Authorization: `Token ${key}` }
             : { ...UA, Accept: 'application/json' };
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

// CourtListener id fields come back as resource URLs like ".../people/2724/"; pull the numeric id.
export function idFromUrl(u) {
  const m = String(u || '').match(/\/(\d+)\/?$/);
  return m ? m[1] : '';
}

// Court ids are alphanumeric slugs (e.g. "ca2", "scotus"), not numbers — pull the last path segment.
export function slugFromUrl(u) {
  const m = String(u || '').match(/\/([^/]+)\/?$/);
  return m ? m[1] : '';
}

/** Assemble a person's display name from the v4 name parts. */
function personName(p) {
  return [str(p.name_first), str(p.name_middle), str(p.name_last)].filter(Boolean).join(' ').trim()
    || str(p.name_full) || str(p.slug);
}

/**
 * Normalize a raw v4 `people` record → a flat judge profile card. Returns null for unusable input.
 */
export function normalizeJudge(p) {
  if (!p || typeof p !== 'object') return null;
  const id = p.id != null ? String(p.id) : idFromUrl(p.resource_uri);
  const name = personName(p);
  if (!id && !name) return null;
  return tag({
    personId: id,
    name,
    dateBorn: str(p.date_dob),
    positionCount: Array.isArray(p.positions) ? p.positions.length : null,
    resourceUrl: id ? `${BASE}/people/${id}/` : '',
    fjcId: p.fjc_id != null ? String(p.fjc_id) : '',
    hasFinancialDisclosures: Array.isArray(p.financial_disclosures) ? p.financial_disclosures.length > 0 : null,
  });
}

/**
 * Normalize a raw v4 `positions` record → a flat position card (court + appointment facts).
 */
export function normalizePosition(pos) {
  if (!pos || typeof pos !== 'object') return null;
  return tag({
    positionType: str(pos.position_type),
    court: str(pos.court_str) || slugFromUrl(pos.court),
    dateStart: str(pos.date_start),
    dateTermination: str(pos.date_termination),
    appointer: idFromUrl(pos.appointer), // a position id of the appointing official, per CourtListener
    howSelected: str(pos.how_selected),
    nominationProcess: str(pos.nomination_process),
  });
}

// ---- live data (keyless; each fails soft to []/null) ----
async function getJson(u) {
  try {
    const r = await _fetch(u, { headers: authHeaders() });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function apiUrl(path, params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    p.set(k, String(v));
  }
  const qs = p.toString();
  return `${BASE}${path}${qs ? '?' + qs : ''}`;
}

/**
 * Search judges by name. Returns normalized judge cards ([] on failure).
 * @param {{q:string, limit?:number}} opts
 */
export async function searchJudges({ q = '', limit = 20 } = {}) {
  const query = str(q);
  if (!query) return [];
  const j = await getJson(apiUrl('/people/', { name_last: query, page_size: Math.max(1, Math.min(100, num(limit) || 20)) }));
  const rows = Array.isArray(j?.results) ? j.results : [];
  return rows.map(normalizeJudge).filter(Boolean);
}

/**
 * Full profile for one judge by CourtListener person id. Returns a card or null.
 * @param {string|number} personId
 */
export async function judgeProfile(personId) {
  const id = str(personId);
  if (!id) return null;
  const j = await getJson(apiUrl(`/people/${encodeURIComponent(id)}/`, {}));
  return normalizeJudge(j);
}

/**
 * Positions (judicial seats, with appointment facts) held by a judge. Returns [] on failure.
 * @param {string|number} personId
 */
export async function judgePositions(personId) {
  const id = str(personId);
  if (!id) return [];
  const j = await getJson(apiUrl('/positions/', { person: id, page_size: 100 }));
  const rows = Array.isArray(j?.results) ? j.results : [];
  return rows.map(normalizePosition).filter(Boolean);
}

/**
 * Count of opinions authored by a judge (uses the opinions endpoint's `count` envelope field).
 * Returns a number, or null on failure.
 * @param {string|number} personId
 */
export async function authoredOpinionCount(personId) {
  const id = str(personId);
  if (!id) return null;
  const j = await getJson(apiUrl('/opinions/', { author: id, page_size: 1 }));
  return j && j.count != null ? num(j.count) : null;
}

/**
 * Pointers to a judge's public financial-disclosure records. Returns [{ id, year, url }] ([] on failure).
 * We surface POINTERS only (year + CourtListener resource URL), not the line-item private detail.
 * @param {string|number} personId
 */
export async function financialDisclosures(personId) {
  const id = str(personId);
  if (!id) return [];
  const j = await getJson(apiUrl('/financial-disclosures/', { person: id, page_size: 100 }));
  const rows = Array.isArray(j?.results) ? j.results : [];
  return rows.map((d) => {
    const did = d.id != null ? String(d.id) : idFromUrl(d.resource_uri);
    if (!did) return null;
    return tag({ disclosureId: did, year: num(d.year), url: `${BASE}/financial-disclosures/${did}/` });
  }).filter(Boolean);
}

// ---- rendering (escaped HTML; PURE) ----
/**
 * Escaped HTML for a judge profile + positions + opinion count + disclosure pointers. PURE; soft-handles
 * missing fields. Renders facts only — seats, appointment, counts, links — never any verdict.
 * @param {{judge?:object, positions?:object[], opinionCount?:number, disclosures?:object[]}} data
 */
export function renderPage(data = {}) {
  const j = data.judge || {};
  const positions = Array.isArray(data.positions) ? data.positions : [];
  const disclosures = Array.isArray(data.disclosures) ? data.disclosures : [];
  const parts = ['<section class="cl-judge"><h2>Judge — public record</h2>'];
  parts.push(`<p class="cl-who"><strong>${esc(j.name || 'Judge')}</strong>${j.personId ? ' (CourtListener #' + esc(j.personId) + ')' : ''}</p>`);
  if (data.opinionCount != null) parts.push(`<p class="cl-opinions">Authored opinions on record: ${esc(data.opinionCount)}</p>`);
  if (positions.length) {
    parts.push('<table class="cl-positions"><thead><tr><th>Position</th><th>Court</th><th>Start</th><th>End</th><th>Selection</th></tr></thead><tbody>');
    for (const p of positions) {
      parts.push(`<tr><td>${esc(p.positionType)}</td><td>${esc(p.court)}</td><td>${esc(p.dateStart)}</td><td>${esc(p.dateTermination || '—')}</td><td>${esc(p.howSelected)}</td></tr>`);
    }
    parts.push('</tbody></table>');
  } else {
    parts.push('<p class="cl-empty">No positions on record.</p>');
  }
  if (disclosures.length) {
    parts.push('<p class="cl-disclosures">Financial disclosures (public records): ');
    parts.push(disclosures.map((d) => `<a href="${esc(d.url)}">${esc(d.year || d.disclosureId)}</a>`).join(', '));
    parts.push('</p>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names CourtListener / Free Law Project + the right-of-reply path. */
export function dataNote() {
  return `source: ${SRC} (${LICENSE}); public judicial-office record; corrections via Free Law Project`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('courtlistener-judges.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  if (cmd === 'search') {
    const rows = await searchJudges({ q: arg });
    console.log(`SoapBox CourtListener — ${rows.length} judges match "${arg}" ${process.env.COURTLISTENER_TOKEN ? '(token)' : '(keyless)'}`);
    for (const r of rows.slice(0, 25)) console.log(`  • ${r.name} (#${r.personId})  positions=${r.positionCount ?? '?'}`);
    console.log(`  ${dataNote()}`);
  } else if (cmd === 'profile') {
    const id = rest[0];
    const judge = await judgeProfile(id);
    const positions = await judgePositions(id);
    const opinionCount = await authoredOpinionCount(id);
    const disclosures = await financialDisclosures(id);
    console.log(`SoapBox CourtListener — ${judge ? judge.name : id}`);
    console.log(`  authored opinions: ${opinionCount ?? '?'}`);
    for (const p of positions) console.log(`  • ${p.positionType} @ ${p.court} (${p.dateStart || '?'}→${p.dateTermination || 'present'})`);
    for (const d of disclosures) console.log(`  • disclosure ${d.year}: ${d.url}`);
    console.log(`  ${dataNote()}`);
  } else {
    console.log('usage: courtlistener-judges.mjs <search "name"|profile PERSON_ID>');
    console.log(`  COURTLISTENER_TOKEN ${process.env.COURTLISTENER_TOKEN ? 'is set' : 'unset → keyless low-rate reads'}`);
  }
}
