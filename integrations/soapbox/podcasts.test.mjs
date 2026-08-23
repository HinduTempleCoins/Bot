import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toShow, searchPodcasts, lookupPodcast, topPodcasts,
  episodes, parseEpisodes, parseDuration,
  renderList, dataNote, esc, __setFetch, __setPodcastIndex, hasPodcastIndex,
} from './podcasts.mjs';

const RAW = {
  collectionId: 12345, collectionName: 'The History of Rome',
  artistName: 'Mike Duncan', feedUrl: 'https://feeds.example.com/history-of-rome',
  artworkUrl600: 'https://art.example.com/600.jpg', primaryGenreName: 'History',
  trackCount: 179, collectionViewUrl: 'https://podcasts.apple.com/us/podcast/id12345',
};

const RSS = `<?xml version="1.0"?><rss><channel>
  <title>The History of Rome</title>
  <item>
    <title><![CDATA[001- In the Beginning]]></title>
    <pubDate>Sun, 28 Jul 2007 12:00:00 +0000</pubDate>
    <itunes:duration>00:14:30</itunes:duration>
    <description><![CDATA[The very first episode.]]></description>
    <enclosure url="https://feeds.example.com/audio/001.mp3" length="7000000" type="audio/mpeg"/>
  </item>
  <item>
    <title>002- Youthful Indiscretions</title>
    <pubDate>Sun, 04 Aug 2007 12:00:00 +0000</pubDate>
    <itunes:duration>1230</itunes:duration>
    <description>Rome under the kings.</description>
    <enclosure url="https://feeds.example.com/audio/002.mp3" length="6100000" type="audio/mpeg"/>
  </item>
</channel></rss>`;

test('esc escapes html', () => assert.equal(esc(`<b>&"'`), '&lt;b&gt;&amp;&quot;&#39;'));

test('toShow normalizes + tags POINT posture (never rehost)', () => {
  const s = toShow(RAW);
  assert.equal(s.id, '12345');
  assert.equal(s.title, 'The History of Rome');
  assert.equal(s.author, 'Mike Duncan');
  assert.equal(s.feedUrl, 'https://feeds.example.com/history-of-rome');
  assert.equal(s.artwork, 'https://art.example.com/600.jpg');
  assert.equal(s.genre, 'History');
  assert.equal(s.episodeCount, 179);
  assert.equal(s.posture, 'point');
});

test('toShow rejects records with no id or no title', () => {
  assert.equal(toShow({ collectionName: 'x' }), null);   // no id
  assert.equal(toShow({ collectionId: 1 }), null);       // no title
  assert.equal(toShow({}), null);
});

function mockFetchJson(obj) {
  return async () => ({ ok: true, json: async () => obj });
}

test('searchPodcasts returns shaped shows, clamps limit, dedupes', async () => {
  __setFetch(mockFetchJson({ resultCount: 3, results: [RAW, { ...RAW, collectionId: 999, collectionName: 'Revolutions' }, RAW] }));
  const out = await searchPodcasts({ term: 'history', limit: 5000 });
  assert.equal(out.length, 2);                            // duplicate id 12345 deduped
  assert.equal(out[0].posture, 'point');
  assert.equal(out[1].title, 'Revolutions');
  __setFetch(null);
});

test('searchPodcasts soft-fails to [] on empty term, bad response, thrown fetch', async () => {
  assert.deepEqual(await searchPodcasts({ term: '' }), []);
  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await searchPodcasts({ term: 'history' }), []);
  __setFetch(async () => { throw new Error('network'); });
  assert.deepEqual(await searchPodcasts({ term: 'history' }), []);
  __setFetch(null);
});

test('lookupPodcast returns one shaped show by id, soft-fails to null', async () => {
  __setFetch(mockFetchJson({ resultCount: 1, results: [RAW] }));
  const s = await lookupPodcast(12345);
  assert.equal(s.feedUrl, 'https://feeds.example.com/history-of-rome');
  __setFetch(async () => { throw new Error('network'); });
  assert.equal(await lookupPodcast(12345), null);
  assert.equal(await lookupPodcast(''), null);
  __setFetch(null);
});

