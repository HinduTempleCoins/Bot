import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, nextBid, respectsCap, outbidLadder, renderLadder } from './outbid-ladder.mjs';

test('DEFAULTS carry the queue rules', () => {
  assert.equal(DEFAULTS.increment, 0.00000010);
  assert.equal(DEFAULTS.maxSessionRisePct, 0.05);
  assert.equal(DEFAULTS.decimals, 8);
});

test('nextBid: single increment above the current top, rounded to 8 places', () => {
  assert.equal(nextBid({ currentTop: 0.00001000 }), 0.0000101);
  assert.equal(nextBid({ currentTop: 0.00001000, increment: 0.00000010 }), 0.0000101);
  // ourLast is informational and does not change the anchor
  assert.equal(nextBid({ currentTop: 0.00001000, ourLast: 0.00000900 }), 0.0000101);
});

test('nextBid: invalid input soft-fails to null', () => {
  assert.equal(nextBid({ currentTop: 'abc' }), null);
  assert.equal(nextBid({ currentTop: 0.0001, increment: NaN }), null);
  assert.equal(nextBid({}), null);
});

test('decimal rounding stays on the 8-place grid (no float noise)', () => {
  const r = outbidLadder({ startPrice: 0.00001000, competitorTop: 0.00001050, increment: 0.00000010 });
  for (const s of r.steps) {
    const str = s.bid.toFixed(10);
    // 9th and 10th decimals must be zero — value is on the 8-place grid
    assert.match(str, /\d\d$/);
    assert.equal(s.bid, +s.bid.toFixed(8));
  }
});

test('respectsCap: true within 5%, false beyond', () => {
  assert.equal(respectsCap(1.0, 1.05, 0.05), true);
  assert.equal(respectsCap(1.0, 1.0500001, 0.05), false);
  assert.equal(respectsCap(1.0, 0.99, 0.05), true);
});

test('respectsCap: invalid input → false', () => {
  assert.equal(respectsCap('x', 1.0, 0.05), false);
  assert.equal(respectsCap(0, 1.0, 0.05), false);
  assert.equal(respectsCap(1.0, NaN, 0.05), false);
});

test('ladder stops at the competitor top (small gap, within cap)', () => {
  const r = outbidLadder({ startPrice: 0.00001000, competitorTop: 0.00001030, increment: 0.00000010 });
  assert.equal(r.reason, 'reached-competitor-top');
  assert.equal(r.capped, false);
  // final bid is one increment over the competitor top
  assert.equal(r.finalBid, 0.0000104);
  // every step is monotonically increasing
  for (let i = 1; i < r.steps.length; i++) {
    assert.ok(r.steps[i].bid > r.steps[i - 1].bid);
  }
});

test('ladder stops at the 5% session cap and never exceeds it', () => {
  // huge gap to the competitor so the cap is the binding constraint
  const start = 0.00001000;
  const r = outbidLadder({ startPrice: start, competitorTop: 0.00010000, increment: 0.00000010, maxSessionRisePct: 0.05, maxSteps: 10000 });
  assert.equal(r.capped, true);
  const maxAllowed = start * 1.05;
  for (const s of r.steps) {
    assert.ok(s.bid <= maxAllowed + 1e-12, `bid ${s.bid} exceeded cap ${maxAllowed}`);
    assert.ok(s.risePctFromStart <= 0.05 + 1e-9);
  }
  assert.ok(r.finalBid <= maxAllowed + 1e-12);
});

test('maxSteps guard bounds the ladder length', () => {
  const r = outbidLadder({ startPrice: 0.00001000, competitorTop: 1.0, increment: 0.00000010, maxSessionRisePct: 100, maxSteps: 5 });
  assert.equal(r.steps.length, 5);
  assert.equal(r.reason, 'max-steps-reached');
});

test('start already at/above competitor → no steps, not capped', () => {
  const r = outbidLadder({ startPrice: 0.00002000, competitorTop: 0.00001000, increment: 0.00000010 });
  assert.deepEqual(r.steps, []);
  assert.equal(r.capped, false);
  assert.equal(r.reason, 'already-at-or-above-competitor');
  assert.equal(r.finalBid, 0.00002);
});

test('invalid input → empty capped ladder, never throws', () => {
  assert.doesNotThrow(() => outbidLadder({}));
  const r = outbidLadder({ startPrice: 'nope', competitorTop: 0.0001 });
  assert.deepEqual(r, { steps: [], finalBid: null, capped: true, reason: 'invalid-input' });
  const r2 = outbidLadder({ startPrice: 0.0001, competitorTop: 0.0002, increment: 0 });
  assert.equal(r2.reason, 'invalid-input');
});

test('renderLadder: markdown table for a real ladder, note for empty', () => {
  const r = outbidLadder({ startPrice: 0.00001000, competitorTop: 0.00001020, increment: 0.00000010 });
  const md = renderLadder(r);
  assert.match(md, /\| step \| bid \| rise from start \|/);
  assert.match(md, /final bid:/);
  // empty / invalid ladders render a note, not a table
  assert.match(renderLadder(outbidLadder({})), /_no steps|_no ladder|capped/);
  assert.match(renderLadder(null), /_no ladder_/);
});
