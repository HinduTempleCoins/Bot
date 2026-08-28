// credit-score.test.mjs — offline tests for the credit-score education content. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCORE_FACTORS, SCORE_RANGES, BUILD_STEPS, DISPUTE_STEPS, BUREAUS, RESOURCES, DISCLAIMER, bandForScore,
} from './credit-score.mjs';

test('FICO factors sum to 100%', () => {
  assert.equal(SCORE_FACTORS.reduce((s, f) => s + f.weight, 0), 100);
  assert.ok(SCORE_FACTORS.every((f) => f.id && f.name && f.desc));
});

test('ranges cover 300–850 contiguously', () => {
  assert.equal(SCORE_RANGES[0].min, 300);
  assert.equal(SCORE_RANGES[SCORE_RANGES.length - 1].max, 850);
  for (let i = 1; i < SCORE_RANGES.length; i++) {
    assert.equal(SCORE_RANGES[i].min, SCORE_RANGES[i - 1].max + 1, 'no gaps/overlap');
  }
});

test('bandForScore maps scores + soft-fails on junk', () => {
  assert.equal(bandForScore(300).band, 'poor');
  assert.equal(bandForScore(670).band, 'good');
  assert.equal(bandForScore(850).band, 'exceptional');
  assert.equal(bandForScore(200), null);
  assert.equal(bandForScore('nope'), null);
  assert.equal(bandForScore(NaN), null);
});

test('the three nationwide bureaus + free-report source are present', () => {
  assert.equal(BUREAUS.length, 3);
  assert.ok(BUREAUS.some((b) => /equifax/i.test(b.name)));
  assert.ok(RESOURCES.some((r) => /annualcreditreport/i.test(r.name)));
  assert.ok(BUREAUS.every((b) => /^https:\/\//.test(b.url)));
});

test('build + dispute steps are complete', () => {
  assert.ok(BUILD_STEPS.length >= 5 && BUILD_STEPS.every((s) => s.title && s.desc));
  assert.ok(DISPUTE_STEPS.length >= 4 && DISPUTE_STEPS.every((s) => s.title && s.desc));
  assert.ok(DISPUTE_STEPS.some((s) => /FCRA/.test(s.desc)), 'cites FCRA rights');
});

test('compliance: education-not-advice framing + no paid-repair hustle', () => {
  assert.match(DISCLAIMER, /education only/i);
  assert.match(DISCLAIMER, /not financial or legal advice/i);
  assert.match(DISCLAIMER, /do yourself for free/i);
  assert.ok(RESOURCES.some((r) => /repair/i.test(r.name)), 'warns about credit-repair scams');
});
