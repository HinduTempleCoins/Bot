import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPost, buildVideoPost, collectVideos, collect3dScenes, collectSongs, buildSongPost, buildDadaPost,
  buildLibraryPost, buildCanonPost, buildBotanicaPost, buildHorrorPost, buildHerbalPost, build3dPost, listTitle,
  DADA_SCENES, LIBRARY_ITEMS, CANON_ITEMS, BOTANICA_ITEMS, HORROR_ITEMS, HERBAL_CARDS, __setFetch,
} from './shilpa-poster.mjs';

// The audit's finding: all 171 posts said "(testing)" in the title and carried an alpha disclaimer in the
// body, telling every reader the work was not worth looking at. Both are gone from every lane.
test('no lane says "(testing)" in its title or disclaims its own work in the body', () => {
  const posts = [
    buildPost([{ key: 'k', title: 'Scene', group: 'Egypt', credit: 'c', looks: { '1_real': { egyptian: 'a.jpg' } } }], 3),
    buildVideoPost([{ key: 'v', kind: 'Documentary', title: 'Kush and the Nile', url: 'u', poster: 'p', seconds: 60 }], 1),
    buildSongPost([{ key: 's', title: 'Lamp Upon the Water', genre: 'hymn', album: '', seconds: 90, url: 'u' }], 1),
    buildDadaPost(DADA_SCENES.slice(0, 2), 1),
    buildLibraryPost(LIBRARY_ITEMS.slice(0, 2), 1),
    buildCanonPost(CANON_ITEMS.slice(0, 2), 1),
    buildBotanicaPost(BOTANICA_ITEMS.slice(0, 2), 1),
    buildHorrorPost(HORROR_ITEMS.slice(0, 2), 1),
    buildHerbalPost(HERBAL_CARDS.slice(0, 1), 1),
  ];
  for (const p of posts) {
    assert.doesNotMatch(p.title, /testing/i, `title: ${p.title}`);
    assert.doesNotMatch(p.body, /We are testing these features/i);
    assert.doesNotMatch(p.body, /expected to be much better/i);
    assert.ok(p.title.length <= 250, `title fits: ${p.title.length}`);
  }
});

test('listTitle names as many items as fit and never a bare set number', () => {
  assert.equal(listTitle('X: ', ['a', 'b', 'c']), 'X: a, b and c');
  assert.equal(listTitle('X: ', []), 'X');
  const long = Array.from({ length: 40 }, (_, i) => `a rather long item name number ${i}`);
  const t = listTitle('Many: ', long);
  assert.ok(t.length <= 250, t.length);
  assert.match(t, / and \d+ more$/);
  assert.doesNotMatch(listTitle('X: ', ['a']), /set \d/i);
});

