import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseM3U, isFreeChannel, fetchChannels, dataNote, esc, __setFetch } from './iptv-channels.mjs';

const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="NASA.us" tvg-logo="https://logo/nasa.png" group-title="Science" tvg-country="US",NASA TV
https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8
#EXTINF:-1 tvg-id="Redbull.int" tvg-logo="https://logo/rb.png" group-title="Sports",Red Bull TV
https://rbmn-live.akamaized.net/hls/live/590964/BoRB-AT/master.m3u8
#EXTINF:-1 tvg-id="Adult.xx" group-title="XXX",Adult Channel
https://example.com/adult/master.m3u8
#EXTINF:-1 group-title="News [Geo-blocked]",Blocked News
https://example.com/blocked/master.m3u8
#EXTINF:-1 group-title="Bad",Bad Scheme Channel
rtmp://example.com/live/stream
#EXTINF:-1 group-title="News",Dup Channel
https://ntv1.akamaized.net/hls/live/2014075/NASA-NTV1-HLS/master.m3u8`;

const mockText = (body) => async () => ({ ok: true, text: async () => body });

test('esc escapes html incl. single quote', () => {
  assert.equal(esc(`<a>'"&`), '&lt;a&gt;&#39;&quot;&amp;');
});

test('isFreeChannel accepts an http(s) free channel, rejects adult / geo-blocked / bad-scheme / no-url', () => {
  assert.equal(isFreeChannel({ streamUrl: 'https://x/master.m3u8', title: 'News', group: 'News' }), true);
  assert.equal(isFreeChannel({ streamUrl: 'https://x/a.m3u8', title: 'Adult', group: 'XXX' }), false);
  assert.equal(isFreeChannel({ streamUrl: 'https://x/a.m3u8', group: 'News [geo-blocked]' }), false);
  assert.equal(isFreeChannel({ streamUrl: 'rtmp://x/live' }), false);
  assert.equal(isFreeChannel({ streamUrl: '' }), false);
  assert.equal(isFreeChannel(null), false);
});

test('parseM3U parses free channels and filters non-free + dupes', () => {
  const chans = parseM3U(PLAYLIST);
  // NASA + Red Bull kept; Adult, Geo-blocked, rtmp, and the duplicate NASA URL all dropped.
  assert.equal(chans.length, 2);
  const nasa = chans[0];
  assert.equal(nasa.title, 'NASA TV');
  assert.equal(nasa.kind, 'live');
  assert.equal(nasa.country, 'US');
  assert.equal(nasa.group, 'Science');
  assert.equal(nasa.thumb, 'https://logo/nasa.png');
  assert.match(nasa.streamUrl, /master\.m3u8$/);
  assert.equal(nasa.license, 'Free-to-air');
  assert.equal(nasa.source, 'iptv-org');
});

test('parseM3U keepAll:true retains the raw list (so the filter is doing the work)', () => {
  const all = parseM3U(PLAYLIST, { keepAll: true });
  // 5 unique URLs (the duplicate is still deduped), vs 2 after the free-filter.
  assert.ok(all.length > parseM3U(PLAYLIST).length);
});

test('parseM3U soft-handles empty/junk → []', () => {
  assert.deepEqual(parseM3U(''), []);
  assert.deepEqual(parseM3U(null), []);
  assert.deepEqual(parseM3U('not a playlist at all'), []);
});

test('parseM3U honours an explicit non-free license attribute', () => {
  const pl = `#EXTM3U
#EXTINF:-1 group-title="News" license="all-rights-reserved",Paid Channel
https://x/paid.m3u8`;
  assert.equal(parseM3U(pl).length, 0);      // dropped by the license token
  assert.equal(parseM3U(pl, { keepAll: true }).length, 1);
});

test('fetchChannels fetches + parses; clamps to free channels', async () => {
  __setFetch(mockText(PLAYLIST));
  const chans = await fetchChannels({ category: 'science', limit: 10 });
  assert.equal(chans.length, 2);
  __setFetch(null);
});

test('fetchChannels soft-fails to [] on bad response and on throw', async () => {
  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await fetchChannels({}), []);
  __setFetch(async () => { throw new Error('net'); });
  assert.deepEqual(await fetchChannels({ category: 'news' }), []);
  __setFetch(null);
});

test('dataNote states free-to-air / never-rehost discipline', () => {
  assert.match(dataNote(), /free-to-air/i);
  assert.match(dataNote(), /never a rehost|never a piracy/i);
});
