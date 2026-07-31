// pentecaust/herald/outreach-db.mjs — Pentecaust HERALD: the Outreach / backlink database + dashboard.
//
// Component 3 of the Herald outreach brief: the "151-row backlink tracker becomes a shared live system."
// This is the SEO/backlink placement tracker — one row per link opportunity (a directory, forum, wiki,
// guest post, profile, social) that a persona works toward a target MELEK property. It is NOT the CRM in
// pentecaust/crm/model.mjs (that is the AI-SDR lead/campaign pipeline); this is the flat backlink dataset
// the spreadsheet held, now a live shared table with the same status/category/assignee roll-up formulas.
//
// Persistence mirrors pentecaust/crm/model.mjs: one JSON file, injectable fs, soft-fail-never-throw, fully
// offline-testable. NOTHING here touches the network — it is the off-chain roster + a read/update dashboard.
//
//   import { addRow, updateRow, getRow, allRows, removeRow, importRows, totals,
//            STATUSES, handler, __setAuth } from './outreach-db.mjs'
//
//   GET  /outreach            → auth-gated HTML table (all columns, esc()'d) + a totals summary
//   POST /outreach/update     → auth-gated {id,status,liveLinkUrl,notes} row update → {ok:true} JSON
//
//   PORT=8161 HERALD_OUTREACH_DATA=./data/outreach.json node pentecaust/herald/outreach-db.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('HERALD_OUTREACH_DATA', join(process.cwd(), 'data', 'outreach.json'));

// The lifecycle of one backlink placement (left→right). 'link_down' / 'rejected' are unhappy terminals.
export const STATUSES = ['planned', 'submitted', 'link_live', 'verified_dofollow', 'link_down', 'rejected'];

// Storage bounds — sane caps so one bad import can't blow up the JSON file.
const MAX_ROWS = Number(env('HERALD_MAX_ROWS', '20000')) || 20000;
const MAX_FIELD = 500;   // most text columns
const MAX_URL = 1000;    // urls run long
const MAX_NOTES = 2000;

const now = (opts) => (opts && opts.now != null ? opts.now : Date.now());
const clamp = (s, n) => String(s == null ? '' : s).slice(0, n);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── injectable fs + store (same discipline as pentecaust/crm/model.mjs) ──────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} try { writeFileSync(p, s); } catch {} },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { rows: [] };
  try { const o = JSON.parse(raw); return o && Array.isArray(o.rows) ? o : { rows: [] }; } catch { return { rows: [] }; }
}
function saveStore(fs, file, store) { (fs.write || realFs.write)(file, JSON.stringify(store)); }
const ctx = (opts = {}) => ({ fs: opts.fs || realFs, file: opts.file || DATA_FILE() });

// ── row normaliser — the xlsx import (and the API) emit VALUES into this fixed shape; never invent columns.
function normalizeRow(raw = {}, id) {
  const status = STATUSES.includes(raw.status) ? raw.status : 'planned';
  return {
    id,
    category: clamp(raw.category, MAX_FIELD),        // Directory / Forum / Wiki / Guest Post / Profile / Social
    site: clamp(raw.site, MAX_FIELD),                // the destination site's name
    url: clamp(raw.url, MAX_URL),                    // where the link is placed / the submission page
    linkType: clamp(raw.linkType, 60),              // dofollow / nofollow / ugc / sponsored
    persona: clamp(raw.persona, MAX_FIELD),          // which outreach persona works this row
    targetProperty: clamp(raw.targetProperty, MAX_URL), // the MELEK property being linked to
    assignedTo: clamp(raw.assignedTo, MAX_FIELD),    // MELEK account / operator handling it
    status,
    date: clamp(raw.date, 40),                       // free-form date string from the sheet
    liveLinkUrl: clamp(raw.liveLinkUrl, MAX_URL),    // the verified live backlink, once placed
    notes: clamp(raw.notes, MAX_NOTES),
  };
}

