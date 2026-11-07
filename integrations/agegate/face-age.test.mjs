// integrations/agegate/face-age.test.mjs — OFFLINE, injected estimator. The margin is the product, so
// the margin is what gets tested: that 18 alone never clears, that the failure direction is toward
// refusing adults rather than admitting minors, and that no age or image can reach a stored record.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decide, faceAgeProvider, __setEstimator, DEFAULT_MARGIN_YEARS, FLOOR_YEARS, PROVIDER_ID, MAX_FACES,
} from './face-age.mjs';
import { runCheck, __reset, lookup, assertNoPII } from './model.mjs';

const est = (faces) => ({ ok: true, faces });

test('the floor is 18 and the default margin is a real margin, not zero', () => {
  assert.equal(FLOOR_YEARS, 18);
  assert.ok(DEFAULT_MARGIN_YEARS >= 3, `margin ${DEFAULT_MARGIN_YEARS} is too thin to absorb estimator error`);
});

test('an estimate of exactly 18 does NOT clear — that is the point of the margin', () => {
  const r = decide(est([{ age: 18 }]));
  assert.equal(r.ok, false);
  assert.match(r.reason, /below 23/);
  assert.equal(r.needsStrongerMethod, true);
});

test('clearing requires the floor plus the margin', () => {
  assert.equal(decide(est([{ age: 22 }])).ok, false);
  assert.equal(decide(est([{ age: 23 }])).ok, true);
  assert.equal(decide(est([{ age: 40 }])).ok, true);
});

test('the margin is configurable and a zero margin is honoured but explicit', () => {
  assert.equal(decide(est([{ age: 18 }]), { marginYears: 0 }).ok, true);
  assert.equal(decide(est([{ age: 17 }]), { marginYears: 0 }).ok, false);
  assert.equal(decide(est([{ age: 30 }]), { marginYears: 20 }).ok, false);
  // a nonsense margin falls back to the default rather than becoming zero
  assert.equal(decide(est([{ age: 19 }]), { marginYears: -4 }).ok, false);
  assert.equal(decide(est([{ age: 19 }]), { marginYears: 'abc' }).ok, false);
});

test('a refusal says whether retrying could help', () => {
  assert.equal(decide({ ok: false, reason: 'model down' }).retryable, true);
  assert.equal(decide(est([])).retryable, true);
  // too young is not a retry problem
  assert.equal(decide(est([{ age: 19 }])).retryable, false);
});

test('more than one face is refused — we cannot tell whose age we measured', () => {
  assert.equal(MAX_FACES, 1);
  const r = decide(est([{ age: 40 }, { age: 12 }]));
  assert.equal(r.ok, false);
  assert.match(r.reason, /2 faces/);
});

test('a missing, zero or nonsense age never clears', () => {
  for (const faces of [[{}], [{ age: 0 }], [{ age: -3 }], [{ age: 'old' }], [{ age: null }]]) {
    assert.equal(decide(est(faces)).ok, false, JSON.stringify(faces));
  }
});

test('a broken estimator fails closed and never throws', async () => {
  for (const bad of [null, undefined, {}, { ok: false }, { ok: true }, { ok: true, faces: 'nope' }]) {
    assert.equal(decide(bad).ok, false, JSON.stringify(bad));
  }
  __setEstimator(async () => { throw new Error('model exploded'); });
  const r = await faceAgeProvider.check({ image: '/x.jpg' }).catch((e) => ({ ok: false, threw: String(e) }));
  assert.equal(r.ok, false);
  assert.equal(r.threw, undefined, 'the provider must not throw');
  __setEstimator(null);
});

test('no image means no check', async () => {
  const r = await faceAgeProvider.check({});
  assert.equal(r.ok, false);
  assert.match(r.reason, /no image/);
});

test('this provider can only ever produce verified, never id', async () => {
  assert.equal(faceAgeProvider.level, 'verified');
  __setEstimator(async () => est([{ age: 55 }]));
  const r = await faceAgeProvider.check({ image: '/x.jpg' });
  assert.equal(r.level, 'verified');
  __setEstimator(null);
});

test('a passing check records the result and no age, face or image', async () => {
  __reset();
  __setEstimator(async () => est([{ age: 31 }]));
  const rec = await runCheck(faceAgeProvider, 'subject-a', { image: '/selfie.jpg' });
  assert.equal(rec.ok, true, rec.reason);
  const stored = lookup('subject-a');
  assert.equal(stored.level, 'verified');
  assert.equal(stored.provider, PROVIDER_ID);
  // nothing about the person or the photograph survives
  for (const k of Object.keys(stored)) {
    assert.ok(!/age|image|face|photo|selfie|dob|birth/i.test(k), `record leaked "${k}"`);
  }
  assert.equal(JSON.stringify(stored).includes('31'), false, 'the estimated age must not be stored');
  assert.equal(assertNoPII(stored).ok, true);
  __setEstimator(null);
});

test('a failing check stores nothing at all', async () => {
  __reset();
  __setEstimator(async () => est([{ age: 16 }]));
  const rec = await runCheck(faceAgeProvider, 'subject-b', { image: '/selfie.jpg' });
  assert.equal(rec.ok, false);
  assert.equal(lookup('subject-b'), null, 'a refused check must leave no record');
  __setEstimator(null);
});
