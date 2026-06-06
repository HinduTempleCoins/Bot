// patents.mjs — "Search the patent record" reader over PatentsView, the USPTO's open patent-data API
// (search.patentsview.org/api/v1). Where gov-readers.mjs's USPTO trademark reader (#182) covers MARKS,
// this covers PATENTS: search granted patents by keyword / assignee (the organization that owns it) /
// inventor, pull a full record (claims count, cited references, CPC classifications), and roll the
// results up by year + top assignee. No quotes, no money — just the public invention record.
//
// Every reader:
//   • POSTs a PatentsView query JSON and normalizes the response into flat, predictable records,
//   • SOFT-FAILS to [] (or null for scalars) on any error / non-ok / missing data — NEVER throws,
//   • carries an as-of provenance note.
//
// Keyless by default: the classic PatentsView endpoints need NO key. The newer search.patentsview.org
// host MAY require an API key for some callers — we send one ONLY if process.env.PATENTSVIEW_API_KEY is
// present, referenced by ENV NAME ONLY. NO secret is hard-coded in this file by construction.
//
//   import { searchPatents, patentDetail, byAssignee, summary, renderPage, dataNote } from './patents.mjs'
//   node integrations/soapbox/patents.mjs search "neural network"

const BASE = 'https://search.patentsview.org/api/v1';
const SOURCE = 'PatentsView / USPTO';
// API key env NAME only — never a literal key value in this file.
const KEY_ENV = 'PATENTSVIEW_API_KEY';

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community/contact)' };

