// account-trust.test.mjs — offline, node:test. Monotonicity, bands, weights, soft-fail, esc.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  DEFAULT_WEIGHTS,
  clamp01,
  ageScore,
  activityScore,
  endorsementScore,
  reportPenalty,
  trustScore,
  band,
  compare,
  renderBadge,
} from './account-trust.mjs';

test('DEFAULT_WEIGHTS sum to 1 within tolerance', () => {
  const sum = Object.values(DEFAULT_WEIGHTS).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9, `weights sum ${sum}`);
});

test('clamp01 clamps to [0,1] and soft-fails on garbage', () => {
  assert.equal(clamp01(0.5), 0.5);
  assert.equal(clamp01(-3), 0);
  assert.equal(clamp01(9), 1);
  assert.equal(clamp01(NaN), 0);
  assert.equal(clamp01('0.25'), 0.25);
  assert.equal(clamp01(undefined), 0);
});

test('ageScore: 0 at zero, ~0.5 near 90 days, saturating below 1, monotonic', () => {
  assert.equal(ageScore(0), 0);
  assert.ok(Math.abs(ageScore(90) - 0.5) < 1e-9);
  assert.ok(ageScore(10000) < 1 && ageScore(10000) > 0.9);
  assert.ok(ageScore(200) > ageScore(100));
  assert.equal(ageScore(-5), 0); // soft-fail negative
  assert.equal(ageScore(NaN), 0);
});

test('activityScore: monotonic in each axis, log-saturating, soft-fail', () => {
  assert.equal(activityScore({ posts: 0, comments: 0, votes: 0 }), 0);
  assert.equal(activityScore(), 0);
  const lo = activityScore({ posts: 1, comments: 1, votes: 1 });
  const hi = activityScore({ posts: 10, comments: 10, votes: 10 });
  assert.ok(hi > lo);
  // more of any single axis raises it
  assert.ok(activityScore({ posts: 5 }) > activityScore({ posts: 1 }));
  assert.ok(activityScore({ comments: 5 }) > activityScore({ comments: 1 }));
  assert.ok(activityScore({ votes: 5 }) > activityScore({ votes: 1 }));
  // saturating: always < 1
  assert.ok(activityScore({ posts: 1e6, comments: 1e6, votes: 1e6 }) < 1);
  // soft-fail garbage
  assert.equal(activityScore({ posts: NaN, comments: -5, votes: 'x' }), 0);
});

test('endorsementScore + reportPenalty: monotonic, saturating, soft-fail', () => {
  assert.equal(endorsementScore(0), 0);
  assert.ok(endorsementScore(10) > endorsementScore(1));
  assert.ok(endorsementScore(1e6) < 1);
  assert.equal(endorsementScore(-2), 0);

  assert.equal(reportPenalty(0), 0);
  assert.ok(reportPenalty(10) > reportPenalty(1));
  assert.ok(reportPenalty(1e6) < 1);
  assert.equal(reportPenalty(NaN), 0);
});

test('trustScore: well-formed shape, score in [0,100], 2dp', () => {
  const r = trustScore({ accountAgeDays: 365, posts: 40, comments: 200, votes: 900, endorsements: 12, reports: 0, stakeFraction: 0.2 });
  assert.ok(r.score >= 0 && r.score <= 100);
  assert.equal(r.score, Math.round(r.score * 100) / 100);
  assert.ok(['new', 'low', 'medium', 'high', 'trusted'].includes(r.band));
  assert.ok(typeof r.components === 'object');
  assert.ok('reportPenalty' in r.components);
});

test('trustScore monotonicity: more age raises score', () => {
  const base = { posts: 10, comments: 20, votes: 50, endorsements: 5, reports: 0, stakeFraction: 0.1 };
  assert.ok(trustScore({ ...base, accountAgeDays: 365 }).score > trustScore({ ...base, accountAgeDays: 5 }).score);
});

test('trustScore monotonicity: more activity raises score', () => {
  const base = { accountAgeDays: 100, endorsements: 3, reports: 0, stakeFraction: 0.1 };
  assert.ok(
    trustScore({ ...base, posts: 50, comments: 200, votes: 800 }).score >
      trustScore({ ...base, posts: 1, comments: 2, votes: 3 }).score,
  );
});

