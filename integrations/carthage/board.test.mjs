// board.test.mjs — fully offline. No network, no corpus; pure board arithmetic and persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  COLUMNS, WORDS_PER_POINT, WORDS_PER_PARAGRAPH, MAX_POINTS, SIZES,
  estimateExpansion, makeCard, newBoard, upsertCard, moveCard, totals,
  nextCard, loadBoard, saveBoard, renderBoard,
} from './board.mjs';

function tmpdir() { return fs.mkdtempSync(path.join(os.tmpdir(), 'carthage-board-')); }

test('the board speaks metatron, exactly', () => {
  // pentecaust/metatron.mjs: var COLS=['Backlog','Writing','Review','Done'];
  assert.deepEqual([...COLUMNS], ['Backlog', 'Writing', 'Review', 'Done']);
  // pentecaust/metatron.mjs: "1 story point ≈ 500 words"
  assert.equal(WORDS_PER_POINT, 500);
  // pentecaust/metatron.mjs: <input id=pts type=number min=1 max=13>
  assert.equal(MAX_POINTS, 13);
});

test('estimateExpansion uses the guides\' default 5-7 paragraph band', () => {
  const e = estimateExpansion({ text: 'Nabta Playa' });
  assert.equal(e.size, 'normal');
  assert.equal(e.minParagraphs, 5);
  assert.equal(e.maxParagraphs, 7);
  assert.equal(e.paragraphs, 6);
  assert.equal(e.words, 6 * WORDS_PER_PARAGRAPH);          // 900
  assert.equal(e.points, Math.round(900 / WORDS_PER_POINT)); // 2
});

test('estimateExpansion uses the 10-12 band for the items Part 2 names', () => {
  for (const label of ['Job Verses', 'Sacred Tales', 'Lord of the Animals',
    'Suit of Diamonds and Chalices, as well as the Holy Grail', 'Sasha Shulgin Psuedo-Nut quote',
    'Splendor Solis images']) {
    const e = estimateExpansion({ text: label });
    assert.equal(e.size, 'heavy', `${label} should be a heavy item`);
    assert.equal(e.minParagraphs, SIZES.heavy.min);
    assert.equal(e.maxParagraphs, SIZES.heavy.max);
    assert.equal(e.paragraphs, 11);
    assert.equal(e.points, 3);                               // 11 * 150 = 1650 → 3 pts
  }
});

test('estimateExpansion uses the 15-25 band for list bulletpoints', () => {
  const e = estimateExpansion({ text: 'Mt. Hermon, Gabriel, Michael, Raphael, Azazul, etc' });
  assert.equal(e.size, 'list');
  assert.equal(e.paragraphs, 20);
  assert.equal(e.words, 3000);
  assert.equal(e.points, 6);
});

test('points are clamped into metatron\'s 1..13 range', () => {
  const e = estimateExpansion({ text: 'a, b, c, d, e, f, g, etc' });
  assert.ok(e.points >= 1 && e.points <= MAX_POINTS);
  assert.equal(estimateExpansion({}).points >= 1, true);
});

test('makeCard produces a card metatron would accept', () => {
  const c = makeCard({ id: 'B1-L1483', text: 'Book of Tobit Jesus Fish', bookNumber: 1, line: 1483 });
  assert.equal(typeof c.text, 'string');
  assert.equal(Number.isInteger(c.pts), true);
  assert.equal(c.col, 0);
  assert.equal(c.column, 'Backlog');
  assert.equal(c.book, 1);
  assert.equal(c.dossier, null);
});

test('upsertCard is idempotent and never resets human progress', () => {
  let b = newBoard();
  const card = makeCard({ id: 'B1-L1', text: 'Nut and Geb', bookNumber: 1, line: 1 });
  b = upsertCard(b, card);
  b = upsertCard(b, card);
  assert.equal(b.cards.length, 1, 'the same id must not create a second card');

  b = moveCard(b, 'B1-L1', 'Writing');
  assert.equal(b.cards[0].col, 1);

  // a re-parse re-upserts the card; the column and the dossier survive
  b = upsertCard(b, { ...card, dossier: '/data/carthage/dossiers/B1-L1.json' });
  assert.equal(b.cards[0].col, 1, 'Writing must survive a re-run');
  assert.equal(b.cards[0].column, 'Writing');
  b = upsertCard(b, card);
  assert.equal(b.cards[0].dossier, '/data/carthage/dossiers/B1-L1.json', 'dossier link must survive');
});

