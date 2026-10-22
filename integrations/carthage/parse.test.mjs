// parse.test.mjs — fully offline. Reads only the committed fixture corpus; no network, no /opt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseBooks, parseInventory, extractTypeE, parseAll, loadSource, bookAt,
  normalizeLabel, matchInventory, confidenceOf, readText, esc,
} from './parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, 'fixtures', 'growth');

// The 19 books and their "or, the Book of …" second names, as they stand in the source.
const EXPECTED = [
  ['The Book of Tanit', 'the Book of the Sun and Moon'],
  ['The Book of the Tree of Life', 'the Book of the Burning Bush'],
  ['The Book of Dreams', 'the Book of Onireomancy'],
  ['The Book of the Sphynx', 'the Book of Hera'],
  ['The Book of Giants and Kings', 'the Book of Hercules'],
  ['The Book of Marilla', 'the Book of Poseidon'],
  ['The Book of Angels', 'the Book of Zoroaster'],
  ['The Book of Alexander', 'the Book of Jupiter'],
  ['The Book of Kali and Mitra', 'the Book of Kadesh'],
  ['The Book of Titans', 'the Book of Atlas'],
  ['The Book of Imhotep', 'the Book of Building'],
  ['The Book of Oracles', 'the Sibylline Book'],
  ['The Book of Jesus', 'the Book of the Phoenix; the Book of Wax'],
  ['The Book of Pan-Shiva', 'the Book of Pashupati'],
  ['The Book of Saturn', 'the Book of Anubis'],
  ['The Book of War', 'the Book of the Abrahamic Holy Land; the Book of Reshep and Min'],
  ['The Book of Gravity and Light', 'the Book of Einstein and Tesla'],
  ['The Book of Bat', 'the Book of Ancient Relativity'],
  ['The Book of the Djed', 'the Book of Ghosts'],
];

test('parseBooks finds all 19 books with their second names', () => {
  const { text } = loadSource(ROOT);
  const books = parseBooks(text);
  assert.equal(books.length, 19);
  assert.deepEqual(books.map((b) => [b.title, b.secondName]), EXPECTED);
  assert.deepEqual(books.map((b) => b.number), EXPECTED.map((_, i) => i + 1));
});

test('parseBooks catches the three headings that read "The Book of the …"', () => {
  // the naive /^\s*The Book of [A-Z]/ rule misses these; the second-name line is what makes a
  // heading a heading
  const { text } = loadSource(ROOT);
  const titles = parseBooks(text).map((b) => b.title);
  for (const t of ['The Book of the Tree of Life', 'The Book of the Sphynx', 'The Book of the Djed']) {
    assert.ok(titles.includes(t), `missing ${t}`);
  }
});

test('parseBooks does not mistake an in-book heading for a book', () => {
  const text = [
    '                       The Book of Tanit',
    '                 or, the Book of the Sun and Moon',
    '',
    'The Book of Mary Magdeline',     // flush-left, no second name → NOT a book
    '',
    'If we then look to the Westcar Papyrus, it mentions a Stroke Maiden.',
  ].join('\n');
  assert.equal(parseBooks(text).length, 1);
});

test('parseBooks gives line ranges, word counts and flags the placeholder books', () => {
  const { text } = loadSource(ROOT);
  // the fixture is a miniature, so the placeholder threshold is scaled down with it; against the
  // real source the default 500-word threshold flags exactly Titans (132 w) and Saturn (17 w).
  const books = parseBooks(text, { placeholderWords: 60 });
  for (let i = 1; i < books.length; i++) {
    assert.equal(books[i].startLine, books[i - 1].endLine + 1, 'ranges must tile without gaps');
  }
  const titans = books.find((b) => b.title === 'The Book of Titans');
  const saturn = books.find((b) => b.title === 'The Book of Saturn');
  assert.ok(titans.placeholder, 'Titans is a heading with nothing under it');
  assert.ok(saturn.placeholder, 'Saturn is a heading with nothing under it');
  assert.ok(!books[0].placeholder);
});

test('bookAt maps a line number back to its book', () => {
  const { text } = loadSource(ROOT);
  const books = parseBooks(text);
  assert.equal(bookAt(books, books[6].startLine + 1).number, 7);
  assert.equal(bookAt(books, 0), null);
});

test('parseInventory reads all 63 numbered items out of both list formats', () => {
  const guide = readText(path.join(ROOT, 'brujeria', 'Book_201_20Analysis_20Part_202.pdf.txt'));
  const inv = parseInventory(guide);
  assert.equal(inv.length, 63);
  assert.equal(inv[0].text, 'Book of Tobit Jesus Fish');     // numbered-list form
  assert.equal(inv[29].text, 'Pythia');                       // run-on prose form
  assert.equal(inv[62].text, 'Myrmidon');                     // last item, trailing aside stripped
});

test("parseInventory keeps the operator's per-item notes", () => {
  const guide = readText(path.join(ROOT, 'brujeria', 'Book_201_20Analysis_20Part_202.pdf.txt'));
  const inv = parseInventory(guide);
  const sacred = inv.find((i) => i.n === 23);
  assert.equal(sacred.text, 'Sacred Tales');
  assert.equal(sacred.note, 'looks like Header, but I need my own Words between the Quotes');
  assert.equal(inv.find((i) => i.n === 57).note, 'Describe each image');
});

