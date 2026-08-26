// analytics-collector.mjs — the first-party, COOKIELESS analytics collector for the whole network.
//
// This is the durable backend the pageview beacon writes into (see site/analytics/server.mjs). It is
// the promotion of integrations/analytics-selfhost.mjs's privacy model into a real, on-disk store —
// but deliberately DEPENDENCY-FREE: an append-only JSONL file store, NOT SQLite/native deps (disk is
// tight, and house style is flat files + injectable seams). One import, no build step.
//
// PRIVACY POSTURE (load-bearing — do not weaken):
//   • NO cookies, NO IP stored, NO PII, NO raw User-Agent stored. A visit is reduced to a handful of
//     coarse, unlinkable fields: { ts, day, path, host, ref (referrer HOST only), device (coarse
//     class), type }. There is no visitor id, no session id, nothing that can re-identify a person.
//   • The referrer is reduced to its hostname before it is ever written — a full referrer URL (which
//     can carry PII in its path/query) never touches the store.
//   • The device class is derived from the UA in memory and the UA is DISCARDED — only the coarse
//     bucket ('mobile' | 'tablet' | 'bot' | 'desktop' | 'unknown') is stored.
//
// DURABILITY & BOUNDS (can't fill the disk):
//   • Append-only JSONL at <dir>/events.jsonl (dir = ANALYTICS_DIR, default repo-local .analytics/).
//   • When the active file crosses ANALYTICS_MAX_BYTES it ROTATES to events-<ts>.jsonl, and rotated
//     files beyond ANALYTICS_MAX_FILES are pruned oldest-first. Total on-disk is therefore bounded.
//
// SOFT-FAIL: record()/aggregate() NEVER throw — analytics must never break a page or a request path.
// Bad input, a read-only fs, a corrupt line: all degrade to a null/empty return, never an exception.
//
// INJECTABLE SEAMS (offline, temp-dir tests): every function takes an options bag with { dir, now, fs }
// so a test can point at an os.tmpdir() directory, inject a fixed clock, and run fully offline. There
// is also a module-level __setNow / __setFs for the default path.
//
//   import { record, aggregate } from './analytics-collector.mjs'
//   record({ path: '/markets', host: 'data.soapbox.community', ref: 'https://news.ycombinator.com/x', ua });
//   aggregate({ since: '2026-08-01' });   // → { pageviews, topPaths, topHosts, topReferrers, byDay, ... }
//   node integrations/analytics-collector.mjs   # tiny offline demo

import * as nodeFs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..');

// ── injectable clock (default path) ────────────────────────────────────────────────────────────────
let _now = () => Date.now();
export function __setNow(fn) { _now = typeof fn === 'function' ? fn : (() => Date.now()); }

// ── injectable fs seam (default path) — only the handful of methods we use ───────────────────────────
let _fs = nodeFs;
export function __setFs(fs) { _fs = fs || nodeFs; }

// ── config (env-overridable; all bounded) ────────────────────────────────────────────────────────────
export const DEFAULT_DIR = () => process.env.ANALYTICS_DIR || join(REPO_ROOT, '.analytics');
const ACTIVE_FILE = 'events.jsonl';
const ROTATE_PREFIX = 'events-';
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? Math.floor(n) : d; };
const MAX_BYTES = () => num(process.env.ANALYTICS_MAX_BYTES, 5 * 1024 * 1024); // 5 MB per file
const MAX_FILES = () => num(process.env.ANALYTICS_MAX_FILES, 10);              // + active ⇒ ≤ ~55 MB total
const MAX_FIELD = 200; // hard cap on any stored string field

// ── pure field helpers (exported for tests) ──────────────────────────────────────────────────────────
const REF_NONE = '(direct)';

/** Reduce any referrer/URL to its HOSTNAME only — a full URL (with PII in path/query) is never stored. */
export function refHost(u) {
  const s = String(u == null ? '' : u).trim();
  if (!s) return REF_NONE;
  try {
    const h = new URL(s).hostname;
    return h ? h.slice(0, MAX_FIELD) : REF_NONE;
  } catch {
    // not a full URL — if it already looks like a bare host, keep it; else treat as direct.
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s) ? s.slice(0, MAX_FIELD) : REF_NONE;
  }
}

/** Normalise a path: strip query/fragment (they can carry PII), cap length, default '/'. */
export function normPath(p) {
  const s = String(p == null ? '' : p).trim();
  if (!s) return '/';
  const clean = s.split('?')[0].split('#')[0].slice(0, MAX_FIELD);
  return clean || '/';
}