test('Moving Pictures titles name the clips, not an incrementing integer', () => {
  // 109 posts read "Moving Pictures, Set 57: Documentary, Character scene from Hathor's studio (testing)"
  const items = [
    { key: 'doc:a', kind: 'Documentary', title: 'Kush and the Nile', url: 'u1', poster: 'p1', seconds: 588 },
    { key: 'map:b', kind: 'Animated map', title: 'Rome', url: 'u2', poster: 'p2', seconds: 106 },
  ];
  const p = buildVideoPost(items, 57);
  assert.equal(p.permlink, 'shilpa-shastra-moving-pictures-set-57', 'the set number stays in the permlink');
  assert.doesNotMatch(p.title, /set \d/i);
  assert.ok(p.title.includes('Kush and the Nile') && p.title.includes('Rome'));
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
  assert.ok(p.title.includes('Lamp Upon the Water') && p.title.includes('Gentle Giants'));
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


// --- the six new lanes ---------------------------------------------------------------------------
// Each lane's batches must cover every item exactly once: the Dada lane's tests caught a scene that
// had silently fallen out of its table, so every lane gets the same walk.
const IMGB = 'https://melek.salon/img';
const LANES = [
  ['library', LIBRARY_ITEMS, buildLibraryPost, 8, 'shilpa-shastra-library-set-'],
  ['canon', CANON_ITEMS, buildCanonPost, 6, 'shilpa-shastra-canon-set-'],
  ['botanica', BOTANICA_ITEMS, buildBotanicaPost, 5, 'shilpa-shastra-botanica-set-'],
  ['horror', HORROR_ITEMS, buildHorrorPost, 4, 'shilpa-shastra-horror-set-'],
  ['herbal', HERBAL_CARDS, buildHerbalPost, 3, 'shilpa-shastra-herbal-set-'],
];

test('every lane: unique keys, sha256-40 image names, and batches that cover every item exactly once', () => {
  for (const [name, items, build, batchSize, permPrefix] of LANES) {
    assert.ok(items.length > 0, `${name} has items`);
    assert.equal(new Set(items.map((i) => i.key)).size, items.length, `${name} keys unique — state dedupe depends on it`);
    for (const i of items) {
      const imgs = i.imgs ? i.imgs.map((g) => g.img) : [i.img];
      for (const h of imgs) assert.match(h, /^[0-9a-f]{40}$/, `${i.key} image is a sha256-40 name`);
      assert.ok(i.name && i.name.length, `${i.key} has a name`);
    }
    // walk the lane's own slicing exactly as the CLI does
    const seen = new Set();
    let sets = 0;
    while (seen.size < items.length) {
      const todo = items.filter((i) => !seen.has(i.key));
      const batch = todo.slice(0, batchSize);
      assert.ok(batch.length >= 1 && batch.length <= batchSize);
      const p = build(batch, ++sets);
      assert.equal(p.permlink, `${permPrefix}${sets}`);
      assert.ok(p.title.length <= 250, `${name} set ${sets} title ${p.title.length} chars`);
      assert.doesNotMatch(p.title, /set \d/i, `${name} titles carry no set number`);
      for (const i of batch) {
        seen.add(i.key);
        const imgs = i.imgs ? i.imgs.map((g) => g.img) : [i.img];
        for (const h of imgs) assert.ok(p.body.includes(`${IMGB}/${h}.jpg`), `${i.key} image in set ${sets}`);
        assert.ok(p.body.includes(i.name), `${i.key} named in set ${sets}`);
      }
      assert.ok(sets < 200, 'the walk terminates');
    }
    assert.equal(seen.size, items.length, `${name}: every item posted exactly once`);
  }
});

test('library items carry their own record: what it shows, and the Commons credit where there is one', () => {
  const credited = LIBRARY_ITEMS.filter((i) => i.credit);
  assert.ok(credited.length >= 40, `regalia renders keep their reference credit (${credited.length})`);
  const p = buildLibraryPost(credited.slice(0, 3), 1);
  for (const i of credited.slice(0, 3)) {
    assert.ok(p.body.includes(i.shows), `${i.key} description`);
    assert.ok(p.body.includes(i.credit), `${i.key} credit`);
  }
  assert.match(p.body, /Wikimedia Commons/);
  for (const i of LIBRARY_ITEMS) assert.ok(i.shows && i.shows.length > 20, `${i.key} has a description`);
  assert.deepEqual([...new Set(LIBRARY_ITEMS.map((i) => i.group))].length, 5);
});

test('canon posts carry the fixed iconography and the Hathor renders', () => {
  const p = buildCanonPost(CANON_ITEMS.slice(0, 3), 1);
  assert.match(p.body, /VR \/ oculus headset over the eyes/);
  assert.match(p.body, /horned\s+\*\*Hathor-Mehit headdress|Hathor-Mehit headdress/);
  assert.match(p.body, /character\/reference\/README\.md/);
  assert.ok(p.tags.includes('hathor'));
  // hathor.network is a different project entirely; nothing here may point at it
  assert.doesNotMatch(p.body, /hathor\.network/);
});

test('herb cards carry dose and interaction detail, not only a picture', () => {
  const ginger = HERBAL_CARDS.find((c) => c.name === 'Ginger');
  assert.ok(ginger, 'the ginger card is in the table');
  const p = buildHerbalPost([ginger], 1);
  assert.match(p.body, /\*\*Dose:\*\*/);
  assert.match(p.body, /\*\*Cautions and interactions:\*\*/);
  assert.match(p.body, /\*\*Active compounds:\*\*/);
  assert.match(p.body, /Zingiber officinale/);
  assert.ok(p.body.includes(ginger.dose));
  for (const w of ginger.warnings) assert.ok(p.body.includes(w), 'every recorded caution is printed');
  assert.ok(p.tags.includes('plantmedicine'));
  // every herb card in the table has a dose and at least one caution on record
  const herbs = HERBAL_CARDS.filter((c) => c.kind === 'herb');
  assert.ok(herbs.length >= 14);
  for (const c of herbs) {
    assert.ok(c.dose, `${c.key} has a dose on record`);
    assert.ok(c.warnings.length, `${c.key} has cautions on record`);
  }
});

test('horror posts say plainly that they are gore images', () => {
  const p = buildHorrorPost(HORROR_ITEMS.slice(0, 2), 1);
  assert.match(p.body, /These are gore images/);
});

test('3D scene renders are their own lane and never double-post a Moving Pictures id', async () => {
  __setFetch(async (u) => {
    if (String(u).endsWith('/animations/manifest.json')) {
      return { ok: true, json: async () => ({ clips: [
        { id: '3d-tyre-port', kind: '3d-scene', title: 'Tyre Port — in 3D', group: '3D scenes', camera: 'dolly', seconds: 5 },
        { id: '3d-delos-lions', kind: '3d-scene', title: 'Delos Terrace of Lions — in 3D', group: '3D scenes', camera: 'orbit', seconds: 5 },
        { id: 'abc123', kind: 'character-scene', title: 'A character scene', seconds: 7 },
      ] }) };
    }
    return { ok: false };
  });
  const vids = await collectVideos();
  assert.deepEqual(vids.map((v) => v.key), ['anim:abc123'], 'the video lane no longer carries 3D scenes');

  const r3 = await collect3dScenes();
  assert.deepEqual(r3.map((v) => v.key), ['anim:3d-tyre-port', 'anim:3d-delos-lions']);
  assert.equal(r3[0].title, 'Tyre Port', 'the "— in 3D" suffix is not repeated in every line');

  // the 131 ids already on chain as Moving Pictures live in state.videos; the lane must skip them
  const alreadyPosted = new Set(['anim:3d-tyre-port']);
  const todo = r3.filter((v) => !alreadyPosted.has(v.key));
  assert.deepEqual(todo.map((v) => v.key), ['anim:3d-delos-lions']);

  const p = build3dPost(r3, 4);
  assert.equal(p.permlink, 'shilpa-shastra-renders3d-set-4');
  assert.doesNotMatch(p.title, /set \d/i);
  assert.ok(p.title.includes('Tyre Port') && p.title.includes('Delos Terrace of Lions'));
  assert.match(p.body, /Watch it here\]\(https:\/\/hathor\.soapbox\.community\/animations#c-3d-tyre-port\)/);
  assert.match(p.body, /dolly camera/);
  assert.ok(p.tags.includes('render3d'));
  __setFetch(null);
});

test('every lane has its own app tag and its own permlink prefix', () => {
  const perms = LANES.map(([, , , , pfx]) => pfx).concat(['shilpa-shastra-renders3d-set-', 'shilpa-shastra-dada-set-']);
  assert.equal(new Set(perms).size, perms.length, 'no two lanes share a permlink prefix');
  const tagSets = [
    buildLibraryPost(LIBRARY_ITEMS.slice(0, 1), 1).tags,
    buildCanonPost(CANON_ITEMS.slice(0, 1), 1).tags,
    buildBotanicaPost(BOTANICA_ITEMS.slice(0, 1), 1).tags,
    buildHorrorPost(HORROR_ITEMS.slice(0, 1), 1).tags,
    buildHerbalPost(HERBAL_CARDS.slice(0, 1), 1).tags,
    build3dPost([{ key: 'k', title: 't', group: 'g', camera: '', url: 'u', poster: 'p', seconds: 5 }], 1).tags,
  ];
  for (const tags of tagSets) {
    assert.equal(tags[0], 'shilpashastra', 'the category stays shilpashastra');
    assert.ok(!tags.includes('test'), 'nothing is tagged as test content');
    for (const t of tags) assert.match(t, /^[a-z][a-z0-9-]{1,23}$/, `${t} is a valid chain tag`);
  }
  // the audit: 139 posts were tagged "history" including ones with nothing to do with history
  assert.ok(!buildHerbalPost(HERBAL_CARDS.slice(0, 1), 1).tags.includes('history'));
  assert.ok(!buildBotanicaPost(BOTANICA_ITEMS.slice(0, 1), 1).tags.includes('history'));
  // every lane's tag set is distinguishable from every other's
  assert.equal(new Set(tagSets.map((t) => t.join(','))).size, tagSets.length);
});
