// elections-info.mjs — Civic-info reader (v3 §6A.3) over the Google Civic Information API's ELECTIONS
// surface: the `elections` list and the `voterinfo` lookup (Voting Information Project data). Reports
// actionable voting info — what elections are upcoming, and where/when/how to vote, register, and the
// applicable deadlines — for a given address.
//
//   ⚠ The Google Civic `representatives` endpoint is DEAD (retired April 2025) and is NOT used here.
//     Office-holder / "who represents me" data comes from congress-legislators.mjs + open-states.mjs,
//     NOT from this module. We only use the two surviving civic surfaces: `elections` and `voterinfo`.
//     See: developers.google.com/civic-information — representatives() returns 404/Gone since 2025-04.
//
// HARD RULES (v3 §6A.3 — non-negotiable, enforced in code below):
//   • OFFICIAL SOURCES ONLY for actionable voting info. The where/when/registration/deadline facts
//     surfaced here originate from election officials via the Voting Information Project feed that Google
//     Civic republishes. Every record is timestamped (fetchedAt), carries the upstream source link, and
//     carries an explicit `deferNote` — "verify with your local election officials" — that the renderer
//     always prints. We do NOT synthesize, infer, or "helpfully" fill in any voting fact.
//   • AUTO-EXPIRY. VIP/Google-Civic voter-info data is only valid through election day. Records dated
//     past their election are EXPIRED and dropped (see dropExpiredElections / voterInfo's expiry gate).
//     Stale voting instructions are worse than none, so an expired election yields [] / a null lookup.
//   • KEY BY NAME, SOFT-SKIP ABSENT. The key is read only by env NAME (GOOGLE_CIVIC_API_KEY). With no
//     key set, every live call soft-skips to []/null — never throws, never blocks the page.
//
// Pattern follows worldbank.mjs / fec.mjs: ESM, zero deps, __setFetch seam, soft-fail (return []/null,
// NEVER throw), injectable clock + data for tests, guarded CLI demo, escaped rendered HTML.
//
//   import { apiKey, hasKey, elections, voterInfo, dropExpiredElections, isExpired,
//            renderPage, dataNote, deferNote, __setFetch } from './elections-info.mjs'
//   GOOGLE_CIVIC_API_KEY=... node integrations/soapbox/elections-info.mjs elections
//   GOOGLE_CIVIC_API_KEY=... node integrations/soapbox/elections-info.mjs voterinfo "1600 Pennsylvania Ave, Washington DC"

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxCivic/1.0 (+https://data.soapbox.community)' };
const BASE = 'https://www.googleapis.com/civicinfo/v2';
const SRC = 'Google Civic Information API (Voting Information Project)';
const LICENSE = 'Google Civic / VIP republication; underlying data © election officials';

// The defer-to-officials note the renderer ALWAYS prints next to any actionable voting fact.
const DEFER = 'Verify all voting details with your local election officials — dates, locations, and rules change.';

// ---- key handling: env GOOGLE_CIVIC_API_KEY by NAME, soft-skip when absent (no DEMO_KEY exists) ----
/** The Google Civic key in effect, by env NAME, or '' when unset. */
export function apiKey() { return process.env.GOOGLE_CIVIC_API_KEY || ''; }
/** True only when a real key is present; live calls soft-skip to []/null otherwise. */
export function hasKey() { return !!apiKey(); }

// ---- pure helpers (unit-tested offline) ----
const str = (v) => (v == null ? '' : String(v)).trim();

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}
const now = () => new Date().toISOString();
const tag = (extra = {}) => ({ source: SRC, license: LICENSE, fetchedAt: now(), ...extra });

// Parse a Google Civic electionDay ('YYYY-MM-DD') into a UTC end-of-day epoch ms, or null.
// We use END of election day (23:59:59Z) so data is considered valid through the whole day.
function electionEndMs(electionDay) {
  const s = str(electionDay);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
}

/**
 * Auto-expiry gate (HARD RULE): is this election's voting data expired relative to `nowMs`?
 * An election with no parseable date is treated as NOT expired (we cannot prove it stale) but the
 * renderer's deferNote still applies. `nowMs` is injectable for deterministic tests.
 * @param {{electionDay?:string}} election
 * @param {number} [nowMs]  defaults to Date.now()
 */
export function isExpired(election, nowMs = Date.now()) {
  const end = electionEndMs(election && election.electionDay);
  if (end == null) return false;
  return nowMs > end;
}

/**
 * Drop elections whose election day has already passed (auto-expiry HARD RULE). PURE.
 * @param {object[]} list   normalized elections
 * @param {number} [nowMs]
 */
export function dropExpiredElections(list, nowMs = Date.now()) {
  if (!Array.isArray(list)) return [];
  return list.filter((e) => !isExpired(e, nowMs));
}

