// site/hathor-live/practices.test.mjs — the no-hardware technique library.
//
// The point of these tests is the same as the point of the module: this subject attracts confident
// instruction with nothing behind it, so the grading and the citations are the product. A practice
// without a real citation, or graded better than its evidence, is the failure mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PRACTICES, PRACTICE_FAMILIES, PRACTICE_IDS, byFamily, practiceGrade,
} from './practices.mjs';
import { GAMMA_PAGE } from './gamma.mjs';

const GRADES = ['strong', 'moderate', 'promising', 'weak', 'traditional'];

test('every practice is well formed and uses a known grade', () => {
  assert.ok(PRACTICES.length >= 8);
  const families = new Set(PRACTICE_FAMILIES.map((f) => f.id));
  for (const p of PRACTICES) {
    assert.ok(p.id && p.name, 'needs id + name');
    assert.ok(families.has(p.family), `${p.id}: unknown family ${p.family}`);
    assert.ok(GRADES.includes(p.grade), `${p.id}: bad grade ${p.grade}`);
    // minutes === 0 is meaningful: an adjunct or an evidence entry with no duration
    assert.ok(Number.isFinite(p.minutes) && p.minutes >= 0, `${p.id}: needs minutes`);
    assert.ok(p.summary && p.summary.length > 40, `${p.id}: needs a real summary`);
    assert.ok(Array.isArray(p.steps) && p.steps.length >= 3, `${p.id}: needs steps`);
    assert.ok(p.evidence && p.evidence.length > 60, `${p.id}: needs an evidence statement`);
  }
});

test('ids are unique', () => {
  assert.equal(new Set(PRACTICE_IDS).size, PRACTICE_IDS.length);
});

test('EVERY practice cites something real — no bare assertions', () => {
  for (const p of PRACTICES) {
    assert.ok(Array.isArray(p.citations) && p.citations.length >= 1, `${p.id}: no citation`);
    for (const c of p.citations) {
      assert.ok(c.label, `${p.id}: citation needs a label`);
      assert.match(c.url, /^https:\/\//, `${p.id}: citation needs an https url`);
    }
  }
});

test('counting sheep is graded WEAK and says what to do instead', () => {
  // The whole reason it is in the library: the folk technique is famous and the one study that
  // tested its shape found it did not work. Downgrading it quietly would defeat the purpose.
  assert.equal(practiceGrade('counting-sheep'), 'weak');
  const sheep = PRACTICES.find((p) => p.id === 'counting-sheep');
  assert.match(sheep.summary + sheep.steps.join(' '), /imagery/i,
    'it must point the reader at the technique that did work');
});

test('imagery distraction outranks counting sheep, which is the finding', () => {
  const order = (g) => GRADES.indexOf(g);
  assert.ok(order(practiceGrade('imagery-distraction')) < order(practiceGrade('counting-sheep')));
});

test('WILD is graded traditional — dramatic technique, thin controlled evidence', () => {
  assert.equal(practiceGrade('wild'), 'traditional');
});

test('MILD and SSILD carry the SAME grade, because the study found them comparable', () => {
  // ILDIS (N=355) found MILD and SSILD similarly effective. Ranking one above the other would be
  // inventing a result the study did not produce.
  assert.equal(practiceGrade('mild'), practiceGrade('ssild'));
});

test('the techniques that fragment sleep carry a caution', () => {
  for (const id of ['wbtb', 'wild']) {
    const p = PRACTICES.find((x) => x.id === id);
    assert.ok(p.caution && p.caution.length > 20, `${id} must carry a caution`);
  }
});

test('the B6 entry carries the neuropathy warning and the five-night limit', () => {
  // 240 mg pyridoxine is far above dietary intake, and chronic high-dose B6 causes peripheral
  // sensory neuropathy. The trial ran five nights. Shipping the dose without that is the harm.
  const b6 = PRACTICES.find((p) => p.id === 'b6-recall');
  assert.ok(b6, 'b6-recall must exist');
  assert.match(b6.caution, /neuropathy/i);
  assert.match(b6.caution + b6.steps.join(' '), /five|5 /i, 'must state the duration studied');
});

test('the B6 entry does NOT claim vividness — the trial found recall only', () => {
  const b6 = PRACTICES.find((p) => p.id === 'b6-recall');
  assert.match(b6.summary + b6.steps.join(' '), /did not|not.*vivid/i,
    'the negative half of the result must be stated, since vividness is what it is sold for');
});

test('applying current during sleep is not handed over as a recipe', () => {
  const t = PRACTICES.find((p) => p.id === 'gamma-tacs-rem');
  assert.ok(t, 'gamma-tacs-rem must exist');
  assert.equal(t.family, 'cueing');
  assert.match(t.caution, /do not improvise|not something we are handing/i);
  assert.match(t.steps.join(' '), /laboratory finding|not a home protocol/i);
});

test('the 40Hz tension is stated rather than resolved in our favour', () => {
  // Voss found frequency decisive; the 2026 chamber study found it did not matter. Both are on the
  // page. Quietly dropping the inconvenient one is the thing this whole library exists not to do.
  const t = PRACTICES.find((p) => p.id === 'gamma-tacs-rem');
  assert.match(t.note, /chamber/i);
  assert.match(t.note, /equivalent|not/i);
});

test('trauma-linked nightmares are routed to a clinician', () => {
  const n = PRACTICES.find((p) => p.id === 'lucid-nightmares');
  assert.match(n.caution, /clinician|PTSD/i);
});

test('meditation is graded on induction, and says the 8-week RCT was negative', () => {
  assert.equal(practiceGrade('meditation-lucid'), 'weak');
  const m = PRACTICES.find((p) => p.id === 'meditation-lucid');
  assert.match(m.evidence, /did not increase|not increase/i);
});

test('byFamily partitions the catalogue with nothing orphaned', () => {
  let n = 0;
  for (const f of PRACTICE_FAMILIES) {
    const items = byFamily(f.id);
    assert.ok(items.length >= 1, `${f.id} has no practices`);
    n += items.length;
  }
  assert.equal(n, PRACTICES.length, 'every practice belongs to exactly one listed family');
});

test('practiceGrade soft-fails on an unknown id', () => {
  assert.equal(practiceGrade('nope'), null);
  assert.equal(practiceGrade(''), null);
  assert.doesNotThrow(() => practiceGrade(undefined));
});

test('the /40hz page renders every practice, escaped, with its grade', () => {
  for (const p of PRACTICES) {
    assert.ok(GAMMA_PAGE.includes(p.name.replace(/&/g, '&amp;').replace(/—/g, '—')),
      `${p.id} missing from the page`);
  }
  assert.match(GAMMA_PAGE, /Practices — the half that needs no hardware/);
  assert.ok(!GAMMA_PAGE.includes('${'), 'no unresolved template expressions');
});

test('the page states plainly that none of this treats insomnia', () => {
  assert.match(GAMMA_PAGE, /(none of this is|not) a treatment for (chronic )?insomnia/i);
  // and it must say where to go instead, rather than only disclaiming
  assert.match(GAMMA_PAGE, /clinical matter/i);
});
