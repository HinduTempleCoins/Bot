// self-crawl-schedule.mjs — the schedule/selector layer for the self-crawl → annal/brief loop (task #54).
//
// This module decides WHICH repo files/sources are DUE to be (re)crawled into annals, on what cadence,
// and verifies the crawl loop actually fired within its expected window. It is the deterministic
// SCHEDULER/SELECTOR — NOT the crawler itself (the website crawler is self-crawl.mjs, #157; the corpus
// ingest-delta manifest is corpus tooling, #152). Those DO the work; this one says when and on what.
//
// The cadence concepts mirror diagnostics-pipeline.mjs and the operator's "resource timing tiers":
//   - a pre-conference BATCH runs 1–2× per day, aligned to the 12-and-12 conference rhythm (twice daily,
//     UTC 06:00 + 18:00). Most files ride this batch.
//   - PER-FILE GRANULAR (JIT): hot/core paths come due more often than once a day, so a granular pass
//     just before annaling a file picks them up; cold corpus comes due weekly.
//
// Priority weighting follows the resident-AI index: Hathor / Cheetah / signup / chain core paths are the
// most load-bearing → 'high'; ordinary integrations/witness/tutorial code → 'medium'; the stable
// knowledge/scripture corpus changes rarely → 'low'.
//
//   import { dueForCrawl, assignCadence, buildSchedule, verifyLoopFired, markCrawled } from './self-crawl-schedule.mjs'
//   const sched = buildSchedule(items, { now: Date.now() });   // { due, next, summary }
//   const health = verifyLoopFired(history, { now: Date.now() }); // { ok, lastRun, gapMs, stale }
//   node integrations/self-crawl-schedule.mjs                   // CLI: print due set + loop health
//
// Pure scheduling logic throughout. Injectable clock + injectable file-lister/stat so tests run fully
// offline. Soft-fail: bad input degrades to an empty/safe result, never a throw. No secrets, no network.

import { readdirSync, statSync } from 'node:fs';

// ── cadences ───────────────────────────────────────────────────────────────────────────────────────
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

// The two daily 12-and-12 conferences (UTC). The batch is meant to run shortly before each, so a
// daily-cadence item recrawled at one conference is fresh for the next ~12h until the following one.
export const CONFERENCE_HOURS_UTC = [6, 18];

// Named cadences → minimum interval between (re)crawls, plus a human label. Aligned to the conference
// rhythm: 'high' comes due twice a conference-window (so the JIT/per-file pass catches it), 'medium'
// rides the once-a-day batch, 'low' is the slow corpus tier.
export const CADENCES = {
  high: { intervalMs: 6 * HOUR, label: 'high — core paths, every 6h (≈2× per conference window)' },
  medium: { intervalMs: 1 * DAY, label: 'medium — daily, rides the pre-conference batch' },
  low: { intervalMs: 1 * WEEK, label: 'low — weekly, stable corpus' },
};
export const CADENCE_ORDER = ['high', 'medium', 'low'];
const DEFAULT_CADENCE = 'medium';

// How long the whole crawl loop is allowed to go silent before we call it stale. The loop is supposed
// to fire at least once per conference window (~12h); we give it a grace margin to one full day.
export const DEFAULT_MAX_GAP_MS = 26 * HOUR;

/** Resolve a cadence name (or interval-bearing object) to its interval in ms. Unknown → default. */
export function cadenceIntervalMs(cadence) {
  if (cadence && typeof cadence === 'object' && Number.isFinite(+cadence.intervalMs)) return +cadence.intervalMs;
  const c = CADENCES[cadence] || CADENCES[DEFAULT_CADENCE];
  return c.intervalMs;
}

// ── cadence assignment ───────────────────────────────────────────────────────────────────────────
// Priority weighting from the resident-AI index (CLAUDE.md): Hathor / Cheetah / Signup / chain core are
// the load-bearing paths and earn the fastest cadence; the stable scripture corpus earns the slowest.

const HIGH_PATTERNS = [
  /(^|\/)witness\//i,           // block production / price feed / account creation — most live
  /(^|\/)signup\//i,            // signup mechanics
  /hathor/i,                    // anything Hathor-named (persona, account ops)
  /cheetah/i,                   // the sibling librarian bot
  /(^|\/)src\/chain\//i,        // chain-client scaffolding (graphene/keys)
  /(^|\/)src\/trollbox\//i,     // condenser signup-help endpoint
  /(^|\/)voting_rules\//i,      // witness voting + curation rules
];
// Binary/asset extensions carry no narrative — they never churn, so they're 'low' regardless of path
// (checked BEFORE the high-priority path patterns, so e.g. a hathor render PNG stays low, not high).
const ASSET_PATTERN = /\.(png|jpg|jpeg|gif|webp|svg|pdf|ico|woff2?|ttf|eot|mp4|mp3|zip)$/i;
const LOW_PATTERNS = [
  /(^|\/)knowledge\/scripture\//i,  // canonical operator docs — change rarely, foundational
  /(^|\/)LINEAGE\.md$/i,            // dated history, append-rarely
];
const MEDIUM_PATTERNS = [
  /(^|\/)integrations\//i,      // active data/integration code
  /(^|\/)tutorial\//i,          // staged onboarding
  /(^|\/)karma\//i,             // off-chain karma
  /(^|\/)system_prompts\//i,    // assembled prompts
  /(^|\/)knowledge\//i,         // rest of the corpus (non-scripture)
  /\.(md|mjs|js|json)$/i,       // ordinary source / docs
];

