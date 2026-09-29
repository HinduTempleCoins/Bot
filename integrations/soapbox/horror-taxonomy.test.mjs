import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HORROR_GENRES, SURVIVAL_WING, PD_HORROR_FILMS, ROOTS_SHELF, HALLOWEEN_PICKS,
  genreById, survivalById, pdFilmsFor, iaQueryFor,
  toTile, curatedTiles, horrorGenreRows, horrorFilms, dataNote, esc, __setFetch,
} from './horror-taxonomy.mjs';

test('esc escapes html incl. single quote', () => {
  assert.equal(esc(`<a>'"&`), '&lt;a&gt;&#39;&quot;&amp;');
});

test('the 8 standalone genres from "A Map of Horror" are present', () => {
  assert.equal(HORROR_GENRES.length, 8);
  const ids = HORROR_GENRES.map((g) => g.id);
  for (const id of ['supernatural', 'slasher', 'survival', 'body', 'cosmic', 'monster', 'exploitation', 'psychological']) {
    assert.ok(ids.includes(id), `missing genre ${id}`);
  }
  // every genre carries the paper's "organized around" thesis + subgenres + query keywords
  for (const g of HORROR_GENRES) {
    assert.ok(g.organizedAround && g.subgenres.length && g.keywords.length, `${g.id} underspecified`);
  }
});

test('survival wing leads with the trafficking NETWORK category, separate from lone/home-invasion', () => {
  // operator refinement: trafficking is the lead; lone-attacker + home-invasion are separate + de-emphasized
  const lead = SURVIVAL_WING.find((s) => s.emphasis === 'lead');
  assert.ok(lead, 'no lead category');
  assert.equal(lead.id, 'trafficking-network');
  assert.match(lead.thesis, /ring|operation|network|system/i);

  // trafficking is NOT collapsed into home-invasion or lone-attacker — all three exist distinctly
  const ids = SURVIVAL_WING.map((s) => s.id);
  assert.ok(ids.includes('home-invasion'));
  assert.ok(ids.includes('lone-attacker'));
  for (const id of ['home-invasion', 'lone-attacker']) {
    assert.equal(survivalById(id).emphasis, 'deemphasized', `${id} should be de-emphasized`);
  }
});

test('trafficking-network is reference leads only; the white-slavery rescue films sit on ROOTS_SHELF, outside the genre', () => {
  const t = survivalById('trafficking-network');
  assert.equal(t.pdTitles.length, 0, 'the old rescue/exposé films are not Girl Has to Kill Everyone');
  assert.ok(t.titles.length >= 3, 'needs reference leads');
  assert.equal(ROOTS_SHELF.emphasis, 'deemphasized');
  assert.ok(!SURVIVAL_WING.some((s) => s.id === ROOTS_SHELF.id), 'roots shelf must not be part of the genre');
  assert.equal(survivalById(ROOTS_SHELF.id), ROOTS_SHELF);
  assert.match(ROOTS_SHELF.thesis, /rescue/);
  const pd = new Map(PD_HORROR_FILMS.map((f) => [f.id, f]));
  for (const id of ROOTS_SHELF.pdTitles) {
    assert.ok(pd.has(id), `roots stock ${id} missing from PD_HORROR_FILMS`);
    assert.equal(pd.get(id).g, 'exploitation');
    assert.match(pd.get(id).sub, /^Roots:/);
  }
  assert.ok(!PD_HORROR_FILMS.some((f) => /Sex Trafficking/.test(f.sub)), 'no PD film is filed inside the genre');
});

test('every curated PD film: valid IA id, real genre, a year, a stated public-domain reason; no duplicates', () => {
  const genreIds = new Set(HORROR_GENRES.map((g) => g.id));
  const seen = new Set();
  for (const f of PD_HORROR_FILMS) {
    assert.match(f.id, /^[A-Za-z0-9._-]+$/, `bad IA id ${f.id}`);
    assert.ok(!seen.has(f.id), `duplicate ${f.id}`); seen.add(f.id);
    assert.ok(genreIds.has(f.g), `${f.id} genre ${f.g}`);
    assert.ok(Number.isInteger(f.year) && f.year >= 1890 && f.year <= 1980, `${f.id} year ${f.year}`);
    assert.ok(f.pd && f.pd.length > 20, `${f.id} has no public-domain reason`);
    if (f.year > 1930) assert.match(f.pd, /Wikipedia/, `${f.id}: a post-1930 title needs a documented reason`);
    else assert.match(f.pd, /by age|Wikipedia/, `${f.id}`);
  }
  assert.ok(PD_HORROR_FILMS.length >= 80, `only ${PD_HORROR_FILMS.length} titles`);
  for (const g of genreIds) assert.ok(pdFilmsFor(g).length >= 2, `genre ${g} has under 2 free films`);
});

