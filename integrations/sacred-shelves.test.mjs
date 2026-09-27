// sacred-shelves.test.mjs — OFFLINE tests for the sacred-text shelves. A tiny fixture index is built into a
// temp dir with the real builder, so the key functions, the on-disk format and the query path are tested
// together. No network.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  greekKey, latinKey, skeleton, keysFor, normRef,
  searchShelves, getPassage, passageAt, stats, available, __reset,
} from './sacred-shelves.mjs';
import { buildIndex } from './sacred-shelves-build.mjs';

export const FIXTURE = [
  { id: 'tlg0012.tlg001:18.417-420', ref: 'Iliad 18.417–420', work: 'Iliad', shelf: 'greek', lang: 'grc',
    text: 'ἀμφίπολοι ῥώοντο ἄνακτι / χρύσειαι, ζωῇσι νεήνισιν εἰοικυῖαι. / τῇς ἐν μὲν νόος ἐστὶ μετὰ φρεσίν, ἐν δὲ καὶ αὐδὴ / καὶ σθένος, ἀθανάτων δὲ θεῶν ἄπο ἔργα ἴσασιν.',
    tr: 'and in support of their master moved handmaids wrought of gold in the semblance of living maids.', tr_lang: 'en', tr_src: 'perseus-eng',
    tr_label: 'English (Perseus eng3)', src: 'perseus-grc', urn: 'urn:cts:greekLit:tlg0012.tlg001.perseus-grc2:18.417-420',
    url: 'https://scaife.perseus.org/reader/urn:cts:greekLit:tlg0012.tlg001.perseus-grc2:18.417-420/',
    aliases: ['Iliad 18.417–420', 'Iliad 18.417', 'Iliad 18.418', 'Iliad 18.419', 'Iliad 18.420'] },
  { id: 'tlg0020.tlg001:135-139', ref: 'Hesiod, Theogony 135–139', work: 'Hesiod, Theogony', shelf: 'greek', lang: 'grc',
    text: 'Θείαν τε Ῥείαν τε Θέμιν τε Μνημοσύνην τε Φοίβην τε χρυσοστέφανον Τηθύν τ᾽ ἐρατεινήν.',
    tr: 'Theia and Rhea, Themis and Mnemosyne and gold-crowned Phoebe and lovely Tethys.', tr_lang: 'en', tr_src: 'perseus-eng', src: 'perseus-grc' },
  { id: 'tlg1463.tlg001:6.1', ref: '1 Enoch (Greek) 6:1', work: '1 Enoch (Greek)', shelf: 'greek', lang: 'grc',
    text: 'καὶ ἐπεθύμησαν αὐτὰς οἱ ἐγρήγοροι καὶ ἀπεπλανήθησαν ὀπίσω αὐτῶν', src: 'first1k', aliases: ['1 Enoch 6:1'] },
  { id: 'tlg0059.tlg011:202e', ref: 'Plato, Symposium 202e', work: 'Plato, Symposium', shelf: 'greek', lang: 'grc',
    text: 'καὶ γὰρ πᾶν τὸ δαιμόνιον μεταξύ ἐστι θεοῦ τε καὶ θνητοῦ. δαίμων μέγας', src: 'perseus-grc' },
  { id: 'hbo.Gen.6.4', ref: 'Gen 6:4', work: 'Hebrew Bible — Genesis', shelf: 'hebrew', lang: 'hbo',
    text: 'הַנְּפִלִ֞ים הָי֣וּ בָאָרֶץ֮ בַּיָּמִ֣ים הָהֵם֒', tr: 'The Nephilim were on the earth in those days', tr_lang: 'en',
    tr_src: 'bsb', tr_label: 'English: Berean Standard Bible', src: 'wlc', aliases: ['Gen 6:4', 'Genesis 6:4', 'Gen.6.4'] },
  { id: 'lxx.Gen.6.4', ref: 'LXX Gen 6:4', work: 'Septuagint (Swete) — Genesis', shelf: 'greek', lang: 'grc',
    text: 'οἱ δὲ γίγαντες ἦσαν ἐπὶ τῆς γῆς ἐν ταῖς ἡμέραις ἐκείναις', src: 'lxx-swete', aliases: ['LXX Gen 6:4', 'Gen 6:4'] },
  { id: 'quran.55.15', ref: "Qur'an 55:15", work: "The Qur'an", shelf: 'arabic', lang: 'ar', text: 'وَخَلَقَ ٱلْجَآنَّ مِن مَّارِجٍ مِّن نَّارٍ',
    tr: 'And the jinn did He create of smokeless fire.', tr_lang: 'en', tr_src: 'pickthall', src: 'tanzil', aliases: ["Qur'an 55:15", 'Quran 55:15'] },
  { id: 'tla.ee18.7', ref: 'TLA Earlier Egyptian #7', work: 'Thesaurus Linguae Aegyptiae — Earlier Egyptian', shelf: 'egyptian', lang: 'egy',
    text: '𓇅𓏏𓆗\nwꜣḏ.t nb.t pr-nsr', tr: 'Wadjet, Herrin des Per-neser.', tr_lang: 'de', tr_src: 'tla', tr_label: 'German (TLA translation)', src: 'tla' },
  { id: 'dcs.1', ref: 'Ṛgveda 1.1 (DCS s.1)', work: 'Ṛgveda', shelf: 'sanskrit', lang: 'sa', text: 'agnim īḍe purohitam yajñasya devam ṛtvijam', src: 'dcs',
    aliases: ['ṚV 1.1'] },
  { id: 'dcs.2', ref: 'Śivapurāṇa 1.1 (DCS s.1)', work: 'Śivapurāṇa', shelf: 'sanskrit', lang: 'sa', text: 'namaḥ śivāya', src: 'dcs' },
  { id: 'oracc.x.P1.0', ref: 'P1 o 1 – o 3', work: 'ORACC test P1', shelf: 'cuneiform', lang: 'akk', text: 'a-na LUGAL be-li₂-ia\n{d}AG u {d}AMAR.UTU',
    gloss: 'ana to šarru king bēlu lord Nabu Marduk', src: 'oracc:cc0' },
  { id: 'dup.1', ref: 'X 1', work: '<script>alert(1)</script>', shelf: 'greek', lang: 'grc', text: 'δαίμων δαίμων', src: 'perseus-grc' },
];
const SOURCES = {
  'perseus-grc': { name: 'Perseus canonical-greekLit', license: 'CC BY-SA 4.0', license_url: 'https://creativecommons.org/licenses/by-sa/4.0/' },
  wlc: { name: 'Westminster Leningrad Codex', license: 'Public domain' },
  tanzil: { name: 'Tanzil Quran Text', license: 'CC BY 3.0 (verbatim copies only)' },
  tla: { name: 'Thesaurus Linguae Aegyptiae', license: 'CC BY-SA 4.0' },
  pickthall: { name: 'Pickthall (1930)', license: 'Public domain' },
};

