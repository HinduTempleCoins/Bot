import { test } from 'node:test';
import assert from 'node:assert';
import { CAMS, rankCams, camsSummary } from './cams.mjs';

// OFFLINE only — no network. Assert the curated list shape (valid /live URLs) + the PURE ranker.

test('CAMS are link-out /live URLs (always valid, no broken embeds)', () => {
  assert.ok(CAMS.length >= 6, 'a real curated list');
  for (const c of CAMS) {
    assert.ok(c.name, 'has a name');
    assert.ok(c.channelHandle, 'has a channelHandle');
    assert.match(c.url, /^https:\/\/www\.youtube\.com\/@.+\/live$/, 'links to channel /live');
    assert.equal(c.url, `https://www.youtube.com/@${c.channelHandle}/live`, 'url derives from handle');
    assert.equal(typeof c.popularity, 'number');
  }
});

test('CAMS includes the named cam networks from the brief', () => {
  const names = CAMS.map((c) => c.name);
  for (const n of ['Explore.org', 'WildEarth', 'Africam', 'Monterey Bay Aquarium']) {
    assert.ok(names.includes(n), `${n} present`);
  }
});

test('rankCams puts live-now first, then unknown, then offline (pure, no network)', () => {
  const list = [
    { name: 'Off', popularity: 99, live: false },
    { name: 'Unknown', popularity: 50, live: null },
    { name: 'Live', popularity: 1, live: true },
  ];
  const ranked = rankCams(list);
  assert.deepEqual(ranked.map((c) => c.name), ['Live', 'Unknown', 'Off']);
});

test('rankCams breaks ties within a band by popularity desc then name asc', () => {
  const list = [
    { name: 'Beta', popularity: 70, live: true },
    { name: 'Alpha', popularity: 90, live: true },
    { name: 'Gamma', popularity: 70, live: true },
  ];
  const ranked = rankCams(list);
  assert.deepEqual(ranked.map((c) => c.name), ['Alpha', 'Beta', 'Gamma']);
});

test('rankCams is pure — does not mutate its input', () => {
  const input = [...CAMS];
  const before = input.map((c) => c.name);
  rankCams(input);
  assert.deepEqual(input.map((c) => c.name), before, 'original order untouched');
});

test('rankCams defaults to CAMS and returns all of them', () => {
  assert.equal(rankCams().length, CAMS.length);
});

test('camsSummary reports counts, topics, and key presence', () => {
  const s = camsSummary();
  assert.equal(s.total, CAMS.length);
  assert.equal(s.enrichable, CAMS.filter((c) => c.channelId).length);
  assert.equal(typeof s.apiKey, 'boolean');
  assert.ok(Array.isArray(s.topics) && s.topics.length >= 1);
});