/**
 * Infer a cadence ('high' | 'medium' | 'low') from a repo-relative path. Deterministic + pure.
 * Order of precedence: high (core) → low (stable corpus/binaries) → medium (everything else).
 * @param {string} path
 * @returns {'high'|'medium'|'low'}
 */
export function assignCadence(path) {
  const p = String(path || '');
  if (!p) return DEFAULT_CADENCE;
  if (ASSET_PATTERN.test(p)) return 'low';          // binaries never churn — slowest tier, beats path
  if (HIGH_PATTERNS.some((re) => re.test(p))) return 'high';
  if (LOW_PATTERNS.some((re) => re.test(p))) return 'low';
  if (MEDIUM_PATTERNS.some((re) => re.test(p))) return 'medium';
  return DEFAULT_CADENCE;
}

// ── due selection ──────────────────────────────────────────────────────────────────────────────────
/**
 * Given crawl items, return the subset that is DUE: never-crawled items, or items whose age since
 * lastCrawledAt has reached/exceeded their cadence interval. Pure — does not mutate input.
 *
 * @param {Array<{ path:string, cadence?:string, lastCrawledAt?:number|string|null }>} items
 * @param {{ now?: number }} [opts]
 * @returns {Array} the due subset (same object refs as input, filtered)
 */
export function dueForCrawl(items, { now = Date.now() } = {}) {
  const list = Array.isArray(items) ? items : [];
  return list.filter((it) => {
    if (!it || !it.path) return false;
    const cadence = it.cadence || assignCadence(it.path);
    const last = toMs(it.lastCrawledAt);
    if (last == null) return true;                 // never crawled → always due
    const interval = cadenceIntervalMs(cadence);
    return now - last >= interval;
  });
}

// Coerce a timestamp (ms number | ISO string | Date) to ms, or null if absent/unparseable.
function toMs(t) {
  if (t == null) return null;
  if (typeof t === 'number') return Number.isFinite(t) ? t : null;
  if (t instanceof Date) { const v = t.getTime(); return Number.isFinite(v) ? v : null; }
  const v = Date.parse(String(t));
  return Number.isFinite(v) ? v : null;
}

// ── schedule build ───────────────────────────────────────────────────────────────────────────────
/**
 * Build a full schedule from crawl items: which are due now, when each is next due, and a summary
 * count per cadence. Each item's cadence is resolved (explicit field wins, else inferred from path).
 *
 * @param {Array<{ path:string, cadence?:string, lastCrawledAt?:number|string|null }>} items
 * @param {{ now?: number }} [opts]
 * @returns {{
 *   now: number,
 *   due: Array,
 *   next: Array<{ path:string, cadence:string, dueAt:number, overdue:boolean }>,
 *   summary: { high:number, medium:number, low:number, dueNow:number, total:number }
 * }}
 */
export function buildSchedule(items, { now = Date.now() } = {}) {
  const list = (Array.isArray(items) ? items : []).filter((it) => it && it.path);

  const summary = { high: 0, medium: 0, low: 0, dueNow: 0, total: list.length };
  const next = [];

  for (const it of list) {
    const cadence = it.cadence || assignCadence(it.path);
    if (summary[cadence] != null) summary[cadence] += 1;
    const last = toMs(it.lastCrawledAt);
    const interval = cadenceIntervalMs(cadence);
    // never-crawled → due immediately (dueAt = now); else last + interval.
    const dueAt = last == null ? now : last + interval;
    const overdue = dueAt <= now;
    if (overdue) summary.dueNow += 1;
    next.push({ path: it.path, cadence, dueAt, overdue });
  }

  // soonest-due first, so a granular pass can take the top of the list.
  next.sort((a, b) => a.dueAt - b.dueAt);

  const due = dueForCrawl(list, { now });
  return { now, due, next, summary };
}

// ── loop-health verifier ───────────────────────────────────────────────────────────────────────────
/**
 * Verify the crawl loop actually fired within its expected window — the "verify the loop fires" health
 * check (#54). `history` is the run log: an array of timestamps, an array of { at }/{ ts }/{ ranAt }
 * records, or the path to a JSONL file (when a lister/reader isn't injected we accept the in-memory
 * forms only; CLI reads the file). Returns ok/stale plus the measured gap.
 *
 * @param {Array<number|string|{at?:any,ts?:any,ranAt?:any,crawledAt?:any}>} history
 * @param {{ now?: number, maxGapMs?: number }} [opts]
 * @returns {{ ok:boolean, lastRun:number|null, gapMs:number|null, stale:boolean, runs:number }}
 */
