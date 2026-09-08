import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SCALE, SCENARIOS, ITEMS, ITEM_COUNT, MIN_SCORE, MAX_SCORE, LANDMARKS,
  buildForm, scoreForm, resultCopy, vviqPageHTML,
} from './exam-vviq.mjs';

const all = (v) => Object.fromEntries(ITEMS.map((i) => [i.id, v]));

test('sixteen items in four scenes, on the sixteen-to-eighty scale', () => {
  assert.equal(SCENARIOS.length, 4);
  assert.equal(ITEM_COUNT, 16);
  assert.equal(ITEMS.length, 16);
  assert.equal(new Set(ITEMS.map((i) => i.id)).size, 16);
  assert.equal(MIN_SCORE, ITEM_COUNT * 1);
  assert.equal(MAX_SCORE, ITEM_COUNT * 5);
});

test('the scale runs the aphantasia-era way round — 1 is no image, 5 is as vivid as seeing', () => {
  assert.equal(SCALE.length, 5);
  assert.match(SCALE[0].label, /No image at all/);
  assert.match(SCALE[4].label, /as vivid as normal vision/);
  // The direction is the thing most likely to be got backwards, so it is asserted, not assumed.
  assert.equal(scoreForm(all(1)).score.total, MIN_SCORE);
  assert.equal(scoreForm(all(5)).score.total, MAX_SCORE);
});

test('scenario order is randomised but items inside a scenario keep their published sequence', () => {
  const a = buildForm({ seed: 'one' });
  assert.equal(a.length, 4);
  assert.equal(a.reduce((n, s) => n + s.items.length, 0), 16);
  for (const s of a) {
    const canonical = SCENARIOS.find((x) => x.id === s.id);
    assert.deepEqual(s.items.map((i) => i.text), canonical.items,
      'a scenario is a narrative — reordering inside it changes the question');
  }
  // Two different people get different scene orders; the same seed reproduces one.
  const orders = new Set(['a', 'b', 'c', 'd', 'e', 'f'].map((s) => buildForm({ seed: s }).map((x) => x.id).join(',')));
  assert.ok(orders.size > 1, 'scenario order never varied');
  assert.equal(buildForm({ seed: 'one' }).map((x) => x.id).join(','), a.map((x) => x.id).join(','));
});

test('a partial form is scored as partial and never printed as a VVIQ total', () => {
  const partial = Object.fromEntries(ITEMS.slice(0, 12).map((i) => [i.id, 4]));
  const r = scoreForm(partial);
  assert.equal(r.answered, 12);
  assert.equal(r.complete, false);
  const copy = resultCopy(r, { n: 5 });
  assert.match(copy.headline, /12 of 16 items answered/);
  assert.ok(copy.lines.some((l) => /cannot be read against the landmarks/.test(l)));
});

test('out-of-range and junk answers are left out rather than coerced', () => {
  const r = scoreForm({ ...all(3), 'person.1': 9, 'person.2': 0, 'person.3': 2.5, 'person.4': 'x' });
  assert.equal(r.answered, 12);
  assert.equal(r.score.total, 36);
  assert.equal(scoreForm(null).score.total, null);
  assert.equal(scoreForm('nope').answered, 0);
});

test('per-scenario subtotals are reported, because the whole is not the only thing measured', () => {
  const answers = { ...all(1) };
  for (const i of ITEMS.filter((x) => x.scenario === 'sunrise')) answers[i.id] = 5;
  const r = scoreForm(answers);
  assert.equal(r.byScenario.sunrise, 20);
  assert.equal(r.byScenario.person, 4);
});

// ── the straight-lining observation, which must never become an accusation ────────────────────────

test('answering all-the-same-and-fast is reported as an observation, not a verdict', () => {
  const times = Object.fromEntries(ITEMS.map((i) => [i.id, 400]));
  const r = scoreForm(all(1), times);
  assert.equal(r.allSameAnswer, true);
  assert.equal(r.answeredQuickly, true);
  const copy = resultCopy(r, { n: 5 });
  const note = copy.lines.find((l) => /same answer to every item/.test(l));
  assert.ok(note, 'the observation was not surfaced');
  // The honest half: a person with no imagery legitimately answers 1 to everything, quickly.
  assert.match(note, /exactly what someone with no voluntary imagery does/);
  assert.match(note, /cannot tell them apart/);
  assert.ok(!/cheat|fake|invalid|discard/i.test(note));
  // And the data is kept regardless.
  assert.equal(r.score.total, MIN_SCORE);
});

test('a slow floor responder is not flagged at all', () => {
  const times = Object.fromEntries(ITEMS.map((i) => [i.id, 6000]));
  const r = scoreForm(all(1), times);
  assert.equal(r.allSameAnswer, true);
  assert.equal(r.answeredQuickly, false);
  assert.ok(!resultCopy(r, { n: 5 }).lines.some((l) => /same answer to every item/.test(l)));
});

// ── the wording rule ─────────────────────────────────────────────────────────────────────────────

test('the result reports a number and never a category', () => {
  const copy = resultCopy(scoreForm(all(1)), { n: 5 });
  const text = [copy.headline, ...copy.lines, ...copy.landmarks.map((l) => `${l.text} ${l.source}`)].join(' ');
  assert.match(text, /VVIQ 16 of 80/);
  assert.ok(!/you have aphantasia/i.test(text));
  assert.ok(!/you are aphantasic/i.test(text));
  assert.ok(!/\bdiagnos/i.test(text));
  assert.equal(copy.neverSay, 'You have aphantasia.');
});

test('the no-consensus statement comes FIRST, before any threshold', () => {
  const copy = resultCopy(scoreForm(all(3)), { n: 5 });
  assert.equal(copy.landmarks[0].text, LANDMARKS.noConsensus);
  assert.match(copy.landmarks[1].text, /below 24/);
  assert.match(copy.landmarks[1].source, /Zeman/);
  assert.ok(copy.landmarks.some((l) => /hyperphantasia/.test(l.text)));
});

test('the copy says the scale direction and says a visual score is not the whole inner life', () => {
  const lines = resultCopy(scoreForm(all(4)), { n: 5 }).lines.join(' ');
  assert.match(lines, /a LOW total means LOW vividness/);
  assert.match(lines, /the opposite result/);
  assert.match(lines, /Andrade/);
  assert.match(lines, /no visual imagery and vivid/);
});

test('a single sitting is told it is a reading, and a pair is reported as a pair', () => {
  assert.equal(resultCopy(scoreForm(all(2)), { n: 5 }).retest.ok, false);
  const pair = resultCopy(scoreForm(all(2)), { n: 5, priorScore: 40 }).retest;
  assert.equal(pair.ok, true);
  assert.equal(pair.first, 40);
  assert.equal(pair.second, 32);
});

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

test('the page states the direction, the administration and the licence', () => {
  const html = vviqPageHTML();
  assert.match(html, /1 means no image at all/);
  assert.match(html, /eyes open, which is/);
  assert.match(html, /not interchangeable/);
  assert.match(html, /Marks \(1973\), reproduced from the published appendix/);
  assert.match(html, /VVIQ-2’s thirty-two items are not reproduced here/);
});

test('the page never asks for a name, an email or an account, and carries the state card', () => {
  const html = vviqPageHTML();
  assert.ok(!/type=email|name="email"|name="name"|password/i.test(html));
  assert.match(html, /Karolinska/);
  assert.match(html, /We do not ask how much, and we never will/);
});