test('Halloween picks all come from the verified PD list', () => {
  const ids = new Set(PD_HORROR_FILMS.map((f) => f.id));
  assert.ok(HALLOWEEN_PICKS.length >= 8);
  for (const id of HALLOWEEN_PICKS) assert.ok(ids.has(id), id);
});

test('genreById / survivalById lookups', () => {
  assert.equal(genreById('monster').title, 'Monster');
  assert.equal(genreById('nope'), null);
  assert.equal(survivalById('siege').wing, 'martyrs');
  assert.equal(survivalById('she-is-the-monster').wing, 'eyes-of-my-mother');
});

test('every curated PD film maps to a real top-level genre', () => {
  const genreIds = new Set(HORROR_GENRES.map((g) => g.id));
  for (const f of PD_HORROR_FILMS) {
    assert.ok(f.id && f.title, 'film missing id/title');
    assert.ok(genreIds.has(f.g), `${f.title} has unknown genre ${f.g}`);
  }
  // the flagship PD titles are present
  const ids = PD_HORROR_FILMS.map((f) => f.id);
  assert.ok(ids.includes('night_of_the_living_dead_dvd'));
  assert.ok(ids.includes('Nosferatu1922'));
});

test('pdFilmsFor filters by genre', () => {
  const monster = pdFilmsFor('monster');
  assert.ok(monster.length >= 3);
  assert.ok(monster.every((f) => f.g === 'monster'));
  assert.deepEqual(pdFilmsFor('no-such-genre'), []);
});

test('iaQueryFor builds an OR clause from genre keywords, or the survival iaQuery', () => {
  const q = iaQueryFor('supernatural');
  assert.match(q, /haunted/);
  assert.match(q, / OR /);
  // survival category returns its bespoke query
  assert.equal(iaQueryFor('trafficking-network'), survivalById('trafficking-network').iaQuery);
  // multi-word keywords get quoted
  assert.match(iaQueryFor('cosmic'), /"sci-fi horror"/);
  // unknown → safe default
  assert.equal(iaQueryFor('???'), 'horror');
});

test('toTile shapes a PD film like the stream surface expects', () => {
  const t = toTile({ id: 'Nosferatu1922', title: 'Nosferatu', year: 1922, g: 'monster', sub: 'Vampire' });
  assert.equal(t.kind, 'film');
  assert.equal(t.year, '1922');
  assert.equal(t.licenseToken, 'public-domain');
  assert.equal(t.source, 'Internet Archive');
  assert.match(t.streamUrl, /^https:\/\/archive\.org\/embed\/Nosferatu1922$/);
  assert.equal(t.posture, 'window');
  assert.equal(toTile(null), null);
  assert.equal(toTile({}), null);
});

test('curatedTiles returns streamable PD tiles for a genre, respects limit', () => {
  const tiles = curatedTiles('monster', { limit: 2 });
  assert.equal(tiles.length, 2);
  assert.ok(tiles.every((t) => t.streamUrl.startsWith('https://archive.org/embed/')));
  // no genre → all PD films
  assert.equal(curatedTiles('', { limit: 100 }).length, PD_HORROR_FILMS.length);
});

test('horrorGenreRows returns a row per standalone genre with tiles', () => {
  const rows = horrorGenreRows();
  assert.equal(rows.length, HORROR_GENRES.length);
  assert.ok(rows.every((r) => r.title && Array.isArray(r.tiles) && r.subgenres.length));
});

test('horrorFilms does a live IA search through the injected fetch; soft-fails to []', async () => {
  const fakeDoc = {
    response: { docs: [{ identifier: 'CarnivalofSouls', title: 'Carnival of Souls', year: '1962', collection: ['SciFi_Horror'] }] },
  };
  __setFetch(async () => ({ ok: true, json: async () => fakeDoc }));
  const films = await horrorFilms({ genre: 'supernatural', limit: 5 });
  assert.equal(films.length, 1);
  assert.equal(films[0].id, 'CarnivalofSouls');
  assert.equal(films[0].source, 'Internet Archive');

  // soft-fail paths
  __setFetch(async () => ({ ok: false }));
  assert.deepEqual(await horrorFilms({ genre: 'monster' }), []);
  __setFetch(async () => { throw new Error('net'); });
  assert.deepEqual(await horrorFilms({}), []);
  __setFetch(null);
});

test('dataNote states the taxonomy basis + PD-only / never-rehost discipline', () => {
  assert.match(dataNote(), /Map of Horror/);
  assert.match(dataNote(), /trafficking/i);
  assert.match(dataNote(), /public-?domain/i);
  assert.match(dataNote(), /never rehost/i);
});
