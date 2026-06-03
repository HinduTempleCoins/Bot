// ecfr.mjs — Law.SoapBox legal-vertical reader (v3 §10) over the eCFR API (www.ecfr.gov/api), the
// official Electronic Code of Federal Regulations published by the Office of the Federal Register and
// the GPO. KEYLESS and open. This module reads the title structure (parts under a title), a part's
// metadata, and runs full-text search across the CFR.
//
// DISCIPLINE (v3 §10 — non-negotiable):
//   • FEDERAL REGULATIONS ARE PUBLIC DOMAIN. The CFR is U.S. Government work, no copyright. We mark
//     records license:'public-domain' and host them forever. Attribute the eCFR / Office of the Federal
//     Register as the authoritative source.
//   • STATE FACTS, LINK SOURCES. Title number/name, part number/heading, the as-of date, a search-hit
//     count and headings. NO legal interpretation, NO "this rule means X" gloss. Link the eCFR page.
//   • eCFR is the UNOFFICIAL editorial compilation; the official text is the daily Federal Register /
//     annual CFR. We say so and link the eCFR reader page for each result.
//
// Pattern follows worldbank.mjs / courtlistener-opinions.mjs: ESM, zero deps, __setFetch seam,
// soft-fail (return []/null, NEVER throw), injectable data for tests, guarded CLI demo, escaped HTML.
//
//   import { titles, titleStructure, partInfo, search, ecfrUrl,
//            renderPage, dataNote, __setFetch } from './ecfr.mjs'
//   node integrations/soapbox/ecfr.mjs title 21
//   node integrations/soapbox/ecfr.mjs search "controlled substance"

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxeCFR/1.0 (+https://data.soapbox.community)' };
const BASE = 'https://www.ecfr.gov/api';
const WEB = 'https://www.ecfr.gov';
const SRC = 'eCFR — Office of the Federal Register / GPO';
const LICENSE = 'public-domain';

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

// Today's date (YYYY-MM-DD) for the versioned eCFR endpoints. Overridable for deterministic tests.
function today(d) { return str(d) || new Date().toISOString().slice(0, 10); }

/** Build the canonical eCFR reader URL for a title (optionally a part). PURE. */
export function ecfrUrl(title, part) {
  const t = num(title);
  if (t == null) return WEB;
  return part != null && str(part)
    ? `${WEB}/current/title-${t}/part-${encodeURIComponent(str(part))}`
    : `${WEB}/current/title-${t}`;
}

/** Walk an eCFR structure tree, collecting nodes of a given type (e.g. 'part'). PURE. */
export function collectNodes(node, type, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (str(node.type) === str(type)) out.push(node);
  const kids = Array.isArray(node.children) ? node.children : [];
  for (const k of kids) collectNodes(k, type, out);
  return out;
}

/** Normalize one structure node (part/chapter/section) → flat card. Returns null for unusable input. */
export function normalizeNode(node, title) {
  if (!node || typeof node !== 'object') return null;
  const ident = str(node.identifier);
  const label = str(node.label) || str(node.label_description) || str(node.label_level);
  if (!ident && !label) return null;
  return tag({
    type: str(node.type),
    identifier: ident,
    heading: str(node.label_description) || label,
    title: num(title),
    reserved: node.reserved === true,
    url: ecfrUrl(title, str(node.type) === 'part' ? ident : undefined),
  });
}

// ---- live data (keyless; each fails soft to []/null) ----
async function getJson(u) {
  try {
    const r = await _fetch(u, { headers: { ...UA, Accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

function url(path, params = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v == null || v === '') continue;
    p.set(k, String(v));
  }
  const qs = p.toString();
  return `${BASE}${path}${qs ? '?' + qs : ''}`;
}

/**
 * The 50 CFR titles (number + name + latest amendment date). Returns [{ number, name, latestDate }] ([]).
 */
export async function titles() {
  const j = await getJson(url('/versioner/v1/titles.json', {}));
  const rows = Array.isArray(j?.titles) ? j.titles : [];
  return rows.map((t) => tag({
    number: num(t.number),
    name: str(t.name),
    latestDate: str(t.latest_amended_on) || str(t.latest_issue_date),
    url: ecfrUrl(t.number),
  })).filter((t) => t.number != null);
}

/**
 * Parts under a CFR title (walks the structure tree). Returns normalized part cards ([] on failure).
 * @param {string|number} title
 * @param {{date?:string}} [opts]
 */
export async function titleStructure(title, { date } = {}) {
  const t = num(title);
  if (t == null) return [];
  const j = await getJson(url(`/versioner/v1/structure/${today(date)}/title-${t}.json`, {}));
  const parts = collectNodes(j, 'part');
  return parts.map((n) => normalizeNode(n, t)).filter(Boolean);
}

/**
 * Metadata for one part within a title (heading + reader URL). Returns a card or null.
 * @param {string|number} title
 * @param {string|number} part
 * @param {{date?:string}} [opts]
 */
export async function partInfo(title, part, { date } = {}) {
  const t = num(title);
  const p = str(part);
  if (t == null || !p) return null;
  const all = await titleStructure(t, { date });
  return all.find((n) => str(n.identifier) === p && n.type === 'part') || null;
}

/**
 * Full-text search across the CFR. Returns { total, results: [{ heading, hierarchy, url }] }.
 * @param {{q:string, title?:number, limit?:number}} opts
 */
export async function search({ q = '', title, limit = 20 } = {}) {
  const query = str(q);
  if (!query) return { total: 0, results: [] };
  const params = { query, per_page: Math.max(1, Math.min(100, num(limit) || 20)) };
  if (num(title) != null) params['conditions[title]'] = num(title);
  const j = await getJson(url('/search/v1/results', params));
  if (!j || typeof j !== 'object') return { total: 0, results: [] };
  const rows = Array.isArray(j.results) ? j.results : [];
  const total = num(j.meta && j.meta.total_count != null ? j.meta.total_count : j.total_count) ?? rows.length;
  const results = rows.map((r) => {
    const t = num(r.hierarchy && r.hierarchy.title);
    const part = str(r.hierarchy && r.hierarchy.part);
    return tag({
      heading: str(r.headings && (r.headings.section || r.headings.part)) || str(r.full_text_excerpt) || str(r.label),
      title: t,
      part,
      excerpt: str(r.full_text_excerpt),
      url: t != null ? ecfrUrl(t, part || undefined) : WEB,
    });
  });
  return { total, results };
}

// ---- rendering (escaped HTML; PURE) ----
/**
 * Escaped HTML for a title's parts OR a search result list. PURE; soft-handles missing fields. Facts
 * only — title/part numbers, headings, hit count, links. Never a legal interpretation.
 * @param {{title?:number, parts?:object[], search?:{total:number,results:object[]}, query?:string}} data
 */
export function renderPage(data = {}) {
  if (data.search) {
    const s = data.search;
    const parts = [`<section class="ecfr-search"><h2>eCFR search${data.query ? ` — "${esc(data.query)}"` : ''}</h2>`];
    parts.push(`<p class="ecfr-count">${esc(s.total ?? 0)} matching section(s)</p>`);
    if (Array.isArray(s.results) && s.results.length) {
      parts.push('<ul class="ecfr-results">');
      for (const r of s.results) {
        const lbl = `Title ${r.title ?? '?'}${r.part ? ', Part ' + r.part : ''} — ${r.heading || ''}`;
        parts.push(`<li><a href="${esc(r.url)}">${esc(lbl)}</a></li>`);
      }
      parts.push('</ul>');
    } else {
      parts.push('<p class="ecfr-empty">No matches.</p>');
    }
    parts.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
    return parts.join('');
  }
  const partsList = Array.isArray(data.parts) ? data.parts : [];
  const out = [`<section class="ecfr-title"><h2>CFR Title ${esc(data.title ?? '?')} — parts</h2>`];
  if (partsList.length) {
    out.push('<table class="ecfr-parts"><thead><tr><th>Part</th><th>Heading</th></tr></thead><tbody>');
    for (const p of partsList) {
      const head = p.reserved ? `${p.heading || ''} [Reserved]` : (p.heading || '');
      out.push(`<tr><td><a href="${esc(p.url)}">Part ${esc(p.identifier)}</a></td><td>${esc(head)}</td></tr>`);
    }
    out.push('</tbody></table>');
  } else {
    out.push('<p class="ecfr-empty">No parts on record.</p>');
  }
  out.push(`<p class="data-note">${esc(dataNote())}</p></section>`);
  return out.join('');
}

/** Provenance line — names eCFR / OFR + public-domain + the unofficial-compilation caveat. */
export function dataNote() {
  return `source: ${SRC}; the CFR is public domain (host-forever); eCFR is the editorial compilation — official text is the Federal Register / annual CFR`;
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('ecfr.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'titles') {
    const ts = await titles();
    console.log(`SoapBox eCFR — ${ts.length} titles`);
    for (const t of ts) console.log(`  Title ${t.number}: ${t.name} (as of ${t.latestDate || '?'})`);
    console.log(`  ${dataNote()}`);
  } else if (cmd === 'title') {
    const t = rest[0];
    const ps = await titleStructure(t);
    console.log(`SoapBox eCFR — Title ${t}: ${ps.length} parts`);
    for (const p of ps.slice(0, 40)) console.log(`  Part ${p.identifier}: ${p.heading}${p.reserved ? ' [Reserved]' : ''}`);
    console.log(`  ${dataNote()}`);
  } else if (cmd === 'search') {
    const q = rest.join(' ');
    const s = await search({ q });
    console.log(`SoapBox eCFR — search "${q}": ${s.total} hits`);
    for (const r of s.results.slice(0, 25)) console.log(`  • Title ${r.title}${r.part ? ', Part ' + r.part : ''} — ${r.heading}\n    ${r.url}`);
    console.log(`  ${dataNote()}`);
  } else {
    console.log('usage: ecfr.mjs <titles | title TITLE_NUM | search "query">');
    console.log('  eCFR reads are keyless/open; the CFR is public domain.');
  }
}
