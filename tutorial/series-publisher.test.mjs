// series-publisher.test.mjs — offline tests for the tutorial series publisher. No network, no broadcast.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SERIES_TRACKS, seriesLessons, permlinkFor, titleFor, tagsFor, buildSeries, seriesManifest,
} from './series-publisher.mjs';
import { LESSONS } from './lessons/index.mjs';

test('series orders all lessons by track (core -> automation -> platforms -> defi)', () => {
  const ordered = seriesLessons();
  assert.equal(ordered.length, LESSONS.length);
  const strands = ordered.map((l) => l.strand || null);
  // core block first, then each strand contiguous in track order
  const order = SERIES_TRACKS.map((t) => t.strand);
  let lastIdx = -1;
  for (const s of strands) {
    const idx = order.indexOf(s);
    assert.ok(idx >= lastIdx - 0, 'strands appear in track order');
    lastIdx = Math.max(lastIdx, idx);
  }
  // first is a core lesson, last is a defi lesson
  assert.equal(ordered[0].strand || null, null);
  assert.equal(ordered[ordered.length - 1].strand, 'defi');
});

test('permlinks are unique, lowercase, hyphenated, and numbered', () => {
  const s = buildSeries();
  const seen = new Set();
  s.forEach((p, i) => {
    assert.match(p.permlink, /^melek-tutorial-\d\d-[a-z0-9-]+$/);
    assert.ok(!seen.has(p.permlink), `unique ${p.permlink}`);
    seen.add(p.permlink);
    assert.equal(p.n, i + 1);
  });
});

test('cross-links resolve: first has no prev, last has no next, middle chain is consistent', () => {
  const s = buildSeries();
  assert.equal(s[0].prevPermlink, null);
  assert.equal(s[s.length - 1].nextPermlink, null);
  for (let i = 0; i < s.length; i++) {
    if (i > 0) assert.equal(s[i].prevPermlink, s[i - 1].permlink);
    if (i < s.length - 1) assert.equal(s[i].nextPermlink, s[i + 1].permlink);
  }
});

test('each post body carries the series nav, the lesson content, and the learn-and-earn action', () => {
  const s = buildSeries();
  const first = s[0];
  assert.match(first.body, /MELEK Tutorial — Part 1 of \d+/);
  assert.match(first.body, /The MELEK Tutorial/);                 // bottom nav
  assert.match(first.body, /comment on this post that you did it/i); // CryptoKannon mechanic
  assert.match(first.body, /Welcome/);                            // lesson content present
  // next link points at the real next permlink
  assert.ok(first.body.includes(s[1].permlink));
});

test('the last post closes the series (no Next link, a completion line)', () => {
  const s = buildSeries();
  const last = s[s.length - 1];
  assert.match(last.body, /completed the series/i);
  assert.doesNotMatch(last.body, /Next:.*→\]\(https/);            // no next-arrow link on the finale
});

test('titles + tags are well-formed for on-chain posting', () => {
  const s = buildSeries();
  for (const p of s) {
    assert.match(p.title, /^MELEK Tutorial \d+\/\d+ — /);
    assert.ok(p.tags.length <= 5, 'Graphene <=5 tags');
    assert.equal(p.tags[0], 'melek');                             // category = melek (feed visibility)
    assert.ok(p.tags.includes('tutorial'));
    assert.ok(p.tags.every((t) => /^[a-z0-9-]+$/.test(t)), 'tags lowercase/hyphen');
  }
});

test('own trailing "Next:" pointer is stripped (replaced by resolved series nav)', () => {
  // build with a fake loader whose content ends in a bare "Next: ..." line
  const fakeLessons = [
    { id: 'a', title: 'A', strand: null }, { id: 'b', title: 'B', strand: null },
  ];
  const load = (id) => ({ id, content: `# ${id.toUpperCase()}\n\nbody of ${id}.\n\nNext: something to strip` });
  const s = buildSeries({ lessons: fakeLessons, load });
  assert.doesNotMatch(s[0].body, /Next: something to strip/);
  assert.match(s[0].body, /body of a\./);
});

test('manifest is the posting plan (ordered, with permlinks + tags)', () => {
  const m = seriesManifest();
  assert.equal(m.series, 'MELEK Tutorial');
  assert.equal(m.total, LESSONS.length);
  assert.equal(m.posts.length, LESSONS.length);
  assert.equal(m.posts[0].n, 1);
  assert.ok(m.posts[0].permlink.startsWith('melek-tutorial-01-'));
});
