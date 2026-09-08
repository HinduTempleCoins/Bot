import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRAPHEMES, PRESENTATIONS, TRIAL_COUNT, THRESHOLDS,
  buildTrials, scoreSitting, resultCopy, graphemePageHTML,
} from './exam-grapheme.mjs';

const answers = (colourFor) => buildTrials({ seed: 'test' }).map((t) => ({
  grapheme: t.grapheme, presentation: t.presentation, hex: colourFor(t), ms: 800,
}));

test('the stimulus set is 36 characters and 108 trials — do not shorten it', () => {
  assert.equal(GRAPHEMES.length, 36);
  assert.equal(PRESENTATIONS, 3);
  assert.equal(TRIAL_COUNT, 108);
  assert.equal(new Set(GRAPHEMES).size, 36);
});

test('trials are interleaved, three of each, and never the same character twice in a row', () => {
  const t = buildTrials({ seed: 'someone' });
  assert.equal(t.length, TRIAL_COUNT);
  const counts = new Map();
  for (const x of t) counts.set(x.grapheme, (counts.get(x.grapheme) || 0) + 1);
  for (const g of GRAPHEMES) assert.equal(counts.get(g), 3, `${g} appeared ${counts.get(g)} times`);
  for (let i = 1; i < t.length; i += 1) {
    assert.notEqual(t[i].grapheme, t[i - 1].grapheme, `back-to-back repeat at trial ${i}`);
  }
  // Interleaved, not blocked: a blocked order would put all three of a character together, which
  // lets a person rehearse and turns the exam into a memory test.
  const firstThird = t.slice(0, 36).map((x) => x.grapheme);
  assert.ok(new Set(firstThird).size > 20, 'the opening trials look blocked, not interleaved');
});

test('the same seed gives the same order, and different seeds do not', () => {
  const a = buildTrials({ seed: 'k1' }).map((x) => x.grapheme).join('');
  assert.equal(buildTrials({ seed: 'k1' }).map((x) => x.grapheme).join(''), a);
  assert.notEqual(buildTrials({ seed: 'k2' }).map((x) => x.grapheme).join(''), a);
});

test('a perfectly consistent person scores zero in every space', () => {
  const fixed = { A: '#ff0000', B: '#00ff00' };
  const r = scoreSitting(answers((t) => fixed[t.grapheme] || '#3366cc'));
  assert.equal(r.graphemesScored, 36);
  assert.equal(r.score.rgbUnit, 0);
  assert.equal(r.score.luv, 0);
  assert.equal(r.score.lab, 0);
  assert.equal(r.complete, true);
});

test('a person who picks at random scores well above the published landmark', () => {
  let n = 0;
  const r = scoreSitting(answers(() => {
    n += 1;
    return `#${((n * 2654435761) % 0xffffff).toString(16).padStart(6, '0')}`;
  }));
  assert.ok(r.score.rgbUnit > THRESHOLDS.rgbUnit.value, `random scored ${r.score.rgbUnit}`);
});

test('"no colour" is recorded and excluded, never coerced to grey', () => {
  const rows = buildTrials({ seed: 'nc' }).map((t) => (t.grapheme === 'Q'
    ? { grapheme: t.grapheme, presentation: t.presentation, noColour: true }
    : { grapheme: t.grapheme, presentation: t.presentation, hex: '#123456' }));
  const r = scoreSitting(rows);
  assert.deepEqual(r.noColour, ['Q']);
  assert.equal(r.graphemesScored, 35);
  assert.equal(r.score.rgbUnit, 0, 'the blank character must not drag the mean');
  assert.equal(r.complete, true);
});

test('a character answered half "colour" and half "no colour" is kept as partial, not scored', () => {
  const rows = buildTrials({ seed: 'p' }).map((t) => (t.grapheme === 'Z' && t.presentation === 2
    ? { grapheme: t.grapheme, presentation: t.presentation, noColour: true }
    : { grapheme: t.grapheme, presentation: t.presentation, hex: '#654321' }));
  const r = scoreSitting(rows);
  assert.deepEqual(r.partial, ['Z']);
  assert.equal(r.graphemesScored, 35);
  assert.equal(r.complete, false);
});