test('moveCard ignores unknown cards and unknown columns', () => {
  let b = upsertCard(newBoard(), makeCard({ id: 'X', text: 'x' }));
  b = moveCard(b, 'nope', 'Done');
  assert.equal(b.cards[0].col, 0);
  b = moveCard(b, 'X', 'Nowhere');
  assert.equal(b.cards[0].col, 0);
  b = moveCard(b, 'X', 3);
  assert.equal(b.cards[0].column, 'Done');
});

test('totals adds up points, words and paragraphs across columns and books', () => {
  let b = newBoard();
  b = upsertCard(b, makeCard({ id: 'A', text: 'Nabta Playa', bookNumber: 1 }));            // 2 pts
  b = upsertCard(b, makeCard({ id: 'B', text: 'Sacred Tales', bookNumber: 1 }));            // 3 pts
  b = upsertCard(b, makeCard({ id: 'C', text: 'Berber, Libyan, Punic Gods, etc', bookNumber: 7 })); // 6 pts
  const t = totals(b);
  assert.equal(t.cards, 3);
  assert.equal(t.points, 2 + 3 + 6);
  assert.equal(t.words, 900 + 1650 + 3000);
  assert.equal(t.paragraphs, 6 + 11 + 20);
  assert.equal(t.byBook['Book 1'].cards, 2);
  assert.equal(t.byBook['Book 7'].points, 6);
  assert.equal(t.byColumn.Backlog.points, 11);
  assert.equal(t.remainingPoints, 11);

  b = moveCard(b, 'A', 'Done');
  assert.equal(totals(b).remainingPoints, 9, 'Done no longer counts as remaining');
});

test('nextCard pulls inventoried work first, in book then line order', () => {
  let b = newBoard();
  b = upsertCard(b, { ...makeCard({ id: 'late', text: 'Bes', bookNumber: 13, line: 9 }), confidence: 'inventoried', dossier: 'd' });
  b = upsertCard(b, { ...makeCard({ id: 'early', text: 'Ra', bookNumber: 1, line: 5 }), confidence: 'inventoried', dossier: 'd' });
  b = upsertCard(b, { ...makeCard({ id: 'guess', text: 'Abraxas', bookNumber: 1, line: 1 }), confidence: 'strong', dossier: 'd' });
  assert.equal(nextCard(b).id, 'early');
  // a card with no dossier is not ready for the drafting bot
  let c = upsertCard(newBoard(), { ...makeCard({ id: 'x', text: 'x' }), confidence: 'inventoried' });
  assert.equal(nextCard(c), null);
  assert.equal(nextCard(c, { requireDossier: false }).id, 'x');
});

test('save/load round-trips and loadBoard soft-fails to an empty board', () => {
  const dir = tmpdir();
  const file = path.join(dir, 'board.json');
  let b = upsertCard(newBoard(), makeCard({ id: 'B1-L1', text: 'Ra', bookNumber: 1 }));
  b = moveCard(b, 'B1-L1', 'Review');
  assert.equal(saveBoard(b, file).ok, true);

  const back = loadBoard(file);
  assert.equal(back.cards.length, 1);
  assert.equal(back.cards[0].column, 'Review');

  assert.deepEqual(loadBoard(path.join(dir, 'nope.json')).cards, []);
  fs.writeFileSync(file, 'not json');
  assert.deepEqual(loadBoard(file).cards, []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('saveBoard soft-fails on a bad path instead of throwing', () => {
  const r = saveBoard(newBoard(), null);
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('renderBoard escapes everything it interpolates', () => {
  const b = upsertCard(newBoard(), makeCard({ id: 'B1-L1', text: '<script>alert(1)</script>', bookNumber: 1 }));
  const out = renderBoard(b);
  assert.ok(out.includes('&lt;script&gt;'));
  assert.ok(!out.includes('<script>'));
  for (const col of COLUMNS) assert.ok(out.includes(col));
});

test('board functions tolerate garbage input', () => {
  assert.deepEqual(upsertCard(null, null).cards, []);
  assert.deepEqual(totals(undefined).cards, 0);
  assert.equal(nextCard(null), null);
  assert.equal(typeof renderBoard('nonsense'), 'string');
});