let dir;
before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'shelves-'));
  await buildIndex(FIXTURE, join(dir, 'idx'), { sources: SOURCES, parts: 2 });
  process.env.SACRED_SHELVES_DIR = join(dir, 'idx');
  __reset();
});
after(() => { rmSync(dir, { recursive: true, force: true }); delete process.env.SACRED_SHELVES_DIR; __reset(); });

test('greekKey transliterates the way people type Greek', () => {
  assert.equal(greekKey('ἐγρήγοροι'), 'egregoroi');
  assert.equal(greekKey('δαίμων'), 'daimon');
  assert.equal(greekKey('Θεία'), 'theia');
  assert.equal(greekKey('Ἑρμῆς'), 'hermes');
  assert.equal(greekKey('ἄγγελος'), 'angelos');
});

test('latinKey folds IAST and Egyptological letters', () => {
  assert.equal(latinKey('ṛgveda'), 'rigueda');     // v→u fold is symmetric: the query "rigveda" folds the same way
  assert.equal(latinKey('rigveda'), 'rigueda');
  assert.equal(latinKey('śiva'), latinKey('shiva'));
  assert.equal(skeleton('wꜣḏt'), skeleton('Wadjet'));
  assert.equal(skeleton('hnplym'), skeleton('nephilim'));
});

test('normRef makes citations comparable', () => {
  assert.equal(normRef("Qur'an 55:15"), 'quran55.15');
  assert.equal(normRef('Iliad 18.417–420'), 'iliad18.417-420');
  assert.equal(normRef('Gen 6:4'), normRef('gen 6.4'));
});

test('keysFor skips hieroglyph signs but indexes the transliteration', () => {
  const ks = keysFor('𓇅𓏏𓆗\nwꜣḏ.t nb.t', { lang: 'egy' }).map((x) => x.k);
  assert.ok(ks.includes('wadit'), ks.join(','));
  assert.ok(!ks.some((k) => /[\u{13000}-\u{1342f}]/u.test(k)));
});

