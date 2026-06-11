// reputation-decay.mjs — PURE, deterministic time-decayed reputation score for the MELEK witness.
// No network, no chain calls, no keys, no I/O, no LLM. Backlog 533284e198 (queue id 332,
// "AI reputation system"): the off-chain reputation layer the VKAI item describes.
//
// PURPOSE (read before changing numbers):
//   Hathor / Cheetah accumulate reputation from a STREAM of dated events (posts, endorsements,
//   reports). Unlike account-trust.mjs — which scores a single STATIC snapshot of an account's
//   shape — this module is a time-series: each event's contribution DECAYS with age on an
//   exponential half-life curve, so reputation reflects RECENT behaviour and fades old activity.
//
//   account-trust  → "what does this account look like right now?" (one snapshot, 0..100).
//   reputation-decay → "given everything they've done over time, weighted toward the recent,
//                       what is their standing today?" (a running, decaying sum).
//
// EVENT SHAPE: { ts, weight, kind } where
//     ts     — unix epoch SECONDS the event occurred (number).
//     weight — signed contribution magnitude (number). 'report' events are negative (a penalty).
//     kind   — 'post' | 'endorsement' | 'report' (free-form; used only for grouping/labels).
//
// MODEL: score = Σ  weight_i * decayFactor(ageDays_i, halfLifeDays)
//   where decayFactor(age, H) = 0.5 ** (age / H), clamped to [0,1]. An event halves its
//   contribution every H days. Future-dated events clamp to age 0 (full weight, never amplified).
//
// SOFT-FAIL, NEVER THROW: non-array events → { score:0, band:'new', contributions:[] }.
//   Events with non-finite ts or weight are dropped. Non-finite halfLife/now → safe defaults.
//
//   import { reputationScore, band, compare, renderReputationBadge } from './integrations/reputation-decay.mjs';
//   const r = reputationScore({ events:[{ts, weight:1, kind:'post'}], nowTs, halfLifeDays:90 });
//   // -> { score, band, contributions:[{kind, decayed}] }
//
// CLI:  node integrations/reputation-decay.mjs        # print a worked example

// ── HTML escape: used by renderReputationBadge for any interpolated value ───────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── tunables ────────────────────────────────────────────────────────────────────────────────────
export const DEFAULT_HALFLIFE_DAYS = 90; // an event halves its weight every 90 days
const SECONDS_PER_DAY = 86400;

// ── safe numeric coercion: finite numbers pass through, else null (so callers can drop) ──────────
function finiteOrNull(x) {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

function round4(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 10000) / 10000;
}

function round2(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// ── decay factor: 0.5 ** (ageDays / halfLifeDays), clamped to [0,1] ─────────────────────────────
// ageDays < 0 (future event) clamps to 0 → factor 1 (full weight, never amplified).
// non-finite / non-positive halfLife → DEFAULT_HALFLIFE_DAYS. age 0 → 1; age == H → 0.5.
export function decayFactor(ageDays, halfLifeDays = DEFAULT_HALFLIFE_DAYS) {
  let age = finiteOrNull(ageDays);
  if (age == null) age = 0;
  if (age < 0) age = 0; // future-dated: no amplification
  let H = finiteOrNull(halfLifeDays);
  if (H == null || H <= 0) H = DEFAULT_HALFLIFE_DAYS;
  const f = Math.pow(0.5, age / H);
  if (!Number.isFinite(f)) return 0;
  if (f < 0) return 0;
  if (f > 1) return 1;
  return f;
}

// ── bands (on the decayed score) ────────────────────────────────────────────────────────────────
// Tuned for weight≈1 events: a handful of recent positives → 'emerging'; sustained → 'trusted';
// a deep, recent, positive track record → 'pillar'. Negative / empty → 'new'.
// Boundaries assigned to the UPPER band.
export function band(score) {
  const s = finiteOrNull(score) ?? 0;
  if (s >= 25) return 'pillar';
  if (s >= 8) return 'trusted';
  if (s >= 2) return 'emerging';
  return 'new';
}

// ── main: decayed reputation score over an event stream ─────────────────────────────────────────
export function reputationScore({ events, nowTs, halfLifeDays } = {}) {
  if (!Array.isArray(events)) {
    return { score: 0, band: 'new', contributions: [] };
  }

  // resolve "now": finite seconds, else fall back to the latest valid event ts, else 0.
  let now = finiteOrNull(nowTs);
  let H = finiteOrNull(halfLifeDays);
  if (H == null || H <= 0) H = DEFAULT_HALFLIFE_DAYS;

  // Pre-pass: collect valid events (finite ts AND finite weight).
  const valid = [];
  for (const ev of events) {
    if (!ev || typeof ev !== 'object') continue;
    const ts = finiteOrNull(ev.ts);
    const weight = finiteOrNull(ev.weight);
    if (ts == null || weight == null) continue; // drop malformed
    valid.push({ ts, weight, kind: typeof ev.kind === 'string' ? ev.kind : 'event' });
  }

  if (now == null) {
    // No usable now → anchor to the most recent valid event so ages are >= 0.
    now = valid.reduce((m, e) => (e.ts > m ? e.ts : m), 0);
  }

  let score = 0;
  const contributions = [];
  for (const ev of valid) {
    const ageDays = (now - ev.ts) / SECONDS_PER_DAY;
    const factor = decayFactor(ageDays, H);
    const decayed = ev.weight * factor;
    score += decayed;
    contributions.push({ kind: ev.kind, decayed: round4(decayed) });
  }

  score = round4(score);
  return { score, band: band(score), contributions };
}

// ── comparator for Array.prototype.sort: higher reputation first ────────────────────────────────
// Accepts either reputationScore results ({score}) or raw inputs ({events,...}). Soft-fails to 0.
export function compare(a, b) {
  return scoreOf(b) - scoreOf(a); // descending
}

function scoreOf(x) {
  if (x && typeof x === 'object') {
    if (typeof x.score === 'number' && Number.isFinite(x.score)) return x.score;
    if (Array.isArray(x.events)) return reputationScore(x).score;
  }
  return 0;
}

// ── one-line HTML badge (all interpolation esc()'d) ─────────────────────────────────────────────
export function renderReputationBadge(account, result) {
  const name = esc(account);
  const r = result && typeof result === 'object' ? result : {};
  const score = round2(finiteOrNull(r.score) ?? 0);
  const bnd = esc(r.band || band(score));
  return `<span class="rep-badge rep-${bnd}" title="${name}: reputation ${score} (${bnd})">${name} — ${score} (${bnd})</span>`;
}

// ── CLI demo (guarded; stdout only) ─────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const now = 1_700_000_000; // fixed epoch so the demo is deterministic
  const day = SECONDS_PER_DAY;
  const samples = [
    {
      account: 'longtimer',
      events: [
        { ts: now - 2 * day, weight: 3, kind: 'post' },
        { ts: now - 10 * day, weight: 2, kind: 'endorsement' },
        { ts: now - 200 * day, weight: 5, kind: 'post' },
        { ts: now - 5 * day, weight: 4, kind: 'endorsement' },
      ],
    },
    {
      account: 'fresh',
      events: [{ ts: now - 1 * day, weight: 1, kind: 'post' }],
    },
    {
      account: 'flagged',
      events: [
        { ts: now - 1 * day, weight: 2, kind: 'post' },
        { ts: now - 1 * day, weight: -6, kind: 'report' },
      ],
    },
  ];
  const ranked = samples
    .map((s) => ({ account: s.account, ...reputationScore({ events: s.events, nowTs: now }) }))
    .sort(compare);
  for (const r of ranked) console.log(renderReputationBadge(r.account, r));
}