test('a malformed colour is dropped, never silently read as black', () => {
  const rows = buildTrials({ seed: 'bad' }).map((t) => ({
    grapheme: t.grapheme, presentation: t.presentation,
    hex: t.grapheme === 'M' && t.presentation === 1 ? 'ultramarine' : '#111111',
  }));
  const r = scoreSitting(rows);
  assert.equal(r.dropped, 1);
  assert.ok(r.partial.includes('M'));
  assert.equal(r.score.rgbUnit, 0, 'black must not become the bucket every parse failure lands in');
});

test('an abandoned sitting scores what was finished and says so', () => {
  const r = scoreSitting(answers(() => '#abcdef').slice(0, 30));
  assert.ok(r.graphemesScored < 36);
  assert.equal(r.complete, false);
  assert.ok(r.partial.length > 0);
});

test('garbage in does not throw and does not score', () => {
  for (const junk of [null, undefined, 'nope', 42, [{}], [{ grapheme: 'ЖЖ' }]]) {
    const r = scoreSitting(junk);
    assert.equal(r.score.rgbUnit, null);
    assert.equal(r.graphemesScored, 0);
  }
});

// ── the wording rule, which is the point ─────────────────────────────────────────────────────────

test('the result copy reports a measurement and never a category', () => {
  const r = scoreSitting(answers(() => '#ff8800'));
  const copy = resultCopy(r, { n: 4 });
  const all = [copy.headline, ...copy.lines, ...copy.landmarks.map((l) => `${l.text} ${l.source}`)].join(' ');
  assert.match(all, /Consistency 0/);
  assert.ok(!/you (are|have|might be|may be) a? ?synaesthete/i.test(all), all);
  assert.ok(!/you have synaesthesia/i.test(all));
  assert.ok(!/\bdiagnos/i.test(all));
  assert.equal(copy.neverSay, 'You have synaesthesia.');
});

test('the landmark cites its provenance and makes no claim about the reader', () => {
  const copy = resultCopy(scoreSitting(answers(() => '#ff8800')), { n: 4 });
  assert.match(copy.landmarks[0].text, /conventional threshold in the Synesthesia Battery/);
  assert.match(copy.landmarks[0].source, /Eagleman/);
  // The CIELUV cut-off is NOT invented. It says so, in the copy the reader sees.
  assert.equal(THRESHOLDS.luv.value, null);
  assert.match(copy.landmarks[1].text, /do not publish a CIELUV cut-off/);
  assert.match(copy.landmarks[1].source, /Rothen/);
});

test('a small sample gets no percentile at all', () => {
  const copy = resultCopy(scoreSitting(answers(() => '#ff8800')), { n: 7 });
  assert.ok(copy.lines.some((l) => /too few to place you/.test(l)));
  assert.ok(!copy.lines.some((l) => /%/.test(l)));
});

test('one sitting is told it is a reading, not a finding', () => {
  const copy = resultCopy(scoreSitting(answers(() => '#ff8800')), { n: 7, priorScore: null });
  assert.equal(copy.retest.ok, false);
  assert.match(copy.retest.text, /second sitting is part of the instrument/);
});

test('a second sitting is reported as the pair', () => {
  const copy = resultCopy(scoreSitting(answers(() => '#ff8800')), { n: 7, priorScore: 1.4 });
  assert.equal(copy.retest.ok, true);
  assert.equal(copy.retest.first, 1.4);
  assert.equal(copy.retest.second, 0);
});

// ── the page ─────────────────────────────────────────────────────────────────────────────────────

test('the page states what a browser cannot do, on the page', () => {
  const html = graphemePageHTML();
  assert.match(html, /Your display is not calibrated and cannot be/);
  assert.match(html, /same wrong screen/);
  assert.match(html, /never be worded as/);
  assert.match(html, /Eagleman/);
  assert.match(html, /Rothen/);
});

test('the picker is continuous, not a swatch palette', () => {
  const html = graphemePageHTML();
  assert.match(html, /<canvas id=field/);
  assert.match(html, /Lightness/);
  assert.ok(!/<input type=color/.test(html), 'a native colour input is OS-dependent and often a palette');
});

test('the page carries the state card, and the state card carries no dose box', () => {
  const html = graphemePageHTML();
  assert.match(html, /Karolinska/);
  assert.match(html, /We do not ask how much, and we never will/);
  assert.ok(!/name="dose"|name="amount"|name="route"/.test(html));
});

test('the page never asks for a name, an email or an account', () => {
  const html = graphemePageHTML();
  assert.ok(!/type=email|name="email"|name="name"|password/i.test(html));
  assert.match(html, /one-way hash of it, never the key itself/);
});