let _fetch = (...a) => globalThis.fetch(...a);
/** Test/seam hook: inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (v) => (v == null ? '' : String(v)).trim();
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const clamp = (v, lo, hi, dflt) => Math.max(lo, Math.min(hi, num(v) || dflt));

// Escape for safe HTML interpolation (the strict-conventions requirement).
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// POST a PatentsView request: q (query), f (fields), o (options). Soft-fail to null.
// Sends the API key header ONLY when the env var is set (keyless otherwise).
async function post(endpoint, q, f, o) {
  try {
    const headers = { ...UA, 'Content-Type': 'application/json', Accept: 'application/json' };
    const key = process.env[KEY_ENV];
    if (key) headers['X-Api-Key'] = key;
    const body = { q, f };
    if (o) body.o = o;
    const r = await _fetch(`${BASE}${endpoint}`, { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// PatentsView nests inventor/assignee/CPC as arrays of objects on the patent. Normalize each shape.
const inventorNames = (p) => {
  const arr = Array.isArray(p?.inventors) ? p.inventors : [];
  return arr
    .map((i) => str([i.inventor_name_first, i.inventor_name_last].filter(Boolean).join(' ')) || str(i.inventor_name))
    .filter(Boolean);
};
// all assignee names on the patent (PatentsView returns an array — a patent can be co-assigned).
const assigneeNames = (p) => {
  const arr = Array.isArray(p?.assignees) ? p.assignees : [];
  return arr
    .map((a) => str(a.assignee_organization) || str([a.assignee_individual_name_first, a.assignee_individual_name_last].filter(Boolean).join(' ')))
    .filter(Boolean);
};
const assigneeName = (p) => assigneeNames(p)[0] || '';

// flatten a raw PatentsView patent object into our normalized search record.
function normPatent(p) {
  return {
    patentId: str(p?.patent_id),
    title: str(p?.patent_title),
    date: str(p?.patent_date),
    assignee: assigneeName(p),     // primary assignee (back-compat)
    assignees: assigneeNames(p),   // ALL assignees — a co-assigned patent kept its full list (was dropped)
    inventors: inventorNames(p),
    abstract: str(p?.patent_abstract),
  };
}

// ── searchPatents — keyword / assignee / inventor search ─────────────────────────────────────────────
// Builds a PatentsView _and query from whichever of keyword/assignee/inventor are provided. Soft-fail [].
export async function searchPatents({ keyword = '', assignee = '', inventor = '', limit = 25 } = {}) {
  const kw = str(keyword), asg = str(assignee), inv = str(inventor);
  if (!kw && !asg && !inv) return [];
  const and = [];
  if (kw) and.push({ _text_any: { patent_title: kw } });
  if (asg) and.push({ _text_any: { 'assignees.assignee_organization': asg } });
  if (inv) and.push({ _text_any: { 'inventors.inventor_name_last': inv } });
  const q = and.length === 1 ? and[0] : { _and: and };
  const f = [
    'patent_id', 'patent_title', 'patent_date', 'patent_abstract',
    'assignees.assignee_organization',
    'inventors.inventor_name_first', 'inventors.inventor_name_last',
  ];
  const o = { size: clamp(limit, 1, 100, 25) };
  const j = await post('/patent/', q, f, o);
  const rows = Array.isArray(j?.patents) ? j.patents : [];
  return rows.map(normPatent).filter((x) => x.patentId || x.title);
}

// ── patentDetail — a full record for one patent ─────────────────────────────────────────────────────
// Pulls the patent plus counts: claims, cited references (us_patent_citations), and CPC classes.
// Returns a normalized object, or null on any failure.
export async function patentDetail(patentId) {
  const id = str(patentId);
  if (!id) return null;
  const q = { patent_id: id };
  const f = [
    'patent_id', 'patent_title', 'patent_date', 'patent_abstract', 'patent_type',
    'assignees.assignee_organization',
    'inventors.inventor_name_first', 'inventors.inventor_name_last',
    'cpc_current.cpc_group_id', 'cpc_current.cpc_group',
    'us_patent_citations.citation_patent_id',
    'claims.claim_sequence',
  ];
  const j = await post('/patent/', q, f, { size: 1 });
  const p = Array.isArray(j?.patents) ? j.patents[0] : null;
  if (!p) return null;
  const cpc = (Array.isArray(p.cpc_current) ? p.cpc_current : [])
    .map((c) => ({ id: str(c.cpc_group_id), label: str(c.cpc_group) }))
    .filter((c) => c.id);
  const citations = (Array.isArray(p.us_patent_citations) ? p.us_patent_citations : [])
    .map((c) => str(c.citation_patent_id)).filter(Boolean);
  const claimsCount = Array.isArray(p.claims) ? p.claims.length : 0;
  return {
    ...normPatent(p),
    type: str(p.patent_type),
    claimsCount,
    citationsCount: citations.length,
    citations,
    cpc,
  };
}

// ── byAssignee — an organization's patents ──────────────────────────────────────────────────────────
export async function byAssignee(name, { limit = 25 } = {}) {
  const org = str(name);
  if (!org) return [];
  return searchPatents({ assignee: org, limit });
}

// ── summary — counts by year + top assignees ────────────────────────────────────────────────────────
// data-only roll-up of a normalized result set (no network). Year is parsed from the patent_date.
export function summary(results) {
  const rows = Array.isArray(results) ? results : [];
  const byYear = {};
  const byAsg = {};
  for (const p of rows) {
    const y = str(p?.date).slice(0, 4);
    if (/^\d{4}$/.test(y)) byYear[y] = (byYear[y] || 0) + 1;
    const a = str(p?.assignee);
    if (a) byAsg[a] = (byAsg[a] || 0) + 1;
  }
  const topAssignees = Object.entries(byAsg)
    .map(([assignee, count]) => ({ assignee, count }))
    .sort((a, b) => b.count - a.count || (a.assignee < b.assignee ? -1 : 1))
    .slice(0, 10);
  return { total: rows.length, byYear, topAssignees };
}

// ── Provenance note ─────────────────────────────────────────────────────────────────────────────────
export function dataNote(asOf) {
  const when = str(asOf) || new Date().toISOString().slice(0, 10);
  return `source: ${SOURCE}, as of ${when}; granted-patent records, not legal advice`;
}

// ── Render an escaped HTML patents results list ──────────────────────────────────────────────────────
// data = { query, patents:[{patentId,title,date,assignee,inventors,abstract}], asOf }.
// All interpolated values are HTML-escaped. Returns a self-contained <section>.
export function renderPage(data = {}) {
  const patents = Array.isArray(data.patents) ? data.patents : [];
  const query = str(data.query);
  const items = patents.slice(0, 50).map((p) => {
    const invs = Array.isArray(p.inventors) ? p.inventors : [];
    const link = p.patentId ? `https://patents.google.com/patent/US${esc(p.patentId)}` : '';
    return [
      '  <li class="patent">',
      link
        ? `    <a href="${link}" rel="nofollow noopener"><strong>${esc(p.title || p.patentId)}</strong></a>`
        : `    <strong>${esc(p.title || '')}</strong>`,
      `    <span class="meta">${esc(p.patentId)}${p.date ? ' · ' + esc(p.date) : ''}${p.assignee ? ' · ' + esc(p.assignee) : ''}</span>`,
      invs.length ? `    <span class="inventors">${esc(invs.join(', '))}</span>` : '',
      p.abstract ? `    <p class="abstract">${esc(p.abstract)}</p>` : '',
      '  </li>',
    ].filter(Boolean).join('\n');
  }).join('\n');

  return [
    '<section class="patents">',
    `  <h2>Patent Search${query ? ' — ' + esc(query) : ''}</h2>`,
    items ? `  <ul class="results">\n${items}\n  </ul>` : '  <p class="empty">No patents found.</p>',
    `  <p class="note">${esc(dataNote(data.asOf))}</p>`,
    '</section>',
  ].filter(Boolean).join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('patents.mjs')) {
  const [cmd, ...rest] = process.argv.slice(2);
  const arg = rest.join(' ');
  const out = (label, v) => { console.log(`\n== ${label} ==`); console.log(JSON.stringify(v, null, 2)); };
  if (cmd === 'search') out('search', await searchPatents({ keyword: arg || 'neural network' }));
  else if (cmd === 'assignee') out('assignee', await byAssignee(arg || 'IBM'));
  else if (cmd === 'inventor') out('inventor', await searchPatents({ inventor: arg || 'Edison' }));
  else if (cmd === 'detail') out('detail', await patentDetail(arg || '10000000'));
  else if (cmd === 'summary') out('summary', summary(await searchPatents({ keyword: arg || 'solar' })));
  else if (cmd === 'page') console.log(renderPage({ query: arg, patents: await searchPatents({ keyword: arg || 'battery' }), asOf: new Date().toISOString().slice(0, 10) }));
  else console.log('usage: patents.mjs <search QUERY|assignee ORG|inventor NAME|detail PATENT_ID|summary QUERY|page QUERY>');
}
