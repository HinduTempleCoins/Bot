import { test } from 'node:test';
import assert from 'node:assert/strict';
import { videoId, parseTimedtextXml, fetchTranscript } from './youtube-transcript.mjs';

test('videoId extracts from common URL forms + bare id', () => {
  assert.equal(videoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(videoId('https://youtu.be/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(videoId('https://www.youtube.com/shorts/dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(videoId('dQw4w9WgXcQ'), 'dQw4w9WgXcQ');
  assert.equal(videoId('not a url'), null);
});

test('parseTimedtextXml decodes cues + entities', () => {
  const xml = '<transcript><text start="0" dur="2.5">hello &amp; welcome</text><text start="2.5" dur="2">it&#39;s live</text></transcript>';
  const cues = parseTimedtextXml(xml);
  assert.equal(cues.length, 2);
  assert.equal(cues[0].text, 'hello & welcome');
  assert.equal(cues[0].startMs, 0);
  assert.equal(cues[0].endMs, 2500);
  assert.equal(cues[1].text, "it's live");
});

test('fetchTranscript pulls + normalizes the timedtext track', async () => {
  const fetch = async () => ({ text: async () => '<transcript><text start="0" dur="1">so terence said</text><text start="1" dur="1">the logos speaks</text></transcript>' });
  const r = await fetchTranscript('dQw4w9WgXcQ', { fetch });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'youtube-captions');
  assert.match(r.transcript, /so terence said the logos speaks/);
  assert.equal(r.cues.length, 2);
});

test('fetchTranscript dedupes consecutive repeated cues (auto-caption rollup)', async () => {
  const fetch = async () => ({ text: async () => '<t><text start="0" dur="1">a line</text><text start="1" dur="1">a line</text><text start="2" dur="1">next</text></t>' });
  const r = await fetchTranscript('dQw4w9WgXcQ', { fetch });
  assert.equal(r.transcript, 'a line next');
});

test('fetchTranscript signals needsAsr when no captions exist', async () => {
  const fetch = async () => ({ text: async () => '' });
  const r = await fetchTranscript('dQw4w9WgXcQ', { fetch });
  assert.equal(r.ok, false);
  assert.equal(r.needsAsr, true);
});

test('fetchTranscript rejects a bad id / missing fetch', async () => {
  assert.equal((await fetchTranscript('nope', { fetch: async () => ({}) })).note, 'bad-id');
  assert.equal((await fetchTranscript('dQw4w9WgXcQ', { fetch: null })).note, 'no-fetch');
});

test('fetchTranscript accepts a caller-supplied SRT/VTT track url', async () => {
  const fetch = async () => ({ text: async () => 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nhello world\n' });
  const r = await fetchTranscript('dQw4w9WgXcQ', { fetch, trackUrl: 'https://x/track.vtt' });
  assert.equal(r.ok, true);
  assert.match(r.transcript, /hello world/);
});