// Deterministic-ish id: store length + timestamp (NOT Math.random — reproducible under injected now()).
function makeId(store, opts) {
  const base = `row-${store.rows.length + 1}-${now(opts)}`;
  if (!store.rows.some((r) => r.id === base)) return base;
  for (let i = 2; i < 100000; i++) { const id = `${base}-${i}`; if (!store.rows.some((r) => r.id === id)) return id; }
  return base;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────────────────────────────
export function addRow(row = {}, opts = {}) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  if (store.rows.length >= MAX_ROWS) return { ok: false, reason: 'row cap reached' };
  const id = clamp(row.id, 120).trim() || makeId(store, opts);
  if (store.rows.some((r) => r.id === id)) return { ok: false, reason: 'duplicate id' };
  const r = normalizeRow(row, id);
  store.rows.push(r);
  saveStore(fs, file, store);
  return { ok: true, row: r };
}

export function getRow(id, opts = {}) {
  const { fs, file } = ctx(opts);
  return loadStore(fs, file).rows.find((r) => r.id === String(id || '')) || null;
}

export function allRows(opts = {}) {
  const { fs, file } = ctx(opts);
  return loadStore(fs, file).rows.slice();
}

export function updateRow(id, patch = {}, opts = {}) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const r = store.rows.find((x) => x.id === String(id || ''));
  if (!r) return { ok: false, reason: 'no such row' };
  // Only mutate provided keys; re-clamp through the normaliser so bad lengths/status can't slip in.
  const merged = normalizeRow({ ...r, ...patch }, r.id);
  Object.assign(r, merged);
  saveStore(fs, file, store);
  return { ok: true, row: r };
}

export function removeRow(id, opts = {}) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const i = store.rows.findIndex((r) => r.id === String(id || ''));
  if (i < 0) return { ok: false, reason: 'no such row' };
  const [removed] = store.rows.splice(i, 1);
  saveStore(fs, file, store);
  return { ok: true, row: removed };
}

// ── bulk import (the xlsx → rows path) ────────────────────────────────────────────────────────────────
export function importRows(rowsArray, opts = {}) {
  const list = Array.isArray(rowsArray) ? rowsArray : [];
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  let added = 0;
  for (const raw of list) {
    if (store.rows.length >= MAX_ROWS) break;
    const id = clamp(raw && raw.id, 120).trim() || makeId(store, opts);
    if (store.rows.some((r) => r.id === id)) continue;  // skip collisions, keep going
    store.rows.push(normalizeRow(raw || {}, id));
    added++;
  }
  saveStore(fs, file, store);
  return { ok: true, added };
}

// ── roll-up (the spreadsheet's COUNTIF formulas: total + counts by status / category / assignee) ──────
export function totals(opts = {}) {
  const rows = allRows(opts);
  const byStatus = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const byCategory = {};
  const byAssignee = {};
  for (const r of rows) {
    if (byStatus[r.status] != null) byStatus[r.status]++;
    const cat = r.category || '(uncategorized)';
    byCategory[cat] = (byCategory[cat] || 0) + 1;
    const who = r.assignedTo || '(unassigned)';
    byAssignee[who] = (byAssignee[who] || 0) + 1;
  }
  return { total: rows.length, byStatus, byCategory, byAssignee };
}

// ── dashboard HTML ────────────────────────────────────────────────────────────────────────────────────
const COLS = ['category', 'site', 'url', 'linkType', 'persona', 'targetProperty', 'assignedTo', 'status', 'date', 'liveLinkUrl', 'notes'];

function summaryHtml(t) {
  const kv = (obj) => Object.entries(obj).map(([k, v]) => `<li>${esc(k)}: ${esc(v)}</li>`).join('');
  return `<section class="summary">
    <p><strong>Total rows:</strong> ${esc(t.total)}</p>
    <h3>By status</h3><ul>${kv(t.byStatus)}</ul>
    <h3>By category</h3><ul>${kv(t.byCategory)}</ul>
    <h3>By assignee</h3><ul>${kv(t.byAssignee)}</ul>
  </section>`;
}

