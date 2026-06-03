// conference-monitor.mjs — health monitor that VERIFIES the 12-and-12 conference is actually running
// (task #29). The 12-and-12 is the twice-daily Claude Code + Qwen + ensemble meeting that produces the
// annals/briefs the whole stack reads. If it silently stops firing — the GPU box went down, the timer
// died, the loop crashed mid-pass — the briefs go stale and nobody downstream knows. This module is the
// watchdog that catches that: it knows WHEN a conference should have run, checks the run history against
// that schedule, and checks that the conference's OUTPUT (a fresh annal + a fresh brief) actually landed.
//
// The cadence (operator's "12-and-12", CST-aligned): the conference runs twice daily, at UTC 06:00 and
// UTC 18:00. Each cycle is meant to produce one fresh annal and one fresh brief, good until the next.
//
//   import { expectedLastConference, verifyConference, verifyArtifacts, healthBlock, nextConference }
//     from './conference-monitor.mjs'
//   const result = verifyConference(history, { now: Date.now() });   // { ok, missed, stale, reason, ... }
//   const md = healthBlock(result);                                   // brief-ready "### 12-and-12 health"
//   node integrations/conference-monitor.mjs                          // CLI: print health
//
// Mirrors self-crawl-schedule.mjs's verifyLoopFired health-check pattern and diagnostics-pipeline.mjs's
// brief-section style. Pure health logic throughout; injectable clock + injectable history/output source
// (__setSource) so tests run fully OFFLINE. Soft-fail: bad input degrades to a safe result, never throws.
// No secrets, no network.

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

// The two daily 12-and-12 conferences, in UTC hours. CST-aligned (00:00 + 12:00 CST → 06:00 + 18:00 UTC).
export const CONFERENCE_HOURS_UTC = [6, 18];

// How late the expected conference is allowed to be before we call it MISSED. The slots are 12h apart;
// we give a few hours of grace for a slow pass / clock skew before raising an alarm.
export const DEFAULT_GRACE_MS = 3 * HOUR;

// How old the freshest annal/brief is allowed to be before we call the output STALE. One conference
// window (~12h) plus the same grace margin — output older than that means a cycle's product never landed.
export const DEFAULT_MAX_AGE_MS = 12 * HOUR + DEFAULT_GRACE_MS;

// ── timestamp coercion ───────────────────────────────────────────────────────────────────────────
// Coerce a timestamp (ms number | ISO string | Date) to ms, or null if absent/unparseable. Never throws.
function toMs(t) {
  if (t == null) return null;
  if (typeof t === 'number') return Number.isFinite(t) ? t : null;
  if (t instanceof Date) { const v = t.getTime(); return Number.isFinite(v) ? v : null; }
  const v = Date.parse(String(t));
  return Number.isFinite(v) ? v : null;
}

// ── schedule math ──────────────────────────────────────────────────────────────────────────────────
/**
 * The timestamp (ms) of the conference slot that should MOST RECENTLY have run as of `now`. Pure.
 * Walks back from now across today's and yesterday's slots and returns the latest one that is <= now.
 *
 * @param {number|string|Date} [now]
 * @returns {number} ms timestamp of the most recent due conference slot
 */
export function expectedLastConference(now = Date.now()) {
  const t = toMs(now) ?? Date.now();
  const slots = slotsAround(t);
  // latest slot at or before now
  let best = slots[0];
  for (const s of slots) if (s <= t && s > best) best = s;
  // if every slot computed is in the future (shouldn't happen given we seed yesterday), fall back to the
  // earliest, so callers always get a concrete past anchor.
  if (best > t) best = Math.min(...slots);
  return best;
}

/**
 * The timestamp (ms) of the NEXT conference slot due strictly after `now`. Pure.
 * @param {number|string|Date} [now]
 * @returns {number} ms timestamp of the upcoming conference slot
 */
export function nextConference(now = Date.now()) {
  const t = toMs(now) ?? Date.now();
  const slots = slotsAround(t).filter((s) => s > t).sort((a, b) => a - b);
  if (slots.length) return slots[0];
  // defensive: extend one more day forward
  const d = new Date(t);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, CONFERENCE_HOURS_UTC[0], 0, 0, 0);
}

