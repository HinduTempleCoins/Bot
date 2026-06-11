// join-velocity.test.mjs — offline tests for the anti-raid join-velocity analyzer. Backlog 3828bda09a.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  slidingWindowCounts,
  nameSimilarityFlag,
  analyzeJoins,
  recommend,
} from './join-velocity.mjs';

test('slidingWindowCounts: clustered timestamps yield a high peak', () => {
  const events = [];
  for (let i = 0; i < 12; i++) events.push({ ts: 1000 + i }); // 12 joins in 11s
  const { peak, peakWindowStart } = slidingWindowCounts(events, 60);
  assert.equal(peak, 12);
  assert.equal(peakWindowStart, 1000);
});

test('slidingWindowCounts: spread-out joins keep peak low', () => {
  const events = [{ ts: 0 }, { ts: 120 }, { ts: 240 }, { ts: 360 }]; // one per 2min
  const { peak } = slidingWindowCounts(events, 60);
  assert.equal(peak, 1);
});

test('slidingWindowCounts: empty/garbage is safe', () => {
  assert.deepEqual(slidingWindowCounts([], 60), { peak: 0, peakWindowStart: null });
  assert.deepEqual(slidingWindowCounts(null, 60), { peak: 0, peakWindowStart: null });
  assert.deepEqual(slidingWindowCounts('nope', 60), { peak: 0, peakWindowStart: null });
});

test('slidingWindowCounts: NaN timestamps are dropped', () => {
  const events = [{ ts: 1 }, { ts: NaN }, { ts: 'x' }, { ts: 2 }, { ts: undefined }];
  const { peak } = slidingWindowCounts(events, 60);
  assert.equal(peak, 2); // only the two finite ts survive
});

test('nameSimilarityFlag: near-duplicate handles score high', () => {
  const frac = nameSimilarityFlag(['alice01', 'alice02', 'alice_03', 'alice-04']);
  assert.ok(frac >= 0.9, `expected ~1, got ${frac}`);
});

test('nameSimilarityFlag: distinct handles score 0', () => {
  const frac = nameSimilarityFlag(['bob', 'carol', 'dave', 'erin']);
  assert.equal(frac, 0);
});

test('nameSimilarityFlag: <2 or empty is 0', () => {
  assert.equal(nameSimilarityFlag([]), 0);
  assert.equal(nameSimilarityFlag(['solo']), 0);
  assert.equal(nameSimilarityFlag(null), 0);
});

test('analyzeJoins: clustered timestamps trip raid', () => {
  const events = [];
  for (let i = 0; i < 14; i++) events.push({ ts: 1000 + i, handle: `user_diff_${i}` });
  const r = analyzeJoins({ events, windowSec: 60, threshold: 10 });
  assert.equal(r.raid, true);
  assert.equal(r.severity, 'raid');
  assert.equal(r.peak, 14);
  assert.ok(r.ratePerMin > 0);
  assert.ok(r.reasons.length >= 1);
  assert.equal(recommend(r), 'lock joins');
});

test('analyzeJoins: spread-out joins stay none', () => {
  const events = [{ ts: 0 }, { ts: 120 }, { ts: 240 }, { ts: 360 }];
  const r = analyzeJoins({ events, windowSec: 60, threshold: 10 });
  assert.equal(r.raid, false);
  assert.equal(r.severity, 'none');
  assert.equal(recommend(r), 'ok');
});

test('analyzeJoins: similar-handle burst escalates to raid below peak threshold', () => {
  // only 6 joins (threshold 10, so peak alone is below), but all near-duplicate handles
  const events = [];
  for (let i = 0; i < 6; i++) events.push({ ts: 500 + i, handle: `botacct${i}` });
  const r = analyzeJoins({ events, windowSec: 60, threshold: 10 });
  assert.ok(r.similarFraction >= 0.5, `similarFraction=${r.similarFraction}`);
  // peak 6 >= threshold/2 (5) AND similar high → raid
  assert.equal(r.raid, true);
  assert.equal(r.severity, 'raid');
});

test('analyzeJoins: moderate peak with no similarity is watch', () => {
  // 5 distinct joins (distinct first-6 chars), threshold 10 → peak >= threshold/2 but not raid
  const handles = ['zebra', 'quokka', 'mango7', 'velvet', 'thistle'];
  const events = handles.map((h, i) => ({ ts: 700 + i, handle: h }));
  const r = analyzeJoins({ events, windowSec: 60, threshold: 10 });
  assert.equal(r.similarFraction, 0);
  assert.equal(r.raid, false);
  assert.equal(r.severity, 'watch');
  assert.equal(recommend(r), 'enable slow-mode');
});

test('analyzeJoins: empty input is safe none', () => {
  const r = analyzeJoins({ events: [] });
  assert.equal(r.raid, false);
  assert.equal(r.severity, 'none');
  assert.equal(r.peak, 0);
  assert.equal(r.peakWindowStart, null);
  assert.equal(r.ratePerMin, 0);
});

test('analyzeJoins: garbage input never throws', () => {
  for (const bad of [undefined, null, 42, 'x', {}, { events: 'nope' }, { events: [null, {}, 1] }]) {
    const r = analyzeJoins(bad);
    assert.equal(r.raid, false);
    assert.equal(typeof r.severity, 'string');
    assert.ok(['none', 'watch', 'raid'].includes(r.severity));
  }
});

test('analyzeJoins: defaults apply when threshold/windowSec missing or invalid', () => {
  const events = [];
  for (let i = 0; i < 11; i++) events.push({ ts: i }); // 11 in <1s, default threshold 10
  const r = analyzeJoins({ events, threshold: -5, windowSec: 'bad' });
  assert.equal(r.raid, true);
  assert.equal(r.severity, 'raid');
});

test('esc: escapes HTML in reasons / action strings', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  // reasons and recommend() outputs are plain but must survive escaping unchanged-safe
  const r = analyzeJoins({ events: [{ ts: 0 }, { ts: 1 }] });
  for (const reason of r.reasons) assert.equal(typeof esc(reason), 'string');
  assert.equal(esc(recommend(r)), recommend(r));
});

test('recommend: maps severity deterministically', () => {
  assert.equal(recommend({ severity: 'raid' }), 'lock joins');
  assert.equal(recommend({ severity: 'watch' }), 'enable slow-mode');
  assert.equal(recommend({ severity: 'none' }), 'ok');
  assert.equal(recommend(null), 'ok');
  assert.equal(recommend({}), 'ok');
});
