// proof-of-human.mjs — the anti-fraud "proof of human" gate that sits in front of EVERY
// earning surface (steps / attention / gaming / farming … queue #174). It is PURE logic:
// no network, no clock-of-record, no I/O. Every input is passed in.
//
// The design principle (operator's): we do NOT try to make spoofing impossible — we make it
// UNPROFITABLE. Verified humans earn a higher MULTIPLIER and so out-earn spoofers per unit of
// effort. Verification is offered as tiers, never forced:
//   • anonymous      — no attestation at all (floor multiplier, heaviest Sybil scrutiny)
//   • device         — on-device attestation (Play Integrity / App Attest class). Privacy-clean
//                      DEFAULT: proves "a real device, one human" without identity.
//   • idme           — ID.me-class verified identity. HIGHER tier, opt-in, offered not forced.
//
// Two exports do the work:
//   assess({signals}) → { tier, humanityScore (0..1), multiplier, reasons }
//   gate({payout, assessment, rules}) → { allowed, adjustedPayout, reason, flags }
// plus TIERS (the tier table) for callers that want to surface the ladder.
//
// The SAME gate is used by steps/attention/gaming/farming — the surface only differs by which
// anomaly signals it can supply (a steps surface knows stepRatePerMin; a gaming surface knows
// actionsPerMin; etc.). Unknown signals are simply absent and skipped.
//
//   import { assess, gate, TIERS } from './proof-of-human.mjs'
//   node integrations/proof-of-human.mjs            # worked example

// ── small numeric helpers ──────────────────────────────────────────────────────
const clamp01 = (x) => {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
};
const num = (x, d = 0) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
};
const round = (x, p = 4) => {
  const f = 10 ** p;
  return Math.round((Number(x) + Number.EPSILON) * f) / f;
};

// ── the tier ladder ─────────────────────────────────────────────────────────────
// `base` = the humanityScore an attestation alone vouches for (before anomalies dock it).
// `multiplier` = the earning multiplier a CLEAN account at this tier gets. Verified > unverified
// is structural: idme.multiplier > device.multiplier > anonymous.multiplier, always.
export const TIERS = Object.freeze({
  anonymous: Object.freeze({ tier: 'anonymous', label: 'Anonymous',                 base: 0.20, multiplier: 0.50 }),
  device:    Object.freeze({ tier: 'device',    label: 'On-device attestation',      base: 0.65, multiplier: 1.00 }),
  idme:      Object.freeze({ tier: 'idme',      label: 'ID.me-class verified human',  base: 0.90, multiplier: 1.50 }),
});

// Resolve which tier a set of signals qualifies for. We pick the HIGHEST tier the signals
// actually support — an idme-verified user still must carry a valid device attestation to claim
// the device floor, but identity verification is what unlocks the top tier.
export function resolveTier(signals = {}) {
  const s = signals || {};
  if (s.idVerified === true) return TIERS.idme;
  if (s.deviceAttested === true) return TIERS.device;
  return TIERS.anonymous;
}

// ── Sybil / anomaly detectors (each returns a penalty 0..1 + a reason when it fires) ─────────
// Penalties are "how much humanity-confidence this signal removes". They COMBINE so that a
// single severe anomaly (impossible rate) can zero the score on its own.

// Physically-impossible activity rates. Different surfaces report different rate fields; we check
// whichever are present against generous human ceilings (anything past these can't be a person).
const RATE_CEILINGS = Object.freeze({
  stepRatePerMin: 220,    // elite running cadence ~180–200 spm; >220 sustained = not walking
  actionsPerMin: 600,     // 10 deliberate game actions/sec sustained = a script
  tapsPerMin: 700,        // attention surface: faster-than-human tapping
  claimsPerHour: 120,     // farming: harvest/claim events — 2/min sustained = automation
});
function impossibleRate(s) {
  for (const [field, ceil] of Object.entries(RATE_CEILINGS)) {
    if (s[field] == null) continue;
    const v = num(s[field], 0);
    if (v > ceil) {
      // scale severity by how far past the ceiling we are; >2x ceiling = total wipe.
      const over = (v - ceil) / ceil;
      return { penalty: clamp01(0.6 + over), reason: `impossible ${field}=${v} (>${ceil})` };
    }
  }
  return null;
}

// Device reuse: many distinct accounts behind one device fingerprint = a Sybil farm. One human,
// one device is fine (==1). Penalty ramps with the count above 1.
function deviceReuse(s) {
  if (s.accountsOnDevice == null) return null;
  const n = Math.max(0, Math.floor(num(s.accountsOnDevice, 1)));
  if (n <= 1) return null;
  // 2 accounts → mild, 3 → moderate, 5+ → severe.
  const penalty = clamp01((n - 1) * 0.3);
  return { penalty, reason: `device shared by ${n} accounts` };
}

// Velocity: too many payout-earning events in the window = burst/scripted farming. Uses
// eventsInWindow vs windowMinutes against a per-minute soft cap.
function velocity(s) {
  if (s.eventsInWindow == null || s.windowMinutes == null) return null;
  const events = Math.max(0, num(s.eventsInWindow, 0));
  const mins = Math.max(1e-6, num(s.windowMinutes, 0));
  const perMin = events / mins;
  const SOFT = 4; // >4 distinct earning events/min sustained is suspicious for a human
  if (perMin <= SOFT) return null;
  const penalty = clamp01((perMin - SOFT) / (SOFT * 3)); // 4x soft cap → full penalty
  return { penalty, reason: `velocity ${round(perMin, 2)}/min (>${SOFT})` };
}

