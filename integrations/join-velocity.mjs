// join-velocity.mjs — PURE, deterministic join/signup velocity & anti-raid analyzer for MELEK.
// No network, no chain calls, no keys, no I/O, no LLM, no bans. Backlog 3828bda09a.
//
// PURPOSE (read before changing numbers):
//   A community/server (troll-box signup, condenser, Discord-style room) wants to throttle
//   coordinated raids — a sudden burst of joins, often with near-duplicate handles — WITHOUT
//   banning anyone and WITHOUT any side effects. This module looks at a list of join EVENTS
//   (timestamps + optional handle hints) and produces a SCORE + severity + a recommended action
//   string. It never acts; the caller decides whether to slow-mode or lock joins.
//
// WHAT IT IS NOT:
//   - Not a ban list, not moderation state, not persistence. Pure windowed math.
//   - Not account-trust (that scores a single peer). This scores the SHAPE of an arrival burst.
//
// SIGNALS:
//   1. PEAK VELOCITY    — max joins in any sliding window of windowSec (default 60s).
//   2. NAME SIMILARITY  — fraction of handles that are near-duplicates of another handle
//                         (botnets reuse a stem: alice01, alice02, alice_03 ...).
//
// SEVERITY RULES:
//   raid  if peak >= threshold
//         OR (similarFraction is high  AND  peak >= threshold/2).
//   watch if peak >= threshold/2  OR  similarFraction is high (but not yet raid).
//   none  otherwise.
//
// SOFT-FAIL, NEVER THROW: empty / garbage / non-array events → {raid:false, severity:'none'}.
//   NaN / non-finite timestamps are dropped. All functions always return a well-formed value.
//
//   import { analyzeJoins, recommend } from './integrations/join-velocity.mjs';
//   const r = analyzeJoins({ events: [{ts:0,handle:'bob01'},{ts:1,handle:'bob02'}], threshold: 10 });
//   recommend(r); // -> 'ok' | 'enable slow-mode' | 'lock joins'
//
// CLI:  node integrations/join-velocity.mjs        # print a worked example

// ── HTML escape: used wherever a reason/action might be interpolated into a page ────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── tunables (defaults; caller may override threshold/windowSec) ────────────────────────────────
export const DEFAULT_WINDOW_SEC = 60;
export const DEFAULT_THRESHOLD = 10;        // joins-in-window that on its own means "raid"
export const SIMILAR_HIGH = 0.5;            // fraction of near-dup handles that counts as "high"

// ── safe finite number, or null if it can't be coerced ──────────────────────────────────────────
function finiteOrNull(x) {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

// ── extract clean, sorted timestamps (seconds) from raw events; drops NaN/garbage ───────────────
function cleanTimestamps(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const e of events) {
    if (e == null) continue;
    const raw = typeof e === 'object' ? e.ts : e;
    const t = finiteOrNull(raw);
    if (t === null) continue;
    out.push(t);
  }
  out.sort((a, b) => a - b);
  return out;
}

// ── extract handle strings from events (optional; missing → skipped) ────────────────────────────
function cleanHandles(events) {
  if (!Array.isArray(events)) return [];
  const out = [];
  for (const e of events) {
    if (e == null || typeof e !== 'object') continue;
    const h = e.handle;
    if (typeof h !== 'string') continue;
    const trimmed = h.trim();
    if (trimmed) out.push(trimmed);
  }
  return out;
}

// ── normalize a handle: lowercase, strip trailing digits & non-alphanumerics → the "stem" ───────
function stem(handle) {
  return String(handle == null ? '' : handle)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')   // drop separators: alice_03 → alice03
    .replace(/[0-9]+$/g, '');     // drop trailing run of digits: alice03 → alice
}

// ── levenshtein-lite: bounded edit distance, deterministic, capped for cheapness ────────────────
function editDistance(a, b) {
  a = String(a); b = String(b);
  const la = a.length, lb = b.length;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1);
    cur[0] = i;
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[lb];
}

// ── are two handles "near-duplicate"? same stem, or tiny edit distance on a short prefix ────────
function nearDuplicate(h1, h2) {
  const s1 = stem(h1), s2 = stem(h2);
  if (s1 && s2 && s1 === s2) return true;          // alice01 / alice_02 → both stem to "alice"
  // cheap prefix compare: first 6 chars, allow 1 edit
  const p1 = String(h1).toLowerCase().slice(0, 6);
  const p2 = String(h2).toLowerCase().slice(0, 6);
  if (!p1 || !p2) return false;
  return editDistance(p1, p2) <= 1;
}