// Build the set of conference slot timestamps spanning yesterday → tomorrow (UTC), so the nearest past
// and nearest future slot are always present regardless of which side of a slot `now` falls on.
function slotsAround(t) {
  const d = new Date(t);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  const out = [];
  for (const offset of [-1, 0, 1]) {
    for (const h of CONFERENCE_HOURS_UTC) {
      out.push(Date.UTC(y, m, day + offset, h, 0, 0, 0));
    }
  }
  return out;
}

// ── run-history normalization ──────────────────────────────────────────────────────────────────────
// Pull conference run records out of whatever history shape was passed. Each record may be a bare
// timestamp or an object carrying a timestamp + optional pass/fail + artifact refs. Best-effort.
//   { at|ts|ranAt|time, ok|passed|status, annal|annalRef, brief|briefRef }
// Returns [{ at:number, ok:boolean|null, annal:any, brief:any }], sorted oldest→newest. Never throws.
function normalizeHistory(history) {
  if (!Array.isArray(history)) return [];
  const out = [];
  for (const h of history) {
    if (h == null) continue;
    let at = null, ok = null, annal = null, brief = null;
    if (typeof h === 'number' || typeof h === 'string' || h instanceof Date) {
      at = toMs(h);
    } else if (typeof h === 'object') {
      at = toMs(h.at ?? h.ts ?? h.ranAt ?? h.time ?? h.ranAtMs);
      if ('ok' in h) ok = !!h.ok;
      else if ('passed' in h) ok = !!h.passed;
      else if ('status' in h) ok = /^(ok|pass|passed|success|green)$/i.test(String(h.status));
      annal = h.annal ?? h.annalRef ?? h.annals ?? null;
      brief = h.brief ?? h.briefRef ?? h.briefs ?? null;
    }
    if (at != null) out.push({ at, ok, annal, brief });
  }
  out.sort((a, b) => a.at - b.at);
  return out;
}

// ── conference verifier ──────────────────────────────────────────────────────────────────────────
/**
 * Verify the 12-and-12 conference actually ran on schedule. Given a history of conference runs, returns
 * whether the expected (most-recently-due) conference fired within grace, and whether the latest run
 * counts as a failure/stale.
 *
 * MISSED: no run landed within `graceMs` after the expected slot (and not in the window before the next).
 * STALE:  a run exists but the latest one is older than a full conference window + grace (output is old)
 *         — or the latest run is marked failed.
 *
 * @param {Array<number|string|{at?,ts?,ranAt?,ok?,passed?,status?,annal?,brief?}>} history
 * @param {{ now?: number|string|Date, graceMs?: number, maxAgeMs?: number }} [opts]
 * @returns {{
 *   ok: boolean, lastRun: number|null, expected: number, gapMs: number|null,
 *   missed: boolean, stale: boolean, reason: string, runs: number
 * }}
 */
