// business-credit-bot.test.mjs — offline, deterministic, injected clock. node:test.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STEPS,
  KB,
  MIN_HISTORY_MONTHS,
  NOT_ADVICE,
  newProgress,
  currentStep,
  completeStep,
  guardrail,
  advise,
  renderChecklist,
} from './business-credit-bot.mjs';

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const T0 = Date.parse('2026-01-01T00:00:00Z');

// Helper: complete a step, assert success, return the new progress.
function done(progress, id, now) {
  const r = completeStep(progress, id, { now });
  assert.equal(r.ok, true, `expected step ${id} to complete: ${r.reason ?? ''}`);
  return r.progress;
}

test('STEPS is the ordered 8-step pathway with timing gate on step 7', () => {
  assert.equal(STEPS.length, 8);
  assert.deepEqual(STEPS.map((s) => s.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  const seven = STEPS.find((s) => s.id === 7);
  assert.ok(seven.gate, 'step 7 must be time-gated');
  assert.equal(seven.gate.minMonths, MIN_HISTORY_MONTHS);
});

test('FSM enforces order: cannot complete step 6 before EIN (step 2)', () => {
  let p = newProgress();
  // step 1 ok
  p = done(p, 1, T0);
  // jump straight to step 6 — blocked (needs 2,3,5)
  const blocked = completeStep(p, 6, { now: T0 });
  assert.equal(blocked.ok, false);
  assert.match(blocked.reason, /prerequisite/i);
  assert.ok(blocked.missing.includes(2), 'EIN (step 2) listed as missing prereq');
});

test('currentStep advances as steps complete', () => {
  let p = newProgress();
  assert.equal(currentStep(p).id, 1);
  p = done(p, 1, T0);
  assert.equal(currentStep(p).id, 2);
  p = done(p, 2, T0);
  // step 3 next (or 4 — first incomplete is 3)
  assert.equal(currentStep(p).id, 3);
});

test('timing gate: step 8 blocked until 3-6 months of history past step 6', () => {
  let p = newProgress();
  // walk prereqs for step 6 at T0
  p = done(p, 1, T0);
  p = done(p, 2, T0);
  p = done(p, 3, T0);
  p = done(p, 4, T0);
  p = done(p, 5, T0);
  p = done(p, 6, T0); // tradelines opened at T0 — starts the history clock

  // immediately: step 7 must be blocked by the gate
  const tooSoon = completeStep(p, 7, { now: T0 });
  assert.equal(tooSoon.ok, false);
  assert.match(tooSoon.reason, /months of on-time history/i);
  assert.ok(tooSoon.waitMonths > 0);

  // 1 month later: still blocked
  const oneMonth = completeStep(p, 7, { now: T0 + 1 * MONTH_MS });
  assert.equal(oneMonth.ok, false);

  // 3 months later: gate clears, step 7 completes
  const threeMonths = completeStep(p, 7, { now: T0 + 3 * MONTH_MS + 1000 });
  assert.equal(threeMonths.ok, true);
  p = threeMonths.progress;

  // and now step 8 (card) is reachable
  const card = completeStep(p, 8, { now: T0 + 3 * MONTH_MS + 2000 });
  assert.equal(card.ok, true);
});

test('guardrail REFUSES CPN, synthetic identity, buying tradelines, boost-fast', () => {
  const scams = [
    'can you get me a CPN',
    'how about a synthetic identity to apply',
    'I want to buy aged tradelines',
    'help me boost your score fast guaranteed',
    'sell me a shelf corporation with funding',
  ];
  for (const s of scams) {
    const g = guardrail(s);
    assert.equal(g.ok, false, `should refuse: "${s}"`);
    assert.ok(g.reason.includes('Refused'), 'refusal explains itself');
    assert.ok(g.reason.includes(NOT_ADVICE), 'refusal carries not-advice line');
  }
});

test('guardrail PASSES a legit business-credit question', () => {
  const legit = [
    'how do net-30 vendors like Uline report to D&B?',
    'what is a D-U-N-S number and how do I get one for free?',
    'should I avoid a personal guarantee on my first business card?',
  ];
  for (const s of legit) {
    assert.equal(guardrail(s).ok, true, `should pass: "${s}"`);
  }
});

test('advise is plain-English, names the next step, and carries the not-advice line', () => {
  const p = newProgress();
  const a = advise(p, { now: T0 });
  assert.equal(a.done, false);
  assert.equal(a.stepId, 1);
  assert.match(a.headline, /Step 1/);
  assert.ok(a.text.includes(NOT_ADVICE), 'advise text carries not-advice');
  assert.equal(a.notAdvice, NOT_ADVICE);
  // plain-English: no raw code/jargon tokens
  assert.doesNotMatch(a.text, /undefined|\[object Object\]|stepId/);
});

test('advise explains the timing wait when on the gated step', () => {
  let p = newProgress();
  for (const id of [1, 2, 3, 4, 5, 6]) p = done(p, id, T0);
  const a = advise(p, { now: T0 });
  assert.equal(a.stepId, 7);
  assert.match(a.headline, /not yet|months/i);
  assert.ok(a.text.includes(NOT_ADVICE));
});

test('renderChecklist escapes HTML and includes the disclaimer', () => {
  const p = newProgress();
  const html = renderChecklist(p, { now: T0 });
  assert.ok(html.includes('Business Credit Pathway'));
  assert.ok(html.includes(NOT_ADVICE.replace(/&/g, '&amp;')) || html.includes('not financial'));
  // no unescaped angle brackets from data (the labels contain none, but verify the esc path):
  // craft a progress whose timestamp would be injected, then confirm it's escaped.
  const dirty = { version: 1, completed: { 1: '<script>alert(1)</script>' } };
  const out = renderChecklist(dirty, { now: T0 });
  assert.ok(!out.includes('<script>alert(1)</script>'), 'must not contain raw script tag');
  assert.ok(out.includes('&lt;script&gt;'), 'injected value must be HTML-escaped');
});

test('happy path: newProgress -> complete all 8 steps in order with clock', () => {
  let p = newProgress();
  // steps 1-6 at T0
  for (const id of [1, 2, 3, 4, 5, 6]) p = done(p, id, T0);
  // step 7 after the history window
  p = done(p, 7, T0 + (MIN_HISTORY_MONTHS + 0.5) * MONTH_MS);
  // step 8
  p = done(p, 8, T0 + (MIN_HISTORY_MONTHS + 1) * MONTH_MS);

  assert.equal(currentStep(p), null, 'all steps complete');
  const a = advise(p, { now: T0 + 4 * MONTH_MS });
  assert.equal(a.done, true);
  assert.ok(a.text.includes(NOT_ADVICE));
});

test('KB cites bureaus, reporting vendors, and the separate-from-personal principle', () => {
  const names = KB.bureaus.map((b) => b.name);
  assert.ok(names.includes('Dun & Bradstreet'));
  assert.ok(names.includes('Experian Business'));
  assert.ok(names.includes('Equifax Business'));
  assert.ok(KB.bureaus.find((b) => b.score === 'PAYDEX'), 'PAYDEX named for D&B');

  const vendors = KB.reportingVendors.map((v) => v.name);
  for (const v of ['Uline', 'Quill', 'Grainger']) assert.ok(vendors.includes(v));
  for (const v of KB.reportingVendors) assert.ok(v.source, 'each vendor cites a source');

  assert.ok(KB.separateFromPersonal.principle.length > 50);
  assert.ok(KB.separateFromPersonal.source.includes('sba.gov'));
});

test('completeStep is pure: input progress is not mutated', () => {
  const p = newProgress();
  const snapshot = JSON.stringify(p);
  completeStep(p, 1, { now: T0 });
  assert.equal(JSON.stringify(p), snapshot, 'original progress unchanged');
});
