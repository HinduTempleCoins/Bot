// videos.test.mjs — OFFLINE: keyless fallback, cached embeds, background lookup, daily budget, escaping.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

process.env.WIKI_VIDEOS_CACHE = mkdtempSync(tmpdir() + '/wiki-videos-') + '/cache.json';
const V = await import('./videos.mjs');
const reply = (items) => async () => ({ ok: true, json: async () => ({ items }) });
const item = (id, title) => ({ id: { videoId: id }, snippet: { title, channelTitle: 'Chan' } });

test('without a key: a YouTube search link, never an empty section, no lookups', async () => {
  delete process.env.YOUTUBE_API_KEY; V.__reset();
  let calls = 0; V.__setFetch(async () => { calls++; return { ok: false }; });
  const html = V.videosSection('Blue_Lotus', 'Blue Lotus (plant)');
  assert.match(html, /<h2 id=videos>Videos<\/h2>/);
  assert.match(html, /Watch videos about Blue Lotus on YouTube/);
  assert.ok(!html.includes('<iframe'));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 0);
});

test('with a key: first visit kicks off a lookup, the next shows the embed + cards, titles escaped', async () => {
  process.env.YOUTUBE_API_KEY = 'k'; V.__reset();
  V.__setFetch(reply([item('AAAAAAAAAAA', '<b>Lotus</b>'), item('BBBBBBBBBBB', 'Second'), { id: {}, snippet: {} }]));
  V.videosSection('Lotus', 'Lotus');
  await new Promise((r) => setTimeout(r, 20));
  const html = V.videosSection('Lotus', 'Lotus');
  assert.match(html, /youtube-nocookie\.com\/embed\/AAAAAAAAAAA/);
  assert.match(html, /i\.ytimg\.com\/vi\/BBBBBBBBBBB/);
  assert.ok(!html.includes('<b>Lotus</b>'));
});

test('daily budget: lookups stop once the day is spent', async () => {
  process.env.YOUTUBE_API_KEY = 'k'; process.env.YOUTUBE_DAILY_SEARCHES = '2';
  process.env.WIKI_VIDEOS_CACHE = mkdtempSync(tmpdir() + '/wiki-videos-') + '/cache.json'; V.__reset();
  let calls = 0; V.__setFetch(async () => { calls++; return { ok: true, json: async () => ({ items: [item('CCCCCCCCCCC', 'x')] }) }; });
  for (const s of ['a1', 'a2', 'a3', 'a4']) await V.refresh(s, s);
  assert.equal(calls, 2);
  delete process.env.YOUTUBE_DAILY_SEARCHES;
});
