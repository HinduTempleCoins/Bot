// integrations/agegate/face-age.mjs — our own facial age-estimation provider for the `verified` level.
//
// ⭐ WHY WE RUN THIS OURSELVES.
// Commercial age verification is charged PER VISITOR while revenue comes only from the converting
// fraction: at $0.25 a check and 100,000 checks a month that is $25,000/month, paid mostly on people who
// never spend anything (ADULT_CAM_MARKET_RESEARCH.md §0). The gate already fixes half of that by asking
// each surface for its own level. This fixes the other half — the check itself costs nothing per head
// because it runs on our own CPU, on a model already on disk.
//
// ⭐ WHAT IT IS AND IS NOT.
// buffalo_l (insightface) ships a `genderage` model alongside the ArcFace recogniser, so integrations/
// face-identity already loads an age estimate and simply never read it. This provider reads it. That is
// AGE ESTIMATION from a selfie — the "commercially reasonable check" tier. It is NOT an identity document
// match, so it can only ever produce `verified`, never `id`. The `id` tier needs a document examined
// against a live face, and face-identity.verify() is the matcher for that when it is built.
//
// ⭐ THE MARGIN IS THE WHOLE DESIGN.
// An estimator has error. Passing anyone the model guesses at 18 would pass a substantial number of
// seventeen-year-olds. So the threshold is 18 plus a MARGIN, and the margin is explicit, configurable and
// logged in the decision. Estimated 25 with a margin of 5 clears; estimated 20 does not. The failure
// direction is deliberate: we would rather turn away adults who look young — they can be re-checked by a
// stricter method — than admit a minor, because one of those errors is a crime and the other is friction.
//
// ⭐ NO IMAGE IS KEPT, EVER.
// The selfie is a transient input. This module returns a decision and a providerRef; it never writes the
// image, never returns it, and never puts an age or a face in the record. assertNoPII in the model will
// refuse a record carrying any of it, which is the backstop rather than the policy.
//
// House style: ESM, pure decision logic, injectable estimator so the whole thing tests offline.

export const PROVIDER_ID = 'face-age';
export const DEFAULT_MARGIN_YEARS = 5;
export const FLOOR_YEARS = 18;

/** How many faces are acceptable in a frame. More than one and we cannot tell whose age we measured. */
export const MAX_FACES = 1;

let _estimator = null;
/** Inject the thing that turns an image into { ok, faces:[{age, score}] }. Tests pass a stub. */
export function __setEstimator(fn) { _estimator = typeof fn === 'function' ? fn : null; }

async function estimate(image) {
  // Every path through here is wrapped. An injected estimator is as capable of throwing as an imported
  // one, and a gate provider that throws takes the request down instead of failing closed.
  if (_estimator) {
    try { return await _estimator(image); }
    catch (e) { return { ok: false, reason: `estimator failed: ${String((e && e.message) || e).slice(0, 80)}` }; }
  }
  try {
    const mod = await import('../face-identity.mjs');
    if (typeof mod.age !== 'function') return { ok: false, reason: 'face-identity has no age command' };
    return await mod.age(image);
  } catch (e) {
    return { ok: false, reason: `estimator unavailable: ${String((e && e.message) || e).slice(0, 80)}` };
  }
}

/**
 * Decide from an estimate alone. Pure — no I/O, no model. Exported so the rule is testable and auditable
 * without a model on disk, and so the margin cannot be quietly changed without a test noticing.
 */
export function decide(est, { marginYears = DEFAULT_MARGIN_YEARS, floor = FLOOR_YEARS } = {}) {
  const margin = Number.isFinite(+marginYears) && +marginYears >= 0 ? +marginYears : DEFAULT_MARGIN_YEARS;
  const need = (Number.isFinite(+floor) ? +floor : FLOOR_YEARS) + margin;

  if (!est || est.ok !== true) {
    return { ok: false, reason: (est && est.reason) || 'no estimate', retryable: true };
  }
  const faces = Array.isArray(est.faces) ? est.faces : [];
  if (faces.length === 0) return { ok: false, reason: 'no face found in the image', retryable: true };
  if (faces.length > MAX_FACES) {
    return { ok: false, reason: `${faces.length} faces in the frame — send one person alone`, retryable: true };
  }
  const age = +faces[0].age;
  if (!Number.isFinite(age) || age <= 0) return { ok: false, reason: 'the model returned no age', retryable: true };

  if (age >= need) {
    // The record carries no age and no image — only that a check of this kind passed.
    return { ok: true, level: 'verified', providerRef: `face-age:margin${margin}` };
  }
  return {
    ok: false,
    level: 'verified',
    reason: `estimated below ${need} (the floor of ${FLOOR_YEARS} plus a ${margin}-year margin) — this check cannot clear you`,
    retryable: false,
    needsStrongerMethod: true,
  };
}

/** The provider shape integrations/agegate runCheck() expects. */
export const faceAgeProvider = {
  id: PROVIDER_ID,
  level: 'verified',
  async check({ image, marginYears, floor } = {}) {
    if (!image) return { ok: false, reason: 'no image supplied' };
    return decide(await estimate(image), { marginYears, floor });
  },
};

export default faceAgeProvider;
