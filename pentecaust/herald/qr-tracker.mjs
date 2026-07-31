// pentecaust/herald/qr-tracker.mjs — Herald QR / landing tracker (outreach brief, Component 2).
//
// Printed signage (laundromat / pizza-shop / dart-league flyers) carries a QR code that encodes a SHORT
// campaign URL — BASE_URL/go/{campaign-code} (e.g. /go/laundro-03). A phone that scans it hits THIS service,
// which logs the scan (coarse only — timestamp, user-agent, referer HOST) and 301-redirects to the real
// landing page with UTM params attached, so downstream analytics can attribute the visit to the print run.
//
// This is the tracker + redirector + a tiny dashboard. It DOES NOT rasterize QR bitmaps — that is a separate
// print step. qrTargetUrl(code) returns the URL to encode; qrSvgPlaceholder(code) returns a text-only SVG
// stand-in so print can be wired later. Same edge discipline as the rest of pentecaust: injectable fs store,
// injectable time, soft-fail-never-throw, esc() all HTML interpolation, auth-gated dashboard.
//
//   import { registerCampaign, qrTargetUrl, qrSvgPlaceholder, scanStats, handler, __setAuth } from './qr-tracker.mjs'
//
//   GET /go/{code}     → log scan + 301 to landingUrl?utm_source=qr&utm_medium=print&utm_campaign={code}
//   GET /go-dashboard  → (auth-gated) HTML table of scans-per-campaign-per-week

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('HERALD_QR_DATA', join(process.cwd(), 'data', 'qr-scans.json'));
const BASE_URL = () => (env('BASE_URL', 'https://melek.salon') || 'https://melek.salon').replace(/\/$/, '');

const now = (o) => (o && o.now != null ? o.now : Date.now());
const CODE_RE = /^[a-z0-9-]{1,40}$/;
const isCode = (c) => CODE_RE.test(String(c || ''));

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── injectable fs + store ─────────────────────────────────────────────────────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { campaigns: {}, scans: [] };
  try {
    const o = JSON.parse(raw);
    return o && typeof o === 'object'
      ? { campaigns: o.campaigns || {}, scans: Array.isArray(o.scans) ? o.scans : [] }
      : { campaigns: {}, scans: [] };
  } catch { return { campaigns: {}, scans: [] }; }
}
const saveStore = (fs, file, s) => (fs.write || realFs.write)(file, JSON.stringify(s));
const ctx = (o = {}) => ({ fs: o.fs || realFs, file: o.file || DATA_FILE() });

// ── auth predicate (dashboard gate) ────────────────────────────────────────────────────────────────────
let _authed = (req) => true; // eslint-disable-line no-unused-vars
export function __setAuth(fn) { _authed = typeof fn === 'function' ? fn : ((req) => true); }

