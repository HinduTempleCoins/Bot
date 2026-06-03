// wearable.mjs — the SweatCoin-style step layer for SoapBox (queue #173). Ingests step/activity
// records and computes a GATED, dry-run payout intent for movement.
//
// SOURCES:
//   - Health Connect (Android, on-device)  — records handed in by the client app; we only normalize.
//   - Apple HealthKit (iOS, on-device)      — same: the OS owns the data, the app forwards records.
//   - Fitbit Web API (process.env.FITBIT_TOKEN, soft-fail) — the only network source here.
//   NOTE: Google Fit is intentionally NOT supported (deprecated / dead end-2026). Do not add it.
//
// ECONOMICS (load-bearing comment): emissions ≤ real income + sinks. This is a SPONSOR-FUNDED
// reward, not minted-from-nothing inflation: a step's reward is capped daily, has diminishing
// returns past a threshold, and is GATED by proof-of-human. settleSteps returns a payout INTENT
// only — dry-run, no real value moves from here.
//
//   import { ingestSteps, stepReward, settleSteps } from './wearable.mjs'
//   FITBIT_TOKEN=... node integrations/soapbox/wearable.mjs

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxWearable/1.0 (+https://data.soapbox.community)' };

// --- normalization -------------------------------------------------------------------------------

const SUPPORTED = new Set(['health-connect', 'healthkit', 'fitbit']);

function isoDate(v) {
  if (!v) return '';
  const s = String(v);
  // accept already-YYYY-MM-DD, or any Date-parseable value
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Normalize per-source records into a flat [{date, steps, distance}] (distance in metres).
// Same-date records are merged (summed) so a day appears once.
export function ingestSteps({ source, records } = {}) {
  if (!SUPPORTED.has(source)) throw new Error(`unsupported wearable source: ${source}`);
  const list = Array.isArray(records) ? records : [];
  const byDate = new Map();
  for (const r of list) {
    if (!r) continue;
    let date, steps, distance;
    if (source === 'health-connect') {
      // Health Connect StepsRecord: { count, startTime } ; DistanceRecord distance.inMeters
      date = isoDate(r.startTime || r.date);
      steps = num(r.count ?? r.steps);
      distance = num(r.distance?.inMeters ?? r.distanceMeters ?? r.distance);
    } else if (source === 'healthkit') {
      // HealthKit HKQuantitySample: { value, startDate, distanceMeters }
      date = isoDate(r.startDate || r.date);
      steps = num(r.value ?? r.steps);
      distance = num(r.distanceMeters ?? r.distance);
    } else {
      // fitbit activities/steps + distance: { dateTime, value } / { distanceKm }
      date = isoDate(r.dateTime || r.date);
      steps = num(r.value ?? r.steps);
      distance = num(r.distanceMeters ?? (r.distanceKm != null ? r.distanceKm * 1000 : r.distance));
    }
    if (!date) continue;
    const cur = byDate.get(date) || { date, steps: 0, distance: 0 };
    cur.steps += steps;
    cur.distance += distance;
    byDate.set(date, cur);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// --- reward (PURE) -------------------------------------------------------------------------------

export const DEFAULT_RULES = {
  perStep: 0.0005,     // base emission per step
  dailyCap: 10,        // hard ceiling per day (sponsor-funded budget guard)
  fullRateSteps: 8000, // steps earning at full rate; beyond this, diminishing returns
  diminishRate: 0.25,  // marginal rate above fullRateSteps (25% of base)
};

// stepReward(steps, rules) — PURE. Emission for a day's steps with diminishing returns past a
// threshold, then clamped to the daily cap. No I/O, no env, deterministic.
export function stepReward(steps, rules = DEFAULT_RULES) {
  const r = { ...DEFAULT_RULES, ...(rules || {}) };
  const s = num(steps);
  if (s <= 0) return 0;
  const full = Math.min(s, r.fullRateSteps);
  const over = Math.max(0, s - r.fullRateSteps);
  const raw = full * r.perStep + over * r.perStep * r.diminishRate;
  return Math.min(raw, r.dailyCap);
}

// --- settlement (gated, dry-run) -----------------------------------------------------------------

// settleSteps({ steps, gate, rules, account, date }) — returns a payout INTENT, gated by
// proof-of-human. `gate` is an injected predicate (sync or async) returning a boolean (or
// { ok, reason }). Gating is DELEGATED to proof-of-human — this module never decides humanity
// itself. No real value moves: dryRun is always true.
export async function settleSteps({ steps, gate, rules, account = '', date = '' } = {}) {
  const reward = stepReward(steps, rules);
  let gated = true; // closed by default; an explicit gate must open it
  let reason = 'no-gate';
  if (typeof gate === 'function') {
    const verdict = await gate({ steps, account, date, reward });
    if (verdict && typeof verdict === 'object') {
      gated = !verdict.ok;
      reason = verdict.reason || (verdict.ok ? 'passed' : 'failed');
    } else {
      gated = !verdict;
      reason = verdict ? 'passed' : 'failed';
    }
  }
  return {
    kind: 'step-reward',
    account,
    date: isoDate(date) || date || '',
    steps: num(steps),
    reward: gated ? 0 : reward,
    rewardIfPassed: reward,
    gated,
    reason,
    dryRun: true, // emissions ≤ real income + sinks; sponsor-funded; no real value here.
    note: 'payout gated by proof-of-human; dry-run intent only — no value moves from this module',
  };
}

// --- Fitbit Web API (soft-fail, the only network source) -----------------------------------------

// fetchFitbitSteps({ date }) — pulls a day's steps from Fitbit Web API using FITBIT_TOKEN.
// Soft-fails to [] when no token / network error. Returns raw records for ingestSteps('fitbit').
export async function fetchFitbitSteps({ date = 'today', token = process.env.FITBIT_TOKEN } = {}) {
  if (!token) return []; // soft-fail: no token, no source
  try {
    const u = `https://api.fitbit.com/1/user/-/activities/steps/date/${encodeURIComponent(date)}/1d.json`;
    const r = await _fetch(u, { headers: { ...UA, Authorization: `Bearer ${token}`, 'Accept-Language': 'en_US' } });
    if (!r || !r.ok) return [];
    const j = await r.json();
    return (j['activities-steps'] || []).map((d) => ({ dateTime: d.dateTime, value: d.value }));
  } catch { return []; }
}

// CLI
if (process.argv[1] && process.argv[1].endsWith('wearable.mjs')) {
  const records = await fetchFitbitSteps({ date: 'today' }).catch(() => []);
  const days = ingestSteps({ source: 'fitbit', records });
  if (!days.length) {
    console.log('No Fitbit step data (set FITBIT_TOKEN, or this is a soft-fail). Demo with 12,500 steps:');
    days.push({ date: new Date().toISOString().slice(0, 10), steps: 12500, distance: 9200 });
  }
  for (const d of days) {
    const intent = await settleSteps({ steps: d.steps, date: d.date, account: 'demo', gate: () => ({ ok: false, reason: 'proof-of-human not wired (demo)' }) });
    console.log(`  ${d.date}: ${d.steps} steps → reward(if passed) ${intent.rewardIfPassed}  [gated=${intent.gated} ${intent.reason}] dryRun=${intent.dryRun}`);
  }
}