// ── max joins inside any sliding window of windowSec (inclusive of both endpoints) ──────────────
// Returns { peak, peakWindowStart }. Empty/garbage → { peak:0, peakWindowStart:null }.
export function slidingWindowCounts(events, windowSec = DEFAULT_WINDOW_SEC) {
  const ts = cleanTimestamps(events);
  const w = finiteOrNull(windowSec);
  const span = w !== null && w > 0 ? w : DEFAULT_WINDOW_SEC;
  if (ts.length === 0) return { peak: 0, peakWindowStart: null };

  let peak = 0;
  let peakWindowStart = ts[0];
  let left = 0;
  // two-pointer over sorted timestamps: window anchored at each left edge
  for (let right = 0; right < ts.length; right++) {
    while (ts[right] - ts[left] > span) left++;
    const count = right - left + 1;
    if (count > peak) {
      peak = count;
      peakWindowStart = ts[left];
    }
  }
  return { peak, peakWindowStart };
}

// ── fraction (0..1) of handles that have at least one near-duplicate among the others ───────────
// Empty / <2 handles → 0. Deterministic.
export function nameSimilarityFlag(names) {
  const handles = Array.isArray(names)
    ? names.filter((h) => typeof h === 'string' && h.trim()).map((h) => h.trim())
    : [];
  const n = handles.length;
  if (n < 2) return 0;
  let flagged = 0;
  for (let i = 0; i < n; i++) {
    let dup = false;
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      if (nearDuplicate(handles[i], handles[j])) { dup = true; break; }
    }
    if (dup) flagged++;
  }
  return Math.round((flagged / n) * 10000) / 10000; // 4dp, deterministic
}

// ── main analyzer ───────────────────────────────────────────────────────────────────────────────
// analyzeJoins({events, windowSec?, threshold?}) →
//   { peak, peakWindowStart, ratePerMin, similarFraction, raid, severity, reasons }
export function analyzeJoins(input) {
  const safe = input && typeof input === 'object' ? input : {};
  const events = Array.isArray(safe.events) ? safe.events : [];
  const w = finiteOrNull(safe.windowSec);
  const windowSec = w !== null && w > 0 ? w : DEFAULT_WINDOW_SEC;
  const t = finiteOrNull(safe.threshold);
  const threshold = t !== null && t > 0 ? t : DEFAULT_THRESHOLD;

  const { peak, peakWindowStart } = slidingWindowCounts(events, windowSec);
  const similarFraction = nameSimilarityFlag(cleanHandles(events));

  // rate per minute within the peak window
  const ratePerMin = windowSec > 0
    ? Math.round((peak / windowSec) * 60 * 100) / 100
    : 0;

  const reasons = [];
  const similarHigh = similarFraction >= SIMILAR_HIGH;

  // empty / no valid timestamps → safe none
  if (peak === 0) {
    return {
      peak: 0,
      peakWindowStart: null,
      ratePerMin: 0,
      similarFraction,
      raid: false,
      severity: 'none',
      reasons: similarHigh ? ['near-duplicate handles detected'] : [],
    };
  }

  const raidByPeak = peak >= threshold;
  const raidBySimilar = similarHigh && peak >= threshold / 2;
  const raid = raidByPeak || raidBySimilar;

  if (raidByPeak) reasons.push(`peak ${peak} joins in ${windowSec}s >= threshold ${threshold}`);
  if (raidBySimilar) reasons.push(`near-duplicate handles (${Math.round(similarFraction * 100)}%) with elevated peak ${peak}`);

  let severity;
  if (raid) {
    severity = 'raid';
  } else if (peak >= threshold / 2 || similarHigh) {
    severity = 'watch';
    if (peak >= threshold / 2) reasons.push(`peak ${peak} joins approaching threshold ${threshold}`);
    if (similarHigh && !raidBySimilar) reasons.push(`near-duplicate handles (${Math.round(similarFraction * 100)}%)`);
  } else {
    severity = 'none';
  }

  return { peak, peakWindowStart, ratePerMin, similarFraction, raid, severity, reasons };
}

// ── deterministic recommended action string ─────────────────────────────────────────────────────
export function recommend(result) {
  const sev = result && typeof result === 'object' ? result.severity : 'none';
  if (sev === 'raid') return 'lock joins';
  if (sev === 'watch') return 'enable slow-mode';
  return 'ok';
}

// ── CLI: worked example (guarded so importing never runs this) ──────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const events = [];
  for (let i = 0; i < 14; i++) events.push({ ts: 1000 + i, handle: `raider${i}` });
  const result = analyzeJoins({ events, windowSec: 60, threshold: 10 });
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ result, action: recommend(result) }, null, 2));
}
