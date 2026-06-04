// elections-civic.mjs — Elections & civic-information reader (v3 §6A.3). The live, time-aware face:
// sitting officeholders, candidates, what's on your ballot, where/when to vote, and results STATUS.
//
// This is the UNIFIED §6A.3 surface. It does not duplicate the lower-level readers — it stands one
// layer above them with the §6A.3 hard rules baked in, and delegates shape to the open backbone:
//   • officeholders  → @unitedstates/congress-legislators (CC0, keyless GitHub raw) for federal;
//                      Open States (key by ENV NAME) for state. (see congress-legislators.mjs / open-states.mjs)
//   • whatsOnBallot  → Voting Information Project (VIP) contests, via the injectable VIP endpoint.
//   • whereToVote    → VIP polling / early-vote / drop-off locations.
//   • candidates     → FEC candidate search shape.
//   • resultsStatus  → certification GUARD only — this module DOES NOT call races.
//
// ── HARD RULES (v3 §6A.3 — load-bearing, enforced in code, not just commented) ──────────────────
//  1. OFFICIAL-ONLY ACTIONABLE VOTING INFO. where/when to vote, registration, deadlines, ballot
//     contests return ONLY data that carries an official source. Every actionable item is stamped
//     { source, sourceUrl, asOf } and an `official:true` flag. If there is NO official source, we
//     return null + an honest "check your local election office" pointer. We NEVER guess or synthesize.
//  2. NO RACE-CALLING. Election results come only from certified/official feeds. This module does NOT
//     call races and does NOT present uncertified counts as final. `resultsStatus()` returns
//     { certified:boolean } and REFUSES to label a winner when certified === false.
//  3. AUTO-EXPIRY. Ballot / voter info auto-expires after the election date — we never serve a stale
//     polling place. An expired electionDate yields null (whatsOnBallot / whereToVote both gate on it).
//
// ── KEYS / SECRETS ──────────────────────────────────────────────────────────────────────────────
//   NO secrets in this file. API keys are referenced by ENV NAME only and read at call time:
//     VIP_API_KEY (Voting Information Project / Google Civic voterinfo), OPENSTATES_API_KEY (state),
//     FEC_API_KEY (candidates; DEMO_KEY fallback). With a key absent, the live call soft-skips.
//
// Pattern follows macro.mjs / gov-readers.mjs / congress-legislators.mjs: ESM, zero deps, __setFetch
// seam, soft-fail (return []/null, NEVER throw), injectable clock, escaped HTML, guarded CLI demo.
//
//   import { officeholders, whatsOnBallot, whereToVote, candidates, resultsStatus,
//            localElectionOfficePointer, renderPage, dataNote, __setFetch } from './elections-civic.mjs'
//   node integrations/soapbox/elections-civic.mjs officeholders TX
//   FEC_API_KEY=... node integrations/soapbox/elections-civic.mjs candidates "Senate" 2026

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxCivic/1.0 (+https://data.soapbox.community)' };

// Open backbone endpoints (fixed, citable). VIP/Open States base paths; keys appended by ENV NAME.
const CL_RAW = 'https://raw.githubusercontent.com/unitedstates/congress-legislators/main';
const VIP_BASE = 'https://www.googleapis.com/civicinfo/v2'; // VIP-backed voterinfo (Google Civic)
const OPENSTATES_BASE = 'https://v3.openstates.org';
const FEC_BASE = 'https://api.open.fec.gov/v1';

// The honest fallback we hand back whenever there is no official source for actionable voting info.
const LOCAL_OFFICE = 'Check your local election office for official polling places, dates, and rules.';
const LOCAL_OFFICE_URL = 'https://www.usa.gov/election-office';

// ── pure helpers ────────────────────────────────────────────────────────────────────────────────
const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : undefined; };
const now = () => new Date().toISOString();

export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Env keys by NAME (read at call time so tests can set/unset; never inlined). '' when absent.
const vipKey = () => process.env.VIP_API_KEY || process.env.GOOGLE_CIVIC_API_KEY || '';
const openStatesKey = () => process.env.OPENSTATES_API_KEY || '';
const fecKey = () => process.env.FEC_API_KEY || 'DEMO_KEY';

