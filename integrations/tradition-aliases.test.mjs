// tradition-aliases.test.mjs — OFFLINE, pure data.
//
// These tests encode four real, dated search failures from one session. Each one was me telling the
// operator that material was absent when it was present under another name, and each one cost him a
// correction. The tests exist so the specific misses cannot recur silently.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TRADITIONS, expand, canonical, legalNames, missingFrom, handler, esc,
} from './tradition-aliases.mjs';

// --- the four documented misses ----------------------------------------------

test('⭐ orisha expands to Lukumi — the search that returned nothing while a SCOTUS holding sat in the file', () => {
  const names = expand('orisha');
  assert.ok(names.includes('lukumi'), 'Lukumí IS the Orisha religion');
  assert.ok(names.includes('santeria'));
  assert.ok(names.includes('ifa'));
  assert.ok(names.some((n) => n.includes('lukumi babalu aye')), 'the case name is the legal index entry');
});

test('⭐ Zarathustra and Zoroaster resolve to the same tradition — one returns 0 here, the other 10', () => {
  assert.equal(canonical('zarathustra'), 'zoroastrianism');
  assert.equal(canonical('zoroaster'), 'zoroastrianism');
  assert.deepEqual(expand('zarathustra').sort(), expand('zoroaster').sort());
});

test('⭐ Hawaiian expands to State v. Armitage — the operator asked for Kamehameha material', () => {
  const names = expand('hawaiian');
  assert.ok(names.some((n) => n.includes('armitage')),
    'the Kingdom-era religious-liberty language is in a case naming neither Kamehameha nor Hawaiian religion');
  assert.ok(names.includes('kumulipo'));
  assert.ok(names.some((n) => n.includes('mauna kea')));
});

test('⭐ Native American religion expands to Bonnichsen — cosmology filed as population genetics', () => {
  const names = expand('native american church');
  assert.ok(names.includes('bonnichsen'));
  assert.ok(names.some((n) => n.includes('white v. university')));
  assert.ok(names.includes('nagpra'));
});

test('⭐ the cosmology case is indexed under a party name, not a subject', () => {
  const names = expand('falun gong');
  assert.ok(names.includes('zhang jingrong'), 'the "complete Cosmology" holding is indexed by party');
  const t = TRADITIONS.find((x) => x.id === 'falun-gong');
  assert.match(t.note, /cosmology/i);
  assert.match(t.note, /Africa v\. Commonwealth|prong 1/i, 'it must say why the case matters');
});

// --- the structure -----------------------------------------------------------

test('every tradition separates endonym, exonym, scholarly and legal names', () => {
  for (const t of TRADITIONS) {
    for (const k of ['endonym', 'exonym', 'scholarly', 'legal']) {
      assert.ok(Array.isArray(t[k]), `${t.id} missing ${k}`);
    }
    assert.ok(t.endonym.length + t.exonym.length > 0, `${t.id} has no name at all`);
  }
});

test('a tradition with litigation carries its case names — the field most often missed', () => {
  for (const id of ['orisha', 'hawaiian', 'native-american-religion', 'witchcraft', 'ayahuasca-church']) {
    assert.ok(legalNames(id).length > 0, `${id} has no legal names recorded`);
  }
});

test('expand is symmetric — any name reaches the whole set', () => {
  for (const seed of ['santeria', 'lukumi', 'ifa', 'candomble']) {
    const names = expand(seed);
    assert.ok(names.includes('lukumi'), `${seed} did not reach lukumi`);
    assert.ok(names.length > 5, `${seed} expanded to only ${names.length}`);
  }
});

test('an unknown term returns itself rather than nothing — never silently empty', () => {
  const r = expand('quetzalcoatl');
  assert.deepEqual(r, ['quetzalcoatl']);
  assert.equal(canonical('quetzalcoatl'), null);
});

// --- ⭐ the guard rail --------------------------------------------------------

test('missingFrom reports the names NOT yet searched — run this before saying anything is absent', () => {
  const r = missingFrom('orisha', ['orisha']);
  assert.equal(r.ok, false, 'searching one name is not searching the tradition');
  assert.ok(r.missed.includes('lukumi'));
  assert.match(r.advice, /Also search/);
  assert.equal(r.tradition, 'orisha');
});

test('missingFrom reports ok only when every known name was searched', () => {
  const all = expand('falun gong');
  const r = missingFrom('falun gong', all);
  assert.equal(r.ok, true);
  assert.deepEqual(r.missed, []);
  assert.match(r.advice, /All known names/);
});

test('missingFrom never throws on junk and treats junk as "nothing searched"', () => {
  for (const v of [null, undefined, 0, 'x', {}, [null]]) {
    assert.doesNotThrow(() => missingFrom('orisha', v));
  }
  assert.equal(missingFrom('orisha', null).ok, false);
});

// --- robustness --------------------------------------------------------------

test('lookups are case- and whitespace-insensitive', () => {
  assert.equal(canonical('  SANTERÍA  '), 'orisha');
  assert.equal(canonical('Zoroaster'), 'zoroastrianism');
});

test('nothing throws on junk', () => {
  for (const v of [null, undefined, 0, '', [], {}]) {
    assert.doesNotThrow(() => expand(v));
    assert.doesNotThrow(() => canonical(v));
    assert.doesNotThrow(() => legalNames(v));
    assert.doesNotThrow(() => esc(v));
  }
  assert.deepEqual(expand(null), []);
});

test('handler states the rule', () => {
  let body = '';
  handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.match(j.note, /case name/i);
  assert.match(j.note, /before reporting absence/i);
});
