import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPost, buildVideoPost, collectVideos, collectSongs, buildSongPost, TESTING, __setFetch } from './shilpa-poster.mjs';

test('remake sets now carry the testing statement', () => {
  const p = buildPost([{ key: 'k', title: 'Scene', group: 'Egypt', credit: 'c', looks: { '1_real': { egyptian: 'a.jpg' } } }], 3);
  assert.ok(p.body.includes(TESTING));
  assert.match(TESTING, /We are testing these features and looking to develop them/);
});

test('video sets: documentaries first, then maps, then animations; each links to watch; soft-fail per source', async () => {
  __setFetch(async (u) => {
    if (u.endsWith('/documentaries/manifest.json')) return { ok: true, json: async () => ({ films: [{ id: 'kush-nile', title: 'Kush and the Nile', summary: 'Up the Nile', seconds: 588, credits: ['Cliopatria CC BY 4.0'] }] }) };
    if (u.endsWith('/maps/index.json')) return { ok: true, json: async () => ({ clips: [{ id: 'rome', title: 'Rome', fromYear: -509, toYear: 476, duration: 106, credit: 'Cliopatria (Seshat) CC BY 4.0' }] }) };
    if (u.endsWith('/animations/manifest.json')) throw new Error('offline');
    return { ok: false };
  });
  const v = await collectVideos();
  assert.deepEqual(v.map((x) => x.key), ['doc:kush-nile', 'map:rome']);
  assert.equal(v[1].summary, '509 BC → AD 476');
  const p = buildVideoPost(v, 1);
  assert.equal(p.permlink, 'shilpa-shastra-moving-pictures-set-1');
  assert.ok(p.body.includes(TESTING));
  assert.match(p.body, /Watch it here\]\(https:\/\/hathor\.soapbox\.community\/documentaries\/kush-nile\)/);
  assert.match(p.body, /\*Documentary · 9:48\*/);
  assert.match(p.body, /Credits: Cliopatria/);
  __setFetch(null);
});

test('songs become their own blog post set, read from the live music catalogue', async () => {
  __setFetch(async (url) => {
    if (String(url).includes('/music/catalog.json')) {
      return { ok: true, json: async () => ({ tracks: [
        { id: 'lamp-upon-the-water', title: 'Lamp Upon the Water', genre: 'hymn', seconds: 90, url: 'https://stream.soapbox.community/music/t/lamp-upon-the-water', audio: 'https://stream.soapbox.community/music/media/lamp.mp3' },
        { id: 'gentle-giants', title: 'Gentle Giants', album: 'Earths in the Universe', genre: 'choral ballad', seconds: 95, url: 'https://stream.soapbox.community/music/t/gentle-giants' },
        { id: 'no-url', title: 'Not live yet' },
      ] }) };
    }
    return { ok: false };
  });
  const songs = await collectSongs();
  assert.equal(songs.length, 2, 'a song with no live page is never posted');
  assert.equal(songs[0].key, 'song:lamp-upon-the-water');

  const p = buildSongPost(songs, 3);
  assert.match(p.title, /^Songs, Set 3:/);
  assert.equal(p.permlink, 'shilpa-shastra-songs-set-3');
  assert.ok(p.tags.includes('music') && p.tags.includes('song'));
  assert.match(p.body, /Lamp Upon the Water/);
  assert.match(p.body, /Gentle Giants/);
  assert.match(p.body, /hymn · 1:30/);
  assert.match(p.body, /original words and original music, never a copy/);
  assert.match(p.body, /\/music\/t\/lamp-upon-the-water/);
  assert.match(p.body, /the music library/);
});