test('trustScore monotonicity: more endorsements raises, more stake raises', () => {
  const base = { accountAgeDays: 100, posts: 10, comments: 20, votes: 50, reports: 0 };
  assert.ok(trustScore({ ...base, endorsements: 30, stakeFraction: 0.1 }).score > trustScore({ ...base, endorsements: 0, stakeFraction: 0.1 }).score);
  assert.ok(trustScore({ ...base, endorsements: 5, stakeFraction: 0.9 }).score > trustScore({ ...base, endorsements: 5, stakeFraction: 0 }).score);
});

test('trustScore monotonicity: more reports lowers score', () => {
  const base = { accountAgeDays: 365, posts: 40, comments: 200, votes: 900, endorsements: 12, stakeFraction: 0.3 };
  assert.ok(trustScore({ ...base, reports: 0 }).score > trustScore({ ...base, reports: 20 }).score);
});

test('band boundaries assign to upper band', () => {
  assert.equal(band(0), 'new');
  assert.equal(band(19.99), 'new');
  assert.equal(band(20), 'low');
  assert.equal(band(40), 'medium');
  assert.equal(band(60), 'high');
  assert.equal(band(80), 'trusted');
  assert.equal(band(100), 'trusted');
  assert.equal(band(NaN), 'new'); // soft-fail
});

test('weights: custom weights respected and renormalized; garbage falls back', () => {
  // all-zero positive signals except activity; weight activity fully → score reflects activity only
  const r = trustScore({ accountAgeDays: 0, posts: 1e6, comments: 0, votes: 0, endorsements: 0, reports: 0, stakeFraction: 0, weights: { accountAge: 0, activity: 1, endorsements: 0, reports: 0, stake: 0 } });
  // activity is the ONLY weighted axis; score should equal 100*activityScore for these inputs
  const expected = Math.round(100 * activityScore({ posts: 1e6, comments: 0, votes: 0 }) * 100) / 100;
  assert.equal(r.score, expected);
  assert.ok(r.score > 70); // heavy activity, fully weighted
  // unnormalized weights get renormalized (don't throw, valid score)
  const r2 = trustScore({ accountAgeDays: 365, posts: 40, comments: 200, votes: 900, endorsements: 12, reports: 0, stakeFraction: 0.2, weights: { accountAge: 2, activity: 2, endorsements: 2, reports: 2, stake: 2 } });
  assert.ok(r2.score >= 0 && r2.score <= 100);
  // garbage weights → defaults (still valid)
  const r3 = trustScore({ accountAgeDays: 365, posts: 40, weights: { accountAge: NaN, activity: -1 } });
  assert.ok(r3.score >= 0 && r3.score <= 100);
});

test('soft-fail on garbage input: never throws, score 0-ish, well-formed', () => {
  for (const bad of [undefined, null, 42, 'x', [], { posts: NaN, accountAgeDays: -1, reports: 'oops', stakeFraction: 'big' }]) {
    const r = trustScore(bad);
    assert.ok(r.score >= 0 && r.score <= 100);
    assert.ok(['new', 'low', 'medium', 'high', 'trusted'].includes(r.band));
  }
});

test('compare sorts by trust descending', () => {
  const high = trustScore({ accountAgeDays: 900, posts: 120, comments: 800, votes: 5000, endorsements: 40, reports: 0, stakeFraction: 0.4 });
  const low = trustScore({ accountAgeDays: 3, posts: 0, comments: 1, votes: 2, endorsements: 0, reports: 5, stakeFraction: 0 });
  const arr = [low, high];
  arr.sort(compare);
  assert.equal(arr[0], high);
  // also works on raw inputs
  const raw = [{ accountAgeDays: 1 }, { accountAgeDays: 900, posts: 100, endorsements: 30, stakeFraction: 0.5 }];
  raw.sort(compare);
  assert.ok(trustScore(raw[0]).score >= trustScore(raw[1]).score);
  // soft-fail garbage entries
  assert.equal(typeof compare(null, undefined), 'number');
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('renderBadge esc()s the account name and never injects raw HTML', () => {
  const r = trustScore({ accountAgeDays: 365, posts: 40, comments: 200, votes: 900, endorsements: 12, reports: 0, stakeFraction: 0.2 });
  const badge = renderBadge('<script>alert(1)</script>', r);
  assert.ok(!badge.includes('<script>'));
  assert.ok(badge.includes('&lt;script&gt;'));
  assert.ok(badge.includes(`/100`));
  // soft-fail: missing result still produces a string
  const b2 = renderBadge('bob', undefined);
  assert.equal(typeof b2, 'string');
  assert.ok(b2.includes('bob'));
});