export function verifyConference(history, { now = Date.now(), graceMs = DEFAULT_GRACE_MS, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const t = toMs(now) ?? Date.now();
  const expected = expectedLastConference(t);
  const runs = normalizeHistory(history);

  if (!runs.length) {
    return {
      ok: false, lastRun: null, expected, gapMs: null,
      missed: true, stale: true, runs: 0,
      reason: 'No conference runs on record — the 12-and-12 has never reported a run.',
    };
  }

  const last = runs[runs.length - 1];
  const lastRun = last.at;
  const gapMs = t - lastRun;

  // Did SOME run cover the expected slot? A run covers the expected slot if it happened at/after that
  // slot (within grace of it) and at/before now. We accept any run in the [expected, expected+grace+window]
  // band as "the expected conference fired".
  const coveredExpected = runs.some((r) => r.at >= expected - 1000 && r.at <= expected + graceMs);
  // also count a run that landed AFTER the expected slot but before now (e.g. ran a bit late but did run
  // this cycle) — bounded to within the current conference window so a stale old run doesn't satisfy it.
  const ranThisCycle = coveredExpected || runs.some((r) => r.at >= expected - 1000 && r.at <= t);

  const missed = !ranThisCycle && (t - expected) > graceMs;

  // Stale: latest output older than a full window+grace, OR the latest run explicitly failed.
  const lastFailed = last.ok === false;
  const tooOld = gapMs > maxAgeMs;
  const stale = lastFailed || tooOld;

  let reason;
  if (missed && stale) {
    reason = `Expected conference at ${iso(expected)} did not run within grace (${fmtDur(graceMs)}); last run ${iso(lastRun)} is ${fmtDur(gapMs)} old${lastFailed ? ' and is marked failed' : ''}.`;
  } else if (missed) {
    reason = `Expected conference at ${iso(expected)} has not run yet (grace ${fmtDur(graceMs)} elapsed). Last run was ${iso(lastRun)}.`;
  } else if (stale) {
    reason = lastFailed
      ? `Conference ran at ${iso(lastRun)} but its run is marked FAILED — output may be incomplete.`
      : `Last conference ${iso(lastRun)} is ${fmtDur(gapMs)} old — older than one window + grace (${fmtDur(maxAgeMs)}); output is stale.`;
  } else {
    reason = `Conference ran at ${iso(lastRun)} (within grace of the ${iso(expected)} slot). On schedule.`;
  }

  return {
    ok: !missed && !stale,
    lastRun, expected, gapMs, missed, stale, runs: runs.length, reason,
  };
}

// ── artifact verifier ──────────────────────────────────────────────────────────────────────────────
/**
 * Verify the conference's OUTPUT landed: a fresh annal AND a fresh brief for the last cycle. Each input
 * is the freshest artifact's timestamp (ms | ISO | Date) or a record carrying one ({ at|ts|updatedAt|mtimeMs }),
 * or an array of such (the newest is used). Missing/old → flagged. Pure, never throws.
 *
 * @param {{ annals?: any, briefs?: any }} artifacts
 * @param {{ now?: number|string|Date, maxAgeMs?: number }} [opts]
 * @returns {{
 *   ok: boolean,
 *   annal: { present:boolean, fresh:boolean, at:number|null, ageMs:number|null },
 *   brief: { present:boolean, fresh:boolean, at:number|null, ageMs:number|null },
 *   reason: string
 * }}
 */
export function verifyArtifacts({ annals, briefs } = {}, { now = Date.now(), maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  const t = toMs(now) ?? Date.now();
  const annal = artifactStatus(annals, t, maxAgeMs);
  const brief = artifactStatus(briefs, t, maxAgeMs);

  const ok = annal.fresh && brief.fresh;
  const parts = [];
  if (!annal.present) parts.push('no annal on record');
  else if (!annal.fresh) parts.push(`annal is ${fmtDur(annal.ageMs)} old (stale)`);
  if (!brief.present) parts.push('no brief on record');
  else if (!brief.fresh) parts.push(`brief is ${fmtDur(brief.ageMs)} old (stale)`);

  const reason = ok
    ? `Fresh annal (${iso(annal.at)}) and brief (${iso(brief.at)}) both present for the last cycle.`
    : `Output check failed: ${parts.join('; ')}.`;

  return { ok, annal, brief, reason };
}

// Reduce an artifact input to { present, fresh, at, ageMs } against now/maxAge. Picks the newest if given
// an array. Accepts a bare timestamp or a record with at|ts|updatedAt|mtimeMs|time.
function artifactStatus(input, t, maxAgeMs) {
  const at = freshestTs(input);
  if (at == null) return { present: false, fresh: false, at: null, ageMs: null };
  const ageMs = t - at;
  return { present: true, fresh: ageMs <= maxAgeMs && ageMs >= -DAY, at, ageMs };
}

// Extract the newest timestamp (ms) from an artifact input of any accepted shape. null if none.
function freshestTs(input) {
  if (input == null) return null;
  const one = (x) => {
    if (x == null) return null;
    if (typeof x === 'number' || typeof x === 'string' || x instanceof Date) return toMs(x);
    if (typeof x === 'object') return toMs(x.at ?? x.ts ?? x.updatedAt ?? x.mtimeMs ?? x.time ?? x.createdAt);
    return null;
  };
  if (Array.isArray(input)) {
    const ms = input.map(one).filter((v) => v != null);
    return ms.length ? Math.max(...ms) : null;
  }
  return one(input);
}

// ── brief-ready render ───────────────────────────────────────────────────────────────────────────
/**
 * Render a result (from verifyConference, optionally merged with verifyArtifacts) as a brief-ready
 * markdown block — the "### 12-and-12 health" section the briefs splice in. Pure, never throws.
 *
 * Accepts the verifyConference result; if it also carries an `artifacts` field (a verifyArtifacts result)
 * that line is appended. Status icon: ✅ ran · ⚠ missed · ⚠ stale.
 *
 * @param {object} result
 * @returns {string} markdown
 */
export function healthBlock(result) {
  const r = result || {};
  const icon = r.missed ? '⚠' : r.stale ? '⚠' : r.ok ? '✅' : '⚠';
  const status = r.missed ? 'MISSED' : r.stale ? 'STALE' : r.ok ? 'ran' : 'unknown';

  const L = [];
  L.push('### 12-and-12 health');
  L.push(`${icon} **Conference: ${status}** — ${r.reason || 'no result'}`);
  const bits = [];
  bits.push(`expected ${iso(r.expected)}`);
  bits.push(`last run ${r.lastRun != null ? iso(r.lastRun) : '—'}`);
  if (r.gapMs != null) bits.push(`gap ${fmtDur(r.gapMs)}`);
  bits.push(`runs ${r.runs ?? 0}`);
  L.push(`- cadence: UTC ${CONFERENCE_HOURS_UTC.map((h) => `${String(h).padStart(2, '0')}:00`).join(' + ')} (twice daily, CST-aligned) · ${bits.join(' · ')}`);

  if (r.artifacts) {
    const a = r.artifacts;
    const ai = a.ok ? '✅' : '⚠';
    L.push(`- ${ai} output: ${a.reason}`);
  }
  return L.join('\n');
}

// ── small formatters ───────────────────────────────────────────────────────────────────────────────
function iso(ms) {
  const v = toMs(ms);
  return v == null ? '—' : new Date(v).toISOString();
}
function fmtDur(ms) {
  if (ms == null || !Number.isFinite(ms)) return '—';
  const neg = ms < 0; let s = Math.abs(ms) / 1000;
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);
  const out = h ? `${h}h${m ? ` ${m}m` : ''}` : `${m}m`;
  return (neg ? '-' : '') + out;
}

// ── injectable source (for offline tests + CLI) ────────────────────────────────────────────────────
// The CLI needs the real conference run history + freshest artifact timestamps; tests inject a fake so
// they never touch disk/network. A source returns { history, annals, briefs }. Default returns empties
// (this module ships no live store wiring — the 24/7 engine supplies the source in production).
let _source = defaultSource;
/** Inject a source: () => { history, annals, briefs }. Pass null/non-fn to restore the default. */
export function __setSource(fn) { _source = typeof fn === 'function' ? fn : defaultSource; }
function defaultSource() { return { history: [], annals: null, briefs: null }; }

/**
 * Full health check: pull from the injected/default source, verify the conference + its artifacts, and
 * return a single merged result (with `.artifacts` attached). Best-effort, never throws.
 */
export function checkHealth({ now = Date.now(), graceMs = DEFAULT_GRACE_MS, maxAgeMs = DEFAULT_MAX_AGE_MS } = {}) {
  let src = { history: [], annals: null, briefs: null };
  try { src = _source() || src; } catch { /* keep safe default */ }
  const result = verifyConference(src.history, { now, graceMs, maxAgeMs });
  result.artifacts = verifyArtifacts({ annals: src.annals, briefs: src.briefs }, { now, maxAgeMs });
  return result;
}

export default {
  CONFERENCE_HOURS_UTC, DEFAULT_GRACE_MS, DEFAULT_MAX_AGE_MS,
  expectedLastConference, nextConference, verifyConference, verifyArtifacts,
  healthBlock, checkHealth, __setSource,
};

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('conference-monitor.mjs')) {
  const now = Date.now();
  const result = checkHealth({ now });
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(healthBlock(result));
    console.log(`\nnext conference due: ${iso(nextConference(now))}`);
  }
}