// ── campaign registration ─────────────────────────────────────────────────────────────────────────────
export function registerCampaign(code, info = {}, opts = {}) {
  const c = String(code || '').toLowerCase().trim();
  if (!isCode(c)) return { ok: false, reason: 'invalid campaign code (a-z 0-9 - , 1-40 chars)' };
  const landingUrl = String(info.landingUrl || '').trim();
  if (!landingUrl || !/^https?:\/\//i.test(landingUrl)) return { ok: false, reason: 'landingUrl (http/https) required' };
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  store.campaigns[c] = {
    code: c,
    landingUrl,
    label: String(info.label || '').slice(0, 200),
    createdAt: now(opts),
  };
  saveStore(fs, file, store);
  return { ok: true, campaign: store.campaigns[c] };
}

export function getCampaign(code, opts = {}) {
  const { fs, file } = ctx(opts);
  return loadStore(fs, file).campaigns[String(code || '').toLowerCase().trim()] || null;
}

// ── printed-signage helpers (NO bitmap encoding — that is a separate print step) ────────────────────────
export function qrTargetUrl(code) {
  const c = String(code || '').toLowerCase().trim();
  return `${BASE_URL()}/go/${isCode(c) ? c : ''}`;
}

// Text-only SVG stand-in so the print pipeline can be wired later; real QR raster is a downstream step.
export function qrSvgPlaceholder(code) {
  const c = String(code || '').toLowerCase().trim();
  const url = qrTargetUrl(c);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240" role="img" aria-label="QR placeholder for ${esc(c)}">`
    + `<rect width="240" height="240" fill="#fff" stroke="#000" stroke-width="4"/>`
    + `<text x="120" y="110" text-anchor="middle" font-family="monospace" font-size="18" fill="#000">${esc(c || '(none)')}</text>`
    + `<text x="120" y="150" text-anchor="middle" font-family="monospace" font-size="10" fill="#333">${esc(url)}</text>`
    + `<text x="120" y="200" text-anchor="middle" font-family="sans-serif" font-size="10" fill="#888">[QR raster: print step]</text>`
    + `</svg>`;
}

// ── UTM merge: append the print-attribution params, preserving any query already on the landing URL ─────
function withUtm(landingUrl, code) {
  const params = { utm_source: 'qr', utm_medium: 'print', utm_campaign: code };
  const qs = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
  const hashAt = landingUrl.indexOf('#');
  const hash = hashAt >= 0 ? landingUrl.slice(hashAt) : '';
  const base = hashAt >= 0 ? landingUrl.slice(0, hashAt) : landingUrl;
  const sep = base.includes('?') ? '&' : '?';
  return base + sep + qs + hash;
}

// ── ISO week key (e.g. 2026-W31) — groups scans for the dashboard ──────────────────────────────────────
function isoWeek(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '0000-W00';
  // Copy to UTC, shift to nearest Thursday (ISO-8601 week belongs to the year of its Thursday).
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; // Sun=0 → 7
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// Coarse referer: HOST only (never the full URL — no path/query leakage into the scan log).
function refererHost(req) {
  const raw = (req && req.headers && (req.headers.referer || req.headers.referrer)) || '';
  if (!raw) return '';
  try { return new URL(String(raw)).host; } catch {}
  return String(raw).replace(/^https?:\/\//i, '').split('/')[0].split('?')[0].slice(0, 120);
}

function logScan(fs, file, scan) {
  const store = loadStore(fs, file);
  store.scans.push(scan);
  saveStore(fs, file, store);
}

// ── stats ─────────────────────────────────────────────────────────────────────────────────────────────
export function scanStats(opts = {}) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const out = {};
  for (const s of store.scans) {
    const code = s && s.code;
    if (!code) continue;
    if (!out[code]) out[code] = { total: 0, byWeek: {} };
    out[code].total += 1;
    const wk = isoWeek(s.ts);
    out[code].byWeek[wk] = (out[code].byWeek[wk] || 0) + 1;
  }
  return out;
}

// ── HTTP handler ──────────────────────────────────────────────────────────────────────────────────────
function send(res, code, headers, body) {
  try { res.writeHead(code, headers || {}); } catch {}
  try { res.end(body == null ? '' : body); } catch {}
}

export function handler(req, res, opts = {}) {
  const { fs, file } = ctx(opts);
  const method = (req && req.method) || 'GET';
  let path = String((req && req.url) || '/');
  const q = path.indexOf('?'); if (q >= 0) path = path.slice(0, q);

  // GET /go/{code} — log + redirect
  const m = path.match(/^\/go\/([^/]*)$/);
  if (method === 'GET' && m) {
    const code = decodeURIComponent(m[1] || '').toLowerCase();
    const camp = isCode(code) ? loadStore(fs, file).campaigns[code] : null;
    if (!camp) {
      return send(res, 302, { Location: BASE_URL() }, '');
    }
    logScan(fs, file, {
      ts: now(opts),
      code,
      ua: (req && req.headers && req.headers['user-agent']) || '',
      ref: refererHost(req),
    });
    return send(res, 301, { Location: withUtm(camp.landingUrl, code) }, '');
  }

  // GET /go-dashboard — auth-gated scans-per-campaign-per-week table
  if (method === 'GET' && path === '/go-dashboard') {
    let ok = false;
    try { ok = !!_authed(req); } catch { ok = false; }
    if (!ok) return send(res, 401, { 'content-type': 'text/plain; charset=utf-8' }, 'unauthorized');
    return send(res, 200, { 'content-type': 'text/html; charset=utf-8' }, dashboardHtml(opts));
  }

  return send(res, 404, { 'content-type': 'text/plain; charset=utf-8' }, 'not found');
}

function dashboardHtml(opts) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const stats = scanStats(opts);
  // last scanned UA per campaign, escaped — the dashboard renders untrusted UA strings.
  const lastUa = {};
  for (const s of store.scans) { if (s && s.code) lastUa[s.code] = s.ua || ''; }

  const weeks = new Set();
  for (const code of Object.keys(stats)) for (const w of Object.keys(stats[code].byWeek)) weeks.add(w);
  const weekList = [...weeks].sort();

  const codes = Object.keys(stats).sort();
  const rows = codes.map((code) => {
    const camp = store.campaigns[code] || {};
    const cells = weekList.map((w) => `<td>${esc(String(stats[code].byWeek[w] || 0))}</td>`).join('');
    return `<tr><td>${esc(code)}</td><td>${esc(camp.label || '')}</td><td>${esc(String(stats[code].total))}</td>${cells}<td class="ua">${esc(lastUa[code] || '')}</td></tr>`;
  }).join('');

  const head = weekList.map((w) => `<th>${esc(w)}</th>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Herald QR — scans</title>`
    + `<style>body{font-family:system-ui,sans-serif;margin:2rem;color:#111}table{border-collapse:collapse}`
    + `th,td{border:1px solid #ccc;padding:.35rem .6rem;text-align:left;font-size:14px}th{background:#f4f4f4}`
    + `.ua{color:#666;font-size:12px;max-width:22rem;overflow:hidden;text-overflow:ellipsis}</style>`
    + `<h1>Herald QR — scans per campaign per week</h1>`
    + `<table><thead><tr><th>code</th><th>label</th><th>total</th>${head}<th>last UA</th></tr></thead>`
    + `<tbody>${rows || '<tr><td colspan="4">no scans yet</td></tr>'}</tbody></table>`;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const PORT = +(env('PORT', '8161'));
  const HOST = env('HOST', '127.0.0.1');
  createServer((req, res) => handler(req, res)).listen(PORT, HOST, () => {
    // eslint-disable-next-line no-console
    console.log(`herald qr-tracker on http://${HOST}:${PORT}  (BASE_URL=${BASE_URL()})`);
  });
}
