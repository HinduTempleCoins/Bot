import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPost, buildVideoPost, collectVideos, collectSongs, buildSongPost, buildDadaPost, DADA_SCENES, TESTING, __setFetch } from './shilpa-poster.mjs';

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

test('dada sets: titles name the scenes, never a bare set number, and never say testing', () => {
  const batch = DADA_SCENES.slice(0, 6);
  const p = buildDadaPost(batch, 1);

  assert.equal(p.permlink, 'shilpa-shastra-dada-set-1');
  assert.deepEqual(p.tags, ['shilpashastra', 'dada', 'art', 'melek', 'history']);

  // the operator's standing complaint: every title read "Set N ... (testing)" with only an integer changing
  assert.doesNotMatch(p.title, /set \d/i, 'the title must not be a set number');
  assert.doesNotMatch(p.title, /testing/i, 'dada titles never say testing');
  for (const s of batch) assert.ok(p.title.includes(s.name), `title names ${s.name}`);
  assert.ok(p.title.length <= 250);

  // every scene carries its still, its one ground photograph and its cut-out figures
  for (const s of batch) {
    assert.ok(p.body.includes(`![${s.title}](https://melek.salon/img/${s.img}.jpg)`), `${s.key} still`);
    assert.ok(p.body.includes(s.ground), `${s.key} ground credit`);
    assert.ok(p.body.includes(s.figures), `${s.key} figures`);
  }
  assert.match(p.body, /public domain, taken from Wikimedia Commons/);
  assert.match(p.body, /Real cutouts from real public-domain photographs, never generated imagery/);
});

test('dada scene table: unique keys, unique image hashes, batches of 6 cover all 18 scenes', () => {
  assert.equal(DADA_SCENES.length, 18);
  assert.equal(new Set(DADA_SCENES.map((s) => s.key)).size, 18, 'keys unique — state dedupe depends on it');
  assert.equal(new Set(DADA_SCENES.map((s) => s.img)).size, 18, 'image hashes unique');
  for (const s of DADA_SCENES) assert.match(s.img, /^[0-9a-f]{40}$/, `${s.key} is a sha256-40 hash name`);

  // walk the lane's own slicing: three sets, nothing posted twice, nothing left behind
  const seen = new Set();
  let sets = 0;
  while (seen.size < DADA_SCENES.length) {
    const todo = DADA_SCENES.filter((s) => !seen.has(s.key));
    const batch = todo.slice(0, 6);
    assert.ok(batch.length >= 1 && batch.length <= 6);
    const p = buildDadaPost(batch, ++sets);
    assert.equal(p.permlink, `shilpa-shastra-dada-set-${sets}`);
    for (const s of batch) seen.add(s.key);
  }
  assert.equal(sets, 3);
});

test('dada words appear only where the scene actually carries them', () => {
  const byKey = Object.fromEntries(DADA_SCENES.map((s) => [s.key, s]));
  assert.match(buildDadaPost([byKey['dada:guerrilla-action']], 1).body, /WE ARE LOOKING FOR PEOPLE \/ WHO LIKE TO DRAW/);
  assert.match(buildDadaPost([byKey['dada:panthers']], 1).body, /UP AGAINST THE WALL/);
  assert.match(buildDadaPost([byKey['dada:acid-test']], 1).body, /CAN YOU PASS THE ACID TEST\?/);
  assert.match(buildDadaPost([byKey['dada:acid-test']], 1).body, /FURTHUR/);
  // a scene with no words in it gets no words line
  assert.doesNotMatch(buildDadaPost([byKey['dada:bank']], 1).body, /Words in the scene/);
});
