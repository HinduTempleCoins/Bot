// open-states.mjs — Accountability Graph STATE-LEVEL reader (v3 §6A.3) over the Open States / Plural API
// (v3.openstates.org). Complements congress-legislators.mjs (FEDERAL members of Congress) by covering
// STATE legislators and STATE bills — the state-government tier the federal datasets don't touch.
//
//   Open States is the canonical open dataset of U.S. state legislators, committees, and legislation.
//   The v3 API needs a free key (env OPENSTATES_API_KEY, by NAME). With no key set, every live call
//   soft-skips to []/null — never throws, never blocks the page.
//
// DISCIPLINE (v3 §6A.3 — same non-negotiables as the federal readers):
//   • FACTS + CONNECTIONS ONLY. Who currently holds state office, what bills exist and their status,
//     and the public id crosswalk (openstates id ↔ other identifiers). No verdicts, no scores.
//   • PUBLIC-CAPACITY DATA ONLY. State legislators acting in office; public bill records.
//   • LINK EVERY SOURCE. Each record carries source + license + fetchedAt + the openstates.org URL.
//   • RIGHT OF REPLY. Office-holders may dispute via the upstream open dataset (openstates.org).
//
// Pattern follows congress-legislators.mjs / fec.mjs: ESM, zero deps, key-by-NAME soft-skip, __setFetch
// seam, soft-fail (return []/null, NEVER throw), injectable data for tests, guarded CLI, escaped HTML.
//
//   import { apiKey, hasKey, legislatorsByState, billsByState, normalizePerson, normalizeBill,
//            renderPage, dataNote, __setFetch } from './open-states.mjs'
//   OPENSTATES_API_KEY=... node integrations/soapbox/open-states.mjs people CA
//   OPENSTATES_API_KEY=... node integrations/soapbox/open-states.mjs bills CA "climate"

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxOpenStates/1.0 (+https://data.soapbox.community)' };
const BASE = 'https://v3.openstates.org';
const SRC = 'Open States / Plural API (v3)';
const LICENSE = 'Open States open data (CC-BY-style attribution)';

// ---- key handling: env OPENSTATES_API_KEY by NAME, soft-skip when absent (no public demo key) ----
/** The Open States key in effect, by env NAME, or '' when unset. */
export function apiKey() { return process.env.OPENSTATES_API_KEY || ''; }
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

// Open States uses OCD jurisdiction ids; a state postal code maps to ocd-jurisdiction/country:us/state:xx.
// The v3 API also accepts the postal abbreviation directly for `jurisdiction`; normalize to lowercase.
function jurisdiction(state) {
  const s = str(state).toLowerCase();
  if (!s) return '';
  if (s.startsWith('ocd-')) return s;
  return s; // v3 accepts 'ca', 'ny', etc.
}

/**
 * Normalize one raw Open States person (state legislator). Returns null for unusable input.
 * Raw shape: { id:'ocd-person/...', name, party, current_role:{title,org_classification,district},
 *              jurisdiction:{name}, openstates_url, other_identifiers:[{scheme,identifier}], ... }.
 */
export function normalizePerson(p) {
  if (!p || typeof p !== 'object') return null;
  const id = str(p.id);
  const name = str(p.name);
  if (!id && !name) return null;
  const role = p.current_role || {};
  return tag({
    id,
    name,
    party: str(p.party),
    chamber: chamberLabel(role.org_classification),
    district: role.district != null ? String(role.district) : '',
    title: str(role.title),
    jurisdiction: str(p.jurisdiction && p.jurisdiction.name),
    url: str(p.openstates_url),
    ids: idCrosswalk(p),
  });
}

function chamberLabel(orgClass) {
  const c = str(orgClass).toLowerCase();
  if (c === 'upper') return 'Senate';
  if (c === 'lower') return 'House';
  if (c === 'legislature') return 'Legislature';
  return str(orgClass);
}

/** Pull the public id crosswalk out of a raw Open States person (openstates id + other_identifiers). */
export function idCrosswalk(p) {
  const out = {};
  if (str(p && p.id)) out.openstates = str(p.id);
  const others = Array.isArray(p && p.other_identifiers) ? p.other_identifiers : [];
  for (const o of others) {
    const scheme = str(o && o.scheme);
    const ident = str(o && o.identifier);
    if (scheme && ident) (out[scheme] ||= []).push(ident);
  }
  return out;
}

/**
 * Normalize one raw Open States bill. Returns null for unusable input.
 * Raw shape: { id, identifier:'AB 1', title, classification:[...], session, jurisdiction:{name},
 *              latest_action_description, latest_action_date, openstates_url }.
 */
export function normalizeBill(b) {
  if (!b || typeof b !== 'object') return null;
  const identifier = str(b.identifier);
  const title = str(b.title);
  if (!identifier && !title) return null;
  return tag({
    id: str(b.id),
    identifier,
    title,
    session: str(b.session),
    classification: Array.isArray(b.classification) ? b.classification.map(str).filter(Boolean) : [],
    jurisdiction: str(b.jurisdiction && b.jurisdiction.name),
    latestAction: str(b.latest_action_description),
    latestActionDate: str(b.latest_action_date),
    url: str(b.openstates_url),
  });
}

// ---- live data (key required; each soft-skips to []/null) ----
async function getJson(u) {
  try {
    const r = await _fetch(u, { headers: { ...UA, Accept: 'application/json', 'X-API-KEY': apiKey() } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}
function url(path, params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) { if (v == null || v === '') continue; p.set(k, String(v)); }
  const q = p.toString();
  return `${BASE}${path}${q ? '?' + q : ''}`;
}

/**
 * Current state legislators for a state. Returns [] without a key or on any failure.
 * @param {{state:string, chamber?:'Senate'|'House', limit?:number}} opts  state = postal code or OCD id
 */
export async function legislatorsByState({ state = '', chamber, limit = 50 } = {}) {
  if (!hasKey()) return [];
  const j = jurisdiction(state);
  if (!j) return [];
  const data = await getJson(url('/people', {
    jurisdiction: j, per_page: Math.max(1, Math.min(50, Number(limit) || 50)),
  }));
  const rows = Array.isArray(data?.results) ? data.results : [];
  let out = rows.map(normalizePerson).filter(Boolean);
  const want = str(chamber);
  if (want) out = out.filter((r) => r.chamber.toLowerCase() === want.toLowerCase());
  return out;
}

/**
 * State bills for a state, optionally filtered by a free-text query. Returns [] without a key / on failure.
 * @param {{state:string, q?:string, session?:string, limit?:number}} opts
 */
export async function billsByState({ state = '', q = '', session, limit = 20 } = {}) {
  if (!hasKey()) return [];
  const j = jurisdiction(state);
  if (!j) return [];
  const data = await getJson(url('/bills', {
    jurisdiction: j, q: str(q), session: str(session),
    per_page: Math.max(1, Math.min(20, Number(limit) || 20)), sort: 'latest_action_desc',
  }));
  const rows = Array.isArray(data?.results) ? data.results : [];
  return rows.map(normalizeBill).filter(Boolean);
}

// ---- rendering (escaped HTML; PURE) ----
/**
 * Escaped HTML for a list of state legislators OR a list of state bills. Shape is inferred: rows with
 * `identifier` → bills; otherwise → people. PURE; facts only, no verdicts.
 * @param {object[]} rows
 */
export function renderPage(rows) {
  const list = Array.isArray(rows) ? rows : (rows ? [rows] : []);
  const isBills = list.length && list[0] && 'identifier' in list[0];
  if (isBills) {
    const parts = ['<section class="openstates-bills"><h2>State legislation — public record</h2>'];
    parts.push('<table class="os-bills"><thead><tr><th>Bill</th><th>Title</th><th>Latest action</th></tr></thead><tbody>');
    for (const b of list) {
      parts.push(`<tr><td>${esc(b.identifier)}</td><td>${esc(b.title)}</td><td>${esc(b.latestAction)}${b.latestActionDate ? ' (' + esc(b.latestActionDate) + ')' : ''}</td></tr>`);
    }
    parts.push('</tbody></table>');
    parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
    return parts.join('');
  }
  const parts = ['<section class="openstates-people"><h2>State legislators — public record</h2>'];
  if (list.length) {
    parts.push('<table class="os-people"><thead><tr><th>Name</th><th>Chamber</th><th>District</th><th>Party</th></tr></thead><tbody>');
    for (const r of list) {
      parts.push(`<tr><td>${esc(r.name)}</td><td>${esc(r.chamber)}</td><td>${esc(r.district)}</td><td>${esc(r.party)}</td></tr>`);
    }
    parts.push('</tbody></table>');
  } else {
    parts.push('<p class="os-empty">No state legislators found.</p>');
  }
  parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return parts.join('');
}

/** Provenance line — names Open States + its open-data license + right-of-reply path. */
export function dataNote() {
  return `source: ${SRC} (${LICENSE}); public-record state office + bill data; corrections via openstates.org`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('open-states.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!hasKey()) {
    console.log('OPENSTATES_API_KEY unset → live calls soft-skip. Set it (by name) to query Open States v3.');
  }
  if (cmd === 'bills') {
    const state = rest[0];
    const bills = await billsByState({ state, q: rest.slice(1).join(' ') });
    console.log(`SoapBox Open States — ${bills.length} bill(s) for ${state}`);
    for (const b of bills.slice(0, 20)) console.log(`  • ${b.identifier}: ${b.title.slice(0, 70)} — ${b.latestAction || 'no action'}`);
    console.log(`  ${dataNote()}`);
  } else if (cmd === 'people') {
    const state = rest[0];
    const people = await legislatorsByState({ state });
    console.log(`SoapBox Open States — ${people.length} legislator(s) for ${state}`);
    for (const p of people.slice(0, 25)) console.log(`  • ${p.name} (${p.chamber}, ${p.party}, dist ${p.district || '—'})`);
    console.log(`  ${dataNote()}`);
  } else {
    console.log('usage: open-states.mjs <people STATE|bills STATE ["query"]>  (STATE = postal code, e.g. CA)');
  }
}