function tableHtml(rows) {
  const head = `<tr>${['id', ...COLS].map((c) => `<th>${esc(c)}</th>`).join('')}</tr>`;
  const body = rows.map((r) =>
    `<tr>${[r.id, ...COLS.map((c) => r[c])].map((v) => `<td>${esc(v)}</td>`).join('')}</tr>`
  ).join('');
  return `<table><thead>${head}</thead><tbody>${body}</tbody></table>`;
}

function pageHtml(opts) {
  const rows = allRows(opts);
  const t = totals(opts);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>Herald Outreach — backlink tracker</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font-family:system-ui,sans-serif;margin:1.2rem;color:#1a1a2e}
.alpha{position:fixed;top:6px;left:6px;font-size:11px;background:#6c3;color:#fff;padding:1px 6px;border-radius:4px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f0f0f5}.summary ul{margin:.2rem 0}</style></head>
<body><span class="alpha">Alpha</span>
<h1>Herald Outreach — backlink tracker</h1>
${summaryHtml(t)}
<h2>Rows (${esc(rows.length)})</h2>
${tableHtml(rows)}
</body></html>`;
}

// ── HTTP surface ──────────────────────────────────────────────────────────────────────────────────────
// Auth is an injected predicate (DENY by default). The dashboard exposes the full backlink dataset + a
// row-update write, so an unauthenticated request gets 401 — never the table, never a mutation.
let _auth = () => false;
export function __setAuth(fn) { _auth = typeof fn === 'function' ? fn : () => false; }

const sendHtml = (res, code, html) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }); res.end(html); };
const sendJson = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
const unauth = (res) => sendJson(res, 401, { ok: false, reason: 'authentication required' });

// Body reader: accept an already-parsed req.body (tests), else read + JSON.parse the stream. Never throws.
function readJsonBody(req, max = 65536) {
  if (req && req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let d = ''; let over = false;
    try {
      req.on('data', (c) => { d += c; if (d.length > max) { over = true; try { req.destroy(); } catch {} } });
      req.on('end', () => { if (over) return resolve(null); try { resolve(d ? JSON.parse(d) : {}); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

export async function handler(req, res, opts = {}) {
  try {
    const method = (req.method || 'GET').toUpperCase();
    const path = String(req.url || '').split('?')[0].replace(/\/+$/, '') || '/';

    let ok = false; try { ok = !!_auth(req); } catch { ok = false; }
    if (!ok) return unauth(res);

    if (path === '/outreach' && method === 'GET') {
      return sendHtml(res, 200, pageHtml(opts));
    }
    if (path === '/outreach/update' && method === 'POST') {
      const body = await readJsonBody(req);
      if (!body || !body.id) return sendJson(res, 400, { ok: false, reason: 'bad-body' });
      const patch = {};
      if (body.status != null) patch.status = body.status;
      if (body.liveLinkUrl != null) patch.liveLinkUrl = body.liveLinkUrl;
      if (body.notes != null) patch.notes = body.notes;
      const r = updateRow(body.id, patch, opts);
      if (r.ok === false) return sendJson(res, 404, r);
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 404, { ok: false, reason: 'not-found' });
  } catch {
    try { return sendJson(res, 500, { ok: false, reason: 'error' }); } catch { return undefined; }
  }
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const PORT = +(env('PORT', '8161'));
  const HOST = env('HOST', '127.0.0.1');
  // Local/dev only: trust every request so the dashboard is browsable. Production injects a real predicate.
  if (env('HERALD_DEV_TRUST', '') === '1') __setAuth(() => true);
  createServer((req, res) => handler(req, res)).listen(PORT, HOST, () => {
    console.log(`herald outreach-db on http://${HOST}:${PORT}/outreach`);
  });
}