// Datacenter / VPN origin: not damning alone (privacy users), but a soft signal that stacks.
function datacenterOrigin(s) {
  if (s.datacenterIp !== true) return null;
  return { penalty: 0.2, reason: 'datacenter/VPN origin' };
}

// Brand-new account doing high-value earning immediately = classic Sybil churn.
function freshAccountBurst(s) {
  if (s.accountAgeDays == null) return null;
  const age = num(s.accountAgeDays, 9999);
  if (age >= 1) return null;
  return { penalty: 0.25, reason: `fresh account (${round(age, 3)}d old)` };
}

const DETECTORS = [impossibleRate, deviceReuse, velocity, datacenterOrigin, freshAccountBurst];

// ── assess: signals → humanity assessment ───────────────────────────────────────
export function assess({ signals = {} } = {}) {
  const s = signals || {};
  const t = resolveTier(s);

  const reasons = [];
  let humanityScore = t.base;

  // Apply each anomaly as a multiplicative dock so penalties compound and any single severe one
  // (penalty→1) can drive the score to ~0.
  for (const detect of DETECTORS) {
    const hit = detect(s);
    if (hit && hit.penalty > 0) {
      humanityScore *= (1 - clamp01(hit.penalty));
      reasons.push(hit.reason);
    }
  }
  humanityScore = clamp01(humanityScore);

  // Effective multiplier: the tier's multiplier, scaled down by how far humanityScore has fallen
  // below the tier's clean baseline. A clean account keeps its full tier multiplier; an account
  // dragged down by anomalies earns proportionally less, but the tier ORDERING is preserved.
  const cleanliness = t.base > 0 ? clamp01(humanityScore / t.base) : 0;
  const multiplier = round(t.multiplier * cleanliness, 4);

  return {
    tier: t.tier,
    humanityScore: round(humanityScore, 4),
    multiplier,
    reasons,
  };
}

// ── gate: decide if/what to pay ─────────────────────────────────────────────────
// rules (all optional, sensible defaults):
//   minHumanityScore  — below this, deny outright (default 0.15)
//   denyMultiplier    — if effective multiplier <= this, deny (default 0)
//   maxPayout         — hard cap on a single adjusted payout (default Infinity)
export function gate({ payout = 0, assessment = null, rules = {} } = {}) {
  const flags = [];
  const a = assessment || assess({ signals: {} });
  const p = Math.max(0, num(payout, 0));

  const minHumanity = rules.minHumanityScore != null ? num(rules.minHumanityScore, 0.15) : 0.15;
  const denyMult = rules.denyMultiplier != null ? num(rules.denyMultiplier, 0) : 0;
  const maxPayout = rules.maxPayout != null ? num(rules.maxPayout, Infinity) : Infinity;

  if (Array.isArray(a.reasons)) flags.push(...a.reasons);

  if (p <= 0) {
    return { allowed: false, adjustedPayout: 0, reason: 'no payout requested', flags };
  }
  if (a.humanityScore < minHumanity) {
    return {
      allowed: false,
      adjustedPayout: 0,
      reason: `humanityScore ${a.humanityScore} below floor ${minHumanity}`,
      flags,
    };
  }
  if (a.multiplier <= denyMult) {
    return {
      allowed: false,
      adjustedPayout: 0,
      reason: `multiplier ${a.multiplier} not above deny threshold ${denyMult}`,
      flags,
    };
  }

  let adjusted = p * a.multiplier;
  let reason = `paid at ${a.tier} tier ×${a.multiplier}`;
  if (adjusted > maxPayout) {
    adjusted = maxPayout;
    reason = `capped at maxPayout ${maxPayout} (tier ${a.tier} ×${a.multiplier})`;
    flags.push('payout capped');
  }

  return { allowed: true, adjustedPayout: round(adjusted, 6), reason, flags };
}

// ── CLI: worked examples across surfaces ─────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('proof-of-human.mjs')) {
  const show = (label, signals, payout) => {
    const a = assess({ signals });
    const g = gate({ payout, assessment: a });
    console.log(`\n${label}`);
    console.log('  assess:', JSON.stringify(a));
    console.log('  gate  :', JSON.stringify(g));
  };

  console.log('TIERS:', JSON.stringify(TIERS, null, 2));

  show('verified human, steps surface, clean',
    { idVerified: true, deviceAttested: true, stepRatePerMin: 110 }, 10);

  show('device-attested human, gaming surface, clean',
    { deviceAttested: true, actionsPerMin: 90 }, 10);

  show('anonymous user, clean',
    {}, 10);

  show('spoofer: impossible step rate',
    { deviceAttested: true, stepRatePerMin: 900 }, 10);

  show('sybil: one device, many accounts',
    { deviceAttested: true, accountsOnDevice: 6 }, 10);

  show('farm: high velocity from datacenter, fresh account',
    { eventsInWindow: 240, windowMinutes: 10, datacenterIp: true, accountAgeDays: 0.1 }, 10);
}
