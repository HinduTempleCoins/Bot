// congress-legislators.mjs — Accountability Graph base reader (v3 §6A.2) over the open, community-
// maintained @unitedstates/congress-legislators dataset (CC0 public-domain YAML/JSON on GitHub raw).
// FULLY KEYLESS. Reads legislators-current.json for current members of Congress, the committee/
// membership files, and the cross-reference ids (bioguide ↔ FEC ↔ OpenSecrets ↔ GovTrack ↔ Wikidata…).
// That id crosswalk is the join key the rest of the Accountability Graph hangs off of (FEC, LDA, etc.).
//
// DISCIPLINE (v3 §6A.2 — non-negotiable):
//   • FACTS + CONNECTIONS ONLY. This reader reports who currently holds public office, on what
//     committees, and which public ids map to which person. It renders NO verdicts, scores, or
//     characterizations — only what the public record states.
//   • PUBLIC-CAPACITY DATA ONLY. Members of Congress acting in office. No private-life data.
//   • LINK EVERY SOURCE. Every record carries source + license + fetchedAt provenance, and the
//     GitHub raw URL it came from is fixed and citable.
//   • RIGHT OF REPLY. Office-holders may dispute any mapping; this is a mirror of an open dataset,
//     correctable upstream at github.com/unitedstates/congress-legislators.
//
// Pattern follows worldbank.mjs / gov-readers.mjs: ESM, zero deps, keyless, __setFetch seam, soft-fail
// (return []/null, NEVER throw), injectable data for tests, guarded CLI demo, escaped rendered HTML.
//
//   import { currentLegislators, findByBioguide, findByName, committees,
//            idCrosswalk, renderPage, dataNote, __setFetch } from './congress-legislators.mjs'
//   node integrations/soapbox/congress-legislators.mjs name "Warren"
//   node integrations/soapbox/congress-legislators.mjs id W000817
//   node integrations/soapbox/congress-legislators.mjs committees

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxCongress/1.0 (+https://data.soapbox.community)' };

// The dataset is public-domain (CC0) and served from GitHub raw — keyless and citable.
const RAW = 'https://raw.githubusercontent.com/unitedstates/congress-legislators/main';
const SRC = '@unitedstates/congress-legislators';
const LICENSE = 'CC0-1.0 (public domain)';
export const SOURCE_URLS = {
  legislators: `${RAW}/legislators-current.json`,
  committees: `${RAW}/committees-current.json`,
  membership: `${RAW}/committee-membership-current.json`,
};

// ---- pure helpers (unit-tested offline) ----

const str = (v) => (v == null ? '' : String(v)).trim();

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

const now = () => new Date().toISOString();
// stamp a normalized record with its provenance (source + license + fetchedAt).
const tag = (extra = {}) => ({ source: SRC, license: LICENSE, fetchedAt: now(), ...extra });

/**
 * Normalize one raw legislator object (from legislators-current.json) into a flat public-record card.
 * The raw shape is { id:{bioguide,fec:[...],opensecrets,govtrack,wikidata,...}, name:{first,last,official_full},
 *                     bio:{birthday,gender}, terms:[{type,state,party,start,end,district,...}, ...] }.
 * We surface only public-capacity office facts + the id crosswalk. Returns null for unusable input.
 */
export function normalizeLegislator(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = raw.id || {};
  const name = raw.name || {};
  const terms = Array.isArray(raw.terms) ? raw.terms : [];
  const current = terms.length ? terms[terms.length - 1] : {};
  const bioguide = str(id.bioguide);
  const fullName = str(name.official_full) || [str(name.first), str(name.last)].filter(Boolean).join(' ');
  if (!bioguide && !fullName) return null;
  return {
    bioguide,
    name: fullName,
    firstName: str(name.first),
    lastName: str(name.last),
    chamber: current.type === 'sen' ? 'Senate' : current.type === 'rep' ? 'House' : str(current.type),
    state: str(current.state),
    district: current.district != null ? String(current.district) : '',
    party: str(current.party),
    termStart: str(current.start),
    termEnd: str(current.end),
    ids: idCrosswalk(raw),
  };
}

/**
 * Pull the public id crosswalk out of a raw legislator object. This is the join key for the rest of
 * the Accountability Graph: bioguide ↔ FEC candidate ids ↔ OpenSecrets ↔ GovTrack ↔ Wikidata ↔ ICPSR.
 * Returns a flat { bioguide, fec:[...], opensecrets, govtrack, wikidata, icpsr } object (empty fields omitted).
 */
export function idCrosswalk(raw) {
  const id = (raw && raw.id) || {};
  const out = {};
  if (str(id.bioguide)) out.bioguide = str(id.bioguide);
  if (Array.isArray(id.fec) && id.fec.length) out.fec = id.fec.map(str).filter(Boolean);
  if (str(id.opensecrets)) out.opensecrets = str(id.opensecrets);
  if (id.govtrack != null) out.govtrack = String(id.govtrack);
  if (str(id.wikidata)) out.wikidata = str(id.wikidata);
  if (id.icpsr != null) out.icpsr = String(id.icpsr);
  if (id.thomas != null) out.thomas = String(id.thomas);
  return out;
}

// ---- live data (keyless; each fails soft to []/null) ----

async function getJson(url) {
  try {
    const r = await _fetch(url, { headers: { ...UA, Accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/**
 * All current members of Congress as normalized public-record cards. Returns [] on any failure.
 * @param {{chamber?:'Senate'|'House', state?:string}} [filter]  optional public-capacity filters
 */
export async function currentLegislators(filter = {}) {
  const j = await getJson(SOURCE_URLS.legislators);
  if (!Array.isArray(j)) return [];
  let rows = j.map(normalizeLegislator).filter(Boolean).map((r) => tag(r));
  const chamber = str(filter.chamber);
  const state = str(filter.state).toUpperCase();
  if (chamber) rows = rows.filter((r) => r.chamber.toLowerCase() === chamber.toLowerCase());
  if (state) rows = rows.filter((r) => r.state.toUpperCase() === state);
  return rows;
}

/**
 * One member by bioguide id, or null if not found / on failure.
 * @param {string} bioguide  e.g. 'W000817'
 */
export async function findByBioguide(bioguide) {
  const want = str(bioguide).toUpperCase();
  if (!want) return null;
  const all = await currentLegislators();
  return all.find((r) => r.bioguide.toUpperCase() === want) || null;
}

/**
 * Members whose name contains the query (case-insensitive substring over full + last name).
 * Returns [] on no match / failure.
 * @param {string} q
 */
export async function findByName(q) {
  const needle = str(q).toLowerCase();
  if (!needle) return [];
  const all = await currentLegislators();
  return all.filter((r) => r.name.toLowerCase().includes(needle) || r.lastName.toLowerCase().includes(needle));
}

/**
 * Current standing committees + subcommittees, normalized. Returns [] on failure.
 * Raw shape: [{ type:'house'|'senate'|'joint', name, thomas_id, url, subcommittees:[{name,thomas_id},...] }].
 */
export async function committees() {
  const j = await getJson(SOURCE_URLS.committees);
  if (!Array.isArray(j)) return [];
  return j.map((c) => tag({
    name: str(c.name),
    chamber: str(c.type),
    thomasId: str(c.thomas_id),
    url: str(c.url),
    subcommittees: Array.isArray(c.subcommittees)
      ? c.subcommittees.map((s) => ({ name: str(s.name), thomasId: str(s.thomas_id) })).filter((s) => s.name)
      : [],
  })).filter((c) => c.name);
}

// ---- rendering (escaped HTML; PURE) ----

/**
 * Escaped HTML for a list of member cards (from currentLegislators/findByName) OR a single card
 * (from findByBioguide). PURE; soft-handles missing fields. Renders facts only — office, state,
 * party, ids — never any verdict or score.
 */
export function renderPage(data) {
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  const parts = ['<section class="congress-legislators"><h2>Members of Congress — public record</h2>'];
  if (rows.length) {
    parts.push('<table class="cl-members"><thead><tr><th>Name</th><th>Chamber</th><th>State</th><th>Party</th><th>Bioguide</th></tr></thead><tbody>');
    for (const r of rows) {
      parts.push(`<tr><td>${esc(r.name)}</td><td>${esc(r.chamber)}</td><td>${esc(r.state)}${r.district ? '-' + esc(r.district) : ''}</td><td>${esc(r.party)}</td><td>${esc(r.bioguide)}</td></tr>`);
    }
    parts.push('</tbody></table>');
  } else {
    parts.push('<p class="cl-empty">No members found.</p>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names the open dataset + its CC0 license + the right-of-reply note. */
export function dataNote() {
  return `source: ${SRC} (${LICENSE}); public-record office data; corrections via github.com/unitedstates/congress-legislators`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('congress-legislators.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  if (cmd === 'id') {
    const r = await findByBioguide(arg);
    console.log(r ? JSON.stringify({ ...r, fetchedAt: undefined }, null, 2) : 'not found');
  } else if (cmd === 'committees') {
    const cs = await committees();
    console.log(`SoapBox congress-legislators — ${cs.length} committees`);
    for (const c of cs.slice(0, 25)) console.log(`  • [${c.chamber}] ${c.name} (${c.thomasId})  +${c.subcommittees.length} sub`);
    console.log(`  ${dataNote()}`);
  } else if (cmd === 'name') {
    const rows = await findByName(arg);
    console.log(`SoapBox congress-legislators — ${rows.length} match "${arg}"`);
    for (const r of rows.slice(0, 25)) console.log(`  • ${r.name} (${r.chamber}, ${r.party}-${r.state}${r.district ? '-' + r.district : ''})  bioguide=${r.bioguide}`);
    console.log(`  ${dataNote()}`);
  } else {
    const rows = await currentLegislators({ chamber: cmd === 'senate' ? 'Senate' : cmd === 'house' ? 'House' : undefined });
    console.log(`SoapBox congress-legislators — ${rows.length} current members`);
    for (const r of rows.slice(0, 20)) console.log(`  • ${r.name} (${r.chamber}, ${r.party}-${r.state})`);
    console.log('usage: congress-legislators.mjs <senate|house|name "X"|id BIOGUIDE|committees>');
    console.log(`  ${dataNote()}`);
  }
}
