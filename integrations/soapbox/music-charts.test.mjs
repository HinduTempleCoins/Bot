// music-charts.test.mjs — OFFLINE, pure. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LYRICS_SITES, TAB_SITES, musicRefs, chartEntry, topChart, chartSeo,
  renderChart, renderRefs, dataNote, SAMPLE_CHART,
} from './music-charts.mjs';

test('musicRefs emits LINK-OUTS to lyrics + tab sites, and only URLs (no hosted text)', () => {
  const r = musicRefs('Charley Patton', 'Pony Blues');
  assert.equal(r.lyrics.length, LYRICS_SITES.length);
  assert.equal(r.tabs.length, TAB_SITES.length);
  // every ref is a real https link-out carrying the query; nothing but {site,id,url}
  for (const x of [...r.lyrics, ...r.tabs]) {
    assert.match(x.url, /^https:\/\//);
    assert.match(decodeURIComponent(x.url), /Charley Patton|Pony Blues/);
    assert.deepEqual(Object.keys(x).sort(), ['id', 'site', 'url']);
  }
  assert.match(r.lyrics.find((x) => x.id === 'genius').url, /genius\.com/);
  assert.match(r.tabs.find((x) => x.id === 'ultimate-guitar').url, /ultimate-guitar\.com/);
});

test('topChart normalizes, ranks 1..n, and titles itself', () => {
  const c = topChart({
    genre: 'Delta Blues', year: '1929', category: 'recordings', n: 2,
    entries: [{ title: 'B', artist: 'X' }, { rank: 1, title: 'A', artist: 'Y' }, { title: 'C', artist: 'Z' }],
  });
  assert.equal(c.entries.length, 2, 'capped at n');
  assert.equal(c.entries[0].title, 'A', 'explicit rank 1 sorts first');
  assert.equal(c.entries[1].rank, 2, 'auto-ranked');
  assert.equal(c.title, 'Top 2 recordings in Delta Blues, 1929');
});

test('chartSeo builds a canonical path + ItemList JSON-LD of MusicRecording', () => {
  const seo = chartSeo(SAMPLE_CHART, { baseUrl: 'https://music.soapbox.community/' });
  assert.equal(seo.canonical, 'https://music.soapbox.community/music/top/recordings/delta-blues/1929');
  assert.equal(seo.jsonLd['@type'], 'ItemList');
  assert.equal(seo.jsonLd.itemListElement[0].item['@type'], 'MusicRecording');
  assert.equal(seo.jsonLd.numberOfItems, SAMPLE_CHART.entries.length);
});

test('renderChart escapes, deep-links each row to lyrics+tabs, embeds schema, carries data note', () => {
  const evil = topChart({ genre: '<b>g</b>', entries: [{ title: '<script>x</script>', artist: '"art"' }] });
  const html = renderChart(evil);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.doesNotMatch(html, /"art"/);
  const good = renderChart(SAMPLE_CHART, { baseUrl: 'https://music.soapbox.community' });
  assert.match(good, /Lyrics:/);
  assert.match(good, /Tabs:/);
  assert.match(good, /genius\.com/);
  assert.match(good, /application\/ld\+json/);
  assert.match(good, /aggregated \/ editorial picks/); // dataNote
});

test('renderRefs is a pure link-out block (no lyric/tab text)', () => {
  const html = renderRefs('Charley Patton', 'Pony Blues');
  assert.match(html, /Guitar tabs:/);
  assert.match(html, /ultimate-guitar\.com/);
  // copyright posture is stated
  assert.match(html, /copyrighted|link out/i);
});

test('dataNote states the copyright-safe posture (link out, host none)', () => {
  assert.match(dataNote(), /copyrighted/i);
  assert.match(dataNote(), /store none|link out/i);
});