test('parseInventory soft-fails on junk', () => {
  assert.deepEqual(parseInventory(''), []);
  assert.deepEqual(parseInventory(null), []);
  assert.deepEqual(parseInventory('no inventory section here'), []);
});

test('extractTypeE finds the known inventory items in the source', () => {
  const r = parseAll({ root: ROOT });
  const found = new Map(r.bulletpoints.map((b) => [b.text.replace(/,$/, ''), b]));
  for (const label of ['Book of Tobit Jesus Fish', 'Pharaoh\'s Epithets', 'The Puny Punic',
    'Sacred Tales', 'Nut and Geb', 'Splendor Solis images', 'Ashera Tree Goddess',
    'Wand, Club, Mace Culture', 'Dream Work', 'Pythia', 'Pashupati']) {
    assert.ok(found.has(label), `did not extract "${label}"`);
    assert.equal(found.get(label).kind, 'inventoried', `${label} should match the inventory`);
  }
});

test("extractTypeE carries the operator's note onto the bulletpoint", () => {
  const r = parseAll({ root: ROOT });
  const sacred = r.bulletpoints.find((b) => b.text === 'Sacred Tales');
  assert.equal(sacred.note, 'looks like Header, but I need my own Words between the Quotes');
  assert.equal(sacred.inventoryN, 23);
  // "Describe each image" is the author's note on #57, not a card of its own
  assert.equal(r.bulletpoints.filter((b) => b.text === 'Describe each image').length, 0);
  assert.equal(r.bulletpoints.find((b) => b.text === 'Splendor Solis images').note, 'Describe each image');
});

test('extractTypeE records book, line and context for every bulletpoint', () => {
  const r = parseAll({ root: ROOT });
  const tobit = r.bulletpoints.find((b) => b.text === 'Book of Tobit Jesus Fish');
  assert.equal(tobit.bookNumber, 1);
  assert.equal(tobit.bookTitle, 'The Book of Tanit');
  assert.ok(tobit.line > 0);
  assert.ok(tobit.contextBefore.length > 0 && tobit.contextAfter.length > 0);
  assert.equal(tobit.id, `B1-L${tobit.line}`);
});

test('extractTypeE keeps a bulletpoint that sits on top of its block quotation', () => {
  // the Sacred Tales case the operator called out: "looks like Header, but I need my own Words
  // between the Quotes"
  const r = parseAll({ root: ROOT });
  assert.ok(r.bulletpoints.some((b) => b.text === 'Sacred Tales'));
  assert.ok(r.bulletpoints.some((b) => b.text === 'Dream Work'));
});

test('extractTypeE rejects table rows, footnotes, recipe quantities and sign codes', () => {
  const r = parseAll({ root: ROOT });
  const texts = r.bulletpoints.map((b) => b.text);
  for (const noise of ['Mars = Tuesday', 'Mercury = Wednesday', '10 grams Beeswax',
    '40 grams Rosewater', '1. [14] Traditionally peace offering; also in verses 17 and 18']) {
    assert.ok(!texts.includes(noise), `should not have queued "${noise}"`);
  }
});

test('a wrapped verse line is kept but downgraded to weak, not queued as a card', () => {
  const r = parseAll({ root: ROOT });
  const verse = r.bulletpoints.find((b) => b.text.startsWith('He with long locks'));
  assert.ok(verse, 'the line is still reported');
  assert.equal(verse.confidence, 'weak');
});

test('confidenceOf grades labels by the guides\' "2-10 words" noun-phrase shape', () => {
  assert.equal(confidenceOf('Nabta Playa'), 'strong');
  assert.equal(confidenceOf('Thoth, Mercury'), 'strong');
  assert.equal(confidenceOf('Soma is the Hindu God of the Moon'), 'weak');   // finite verb
  assert.equal(confidenceOf('one two three four five six seven eight nine ten eleven'), 'weak');
  assert.equal(confidenceOf('anything at all', { inventoried: true }), 'inventoried');
});

test('matchInventory tolerates the operator\'s typos and punctuation', () => {
  const inv = [{ n: 21, text: 'Soma Sieve Quote', note: null }, { n: 6, text: "Pharaoh's Epithets", note: null }];
  assert.equal(matchInventory('Soma Seive quote', inv)?.n, 21);
  assert.equal(matchInventory('Pharaoh’s Epithets', inv)?.n, 6);
  assert.equal(matchInventory('Completely Unrelated Thing', inv), null);
});

test('normalizeLabel strips the PDF export junk', () => {
  assert.equal(normalizeLabel('Pharaoh’s​ Epithets'), 'pharaoh s epithets');
});

test('parseAll reports inventory coverage honestly', () => {
  const r = parseAll({ root: ROOT });
  assert.equal(r.ok, true);
  assert.equal(r.inventory.length, 63);
  assert.ok(r.coverage.located > 0 && r.coverage.located <= 63);
  assert.equal(r.coverage.located + r.coverage.missing.length, 63);
});

test('parseAll soft-fails on a missing corpus instead of throwing', () => {
  const r = parseAll({ root: path.join(HERE, 'fixtures', 'does-not-exist') });
  assert.equal(r.ok, false);
  assert.deepEqual(r.books, []);
  assert.deepEqual(r.bulletpoints, []);
  assert.ok(r.reasons.length > 0);
});

test('readText and esc never throw', () => {
  assert.equal(readText('/no/such/file/at/all'), '');
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});
