import { test } from 'node:test';
import assert from 'node:assert';
import { severityTier, quakeScore, moveScore, curate, rankNews, worldClocks, CLOCKS } from './chyron.mjs';

test('severityTier buckets by score', () => {
  assert.equal(severityTier(90), 'critical');
  assert.equal(severityTier(60), 'high');
  assert.equal(severityTier(40), 'med');
  assert.equal(severityTier(10), 'low');
});

test('quakeScore: below M4.5 is 0, scales up with magnitude', () => {
  assert.equal(quakeScore(4.0), 0);
  assert.ok(quakeScore(4.5) > 0);
  assert.ok(quakeScore(7.0) > quakeScore(6.0));
  assert.ok(quakeScore(9.5) <= 100);
});

test('moveScore is symmetric and capped', () => {
  assert.equal(moveScore(3), moveScore(-3));
  assert.ok(moveScore(8) > moveScore(3));
  assert.equal(moveScore(50), 100); // capped
});

test('curate dedups, sorts by score desc, and caps (no overcrowding)', () => {
  const items = [
    { text: 'Big quake in Japan', score: 80 },
    { text: 'big quake in japan', score: 70 }, // dup (normalized)
    { text: 'BTC up 5%', score: 50 },
    { text: 'Storm warning', score: 90 },
    { text: 'Minor blip', score: 10 },
  ];
  const out = curate(items, 2);
  assert.equal(out.length, 2, 'capped to max');
  assert.equal(out[0].text, 'Storm warning', 'highest score first');
  assert.equal(out[1].text, 'Big quake in Japan', 'dup of this dropped, not duplicated');
  assert.ok(out[0].tier, 'tier assigned');
});

test('rankNews ranks impact+recency above feed order', () => {
  const items = [
    { title: 'Random market chatter', ageHours: 20, authority: 1 },
    { title: 'SEC approves spot ETF', ageHours: 1, authority: 3 },
  ];
  const top = rankNews(items, { n: 1 });
  assert.match(top[0].title, /ETF/, 'impact keyword + recency wins despite being second in feed');
});

test('rankNews rotates the window by dayKey but keeps n', () => {
  const items = Array.from({ length: 8 }, (_, i) => ({ title: `story ${i}`, ageHours: 5, authority: 1 }));
  const a = rankNews(items, { dayKey: 0, n: 5 });
  const b = rankNews(items, { dayKey: 3, n: 5 });
  assert.equal(a.length, 5);
  assert.equal(b.length, 5);
  assert.notDeepEqual(a.map((x) => x.title), b.map((x) => x.title), 'different day → rotated set');
});

test('worldClocks returns 8 financial capitals with tz', () => {
  const c = worldClocks();
  assert.equal(c.length, 8);
  assert.equal(c, CLOCKS);
  for (const x of c) { assert.ok(x.city); assert.ok(x.tz.includes('/')); }
});
