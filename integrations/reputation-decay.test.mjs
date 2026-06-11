// reputation-decay.test.mjs — offline tests for the time-decayed reputation module.
// node --test integrations/reputation-decay.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  DEFAULT_HALFLIFE_DAYS,
  decayFactor,
  reputationScore,
  band,
  compare,
  renderReputationBadge,
} from './reputation-decay.mjs';

const DAY = 86400;

test('DEFAULT_HALFLIFE_DAYS is 90', () => {
  assert.equal(DEFAULT_HALFLIFE_DAYS, 90);
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

// ── decayFactor ──────────────────────────────────────────────────────────────────────────────────
test('decayFactor: age 0 → 1, age == halfLife → 0.5, 2*halfLife → 0.25', () => {
  assert.equal(decayFactor(0, 90), 1);
  assert.ok(Math.abs(decayFactor(90, 90) - 0.5) < 1e-12);
  assert.ok(Math.abs(decayFactor(180, 90) - 0.25) < 1e-12);
});

test('decayFactor: default half-life when omitted', () => {
  assert.ok(Math.abs(decayFactor(90) - 0.5) < 1e-12);
});

test('decayFactor: future age (negative) clamps to 1, never amplifies', () => {
  assert.equal(decayFactor(-100, 90), 1);
});

test('decayFactor: monotonic non-increasing in age', () => {
  let prev = Infinity;
  for (let a = 0; a <= 360; a += 30) {
    const f = decayFactor(a, 90);
    assert.ok(f <= prev);
    assert.ok(f >= 0 && f <= 1);
    prev = f;
  }
});

test('decayFactor: non-finite / non-positive halfLife falls back to default', () => {
  assert.equal(decayFactor(90, NaN), decayFactor(90, 90));
  assert.equal(decayFactor(90, 0), decayFactor(90, 90));
  assert.equal(decayFactor(90, -5), decayFactor(90, 90));
});

test('decayFactor: non-finite age treated as 0', () => {
  assert.equal(decayFactor(NaN, 90), 1);
  assert.equal(decayFactor(undefined, 90), 1);
});

// ── reputationScore happy path ──────────────────────────────────────────────────────────────────
test('reputationScore: sums weight*decayFactor', () => {
  const now = 1_700_000_000;
  const events = [
    { ts: now, weight: 4, kind: 'post' }, // age 0 → factor 1 → 4
    { ts: now - 90 * DAY, weight: 4, kind: 'endorsement' }, // age 90 → factor .5 → 2
  ];
  const r = reputationScore({ events, nowTs: now, halfLifeDays: 90 });
  assert.ok(Math.abs(r.score - 6) < 1e-6);
  assert.equal(r.contributions.length, 2);
  assert.equal(r.contributions[0].kind, 'post');
  assert.ok(Math.abs(r.contributions[0].decayed - 4) < 1e-6);
  assert.ok(Math.abs(r.contributions[1].decayed - 2) < 1e-6);
});

test('reputationScore: reports are negative and lower the score', () => {
  const now = 1_700_000_000;
  const r = reputationScore({
    events: [
      { ts: now, weight: 5, kind: 'post' },
      { ts: now, weight: -8, kind: 'report' },
    ],
    nowTs: now,
  });
  assert.ok(Math.abs(r.score - -3) < 1e-6);
  assert.equal(r.band, 'new');
});

test('reputationScore: recent activity outweighs old activity', () => {
  const now = 1_700_000_000;
  const recent = reputationScore({ events: [{ ts: now - 1 * DAY, weight: 10, kind: 'post' }], nowTs: now });
  const old = reputationScore({ events: [{ ts: now - 365 * DAY, weight: 10, kind: 'post' }], nowTs: now });
  assert.ok(recent.score > old.score);
});

test('reputationScore: future-dated event uses full weight (age clamped to 0)', () => {
  const now = 1_700_000_000;
  const r = reputationScore({ events: [{ ts: now + 100 * DAY, weight: 3, kind: 'post' }], nowTs: now });
  assert.ok(Math.abs(r.score - 3) < 1e-6);
});

// ── soft-fail / edge ────────────────────────────────────────────────────────────────────────────
test('reputationScore: non-array events → score 0, band new, empty contributions', () => {
  for (const bad of [undefined, null, 42, 'x', {}]) {
    const r = reputationScore({ events: bad, nowTs: 1 });
    assert.deepEqual(r, { score: 0, band: 'new', contributions: [] });
  }
});

test('reputationScore: no args at all soft-fails', () => {
  const r = reputationScore();
  assert.deepEqual(r, { score: 0, band: 'new', contributions: [] });
});

test('reputationScore: drops events with non-finite ts or weight, keeps valid ones', () => {
  const now = 1_700_000_000;
  const r = reputationScore({
    events: [
      { ts: now, weight: 5, kind: 'post' }, // kept
      { ts: 'abc', weight: 5, kind: 'post' }, // dropped (bad ts)
      { ts: now, weight: NaN, kind: 'post' }, // dropped (bad weight)
      { ts: now, weight: Infinity, kind: 'post' }, // dropped (non-finite weight)
      null, // dropped
      'nope', // dropped
    ],
    nowTs: now,
  });
  assert.equal(r.contributions.length, 1);
  assert.ok(Math.abs(r.score - 5) < 1e-6);
});

test('reputationScore: missing nowTs anchors to latest event ts (ages >= 0)', () => {
  const t = 1_700_000_000;
  const r = reputationScore({
    events: [
      { ts: t, weight: 4, kind: 'post' }, // newest → age 0 → 4
      { ts: t - 90 * DAY, weight: 4, kind: 'post' }, // age 90 → 2
    ],
  });
  assert.ok(Math.abs(r.score - 6) < 1e-6);
});

test('reputationScore: non-finite halfLife falls back to default', () => {
  const now = 1_700_000_000;
  const a = reputationScore({ events: [{ ts: now - 90 * DAY, weight: 4, kind: 'post' }], nowTs: now, halfLifeDays: NaN });
  const b = reputationScore({ events: [{ ts: now - 90 * DAY, weight: 4, kind: 'post' }], nowTs: now, halfLifeDays: 90 });
  assert.equal(a.score, b.score);
});

test('reputationScore: empty events array → score 0', () => {
  const r = reputationScore({ events: [], nowTs: 1 });
  assert.equal(r.score, 0);
  assert.equal(r.band, 'new');
  assert.deepEqual(r.contributions, []);
});

test('reputationScore: event without kind labelled "event"', () => {
  const now = 1_700_000_000;
  const r = reputationScore({ events: [{ ts: now, weight: 1 }], nowTs: now });
  assert.equal(r.contributions[0].kind, 'event');
});

// ── band ────────────────────────────────────────────────────────────────────────────────────────
test('band thresholds', () => {
  assert.equal(band(0), 'new');
  assert.equal(band(-10), 'new');
  assert.equal(band(1.9), 'new');
  assert.equal(band(2), 'emerging');
  assert.equal(band(7.9), 'emerging');
  assert.equal(band(8), 'trusted');
  assert.equal(band(24.9), 'trusted');
  assert.equal(band(25), 'pillar');
  assert.equal(band(1000), 'pillar');
});

test('band: non-finite → new', () => {
  assert.equal(band(NaN), 'new');
  assert.equal(band(undefined), 'new');
});

// ── compare ─────────────────────────────────────────────────────────────────────────────────────
test('compare: sorts descending by score (results)', () => {
  const arr = [{ score: 1 }, { score: 9 }, { score: 4 }];
  arr.sort(compare);
  assert.deepEqual(arr.map((x) => x.score), [9, 4, 1]);
});

test('compare: accepts raw inputs and scores on the fly', () => {
  const now = 1_700_000_000;
  const a = { events: [{ ts: now, weight: 10, kind: 'post' }] };
  const b = { events: [{ ts: now, weight: 1, kind: 'post' }] };
  assert.ok(compare(a, b) < 0); // a higher → sorts first
});

test('compare: garbage soft-fails to 0', () => {
  assert.equal(compare(null, null), 0);
  assert.equal(compare(undefined, 'x'), 0);
});

// ── renderReputationBadge ───────────────────────────────────────────────────────────────────────
test('renderReputationBadge: escapes account and embeds score/band', () => {
  const html = renderReputationBadge('<evil>', { score: 12.345, band: 'trusted' });
  assert.ok(html.includes('&lt;evil&gt;'));
  assert.ok(!html.includes('<evil>'));
  assert.ok(html.includes('12.35')); // rounded to 2dp
  assert.ok(html.includes('trusted'));
  assert.ok(html.includes('rep-trusted'));
});

test('renderReputationBadge: soft-fails on missing result', () => {
  const html = renderReputationBadge('acct', undefined);
  assert.ok(html.includes('acct'));
  assert.ok(html.includes('0'));
  assert.ok(html.includes('new'));
});

test('renderReputationBadge: derives band when only score given', () => {
  const html = renderReputationBadge('acct', { score: 30 });
  assert.ok(html.includes('pillar'));
});