test('available() and stats() report the fixture', () => {
  assert.equal(available(), true);
  const s = stats();
  assert.equal(s.ok, true);
  assert.equal(s.N, FIXTURE.length);
  assert.equal(s.langs.grc, 6);
});

test('transliterated queries find the original-language line', () => {
  assert.equal(searchShelves('egregoroi')[0].id, 'tlg1463.tlg001:6.1');
  assert.equal(searchShelves('Theia')[0].id, 'tlg0020.tlg001:135-139');
  assert.ok(searchShelves('daimon').some((r) => r.id === 'tlg0059.tlg011:202e'));
  assert.equal(searchShelves('Wadjet')[0].id, 'tla.ee18.7');
  assert.equal(searchShelves('rigveda agni')[0].id, 'dcs.1');
  assert.equal(searchShelves('namah shivaya')[0].id, 'dcs.2');
  assert.equal(searchShelves('Marduk king')[0].id, 'oracc.x.P1.0');
});

test('native-script queries work too', () => {
  assert.equal(searchShelves('ἐγρήγοροι')[0].id, 'tlg1463.tlg001:6.1');
  assert.equal(searchShelves('נפלים')[0].id, 'hbo.Gen.6.4');
  assert.equal(searchShelves('الجان')[0].id, 'quran.55.15');
});

test('results carry original, translation (with language) and licence', () => {
  const r = searchShelves('jinn smokeless fire')[0];
  assert.equal(r.id, 'quran.55.15');
  assert.equal(r.ref, "Qur'an 55:15");
  assert.match(r.text, /ٱلْجَآنَّ/);
  assert.equal(r.translation_lang, 'en');
  assert.equal(r.source.license, 'CC BY 3.0 (verbatim copies only)');
  assert.equal(r.translation_source.name, 'Pickthall (1930)');
  const eg = searchShelves('Wadjet')[0];
  assert.equal(eg.translation_lang, 'de');
});

test('langs filter and perWork cap', () => {
  const r = searchShelves('Nephilim giants', { langs: ['hbo'] });
  assert.ok(r.length >= 1 && r.every((x) => x.lang === 'hbo'));
  assert.deepEqual(searchShelves('daimon', { langs: ['xx'] }), []);
  assert.ok(searchShelves('daimon', { perWork: 1, limit: 10 }).length <= 3);
});

test('getPassage resolves canonical references, ids, line-in-range and ranges', () => {
  const g = getPassage('Gen 6:4');
  assert.equal(getPassage('Genesis 6:4').passage.id, 'hbo.Gen.6.4');
  assert.equal(g.passage.id, 'hbo.Gen.6.4');
  assert.ok(g.alternates.some((a) => a.id === 'lxx.Gen.6.4'));
  assert.equal(getPassage('Iliad 18.418').passage.id, 'tlg0012.tlg001:18.417-420');
  assert.equal(getPassage('Iliad 18.417–420').passage.id, 'tlg0012.tlg001:18.417-420');
  assert.equal(getPassage("Qur'an 55:15").passage.id, 'quran.55.15');
  assert.equal(getPassage('quran.55.15').passage.id, 'quran.55.15');
  assert.equal(getPassage('urn:cts:greekLit:tlg0012.tlg001.perseus-grc2:18.417-420').passage.id, 'tlg0012.tlg001:18.417-420');
  assert.equal(getPassage('Nowhere 9:9'), null);
  assert.equal(getPassage(''), null);
  assert.equal(passageAt(0).id, FIXTURE[0].id);
  assert.equal(passageAt(999), null);
});

test('soft-fails to empty when the index is missing', () => {
  process.env.SACRED_SHELVES_DIR = join(dir, 'nope');
  __reset();
  assert.equal(available(), false);
  assert.deepEqual(searchShelves('daimon'), []);
  assert.equal(getPassage('Gen 6:4'), null);
  assert.equal(stats().ok, false);
  process.env.SACRED_SHELVES_DIR = join(dir, 'idx');
  __reset();
});

test('English plural and Latinised Greek spellings fold together', () => {
  assert.equal(latinKey('handmaids'), latinKey('handmaid'));
  assert.equal(latinKey('Watchers'), latinKey('watcher'));
  assert.equal(latinKey('Hermes'), 'hermes');
  assert.equal(latinKey('Hephaestus'), greekKey('Ἥφαιστος').replace(/os$/, 'us'));
  assert.equal(normRef('Ṛgveda 10.81'), normRef('Rigveda 10.81'));
});
