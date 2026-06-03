// odds-education.test.mjs — offline tests for the vig-exposure teaching surface (queue #123).
// No network. Run: node --test integrations/soapbox/odds-education.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { impliedFromDecimal, vigLesson, renderLesson, esc } from './odds-education.mjs';

test('impliedFromDecimal: implied probability is 1/decimalOdd', () => {
  assert.equal(impliedFromDecimal(2), 0.5);
  assert.equal(impliedFromDecimal(4), 0.25);
  assert.ok(Math.abs(impliedFromDecimal(1.91) - 1 / 1.91) < 1e-12);
});

test('impliedFromDecimal: invalid / non-positive → null', () => {
  assert.equal(impliedFromDecimal(0), null);
  assert.equal(impliedFromDecimal(-3), null);
  assert.equal(impliedFromDecimal('nope'), null);
  assert.equal(impliedFromDecimal(null), null);
});

test('vigLesson: fair book (decimal 2.0 each) → overround ≈ 0', () => {
  const l = vigLesson({
    trueProbs: { Heads: 0.5, Tails: 0.5 },
    bookOdds: { Heads: 2.0, Tails: 2.0 },
  });
  assert.ok(Math.abs(l.overroundPct) < 1e-9, `expected ~0, got ${l.overroundPct}`);
  assert.ok(Math.abs(l.impliedProbs.Heads - 0.5) < 1e-12);
  assert.match(l.explanation, /fair line|no overround/i);
});

test('vigLesson: vig book (decimal 1.91 each) → ~4.7% overround, positive edge', () => {
  const l = vigLesson({
    trueProbs: { Heads: 0.5, Tails: 0.5 },
    bookOdds: { Heads: 1.91, Tails: 1.91 },
  });
  // sum of implied = 2 * (1/1.91) ≈ 1.0471 → overround ≈ 4.71%
  assert.ok(l.overroundPct > 4 && l.overroundPct < 5.5, `got ${l.overroundPct}`);
  const e = l.edgeByOutcome.Heads;
  assert.ok(Math.abs(e.implied - 1 / 1.91) < 1e-12);
  assert.equal(e.true, 0.5);
  assert.ok(e.edge > 0, 'implied should sit above true (the vig)');
  assert.match(l.explanation, /overround|vig/i);
});

test('vigLesson: overroundPct equals sum(implied) - 1 in percent', () => {
  const bookOdds = { A: 3.0, B: 3.5, C: 4.0 };
  const l = vigLesson({ trueProbs: {}, bookOdds });
  const sum = 1 / 3.0 + 1 / 3.5 + 1 / 4.0;
  assert.ok(Math.abs(l.overroundPct - (sum - 1) * 100) < 1e-9);
});

test('vigLesson: no valid odds → null overround + explanatory text', () => {
  const l = vigLesson({ trueProbs: { A: 0.5 }, bookOdds: {} });
  assert.equal(l.overroundPct, null);
  assert.match(l.explanation, /no valid bookmaker odds/i);
});

test('vigLesson: missing one side is skipped from the sum, not NaN', () => {
  const l = vigLesson({ trueProbs: { A: 0.5, B: 0.5 }, bookOdds: { A: 2.0 } });
  assert.equal(l.impliedProbs.A, 0.5);
  assert.equal(l.impliedProbs.B, undefined);
  assert.ok(Number.isFinite(l.overroundPct));
  assert.equal(l.edgeByOutcome.B.implied, null);
  assert.equal(l.edgeByOutcome.B.edge, null);
});

test('renderLesson: returns an HTML string naming the vig and showing the edge', () => {
  const l = vigLesson({
    trueProbs: { Heads: 0.5, Tails: 0.5 },
    bookOdds: { Heads: 1.91, Tails: 1.91 },
  });
  const html = renderLesson(l);
  assert.equal(typeof html, 'string');
  assert.match(html, /<section/);
  assert.match(html, /Overround/i);
  assert.match(html, /Edge \(vig\)/i);
  assert.match(html, /Heads/);
  // shows both true and implied columns
  assert.match(html, /True prob\./i);
  assert.match(html, /Implied prob\./i);
  // names the edge percentage somewhere
  assert.match(html, /%/);
});

test('renderLesson + esc: outcome labels are HTML-escaped', () => {
  const l = vigLesson({
    trueProbs: { '<b>X</b> & "Y"': 0.5, Z: 0.5 },
    bookOdds: { '<b>X</b> & "Y"': 2.0, Z: 2.0 },
  });
  const html = renderLesson(l);
  assert.ok(!html.includes('<b>X</b>'), 'raw tag must not leak');
  assert.match(html, /&lt;b&gt;X&lt;\/b&gt; &amp; &quot;Y&quot;/);
});

test('esc: escapes the four HTML-significant characters', () => {
  assert.equal(esc('<a> & "b"'), '&lt;a&gt; &amp; &quot;b&quot;');
  assert.equal(esc(null), '');
});