/** Normalize one raw Google Civic election entry. Returns null for unusable input. */
export function normalizeElection(e) {
  if (!e || typeof e !== 'object') return null;
  const id = str(e.id);
  const name = str(e.name);
  const electionDay = str(e.electionDay);
  if (!id && !name) return null;
  return tag({ id, name, electionDay, ocdDivisionId: str(e.ocdDivisionId) });
}

// ---- live data (key required; each soft-skips to []/null) ----
async function getJson(u) {
  try {
    const r = await _fetch(u, { headers: { ...UA, Accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}
function url(path, params = {}) {
  const p = new URLSearchParams();
  p.set('key', apiKey());
  for (const [k, v] of Object.entries(params)) { if (v == null || v === '') continue; p.set(k, String(v)); }
  return `${BASE}${path}?${p.toString()}`;
}

/**
 * Upcoming elections (the /elections list). Expired elections are dropped (auto-expiry HARD RULE).
 * Soft-skips to [] when no key is set or on any failure.
 * @param {{nowMs?:number}} [opts]  nowMs injectable for tests
 */
export async function elections({ nowMs = Date.now() } = {}) {
  if (!hasKey()) return [];
  const j = await getJson(url('/elections', {}));
  const rows = Array.isArray(j?.elections) ? j.elections : [];
  const norm = rows.map(normalizeElection).filter(Boolean);
  return dropExpiredElections(norm, nowMs);
}

/**
 * Voter information for an address (the /voterinfo lookup) — the actionable where/when/registration/
 * deadline surface. Returns a normalized record or null. AUTO-EXPIRY: if the resolved election has
 * already passed, returns null (stale voting instructions are dropped). Soft-skips to null without a key.
 *
 * The returned record carries `deferNote` (defer-to-officials), per-field `source` links lifted from
 * the VIP feed, and `fetchedAt`. The renderer always surfaces the deferNote.
 * @param {{address:string, electionId?:string|number, nowMs?:number}} opts
 */
export async function voterInfo({ address = '', electionId, nowMs = Date.now() } = {}) {
  if (!hasKey()) return null;
  const addr = str(address);
  if (!addr) return null;
  const j = await getJson(url('/voterinfo', { address: addr, electionId }));
  if (!j || typeof j !== 'object') return null;

  const election = normalizeElection(j.election);
  // AUTO-EXPIRY HARD RULE: never hand back voting instructions for a past election.
  if (election && isExpired(election, nowMs)) return null;

  // Pull only the official-source actionable fields. Each pollingLocations/early entry from VIP carries
  // its own `sources` array (the election official who published it) — we keep those links verbatim.
  const norm = (loc) => loc && typeof loc === 'object' ? {
    address: formatCivicAddress(loc.address),
    hours: str(loc.pollingHours),
    name: str(loc.name),
    notes: str(loc.notes),
    sources: Array.isArray(loc.sources)
      ? loc.sources.map((s) => ({ name: str(s && s.name), official: !!(s && s.official) })).filter((s) => s.name)
      : [],
  } : null;

  return tag({
    election,
    pollingLocations: (Array.isArray(j.pollingLocations) ? j.pollingLocations : []).map(norm).filter(Boolean),
    earlyVoteSites: (Array.isArray(j.earlyVoteSites) ? j.earlyVoteSites : []).map(norm).filter(Boolean),
    dropOffLocations: (Array.isArray(j.dropOffLocations) ? j.dropOffLocations : []).map(norm).filter(Boolean),
    // election-administration links: registration URL, ballot info, deadlines, official body.
    administration: normalizeAdministration(j.state),
    deferNote: DEFER,
  });
}

// Flatten a Google Civic address {locationName,line1,city,state,zip} into a one-line string.
function formatCivicAddress(a) {
  if (!a || typeof a !== 'object') return '';
  return [str(a.locationName), str(a.line1), str(a.line2), str(a.line3),
    [str(a.city), str(a.state), str(a.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}

// Pull the official election-administration body + its actionable links (registration / deadlines).
// Shape: j.state[0].electionAdministrationBody.{electionRegistrationUrl, electionInfoUrl, ...}.
function normalizeAdministration(stateArr) {
  const body = Array.isArray(stateArr) && stateArr[0] && stateArr[0].electionAdministrationBody;
  if (!body || typeof body !== 'object') return null;
  return {
    name: str(body.name),
    registrationUrl: str(body.electionRegistrationUrl),
    registrationConfirmationUrl: str(body.electionRegistrationConfirmationUrl),
    infoUrl: str(body.electionInfoUrl),
    absenteeUrl: str(body.absenteeVotingInfoUrl),
    ballotInfoUrl: str(body.ballotInfoUrl),
    rulesUrl: str(body.electionRulesUrl),
    official: true, // these come from the election-administration body in the VIP feed
  };
}

// ---- rendering (escaped HTML; PURE; ALWAYS prints the defer-to-officials note) ----
/**
 * Escaped HTML for an elections list OR a voterInfo record. PURE; soft-handles missing fields.
 * For voter info, the defer-to-officials note is ALWAYS rendered alongside the actionable facts.
 * @param {object|object[]} data  elections() array OR a voterInfo() record
 */
export function renderPage(data) {
  // Elections list view
  if (Array.isArray(data)) {
    const parts = ['<section class="civic-elections"><h2>Upcoming elections</h2>'];
    if (data.length) {
      parts.push('<table class="ce-list"><thead><tr><th>Election</th><th>Date</th></tr></thead><tbody>');
      for (const e of data) parts.push(`<tr><td>${esc(e.name)}</td><td>${esc(e.electionDay)}</td></tr>`);
      parts.push('</tbody></table>');
    } else {
      parts.push('<p class="ce-empty">No upcoming elections available.</p>');
    }
    parts.push(`<p class="defer-note">${esc(DEFER)}</p>`);
    parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
    return parts.join('');
  }

  // Voter-info view
  const v = data || {};
  const e = v.election || {};
  const parts = ['<section class="civic-voterinfo"><h2>Voting information</h2>'];
  if (e.name || e.electionDay) parts.push(`<p class="ce-election"><strong>${esc(e.name)}</strong> — ${esc(e.electionDay)}</p>`);
  const a = v.administration;
  if (a) {
    parts.push('<ul class="ce-admin">');
    if (a.name) parts.push(`<li>Administered by: ${esc(a.name)}</li>`);
    if (a.registrationUrl) parts.push(`<li>Register / check registration: <a href="${esc(a.registrationUrl)}" rel="nofollow noopener">official link</a></li>`);
    if (a.infoUrl) parts.push(`<li>Election info: <a href="${esc(a.infoUrl)}" rel="nofollow noopener">official link</a></li>`);
    if (a.absenteeUrl) parts.push(`<li>Absentee / mail voting: <a href="${esc(a.absenteeUrl)}" rel="nofollow noopener">official link</a></li>`);
    parts.push('</ul>');
  }
  const renderLocs = (label, locs) => {
    if (!Array.isArray(locs) || !locs.length) return;
    parts.push(`<h3>${esc(label)}</h3><ul class="ce-locs">`);
    for (const l of locs) parts.push(`<li>${esc(l.name || l.address)}${l.hours ? ' — ' + esc(l.hours) : ''}</li>`);
    parts.push('</ul>');
  };
  renderLocs('Polling locations', v.pollingLocations);
  renderLocs('Early voting sites', v.earlyVoteSites);
  renderLocs('Ballot drop-off', v.dropOffLocations);
  if (!e.name && !a && !(v.pollingLocations && v.pollingLocations.length)) {
    parts.push('<p class="ce-empty">No voter information available for this address.</p>');
  }
  // HARD RULE: the defer-to-officials note is always present.
  parts.push(`<p class="defer-note">${esc(v.deferNote || DEFER)}</p>`);
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** The defer-to-officials note (exported so callers/tests can assert it is enforced). */
export function deferNote() { return DEFER; }

/** Provenance line — names Google Civic / VIP, the official-source origin, and the expiry caveat. */
export function dataNote() {
  return `source: ${SRC}; actionable voting info originates from election officials via VIP; data valid only through election day`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('elections-info.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!hasKey()) {
    console.log('GOOGLE_CIVIC_API_KEY unset → live calls soft-skip. Set it (by name) to query the Google Civic elections/voterinfo surface.');
  }
  if (cmd === 'voterinfo') {
    const v = await voterInfo({ address: rest.join(' ') });
    if (!v) { console.log('no voter info (no key, no data, or expired election)'); }
    else {
      console.log(`SoapBox civic — voter info for "${rest.join(' ')}"`);
      console.log(`  election: ${v.election ? v.election.name + ' (' + v.election.electionDay + ')' : '—'}`);
      if (v.administration) console.log(`  admin: ${v.administration.name}  register=${v.administration.registrationUrl || '—'}`);
      console.log(`  polling=${v.pollingLocations.length} early=${v.earlyVoteSites.length} dropoff=${v.dropOffLocations.length}`);
      console.log(`  ⚠ ${v.deferNote}`);
    }
  } else {
    const es = await elections();
    console.log(`SoapBox civic — ${es.length} upcoming election(s)`);
    for (const e of es) console.log(`  • ${e.name} — ${e.electionDay} (id=${e.id})`);
    console.log(`  ⚠ ${DEFER}`);
  }
  console.log(`  ${dataNote()}`);
}
