// scarcity-score.mjs — PURE scoring of the "scarcity advantage" the MELEK itinerary leans on
// (itinerary items 102, 125–127, 146). No network, no chain calls, no keys, no I/O.
//
// THESIS (load-bearing, read before changing numbers):
//   A token is *defensible* when it is hard to dump-attack and hard to capture. Three things
//   make it so, and one thing undermines them:
//
//     1. SUPPLY TIGHTNESS   — a SMALL circulating supply means each unit carries weight; there is
//                             less float to flood the market with. Tighter supply → higher score.
//     2. HOLDER BREADTH     — MANY distinct holders means decentralized conviction; the token is
//                             not one whale's plaything. More holders → higher score.
//     3. CONTROL ADVANTAGE  — HIGH self/owner-controlled stake (the founding witness holding its own
//                             float) is a *defensive* moat against a hostile takeover of the float.
//                             More owner control → higher score. (This is the inverse of the usual
//                             "founder dump" worry: here the held stake is the protection.)
//
//     − CONCENTRATION RISK  — if the TOP-10 holders (excluding the owner's declared self-control)
//                             own most of the float, the "many holders" breadth is illusory and the
//                             token is capturable. High top-10 concentration → PENALTY.
//
// All four roll up into a 0..100 score and a tier. The model is DETERMINISTIC and MONOTONIC:
//   - lowering circulatingSupply (tighter) never lowers the score,
//   - raising uniqueHolders never lowers the score,
//   - raising ownerControlledPct never lowers the score,
//   - raising top10Percent never raises the score.
//
// SOFT-FAIL, NEVER THROW: non-finite / negative / out-of-range inputs are clamped to a safe domain
// and a reason is appended explaining the clamp. The function always returns a well-formed result.
//
// This is PUBLIC, pure economics. It is descriptive, NOT financial advice and NOT a price model.
//
//   import { scarcityScore, supplyPerHolder, compare } from './integrations/scarcity-score.mjs';
//   const r = scarcityScore({ circulatingSupply: 1_000_000, uniqueHolders: 5000,
//                             ownerControlledPct: 30, top10Percent: 15 });
//   // -> { score, tier, signals:{...}, reasons:[...] }
//
// CLI:  node integrations/scarcity-score.mjs            # print a worked VKBT-vs-CURE example

// ── DOCUMENTED WEIGHTING (pure constants; tune here, monotonicity preserved) ──────────────────
// The three positive signals sum to 100; concentration risk is a multiplicative haircut on top so
// it can only ever DISCOUNT, never inflate. Weights reflect the itinerary's emphasis: breadth and
// owner-control are the durable moats; tightness is the headline but easiest to game with low float.
const W_SUPPLY_TIGHTNESS = 30; // weight of small circulating supply
const W_HOLDER_BREADTH = 35; // weight of many distinct holders
const W_CONTROL_ADVANTAGE = 35; // weight of owner/self-controlled defensive stake

// Supply tightness reference: supply at/below TIGHT_SUPPLY scores ~1.0; it decays logarithmically
// up to LOOSE_SUPPLY where it bottoms out near 0. Log scale so 1M vs 10M differs more than 1B vs 10B.
const TIGHT_SUPPLY = 1_000_000; // <= this is "extremely tight"
const LOOSE_SUPPLY = 1_000_000_000_000; // >= this is "effectively unbounded float"

// Holder breadth reference: holders at/above BROAD_HOLDERS score ~1.0; below FEW_HOLDERS scores ~0.
const FEW_HOLDERS = 10; // <= this is "captured / nascent"
const BROAD_HOLDERS = 50_000; // >= this is "broadly distributed"

// Concentration haircut: top10Percent is a fraction-of-float owned by the largest 10 NON-owner
// holders. 0% → no haircut (factor 1.0); 100% → maximal haircut (factor MAX_CONC_HAIRCUT).
const MAX_CONC_HAIRCUT = 0.55; // at 100% top-10 concentration the score is cut to 45% of raw

// Tier thresholds on the final 0..100 score.
const TIER_EXTREME = 80;
const TIER_HIGH = 60;
const TIER_MODERATE = 35;

// ── small pure helpers ────────────────────────────────────────────────────────────────────────
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampPct = (x) => (x < 0 ? 0 : x > 100 ? 100 : x);
const round2 = (x) => Math.round(x * 100) / 100;

