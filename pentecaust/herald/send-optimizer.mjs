// pentecaust/herald/send-optimizer.mjs — Herald SEND OPTIMIZER: subject-line A/B (multi-armed bandit) +
// send-time optimization (per-recipient optimal window). Pure, deterministic, offline — no network, no keys.
// The Jacquard/Persado (subject testing) + Seventh Sense (send-time) capabilities in one small module.
//   import { pickSubject, rankSubjectVariants, optimalSendHour, nextSendAt } from './send-optimizer.mjs'
//
// House rules: ESM, esc() any interpolation, soft-fail (never throw on bad input), fully unit-testable.

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(num(v, lo))));

// ── SUBJECT-LINE A/B — UCB1 bandit ──────────────────────────────────────────────────────────────────────
// Each variant carries {id, text, sent, opens}. We score with an Upper Confidence Bound so a subject with
// few sends still gets exploration, and a proven winner gets exploitation. Deterministic (no RNG).
export function scoreVariant(v, totalSent) {
  const sent = Math.max(0, num(v && v.sent));
  const opens = Math.max(0, Math.min(sent, num(v && v.opens)));
  const rate = sent > 0 ? opens / sent : 0;
  const T = Math.max(1, num(totalSent, 1));
  // UCB1 exploration bonus; an unsent variant gets a large-but-finite bonus so it's tried first.
  const bonus = sent > 0 ? Math.sqrt((2 * Math.log(T)) / sent) : 2;
  return { openRate: Math.round(rate * 1e4) / 1e4, score: Math.round((rate + bonus) * 1e4) / 1e4 };
}

/** Rank subject variants best-first by UCB score. Returns a new array with {…v, openRate, score}. */
export function rankSubjectVariants(variants = []) {
  const list = Array.isArray(variants) ? variants.filter((v) => v && v.text != null) : [];
  const totalSent = list.reduce((a, v) => a + Math.max(0, num(v.sent)), 0);
  return list
    .map((v) => ({ id: String(v.id || ''), text: String(v.text), sent: Math.max(0, num(v.sent)),
      opens: Math.max(0, num(v.opens)), ...scoreVariant(v, totalSent) }))
    .sort((a, b) => b.score - a.score || b.openRate - a.openRate || a.text.localeCompare(b.text));
}

/** Pick the next subject to send (the top UCB variant). Soft-fails to null when there are no variants. */
export function pickSubject(variants = []) {
  const ranked = rankSubjectVariants(variants);
  return ranked.length ? ranked[0] : null;
}

// ── SEND-TIME OPTIMIZATION ──────────────────────────────────────────────────────────────────────────────
// Given a recipient's historical open timestamps (epoch ms), find the hour-of-day (0-23, recipient-local via
// tzOffsetMinutes) they most often engage. Fallback = a sane B2B default (Tue/Thu 10:00). Deterministic.
export const DEFAULT_HOUR = 10;          // 10:00 local
export const DEFAULT_DOWS = [2, 4];      // Tue, Thu (0=Sun)

export function optimalSendHour(openTimestamps = [], tzOffsetMinutes = 0) {
  const hist = new Array(24).fill(0);
  const tz = num(tzOffsetMinutes) * 60000;
  let n = 0;
  for (const t of Array.isArray(openTimestamps) ? openTimestamps : []) {
    const ms = num(t, NaN);
    if (!Number.isFinite(ms)) continue;
    const h = new Date(ms + tz).getUTCHours();
    if (h >= 0 && h < 24) { hist[h]++; n++; }
  }
  if (n < 3) return { hour: DEFAULT_HOUR, confidence: 0, samples: n }; // too little data → default
  let best = 0;
  for (let h = 1; h < 24; h++) if (hist[h] > hist[best]) best = h;
  return { hour: best, confidence: Math.round((hist[best] / n) * 1e4) / 1e4, samples: n };
}

/**
 * nextSendAt — the next optimal send Date at/after `fromMs`, on a preferred day-of-week at the optimal hour.
 * prefs: { openTimestamps, tzOffsetMinutes, dows } — dows defaults to Tue/Thu. Returns epoch ms.
 */
export function nextSendAt(fromMs = Date.now(), prefs = {}) {
  const from = num(fromMs, Date.now());
  const { hour } = optimalSendHour(prefs.openTimestamps, prefs.tzOffsetMinutes);
  const dows = Array.isArray(prefs.dows) && prefs.dows.length
    ? prefs.dows.map((d) => clampInt(d, 0, 6)) : DEFAULT_DOWS;
  const tz = num(prefs.tzOffsetMinutes) * 60000;
  // walk forward up to 14 days to find the next (preferred-dow @ optimal-hour) strictly after `from`.
  for (let i = 0; i < 14 * 24; i++) {
    const cand = from + i * 3600000;
    const local = new Date(cand + tz);
    if (dows.includes(local.getUTCDay()) && local.getUTCHours() === hour && cand > from) {
      // zero out minutes/seconds in local frame
      const z = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour) - tz;
      if (z > from) return z;
    }
  }
  return from + 24 * 3600000; // safety fallback: +1 day
}

// ── record an outcome (immutable update of a variant's stats) — for the caller's store ───────────────────
export function recordOutcome(variant, { opened = false } = {}) {
  const v = variant && typeof variant === 'object' ? variant : {};
  return { ...v, sent: Math.max(0, num(v.sent)) + 1, opens: Math.max(0, num(v.opens)) + (opened ? 1 : 0) };
}