/** Host of a page, hostname-only, lowercased. '' when unknown. */
export function normHost(h) {
  const s = String(h == null ? '' : h).trim().toLowerCase();
  if (!s) return '';
  // accept a bare host or a full URL; store hostname only, no port.
  try { if (/^https?:\/\//i.test(s)) return (new URL(s).hostname || '').slice(0, MAX_FIELD); } catch { /* fall */ }
  return s.replace(/:\d+$/, '').slice(0, MAX_FIELD);
}

/** Day bucket (UTC 'YYYY-MM-DD') from a ts (number ms or date string). Coarse — no hour/minute kept. */
export function dayOf(ts) {
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return 'unknown';
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * COARSE device class from a UA string. The UA itself is NEVER stored — only this bucket is. Kept
 * deliberately crude (no version, no model): mobile / tablet / bot / desktop / unknown.
 */
export function deviceClass(ua) {
  const s = String(ua == null ? '' : ua);
  if (!s) return 'unknown';
  if (/bot|crawl|spider|slurp|bingpreview|facebookexternalhit|feedfetcher|curl|wget|python-requests|headless/i.test(s)) return 'bot';
  if (/\bipad\b|\btablet\b|\bkindle\b|\bplaybook\b|\bsilk\b|(android(?!.*mobile))/i.test(s)) return 'tablet';
  if (/mobi|iphone|ipod|android.*mobile|windows phone|blackberry|iemobile|opera mini/i.test(s)) return 'mobile';
  if (/mozilla|applewebkit|gecko|trident|edge|chrome|safari|firefox|opera/i.test(s)) return 'desktop';
  return 'unknown';
}

// ── store internals ──────────────────────────────────────────────────────────────────────────────────
function ensureDir(fs, dir) {
  try { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }); return true; }
  catch { return false; }
}

function rotatedFiles(fs, dir) {
  let names = [];
  try { names = fs.readdirSync(dir) || []; } catch { return []; }
  return names
    .filter((n) => typeof n === 'string' && n.startsWith(ROTATE_PREFIX) && n.endsWith('.jsonl'))
    .sort(); // ROTATE_PREFIX + zero-padded-ish ts → lexical sort ≈ chronological
}

// Rotate the active file out of the way when it's grown past MAX_BYTES, then prune old rotations.
function maybeRotate(fs, dir, now) {
  const active = join(dir, ACTIVE_FILE);
  let size = 0;
  try { size = fs.existsSync(active) ? (fs.statSync(active).size || 0) : 0; } catch { size = 0; }
  if (size < MAX_BYTES()) return;
  // move active → events-<ts>.jsonl (ts padded to a fixed width so lexical == chronological for ~300y)
  const stamp = String(now()).padStart(16, '0');
  const dest = join(dir, `${ROTATE_PREFIX}${stamp}.jsonl`);
  try { fs.renameSync(active, dest); } catch { return; /* couldn't rotate → leave as-is, still bounded-ish */ }
  // prune oldest rotations beyond the cap
  try {
    const rot = rotatedFiles(fs, dir);
    const excess = rot.length - MAX_FILES();
    for (let i = 0; i < excess; i++) {
      try { fs.unlinkSync(join(dir, rot[i])); } catch { /* ignore */ }
    }
  } catch { /* ignore prune failure */ }
}

/**
 * record(event, opts?) — append ONE cookieless event to the durable JSONL store. Soft-fail: returns the
 * stored row on success, or null on any problem (bad input, unwritable fs). NEVER throws.
 *
 * event: {
 *   path,            // page path (query/fragment stripped)
 *   host,            // page host (hostname only)
 *   ref,             // referrer — reduced to HOST ONLY before storage
 *   ua,              // (optional) UA string — used ONLY to derive `device`, then DISCARDED, never stored
 *   device,          // (optional) pre-derived coarse class; overrides ua-derivation
 *   type,            // event type, default 'pageview'
 *   ts,              // (optional) timestamp ms; default injected clock
 * }
 * opts: { dir, now, fs } injectable seams (offline temp-dir tests).
 */
export function record(event = {}, opts = {}) {
  try {
    const fs = opts.fs || _fs;
    const now = typeof opts.now === 'function' ? opts.now : _now;
    const dir = opts.dir || DEFAULT_DIR();
    const at = Number.isFinite(+event.ts) ? +event.ts : now();

    const row = {
      ts: at,
      day: dayOf(at),
      type: String(event.type || 'pageview').slice(0, 64),
      path: normPath(event.path),
      host: normHost(event.host),
      ref: refHost(event.ref),
      // device: prefer an explicit coarse class; else derive from ua IN MEMORY and drop the ua.
      device: event.device ? String(event.device).slice(0, 32) : deviceClass(event.ua),
    };

    if (!ensureDir(fs, dir)) return null;
    maybeRotate(fs, dir, now);
    const line = JSON.stringify(row) + '\n';
    try { fs.appendFileSync(join(dir, ACTIVE_FILE), line); }
    catch { return null; } // read-only fs etc. → soft-fail
    return row;
  } catch {
    return null; // analytics must never throw into a request path
  }
}

// ── reading + aggregation ────────────────────────────────────────────────────────────────────────────
function readLines(fs, file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  if (!raw) return [];
  const out = [];
  for (const ln of raw.split('\n')) {
    const s = ln.trim();
    if (!s) continue;
    try { const o = JSON.parse(s); if (o && typeof o === 'object') out.push(o); }
    catch { /* skip a corrupt/half-written line — soft-fail */ }
  }
  return out;
}

/** All events across the active file + every rotation, oldest-first-ish. Never throws. */
export function readAllEvents(opts = {}) {
  try {
    const fs = opts.fs || _fs;
    const dir = opts.dir || DEFAULT_DIR();
    const files = [...rotatedFiles(fs, dir), ACTIVE_FILE]; // rotations (older) then active (newest)
    const all = [];
    for (const f of files) for (const ev of readLines(fs, join(dir, f))) all.push(ev);
    return all;
  } catch { return []; }
}

const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
const topN = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, n);