/** The honest "no official source → go here" pointer. Carries official:true (it IS official guidance). */
export function localElectionOfficePointer() {
  return { official: true, source: 'USA.gov election office locator', sourceUrl: LOCAL_OFFICE_URL, note: LOCAL_OFFICE, asOf: now() };
}

// Parse an election date ('YYYY-MM-DD') to end-of-day UTC epoch ms (valid through the whole day), or null.
function electionEndMs(electionDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(electionDate));
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
}

/**
 * AUTO-EXPIRY HARD RULE: is voter/ballot data for `electionDate` past its election day relative to nowMs?
 * A missing/unparseable date is treated as NOT expired (cannot prove stale). PURE; nowMs injectable.
 * @param {string} electionDate  'YYYY-MM-DD'
 * @param {number} [nowMs]
 */
export function isExpired(electionDate, nowMs = Date.now()) {
  const end = electionEndMs(electionDate);
  if (end == null) return false;
  return nowMs > end;
}

// stamp an OFFICIAL actionable item with the provenance the hard rule requires.
function officialTag(source, sourceUrl) {
  return { official: true, source: str(source), sourceUrl: str(sourceUrl), asOf: now() };
}

// ── low-level fetch (soft-fail) ───────────────────────────────────────────────────────────────────
async function getJson(u, headers = {}) {
  try {
    const r = await _fetch(u, { headers: { ...UA, Accept: 'application/json', ...headers } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}
function withParams(base, params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { if (v == null || v === '') continue; p.set(k, String(v)); }
  const qs = p.toString();
  return qs ? `${base}?${qs}` : base;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  OFFICEHOLDERS — sitting officeholders (facts only; no verdicts)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/** Normalize one @unitedstates/congress-legislators record to a flat officeholder card. null if unusable. */
export function normalizeFederalOfficeholder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id || {};
  const name = raw.name || {};
  const terms = Array.isArray(raw.terms) ? raw.terms : [];
  const cur = terms.length ? terms[terms.length - 1] : {};
  const bioguide = str(id.bioguide);
  const full = str(name.official_full) || [str(name.first), str(name.last)].filter(Boolean).join(' ');
  if (!bioguide && !full) return null;
  return {
    name: full,
    bioguide,
    level: 'federal',
    chamber: cur.type === 'sen' ? 'Senate' : cur.type === 'rep' ? 'House' : str(cur.type),
    state: str(cur.state).toUpperCase(),
    district: cur.district != null ? String(cur.district) : '',
    party: str(cur.party),
    termStart: str(cur.start),
    termEnd: str(cur.end),
    source: '@unitedstates/congress-legislators',
    sourceUrl: `${CL_RAW}/legislators-current.json`,
    asOf: now(),
  };
}

/** Normalize one Open States person record to a flat officeholder card. null if unusable. */
export function normalizeStateOfficeholder(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const full = str(raw.name);
  if (!full) return null;
  const role = (Array.isArray(raw.current_roles) && raw.current_roles[0]) || {};
  return {
    name: full,
    id: str(raw.id),
    level: 'state',
    chamber: str(role.org_classification || role.title),
    state: str(role.jurisdiction || raw.jurisdiction).toUpperCase().slice(0, 2),
    district: str(role.district),
    party: str(raw.party),
    source: 'Open States',
    sourceUrl: 'https://openstates.org',
    asOf: now(),
  };
}

/**
 * Sitting officeholders. level:'federal' (keyless, congress-legislators) or 'state' (Open States, key by
 * ENV NAME OPENSTATES_API_KEY — soft-skips to [] when absent). Facts only; never a verdict. [] on failure.
 * @param {{state?:string, level?:'federal'|'state', chamber?:string}} [opts]
 */
export async function officeholders({ state, level = 'federal', chamber } = {}) {
  const st = str(state).toUpperCase();
  if (level === 'state') {
    if (!openStatesKey()) return []; // key by NAME absent → soft-skip
    const j = await getJson(
      withParams(`${OPENSTATES_BASE}/people`, { jurisdiction: st, per_page: 50 }),
      { 'X-API-KEY': openStatesKey() },
    );
    const rows = Array.isArray(j?.results) ? j.results : [];
    let out = rows.map(normalizeStateOfficeholder).filter(Boolean);
    if (chamber) out = out.filter((r) => r.chamber.toLowerCase().includes(str(chamber).toLowerCase()));
    return out;
  }
  // federal — keyless
  const j = await getJson(`${CL_RAW}/legislators-current.json`);
  if (!Array.isArray(j)) return [];
  let out = j.map(normalizeFederalOfficeholder).filter(Boolean);
  if (st) out = out.filter((r) => r.state === st);
  if (chamber) out = out.filter((r) => r.chamber.toLowerCase() === str(chamber).toLowerCase());
  return out;
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  WHAT'S ON YOUR BALLOT — official contests only, auto-expiring
// ════════════════════════════════════════════════════════════════════════════════════════════════

// A VIP contest is "official" only when it carries a non-empty `sources` array (the election official
// that published it). Anything without one is NOT actionable and is dropped — never guessed.
function vipContestIsOfficial(c) {
  return !!(c && Array.isArray(c.sources) && c.sources.some((s) => s && str(s.name)));
}
function vipSourceOf(c) {
  const s = (Array.isArray(c.sources) ? c.sources : []).find((x) => x && str(x.name)) || {};
  return officialTag(str(s.name) || 'Voting Information Project', str(s.official ? 'official' : '') || 'https://votinginfoproject.org');
}

/**
 * What's on the ballot for an address (VIP contests). OFFICIAL-ONLY + AUTO-EXPIRY hard rules:
 *   • Only contests carrying an official `sources` entry are returned; each is { ..., official:true,
 *     source, sourceUrl, asOf }.
 *   • If the election date is past, returns null (auto-expiry — no stale ballot).
 *   • If there is NO official source at all (no key, no data, or zero official contests), returns null
 *     PLUS an honest pointer — see the returned shape { contests:null|[], pointer? }.
 * VIP key by ENV NAME (VIP_API_KEY). Soft-skips when absent.
 * @param {{address?:string, division?:string, electionDate?:string, electionId?:string|number, nowMs?:number}} opts
 * @returns {Promise<{electionDate:string, contests:object[]|null, pointer?:object, asOf:string}>}
 */
export async function whatsOnBallot({ address = '', division = '', electionDate = '', electionId, nowMs = Date.now() } = {}) {
  const pointerResult = (electionDateOut = electionDate) => ({
    electionDate: str(electionDateOut), contests: null, pointer: localElectionOfficePointer(), asOf: now(),
  });
  // AUTO-EXPIRY: never serve a ballot for a past election.
  if (electionDate && isExpired(electionDate, nowMs)) return pointerResult();
  const addr = str(address) || str(division);
  if (!addr) return pointerResult();
  if (!vipKey()) return pointerResult(); // key by NAME absent → honest pointer, never guess

  const j = await getJson(withParams(`${VIP_BASE}/voterinfo`, { key: vipKey(), address: addr, electionId }));
  if (!j || typeof j !== 'object') return pointerResult();

  const resolvedDate = str(j.election && j.election.electionDay) || str(electionDate);
  if (resolvedDate && isExpired(resolvedDate, nowMs)) return pointerResult(resolvedDate);

  const raw = Array.isArray(j.contests) ? j.contests : [];
  const contests = raw.filter(vipContestIsOfficial).map((c) => ({
    office: str(c.office) || str(c.type),
    type: str(c.type),
    ballotTitle: str(c.ballotTitle || c.referendumTitle),
    candidates: (Array.isArray(c.candidates) ? c.candidates : [])
      .map((cand) => ({ name: str(cand.name), party: str(cand.party) })).filter((x) => x.name),
    ...vipSourceOf(c),
  }));
  // No official contest came back → honest pointer (HARD RULE: null, not a guess).
  if (!contests.length) return pointerResult(resolvedDate);
  return { electionDate: resolvedDate, contests, asOf: now() };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  WHERE / WHEN TO VOTE — official polling/early/dropoff only, auto-expiring
// ════════════════════════════════════════════════════════════════════════════════════════════════

function flattenCivicAddress(a) {
  if (!a || typeof a !== 'object') return '';
  return [str(a.locationName), str(a.line1), str(a.line2),
    [str(a.city), str(a.state), str(a.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ');
}
function normalizeVipLocation(loc) {
  if (!loc || typeof loc !== 'object') return null;
  // OFFICIAL-ONLY: a location is actionable only if VIP carries its official `sources`.
  const official = Array.isArray(loc.sources) && loc.sources.some((s) => s && str(s.name));
  if (!official) return null;
  const s = loc.sources.find((x) => x && str(x.name)) || {};
  return {
    name: str(loc.name),
    address: flattenCivicAddress(loc.address),
    hours: str(loc.pollingHours),
    notes: str(loc.notes),
    ...officialTag(str(s.name) || 'Voting Information Project', 'https://votinginfoproject.org'),
  };
}

/**
 * Where/when to vote for an address (VIP polling, early-vote, drop-off). OFFICIAL-ONLY + AUTO-EXPIRY:
 *   • Only locations carrying an official VIP `sources` entry are returned (each { ..., official:true }).
 *   • Past election date → null (auto-expiry; no stale polling place).
 *   • No official location (no key / no data / nothing official) → null + honest pointer.
 * VIP key by ENV NAME (VIP_API_KEY). Soft-skips when absent.
 * @param {{address?:string, electionId?:string|number, electionDate?:string, nowMs?:number}} opts
 * @returns {Promise<{polling:object[], early:object[], dropoff:object[], official:true} | {polling:null, pointer:object}>}
 */
export async function whereToVote({ address = '', electionId, electionDate = '', nowMs = Date.now() } = {}) {
  const pointerResult = () => ({ polling: null, early: null, dropoff: null, pointer: localElectionOfficePointer(), asOf: now() });
  if (electionDate && isExpired(electionDate, nowMs)) return pointerResult(); // auto-expiry
  const addr = str(address);
  if (!addr) return pointerResult();
  if (!vipKey()) return pointerResult(); // key by NAME absent → honest pointer

  const j = await getJson(withParams(`${VIP_BASE}/voterinfo`, { key: vipKey(), address: addr, electionId }));
  if (!j || typeof j !== 'object') return pointerResult();

  const resolvedDate = str(j.election && j.election.electionDay) || str(electionDate);
  if (resolvedDate && isExpired(resolvedDate, nowMs)) return pointerResult();

  const polling = (Array.isArray(j.pollingLocations) ? j.pollingLocations : []).map(normalizeVipLocation).filter(Boolean);
  const early = (Array.isArray(j.earlyVoteSites) ? j.earlyVoteSites : []).map(normalizeVipLocation).filter(Boolean);
  const dropoff = (Array.isArray(j.dropOffLocations) ? j.dropOffLocations : []).map(normalizeVipLocation).filter(Boolean);
  if (!polling.length && !early.length && !dropoff.length) return pointerResult(); // nothing official → honest pointer
  return { electionDate: resolvedDate, polling, early, dropoff, official: true, asOf: now() };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  CANDIDATES — FEC candidate search (campaign-finance public record)
// ════════════════════════════════════════════════════════════════════════════════════════════════

function normalizeCandidate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = str(raw.name);
  const id = str(raw.candidate_id);
  if (!name && !id) return null;
  return {
    name,
    candidateId: id,
    office: str(raw.office_full || raw.office),
    party: str(raw.party_full || raw.party),
    state: str(raw.state).toUpperCase(),
    district: str(raw.district),
    cycles: Array.isArray(raw.cycles) ? raw.cycles.map(num).filter((n) => n != null) : [],
    incumbentChallenge: str(raw.incumbent_challenge_full || raw.incumbent_challenge),
    source: 'FEC (api.open.fec.gov)',
    sourceUrl: 'https://www.fec.gov',
    asOf: now(),
  };
}

/**
 * Candidates for an office / cycle (FEC candidate search). FEC key by ENV NAME (FEC_API_KEY; DEMO_KEY
 * fallback). [] on failure. Candidate filings are public record — facts only, no endorsement.
 * @param {{office?:string, cycle?:number, q?:string, limit?:number}} opts
 */
export async function candidates({ office = '', cycle, q = '', limit = 20 } = {}) {
  const query = str(q) || str(office);
  const j = await getJson(withParams(`${FEC_BASE}/candidates/search/`, {
    api_key: fecKey(),
    q: query || undefined,
    office: office && office.length <= 1 ? office : undefined, // FEC office code H/S/P
    cycle: num(cycle),
    per_page: Math.max(1, Math.min(100, num(limit) || 20)),
    sort: 'name',
  }));
  const rows = Array.isArray(j?.results) ? j.results : [];
  return rows.map(normalizeCandidate).filter(Boolean);
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  RESULTS STATUS — the no-race-calling GUARD (this module NEVER calls a race)
// ════════════════════════════════════════════════════════════════════════════════════════════════

/**
 * The certification gate for a contest's results. HARD RULE (NO RACE-CALLING): this module does NOT
 * call races and does NOT present uncertified counts as final. Pass in a contest descriptor that may
 * carry { certified, source, sourceUrl, winner }. We REFUSE to surface a winner label unless the
 * upstream feed is explicitly certified.
 *   • certified === true  → { certified:true, winner?, note, source, sourceUrl, asOf }  (winner allowed)
 *   • certified !== true  → { certified:false, winner:null, note:'…uncertified — no winner called', … }
 * @param {{certified?:boolean, source?:string, sourceUrl?:string, winner?:string}} [contest]
 */
export function resultsStatus(contest = {}) {
  const c = contest && typeof contest === 'object' ? contest : {};
  const certified = c.certified === true;
  const base = {
    certified,
    source: str(c.source) || 'official/certified canvass feed required',
    sourceUrl: str(c.sourceUrl),
    asOf: now(),
  };
  if (!certified) {
    return {
      ...base,
      winner: null, // HARD RULE: never name a winner from an uncertified count
      note: 'Results are NOT certified — no winner is called. We do not project or call races; final results come only from the official certified canvass.',
    };
  }
  return {
    ...base,
    winner: str(c.winner) || null, // only carried when the upstream feed certified it
    note: 'Results reported as certified by the official source above.',
  };
}

// ════════════════════════════════════════════════════════════════════════════════════════════════
//  RENDER (escaped HTML; PURE) + dataNote
// ════════════════════════════════════════════════════════════════════════════════════════════════

function srcLink(item) {
  if (!item) return '';
  const u = str(item.sourceUrl);
  const s = esc(item.source || '');
  return u && /^https?:\/\//.test(u)
    ? ` <a href="${esc(u)}" rel="nofollow noopener">${s || 'official source'}</a>`
    : (s ? ` (${s})` : '');
}

/**
 * Escaped HTML for any of: officeholders[] · whatsOnBallot result · whereToVote result · candidates[] ·
 * resultsStatus result. PURE; soft-handles missing fields. Always surfaces the honest pointer when the
 * official-only rule yields null, and never renders a winner for an uncertified result.
 */
export function renderPage(data) {
  // resultsStatus
  if (data && typeof data === 'object' && !Array.isArray(data) && 'certified' in data) {
    const r = data;
    const parts = ['<section class="civic-results"><h2>Election results status</h2>'];
    parts.push(`<p class="cr-status">Certified: <strong>${r.certified ? 'yes' : 'no'}</strong></p>`);
    if (r.certified && r.winner) parts.push(`<p class="cr-winner">Reported winner (certified): ${esc(r.winner)}</p>`);
    else parts.push('<p class="cr-nowinner">No winner called — results are not certified.</p>');
    parts.push(`<p class="cr-note">${esc(r.note)}</p>`);
    parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
    return parts.join('');
  }
  // whatsOnBallot
  if (data && typeof data === 'object' && !Array.isArray(data) && 'contests' in data) {
    const parts = ['<section class="civic-ballot"><h2>What’s on your ballot</h2>'];
    if (Array.isArray(data.contests) && data.contests.length) {
      parts.push('<ul class="cb-contests">');
      for (const c of data.contests) {
        const cands = (c.candidates || []).map((x) => `${esc(x.name)}${x.party ? ' (' + esc(x.party) + ')' : ''}`).join(', ');
        parts.push(`<li><strong>${esc(c.office || c.ballotTitle)}</strong>${cands ? ' — ' + cands : ''} <span class="official">official</span>${srcLink(c)}</li>`);
      }
      parts.push('</ul>');
    } else {
      const p = data.pointer || localElectionOfficePointer();
      parts.push(`<p class="cb-pointer">${esc(p.note)}${srcLink(p)}</p>`);
    }
    parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
    return parts.join('');
  }
  // whereToVote
  if (data && typeof data === 'object' && !Array.isArray(data) && ('polling' in data || 'pointer' in data && 'dropoff' in data)) {
    const parts = ['<section class="civic-where"><h2>Where &amp; when to vote</h2>'];
    const block = (label, arr) => {
      if (!Array.isArray(arr) || !arr.length) return;
      parts.push(`<h3>${esc(label)}</h3><ul>`);
      for (const l of arr) parts.push(`<li>${esc(l.name || l.address)}${l.hours ? ' — ' + esc(l.hours) : ''} <span class="official">official</span>${srcLink(l)}</li>`);
      parts.push('</ul>');
    };
    if (data.polling || data.early || data.dropoff) {
      block('Polling places', data.polling);
      block('Early voting', data.early);
      block('Ballot drop-off', data.dropoff);
    }
    if (data.polling == null) {
      const p = data.pointer || localElectionOfficePointer();
      parts.push(`<p class="cw-pointer">${esc(p.note)}${srcLink(p)}</p>`);
    }
    parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
    return parts.join('');
  }
  // officeholders[] / candidates[]
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  const isCand = rows.length && rows[0] && 'candidateId' in rows[0];
  const parts = [`<section class="civic-${isCand ? 'candidates' : 'officeholders'}"><h2>${isCand ? 'Candidates' : 'Sitting officeholders'} — public record</h2>`];
  if (rows.length) {
    parts.push('<table><thead><tr><th>Name</th><th>Office</th><th>State</th><th>Party</th></tr></thead><tbody>');
    for (const r of rows) {
      const office = isCand ? r.office : (r.chamber || r.level);
      const st = `${esc(r.state || '')}${r.district ? '-' + esc(r.district) : ''}`;
      parts.push(`<tr><td>${esc(r.name)}</td><td>${esc(office)}</td><td>${st}</td><td>${esc(r.party)}</td></tr>`);
    }
    parts.push('</tbody></table>');
  } else {
    parts.push('<p class="empty">No records found.</p>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance + the §6A.3 caveats (official-only / no race-calling / auto-expiry), one line. */
export function dataNote() {
  return 'sources: @unitedstates/congress-legislators (CC0), Voting Information Project (election officials), Open States, FEC; '
    + 'actionable voting info is official-only and defers to your local election office; results shown only when certified — '
    + 'we do not call races; ballot/voter info expires after election day';
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('elections-civic.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'officeholders') {
    const rows = await officeholders({ state: rest[0], level: rest[1] === 'state' ? 'state' : 'federal' });
    console.log(`SoapBox civic — ${rows.length} officeholder(s)`);
    for (const r of rows.slice(0, 25)) console.log(`  • ${r.name} (${r.chamber || r.level}, ${r.party}-${r.state}${r.district ? '-' + r.district : ''})`);
  } else if (cmd === 'candidates') {
    const rows = await candidates({ q: rest[0] || '', cycle: rest[1] });
    console.log(`SoapBox civic — ${rows.length} candidate(s)`);
    for (const r of rows.slice(0, 25)) console.log(`  • ${r.name} (${r.office}, ${r.party}-${r.state})  ${r.candidateId}`);
  } else if (cmd === 'ballot') {
    const b = await whatsOnBallot({ address: rest.join(' ') });
    console.log(b.contests ? `${b.contests.length} official contest(s)` : `no official ballot → ${b.pointer.note}`);
  } else if (cmd === 'where') {
    const w = await whereToVote({ address: rest.join(' ') });
    console.log(w.polling ? `polling=${w.polling.length} early=${w.early.length} dropoff=${w.dropoff.length} (official)` : `no official location → ${w.pointer.note}`);
  } else {
    console.log('usage: elections-civic.mjs <officeholders STATE [state]|candidates "Q" [cycle]|ballot "ADDR"|where "ADDR">');
  }
  console.log(`  ${dataNote()}`);
}
