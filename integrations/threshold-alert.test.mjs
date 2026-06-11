// threshold-alert.test.mjs — offline tests for the price-threshold alert evaluator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, evaluateAll, dedupeFires, ruleKey } from './threshold-alert.mjs';

test('above fires when price > value, not at/below', () => {
  assert.equal(evaluate({ rule: { kind: 'above', value: 100 }, price: 101 }).fired, true);
  assert.equal(evaluate({ rule: { kind: 'above', value: 100 }, price: 100 }).fired, false);
  assert.equal(evaluate({ rule: { kind: 'above', value: 100 }, price: 99 }).fired, false);
});

test('below fires when price < value, not at/above', () => {
  assert.equal(evaluate({ rule: { kind: 'below', value: 100 }, price: 99 }).fired, true);
  assert.equal(evaluate({ rule: { kind: 'below', value: 100 }, price: 100 }).fired, false);
  assert.equal(evaluate({ rule: { kind: 'below', value: 100 }, price: 101 }).fired, false);
});

test('pctChange compares to prev by fraction (both directions)', () => {
  // 10% up: 100 -> 110, threshold 0.1
  assert.equal(evaluate({ rule: { kind: 'pctChange', value: 0.1 }, price: 110, prev: 100 }).fired, true);
  // 5% up does not meet 10%
  assert.equal(evaluate({ rule: { kind: 'pctChange', value: 0.1 }, price: 105, prev: 100 }).fired, false);
  // down move also counts (magnitude)
  const down = evaluate({ rule: { kind: 'pctChange', value: 0.2 }, price: 70, prev: 100 });
  assert.equal(down.fired, true);
  assert.match(down.reason, /down/);
});

test('pctChange needs prev and a non-zero prev', () => {
  assert.equal(evaluate({ rule: { kind: 'pctChange', value: 0.1 }, price: 110 }).fired, false);
  assert.equal(evaluate({ rule: { kind: 'pctChange', value: 0.1 }, price: 110, prev: 0 }).fired, false);
});

test('crossUp needs an actual crossing, not a steady state above', () => {
  // prev below, price above => crossed up
  assert.equal(evaluate({ rule: { kind: 'crossUp', value: 100 }, price: 101, prev: 99 }).fired, true);
  // both above => steady, no cross
  assert.equal(evaluate({ rule: { kind: 'crossUp', value: 100 }, price: 105, prev: 101 }).fired, false);
  // prev exactly at value, price above => crosses (prev <= value)
  assert.equal(evaluate({ rule: { kind: 'crossUp', value: 100 }, price: 101, prev: 100 }).fired, true);
  // needs prev
  assert.equal(evaluate({ rule: { kind: 'crossUp', value: 100 }, price: 101 }).fired, false);
});

test('crossDown needs an actual downward crossing', () => {
  assert.equal(evaluate({ rule: { kind: 'crossDown', value: 100 }, price: 99, prev: 101 }).fired, true);
  // both below => steady, no cross
  assert.equal(evaluate({ rule: { kind: 'crossDown', value: 100 }, price: 90, prev: 95 }).fired, false);
  assert.equal(evaluate({ rule: { kind: 'crossDown', value: 100 }, price: 99 }).fired, false);
});

test('soft-fail: bad rule / non-finite price never throws, returns fired:false', () => {
  assert.equal(evaluate().fired, false);
  assert.equal(evaluate({ rule: null, price: 5 }).fired, false);
  assert.equal(evaluate({ rule: { kind: 'above', value: 100 }, price: NaN }).fired, false);
  assert.equal(evaluate({ rule: { kind: 'above', value: Infinity }, price: 5 }).fired, false);
  assert.equal(evaluate({ rule: { kind: 'nope', value: 1 }, price: 5 }).fired, false);
  assert.equal(evaluate({ rule: { kind: 'above', value: 'x' }, price: 5 }).fired, false);
});

test('evaluateAll returns only fired rules with key + reason', () => {
  const rules = [
    { id: 'a', kind: 'above', value: 100 },
    { id: 'b', kind: 'below', value: 100 },
    { id: 'c', kind: 'crossUp', value: 95 },
  ];
  const out = evaluateAll(rules, { price: 101, prev: 90 });
  const keys = out.map((o) => o.key).sort();
  assert.deepEqual(keys, ['a', 'c']); // above fires, crossUp fires, below does not
  assert.ok(out.every((o) => o.fired === true && typeof o.reason === 'string'));
});

test('evaluateAll soft-fails on non-array / bad entries', () => {
  assert.deepEqual(evaluateAll(null, { price: 1 }), []);
  assert.deepEqual(evaluateAll([null, 'x', { kind: 'bad', value: 1 }], { price: 1 }), []);
});

test('ruleKey prefers id, else kind|value', () => {
  assert.equal(ruleKey({ id: 'z', kind: 'above', value: 100 }), 'z');
  assert.equal(ruleKey({ kind: 'above', value: 100 }), 'above|100');
  assert.equal(ruleKey(null), 'invalid');
});

test('dedupeFires collapses repeats of same key within window (injected now)', () => {
  const fires = [
    { key: 'a', ts: 0, reason: 'x' },
    { key: 'a', ts: 1000, reason: 'x' },   // within 60s window -> collapsed
    { key: 'b', ts: 1000, reason: 'y' },
    { key: 'a', ts: 200000, reason: 'x' },  // outside window -> new fire
  ];
  const kept = dedupeFires(fires, { windowMs: 60_000 });
  assert.equal(kept.length, 3);
  const firstA = kept.find((k) => k.key === 'a' && k.lastTs === 1000);
  assert.equal(firstA.count, 2);
  assert.ok(kept.some((k) => k.key === 'a' && k.count === 1 && k.lastTs === 200000));
});

test('dedupeFires falls back to index when no ts/now, and soft-fails on non-array', () => {
  const out = dedupeFires([{ key: 'a' }, { key: 'a' }], { windowMs: 60_000 });
  assert.equal(out.length, 1); // indices 0,1 within window -> collapsed
  assert.equal(out[0].count, 2);
  assert.deepEqual(dedupeFires(null), []);
});

test('dedupeFires derives key from rule when key absent', () => {
  const out = dedupeFires(
    [{ rule: { kind: 'above', value: 100 }, ts: 0 }, { rule: { kind: 'above', value: 100 }, ts: 10 }],
    { windowMs: 1000 }
  );
  assert.equal(out.length, 1);
  assert.equal(out[0].count, 2);
});