/**
 * aggregate({ since, until, type, top, dir, now, fs }) → a privacy-safe rollup:
 *   { pageviews, byDevice, topPaths, topHosts, topReferrers, byDay, span }
 * `since`/`until` are inclusive day strings ('YYYY-MM-DD') or timestamps. `top` caps the top-N lists
 * (default 20). PURE read: computes nothing it can't measure; empty store → all-zero shape. Never throws.
 */
export function aggregate(opts = {}) {
  const empty = { pageviews: 0, byDevice: {}, topPaths: [], topHosts: [], topReferrers: [], byDay: [], span: { from: null, to: null } };
  try {
    const top = num(opts.top, 20);
    const type = opts.type === undefined ? 'pageview' : opts.type; // null/'' → count all types
    const sinceDay = opts.since == null ? null : (String(opts.since).length === 10 ? String(opts.since) : dayOf(opts.since));
    const untilDay = opts.until == null ? null : (String(opts.until).length === 10 ? String(opts.until) : dayOf(opts.until));

    const events = readAllEvents(opts);
    const paths = {}, hosts = {}, refs = {}, days = {}, devices = {};
    let pageviews = 0; let minDay = null; let maxDay = null;

    for (const ev of events) {
      if (!ev || typeof ev !== 'object') continue;
      if (type && ev.type !== type) continue;
      const d = ev.day || dayOf(ev.ts);
      if (sinceDay && d < sinceDay) continue;
      if (untilDay && d > untilDay) continue;
      pageviews++;
      bump(paths, ev.path || '/');
      if (ev.host) bump(hosts, ev.host);
      bump(refs, ev.ref || REF_NONE);
      bump(days, d);
      bump(devices, ev.device || 'unknown');
      if (minDay == null || d < minDay) minDay = d;
      if (maxDay == null || d > maxDay) maxDay = d;
    }

    return {
      pageviews,
      byDevice: devices,
      topPaths: topN(paths, top),
      topHosts: topN(hosts, top),
      topReferrers: topN(refs, top),
      byDay: Object.entries(days).sort().map(([d, c]) => [d, c]),
      span: { from: minDay, to: maxDay },
    };
  } catch { return empty; }
}

// ── CLI — tiny offline demo (no network, writes to a temp dir, prints an aggregate) ──────────────────
if (process.argv[1] && process.argv[1].endsWith('analytics-collector.mjs')) {
  const os = await import('node:os');
  const dir = join(os.tmpdir(), 'analytics-collector-demo-' + Date.now());
  const day = Date.parse('2026-08-20T12:00:00Z');
  record({ path: '/markets?ref=x', host: 'data.soapbox.community', ref: 'https://news.ycombinator.com/item?id=1', ua: 'Mozilla/5.0 (iPhone)', ts: day }, { dir });
  record({ path: '/markets', host: 'data.soapbox.community', ua: 'Mozilla/5.0 (X11; Linux)', ts: day }, { dir });
  record({ path: '/stocks', host: 'stocks.soapbox.community', ref: 'https://www.google.com/search?q=y', ua: 'GPTBot/1.0', ts: day + 86400000 }, { dir });
  const a = aggregate({ dir });
  console.log('analytics-collector — cookieless, no PII, JSONL store — demo:\n' + '─'.repeat(60));
  console.log(`  pageviews: ${a.pageviews}   devices: ${JSON.stringify(a.byDevice)}   span: ${a.span.from}..${a.span.to}`);
  console.log('  top paths:'); for (const [p, c] of a.topPaths) console.log(`    ${String(c).padStart(4)}  ${p}`);
  console.log('  top hosts:'); for (const [h, c] of a.topHosts) console.log(`    ${String(c).padStart(4)}  ${h}`);
  console.log('  referrers:'); for (const [r, c] of a.topReferrers) console.log(`    ${String(c).padStart(4)}  ${r}`);
  console.log('  stored row (note: no ip/ua/cookie):', JSON.stringify(readAllEvents({ dir })[0]));
  console.log('─'.repeat(60), '\n  store dir:', dir);
}