// Coerce a raw input to a finite, non-negative number. Returns { value, clamped, reason? }.
function finiteNonNeg(raw, label, fallback) {
  if (!Number.isFinite(raw)) {
    return { value: fallback, clamped: true, reason: `${label} not finite — clamped to ${fallback}` };
  }
  if (raw < 0) {
    return { value: 0, clamped: true, reason: `${label} negative — clamped to 0` };
  }
  return { value: raw, clamped: false };
}

// ── public: supply per holder ───────────────────────────────────────────────────────────────
// Average float each holder carries. Soft-fails: bad inputs → returns 0 (never throws, never NaN/∞).
export function supplyPerHolder(circulating, unique) {
  const c = Number.isFinite(circulating) && circulating > 0 ? circulating : 0;
  const u = Number.isFinite(unique) && unique > 0 ? unique : 0;
  if (c === 0 || u === 0) return 0;
  return round2(c / u);
}

// ── component scorers (each returns 0..1) ─────────────────────────────────────────────────────
// Smaller supply → closer to 1. Log-interpolated between TIGHT and LOOSE. Monotonic decreasing in c.
function supplyTightness01(c) {
  if (c <= TIGHT_SUPPLY) return 1;
  if (c >= LOOSE_SUPPLY) return 0;
  const lo = Math.log10(TIGHT_SUPPLY);
  const hi = Math.log10(LOOSE_SUPPLY);
  const here = Math.log10(c);
  return clamp01(1 - (here - lo) / (hi - lo));
}

// More holders → closer to 1. Log-interpolated between FEW and BROAD. Monotonic increasing in u.
function holderBreadth01(u) {
  if (u <= FEW_HOLDERS) return 0;
  if (u >= BROAD_HOLDERS) return 1;
  const lo = Math.log10(FEW_HOLDERS);
  const hi = Math.log10(BROAD_HOLDERS);
  const here = Math.log10(u);
  return clamp01((here - lo) / (hi - lo));
}

// Owner-controlled defensive stake as a fraction of float. Linear; monotonic increasing.
function controlAdvantage01(ownerPct) {
  return clamp01(ownerPct / 100);
}

// Concentration haircut FACTOR in [MAX_CONC_HAIRCUT, 1]. Higher top-10 % → lower factor (more cut).
function concentrationFactor(top10Pct) {
  const f = top10Pct / 100; // 0..1
  return 1 - (1 - MAX_CONC_HAIRCUT) * clamp01(f);
}

function tierFor(score) {
  if (score >= TIER_EXTREME) return 'EXTREME';
  if (score >= TIER_HIGH) return 'HIGH';
  if (score >= TIER_MODERATE) return 'MODERATE';
  return 'LOW';
}