test('topPodcasts is a keyless convenience search by genre', async () => {
  __setFetch(mockFetchJson({ resultCount: 1, results: [{ ...RAW, primaryGenreName: 'Comedy' }] }));
  const out = await topPodcasts({ genre: 'Comedy', limit: 10 });
  assert.equal(out[0].genre, 'Comedy');
  __setFetch(null);
});

test('parseDuration handles HH:MM:SS, MM:SS, raw seconds, garbage', () => {
  assert.equal(parseDuration('00:14:30'), 870);
  assert.equal(parseDuration('20:30'), 1230);
  assert.equal(parseDuration('1230'), 1230);
  assert.equal(parseDuration(''), 0);
  assert.equal(parseDuration('abc'), 0);
});

test('parseEpisodes reads enclosure audioUrl + title + pubDate + duration, tags POINT', () => {
  const eps = parseEpisodes(RSS);
  assert.equal(eps.length, 2);
  assert.equal(eps[0].title, '001- In the Beginning');            // CDATA stripped
  assert.equal(eps[0].audioUrl, 'https://feeds.example.com/audio/001.mp3');
  assert.match(eps[0].pubDate, /28 Jul 2007/);
  assert.equal(eps[0].durationSec, 870);
  assert.equal(eps[0].desc, 'The very first episode.');
  assert.equal(eps[0].posture, 'point');
  assert.equal(eps[1].durationSec, 1230);
});

test('parseEpisodes skips items with no enclosure + dedupes by audioUrl', () => {
  const noEnc = '<rss><channel><item><title>No audio</title></item></channel></rss>';
  assert.deepEqual(parseEpisodes(noEnc), []);
  const dup = `<rss><channel>
    <item><title>A</title><enclosure url="https://x/a.mp3" type="audio/mpeg"/></item>
    <item><title>B</title><enclosure url="https://x/a.mp3" type="audio/mpeg"/></item>
  </channel></rss>`;
  assert.equal(parseEpisodes(dup).length, 1);
  assert.deepEqual(parseEpisodes(''), []);
});

test('episodes fetches a feed then parses, soft-fails to [] on bad response + thrown fetch', async () => {
  __setFetch(async () => ({ ok: true, text: async () => RSS }));
  const eps = await episodes('https://feeds.example.com/history-of-rome');
  assert.equal(eps.length, 2);
  assert.equal(eps[0].audioUrl, 'https://feeds.example.com/audio/001.mp3');
  assert.deepEqual(await episodes(''), []);
  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await episodes('https://feeds.example.com/x'), []);
  __setFetch(async () => { throw new Error('network'); });
  assert.deepEqual(await episodes('https://feeds.example.com/x'), []);
  __setFetch(null);
});

test('renderList emits an esc-safe show list with the feedUrl + Listen button', () => {
  const html = renderList([toShow(RAW)]);
  assert.match(html, /The History of Rome/);
  assert.match(html, /data-feed="https:\/\/feeds\.example\.com\/history-of-rome"/);
  assert.match(html, /class=listen/);
  assert.match(html, /179 eps/);
  assert.match(renderList([]), /No podcasts/);
});

test('renderList escapes hostile show fields', () => {
  const html = renderList([{ title: '<script>x</script>', author: '"&', genre: '', feedUrl: '', episodeCount: 0 }]);
  assert.doesNotMatch(html, /<script>x<\/script>/);
  assert.match(html, /&lt;script&gt;/);
});

test('PodcastIndex seam is a documented no-op unless creds set', () => {
  assert.equal(hasPodcastIndex(), false);
  __setPodcastIndex({ key: 'k', secret: 's' });
  assert.equal(hasPodcastIndex(), true);
  __setPodcastIndex(null);
  assert.equal(hasPodcastIndex(), false);
});

test('dataNote states the never-rehost posture + keyless source', () => {
  assert.match(dataNote(), /never rehost|point to/i);
  assert.match(dataNote(), /Apple|iTunes/i);
});
