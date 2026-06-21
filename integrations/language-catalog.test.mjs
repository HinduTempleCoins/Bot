// language-catalog.test.mjs — the Language Center curriculum. Pure, offline.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  FAMILIES, RESOURCES, family, getResource, byFamily, byLanguage, search,
  JESUIT_METHOD, hierophantXref, familiesWithCounts, validateCatalog,
  isSpecialized, specializedLanguages, langAlias,
} from './language-catalog.mjs';

test('translation specialty: uncommon catalog tongues route to Hathor; common ones do not', () => {
  // Kurdish dialects + scripture/ancient tongues = her specialty (route into the Language Center)
  assert.equal(isSpecialized('ckb'), true);          // Sorani (ISO code → catalog)
  assert.equal(isSpecialized('kmr'), true);          // Kurmanji
  assert.equal(isSpecialized('zaza-gorani'), true);  // by catalog name
  assert.equal(isSpecialized('phn'), true);          // Phoenician (ISO → phoenician-punic)
  assert.equal(isSpecialized('phoenician-punic'), true);
  // modern-world family is cataloged but COMMON — the cheap MT serves it, so NOT specialized
  assert.equal(isSpecialized('mandarin'), false);
  assert.equal(isSpecialized('russian'), false);
  // a plain common language not in the catalog at all
  assert.equal(isSpecialized('es'), false);
  assert.equal(isSpecialized(''), false);
  // aliases resolve
  assert.equal(langAlias('ckb'), 'sorani');
  assert.equal(langAlias('grc'), 'koine-greek');
  // she has more than a couple specialized languages, all real catalog entries
  const langs = specializedLanguages();
  assert.ok(langs.length >= 5);
  assert.ok(langs.includes('kurmanji'));
});

test('catalog validates: unique entries, known families, http(s) urls', () => {
  const v = validateCatalog();
  assert.ok(v.ok, 'invalid: ' + v.errors.join('; '));
  assert.ok(v.resources >= 70);
  assert.ok(v.families >= 6);
});

test('the operator-named languages are all present', () => {
  const langs = new Set(RESOURCES.map((r) => r.language));
  for (const l of ['kurmanji', 'sorani', 'zaza-gorani', 'koine-greek', 'biblical-hebrew', 'phoenician-punic',
    'sanskrit', 'latin', 'egyptian', 'akkadian', 'proto-canaanite', 'berber-amazigh', 'somali',
    'mandarin', 'korean', 'russian']) {
    assert.ok(langs.has(l), `missing language: ${l}`);
  }
});

test('byFamily lists foundational types first (course/textbook before corpus)', () => {
  const k = byFamily('kurdish');
  assert.ok(k.length >= 10);
  const firstCorpus = k.findIndex((x) => x.type === 'corpus');
  const lastCourse = k.map((x) => x.type).lastIndexOf('course');
  if (firstCorpus !== -1 && lastCourse !== -1) assert.ok(lastCourse < firstCorpus, 'courses precede corpora');
});

test('byFamily returns [] for an unknown family (never throws)', () => {
  assert.deepEqual(byFamily('klingon'), []);
});

test('the Jesuit method is the teaching pedagogy, with stages + the four exercises', () => {
  assert.match(JESUIT_METHOD.name, /Ratio Studiorum/);
  assert.equal(JESUIT_METHOD.stages.length, 3);
  assert.equal(JESUIT_METHOD.exercises.length, 4);
  assert.ok(JESUIT_METHOD.prelection.length > 40);
  assert.ok(JESUIT_METHOD.howHathorTeaches.length >= 4);
});

test('Hierophant cross-links: the scripture languages unlock their texts ("language and the gods")', () => {
  assert.ok(hierophantXref('koine-greek').includes('septuagint'));
  assert.ok(hierophantXref('egyptian').includes('pyramid-texts'));
  assert.ok(hierophantXref('akkadian').includes('epic-of-gilgamesh'));
  assert.ok(hierophantXref('sanskrit').includes('rigveda'));
  assert.deepEqual(hierophantXref('nonexistent'), []);
});

test('search finds resources by language and goal', () => {
  assert.ok(search('learn mandarin chinese').some((x) => x.language === 'mandarin'));
  assert.ok(search('hieroglyphs').some((x) => x.language === 'egyptian'));
  assert.ok(search('koine greek new testament').some((x) => x.language === 'koine-greek'));
  assert.deepEqual(search(''), []);
});

test('byLanguage gathers a single language across types', () => {
  const so = byLanguage('sorani');
  assert.ok(so.length >= 3);
  assert.ok(so.some((x) => x.type === 'grammar'));
});

test('familiesWithCounts reports totals + language spread', () => {
  const rows = familiesWithCounts();
  assert.equal(rows.length, FAMILIES.length);
  assert.ok(rows.find((r) => r.id === 'modern-world').total >= 10);
});

test('every resource carries an http(s) link + a family that resolves', () => {
  for (const x of RESOURCES) {
    assert.match(x.url, /^https?:\/\//, `${x.id} url`);
    assert.ok(family(x.family), `${x.id} family resolves`);
    assert.ok((x.note || '').length > 5, `${x.id} note`);
  }
});
