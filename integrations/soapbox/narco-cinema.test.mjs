// narco-cinema.test.mjs — offline. node --test integrations/soapbox/narco-cinema.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NARCO_TITLES, NARCO_PD, EXCLUDED, SHELVES, titlesByShelf, freeNow, filmsHref, narcoTile } from './narco-cinema.mjs';
import { licenseLabel, looksLikeRip } from './archive-video.mjs';
import { allFreeFilms } from './free-film-registry.mjs';

test('catalogue: every title has a name, a known shelf, and dated sources for any free service', () => {
  const shelves = new Set(SHELVES.map((s) => s.id));
  assert.ok(NARCO_TITLES.length >= 50);
  for (const t of NARCO_TITLES) {
    assert.ok(t.t, 'title');
    assert.ok(shelves.has(t.shelf), `${t.t}: shelf ${t.shelf}`);
    for (const w of t.where || []) {
      assert.match(w.url, /^https:\/\//, `${t.t}: url`);
      assert.equal(w.seen, '2026-09-29', `${t.t}: seen date`);
      assert.doesNotMatch(w.url, /youtube\.com|youtu\.be|archive\.org/, `${t.t}: no YouTube/IA uploads of copyrighted narcocine`);
    }
  }
  assert.ok(titlesByShelf().find((s) => s.id === 'coyote').items.some((t) => t.t === 'El Coyote y la Bronca' && t.y === 1980));
  assert.ok(freeNow().length >= 20);
});

test('only documented public-domain items play; every one is registered as cleared and not rip-named', () => {
  assert.ok(NARCO_PD.length >= 15);
  const ids = new Set(allFreeFilms().map((f) => f.id));
  for (const f of NARCO_PD) {
    assert.ok(f.id && f.title && f.why, `${f.id}: fields`);
    assert.match(f.why, /public domain|US government work|by age/i, `${f.id}: PD reason`);
    assert.equal(looksLikeRip(f.id, f.title), false, f.id);
    assert.equal(licenseLabel('', ['feature_films'], { id: f.id }).token, 'public-domain', `${f.id}: registered`);
    assert.ok(ids.has(f.id), `${f.id}: in the free-film registry (Films bridge)`);
    assert.equal(narcoTile(f).licenseToken, 'public-domain');
  }
  // the copyrighted Mexican narcocine uploads are never cleared
  assert.equal(licenseLabel('', ['feature_films'], { id: 'la-banda-del-carro-rojo-1978-fullscreen', year: '1978' }).token, 'unverified');
  assert.ok(EXCLUDED.some((x) => /network copyright/.test(x.why)));
});

test('SoapBox Films links: exact film when matched, else a title+year search', () => {
  assert.equal(filmsHref({ t: 'Traffic', y: 2000, qid: 'Q12345' }), '/films/Q12345');
  assert.equal(filmsHref({ t: 'La clave 7', y: 1999 }), '/films/search?q=La%20clave%207%201999');
  assert.equal(filmsHref({ t: 'Ser Capo', y: 0 }), '/films/search?q=Ser%20Capo');
});