// ── public: the score ─────────────────────────────────────────────────────────────────────────
export function scarcityScore(input) {
  const reasons = [];
  const src = input && typeof input === 'object' ? input : {};
  if (!input || typeof input !== 'object') {
    reasons.push('input missing or not an object — treated all fields as 0');
  }

  const sup = finiteNonNeg(src.circulatingSupply, 'circulatingSupply', 0);
  const hol = finiteNonNeg(src.uniqueHolders, 'uniqueHolders', 0);
  let ownerRaw = finiteNonNeg(src.ownerControlledPct, 'ownerControlledPct', 0);
  let topRaw = finiteNonNeg(src.top10Percent, 'top10Percent', 0);
  if (sup.reason) reasons.push(sup.reason);
  if (hol.reason) reasons.push(hol.reason);
  if (ownerRaw.reason) reasons.push(ownerRaw.reason);
  if (topRaw.reason) reasons.push(topRaw.reason);

  const circulatingSupply = sup.value;
  const uniqueHolders = Math.floor(hol.value);

  let ownerPct = ownerRaw.value;
  if (ownerPct > 100) {
    reasons.push(`ownerControlledPct ${ownerPct} > 100 — clamped to 100`);
    ownerPct = 100;
  }
  let top10Pct = topRaw.value;
  if (top10Pct > 100) {
    reasons.push(`top10Percent ${top10Pct} > 100 — clamped to 100`);
    top10Pct = 100;
  }
  ownerPct = clampPct(ownerPct);
  top10Pct = clampPct(top10Pct);

  // component signals (0..1)
  const supplyTightness = supplyTightness01(circulatingSupply);
  const holderBreadth = holderBreadth01(uniqueHolders);
  const controlAdvantage = controlAdvantage01(ownerPct);
  const concFactor = concentrationFactor(top10Pct);
  // concentrationRisk reported as a 0..1 RISK (1 = max risk) for legibility.
  const concentrationRisk = clamp01(top10Pct / 100);

  const raw =
    W_SUPPLY_TIGHTNESS * supplyTightness +
    W_HOLDER_BREADTH * holderBreadth +
    W_CONTROL_ADVANTAGE * controlAdvantage; // 0..100 before haircut

  const score = round2(clamp01(raw / 100 * concFactor) * 100);
  const tier = tierFor(score);

  // explanatory reasons (deterministic prose from the same numbers)
  if (circulatingSupply > 0 && circulatingSupply <= TIGHT_SUPPLY) {
    reasons.push('supply is extremely tight (<= 1M) — strong scarcity floor');
  } else if (circulatingSupply >= LOOSE_SUPPLY) {
    reasons.push('supply is effectively unbounded — no scarcity floor');
  }
  if (uniqueHolders >= BROAD_HOLDERS) {
    reasons.push('holders are broadly distributed — hard to capture');
  } else if (uniqueHolders <= FEW_HOLDERS) {
    reasons.push('very few holders — nascent / capturable distribution');
  }
  if (ownerPct >= 50) {
    reasons.push('high owner-controlled stake — strong defensive moat on the float');
  }
  if (top10Pct >= 50) {
    reasons.push('top-10 non-owner concentration is high — breadth is partly illusory (haircut applied)');
  }
  if (supplyPerHolder(circulatingSupply, uniqueHolders) > 0) {
    reasons.push(`avg float per holder ≈ ${supplyPerHolder(circulatingSupply, uniqueHolders)}`);
  }
  if (reasons.length === 0) reasons.push('nominal inputs — no notable signals');

  return {
    score,
    tier,
    signals: {
      supplyTightness: round2(supplyTightness),
      holderBreadth: round2(holderBreadth),
      controlAdvantage: round2(controlAdvantage),
      concentrationRisk: round2(concentrationRisk),
    },
    reasons,
  };
}

// ── public: compare a set of tokens, sorted by score (desc), with a one-line verdict each ───────
// Accepts an array of { name?, ...scarcityScore-input }. Soft-fails: non-array → []; bad entries are
// scored as all-zero (their reasons explain why). Stable: ties break by name then original index.
export function compare(a, b) {
  // Allow compare(arrayOfTokens) OR compare(tokenA, tokenB).
  let tokens;
  if (Array.isArray(a)) {
    tokens = a;
  } else if (a && b) {
    tokens = [a, b];
  } else if (a) {
    tokens = [a];
  } else {
    return [];
  }
  if (!Array.isArray(tokens)) return [];

  const scored = tokens.map((t, i) => {
    const obj = t && typeof t === 'object' ? t : {};
    const r = scarcityScore(obj);
    const name = typeof obj.name === 'string' && obj.name ? obj.name : `token#${i}`;
    return {
      name,
      score: r.score,
      tier: r.tier,
      signals: r.signals,
      reasons: r.reasons,
      verdict: `${name}: ${r.score}/100 (${r.tier}) — ${verdictLine(r)}`,
      _i: i,
    };
  });

  scored.sort((x, y) => {
    if (y.score !== x.score) return y.score - x.score;
    if (x.name !== y.name) return x.name < y.name ? -1 : 1;
    return x._i - y._i;
  });

  return scored.map(({ _i, ...rest }) => rest);
}

function verdictLine(r) {
  const s = r.signals;
  if (r.tier === 'EXTREME') return 'tight supply + broad holders + strong self-control: highly defensible';
  if (r.tier === 'HIGH') return 'good scarcity moat; one of the three pillars is soft';
  if (r.tier === 'MODERATE') {
    if (s.concentrationRisk >= 0.5) return 'concentration drags it down despite some scarcity';
    return 'mixed signals — defensible only on some axes';
  }
  return 'weak scarcity advantage — loose float, thin holders, or low self-control';
}

// ── CLI demo (guarded; no I/O beyond stdout) ────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const VKBT = { name: 'VKBT-like', circulatingSupply: 750_000, uniqueHolders: 12_000, ownerControlledPct: 40, top10Percent: 12 };
  const CURE = { name: 'CURE-like', circulatingSupply: 850_000_000_000, uniqueHolders: 40, ownerControlledPct: 5, top10Percent: 78 };
  console.log(JSON.stringify(compare([VKBT, CURE]), null, 2));
}
