import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, ITEMS, byCategory, getItem, ingestableTexts, search } from './crowd-strategy-catalog.mjs';

test('catalog has the 5 shelves and real items', () => {
  assert.equal(CATEGORIES.length, 5);
  assert.ok(ITEMS.length >= 12);
  assert.ok(byCategory('strategy').some((x) => /Sun Tzu/.test(x.title)));
  assert.ok(byCategory('civil-resistance').some((x) => /Sharp/.test(x.title)));
});

test('ingestable public-domain texts have gutenberg sources', () => {
  const t = ingestableTexts();
  assert.ok(t.length >= 3);
  assert.ok(t.every((x) => /gutenberg\.org\/ebooks\/\d+/.test(x.source.gutenberg)));
  assert.ok(t.some((x) => x.id === 'art-of-war-sunzi'));
});

test('search + getItem', () => {
  assert.ok(search('nonviolent protest methods').some((x) => x.id === 'sharp-198'));
  assert.equal(getItem('csrnet').kind, 'model');
  assert.equal(getItem('nope'), null);
});
