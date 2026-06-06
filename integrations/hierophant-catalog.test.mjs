// hierophant-catalog.test.mjs — OFFLINE integrity tests for the Hierophant text catalog.
// Pure data: no network, no fetch, no fs. We assert the catalog's internal consistency — every
// companion + entity-reference id resolves, every link is https, traditions enumerate, the helper
// lookups behave — so the /texts pages can never link to a dangling id or a non-https source.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TRADITIONS, TEXTS, READING_PATHS, TEXT_IDS, TRADITION_IDS,
  getText, getTradition, textsByTradition, companionsOf, linksOf, validateCatalog,
} from './hierophant-catalog.mjs';

test('validateCatalog passes with no errors', () => {
  const { ok, errors } = validateCatalog();
  assert.equal(ok, true, `catalog errors: ${JSON.stringify(errors)}`);
  assert.deepEqual(errors, []);
});

test('catalog has a substantial curated set across many traditions', () => {
  assert.ok(TEXTS.length >= 35, `expected >=35 texts, got ${TEXTS.length}`);
  assert.ok(TRADITIONS.length >= 12, `expected >=12 traditions, got ${TRADITIONS.length}`);
  // every tradition id is unique
  assert.equal(TRADITION_IDS.size, TRADITIONS.length);
});

test('every text id is unique', () => {
  assert.equal(TEXT_IDS.size, TEXTS.length);
});

test('the obvious canon is present', () => {
  const want = [
    'pyramid-texts', 'book-of-the-dead', 'enuma-elish', 'gilgamesh', 'iliad', 'odyssey',
    'theogony', 'homeric-hymns', 'orphic-hymns', 'corpus-hermeticum', 'nag-hammadi',
    'kjv-bible', 'quran', 'avesta', 'rig-veda', 'upanishads', 'bhagavad-gita', 'dhammapada',
    'tao-te-ching', 'i-ching', 'eddas', 'kalevala', 'popol-vuh', 'greek-magical-papyri', 'zohar',
  ];
  for (const id of want) assert.ok(getText(id), `missing canon text: ${id}`);
});

test('every text belongs to an enumerated tradition', () => {
  for (const t of TEXTS) assert.ok(TRADITION_IDS.has(t.tradition), `${t.id}: ${t.tradition}`);
});

test('every link on every text is https', () => {
  for (const t of TEXTS) {
    for (const u of Object.values(t.links || {})) {
      assert.match(u, /^https:\/\//, `${t.id} link not https: ${u}`);
    }
  }
});

test('every companion id resolves to a real text and carries a why', () => {
  for (const t of TEXTS) {
    for (const c of (t.companions || [])) {
      assert.ok(getText(c.id), `${t.id}: dangling companion ${c.id}`);
      assert.ok(c.why && c.why.length >= 8, `${t.id}: companion ${c.id} missing why`);
    }
  }
});

test('companionsOf resolves to {text, why} and skips nothing valid', () => {
  const comps = companionsOf('orphic-hymns');
  assert.ok(comps.length >= 2);
  for (const c of comps) {
    assert.ok(c.text && c.text.id, 'resolved companion has a text');
    assert.ok(typeof c.why === 'string' && c.why.length > 0);
  }
  // a text with no companions / unknown id → empty array, never throws
  assert.deepEqual(companionsOf('does-not-exist'), []);
});

test('linksOf returns labelled https links for a text that has them', () => {
  const links = linksOf('iliad');
  assert.ok(links.length >= 2, 'Iliad has multiple links');
  for (const l of links) {
    assert.match(l.url, /^https:\/\//);
    assert.ok(l.label.length > 0);
    assert.ok(['sacredTexts', 'gutenberg', 'archive'].includes(l.kind));
  }
  assert.deepEqual(linksOf('does-not-exist'), []);
});

test('a meaningful share of texts carry a build-time-verified link', () => {
  const verified = TEXTS.filter((t) => t.verified).length;
  assert.ok(verified >= 20, `expected >=20 verified, got ${verified}`);
});

test('textsByTradition groups correctly and is non-empty for major traditions', () => {
  for (const trad of ['egyptian', 'greek', 'hindu']) {
    const list = textsByTradition(trad);
    assert.ok(list.length >= 1, `${trad} has texts`);
    for (const t of list) assert.equal(t.tradition, trad);
  }
});

test('getTradition + getText return null on miss, never throw', () => {
  assert.equal(getTradition('nope'), null);
  assert.equal(getText('nope'), null);
});

test('every reading path resolves to a real text', () => {
  assert.ok(READING_PATHS.length >= 3);
  for (const p of READING_PATHS) assert.ok(getText(p.id), `reading path ${p.id} dangling`);
});

test('Hathor’s text (Book of the Dead) lists her among its entities', () => {
  const bod = getText('book-of-the-dead');
  assert.ok(bod.entities.includes('hathor'), 'Book of the Dead references hathor entity');
});