export function verifyLoopFired(history, { now = Date.now(), maxGapMs = DEFAULT_MAX_GAP_MS } = {}) {
  const runs = normalizeHistory(history);
  if (!runs.length) {
    return { ok: false, lastRun: null, gapMs: null, stale: true, runs: 0 };
  }
  const lastRun = Math.max(...runs);
  const gapMs = now - lastRun;
  const stale = gapMs > maxGapMs;
  return { ok: !stale, lastRun, gapMs, stale, runs: runs.length };
}

// Pull run timestamps (ms) out of whatever history shape was passed. Best-effort, never throws.
function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  const out = [];
  for (const h of history) {
    let ms = null;
    if (h == null) continue;
    if (typeof h === 'number' || typeof h === 'string' || h instanceof Date) ms = toMs(h);
    else if (typeof h === 'object') ms = toMs(h.at ?? h.ts ?? h.ranAt ?? h.crawledAt ?? h.time);
    if (ms != null) out.push(ms);
  }
  return out;
}

// ── mark crawled ───────────────────────────────────────────────────────────────────────────────────
/**
 * Return a NEW items array with the target path's lastCrawledAt updated. Pure — does not mutate the
 * input array or its objects. Items whose path doesn't match are returned unchanged (same refs).
 *
 * @param {Array<{path:string,lastCrawledAt?:any}>} items
 * @param {string} path
 * @param {number} [at] timestamp ms (default now)
 * @returns {Array}
 */
export function markCrawled(items, path, at = Date.now()) {
  const list = Array.isArray(items) ? items : [];
  return list.map((it) => (it && it.path === path ? { ...it, lastCrawledAt: at } : it));
}

// ── file-lister (injectable for tests) ───────────────────────────────────────────────────────────
// The crawler/manifest needs the candidate file set; we provide a default repo walker, but tests inject
// a fake so they run offline. The lister returns [{ path, lastCrawledAt }] WITHOUT a real crawl — it
// just enumerates candidates; lastCrawledAt is supplied by the caller's state store (omitted here → due).
let _lister = defaultLister;
/** Inject a file-lister: () => Array<{path, lastCrawledAt?}>. Pass null to restore the default. */
export function __setLister(fn) { _lister = typeof fn === 'function' ? fn : defaultLister; }

// Default: walk the repo from CWD, skipping noise dirs, returning repo-relative paths. Best-effort.
function defaultLister({ root = process.cwd(), skip = /(^|\/)(node_modules|\.git|\.local|data|coverage)(\/|$)/ } = {}) {
  const out = [];
  const walk = (dir, rel) => {
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (skip.test(childRel) || skip.test(`/${childRel}`)) continue;
      const abs = `${dir}/${e.name}`;
      if (e.isDirectory()) { walk(abs, childRel); continue; }
      if (!e.isFile()) continue;
      let mtimeMs = null;
      try { mtimeMs = statSync(abs).mtimeMs; } catch { /* ignore */ }
      out.push({ path: childRel, cadence: assignCadence(childRel), mtimeMs });
      if (out.length >= 5000) return;               // sanity cap
    }
  };
  walk(root, '');
  return out;
}

/** List candidate files (via the injected/default lister) and build their schedule against `now`. */
export function scheduleFromRepo({ now = Date.now() } = {}) {
  let items = [];
  try { items = _lister() || []; } catch { items = []; }
  return buildSchedule(items, { now });
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('self-crawl-schedule.mjs')) {
  const now = Date.now();
  const sched = scheduleFromRepo({ now });
  console.log('self-crawl schedule (deterministic selector — what is DUE to recrawl into annals)\n');
  console.log(`cadences:`);
  for (const c of CADENCE_ORDER) console.log(`  ${c.padEnd(7)} ${CADENCES[c].label}`);
  console.log(`\n12-and-12 conferences: UTC ${CONFERENCE_HOURS_UTC.join(':00, ')}:00 (batch runs just before each)\n`);
  const s = sched.summary;
  console.log(`candidates: ${s.total}  (high ${s.high} · medium ${s.medium} · low ${s.low})`);
  console.log(`due now:    ${s.dueNow}\n`);
  console.log('next 15 due:');
  for (const n of sched.next.slice(0, 15)) {
    const when = n.overdue ? 'DUE NOW' : new Date(n.dueAt).toISOString();
    console.log(`  [${n.cadence.padEnd(6)}] ${when.padEnd(26)} ${n.path}`);
  }
  // loop health is read from the site-crawl JSONL if present (the loop's own log); here we just show how.
  const health = verifyLoopFired([], { now });
  console.log(`\nloop health (empty history demo): ${health.stale ? 'STALE — loop has not fired' : 'ok'}`);
}

export default {
  CADENCES, CADENCE_ORDER, CONFERENCE_HOURS_UTC, DEFAULT_MAX_GAP_MS,
  cadenceIntervalMs, assignCadence, dueForCrawl, buildSchedule, verifyLoopFired, markCrawled,
  scheduleFromRepo, __setLister,
};
