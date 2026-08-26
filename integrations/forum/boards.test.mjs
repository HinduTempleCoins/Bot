// boards.test.mjs — offline tests for the MEGA-FORUM board registry + prefix resolver. node --test, no
// network, pure/deterministic. Covers registry integrity, the prefix resolver (city/austin etc. resolve;
// junk → null), sitemap entries, determinism, and never-throws.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveBoard, isBoard, boardMeta, listCategories, listBoards, boardsByCategory,
  boardsInCategory, boardSitemapEntries, forumRegistry, seoTypeForKind,
  CATEGORIES, FLAGSHIP_BOARDS,
} from './boards.mjs';

test('registry integrity: every static board is well-formed and in a known category', () => {
  const cats = new Set(CATEGORIES.map((c) => c.id));
  const seen = new Set();
  for (const b of listBoards()) {
    assert.ok(b.id && typeof b.id === 'string', 'has id');
    assert.ok(b.title, `board ${b.id} has a title`);
    assert.ok(b.desc, `board ${b.id} has a desc`);
    assert.ok(b.kind, `board ${b.id} has a kind`);
    assert.ok(b.seoType, `board ${b.id} has a seoType`);
    assert.ok(cats.has(b.categoryId), `board ${b.id} category ${b.categoryId} is known`);
    assert.equal(b.seoType, seoTypeForKind(b.kind), `seoType matches kind for ${b.id}`);
    assert.ok(!seen.has(b.id), `board id ${b.id} is unique`);
    seen.add(b.id);
  }
});

test('the ten design categories are all present', () => {
  const ids = listCategories().map((c) => c.id).sort();
  assert.deepEqual(ids,
    ['classifieds', 'crypto', 'gaming', 'history', 'local', 'melek', 'mind', 'reviews', 'style', 'travel']);
  assert.equal(CATEGORIES.length, 10);
});

test('kind → seoType mapping is correct', () => {
  assert.equal(seoTypeForKind('discussion'), 'DiscussionForumPosting');
  assert.equal(seoTypeForKind('wiki-linkout'), 'DiscussionForumPosting');
  assert.equal(seoTypeForKind('qa'), 'QAPage');
  assert.equal(seoTypeForKind('review'), 'LocalBusiness');
  assert.equal(seoTypeForKind('classified'), 'DiscussionForumPosting');
  assert.equal(seoTypeForKind('junk'), 'DiscussionForumPosting'); // safe default
});

test('static boards resolve with the right category + shape', () => {
  const econ = resolveBoard('economy');
  assert.ok(econ);
  assert.equal(econ.id, 'economy');
  assert.equal(econ.category, 'MELEK / Ecosystem');
  assert.equal(econ.kind, 'discussion');
  assert.equal(econ.seoType, 'DiscussionForumPosting');
  assert.equal(econ.programmatic, false);

  const btc = resolveBoard('crypto/bitcoin');
  assert.ok(btc);
  assert.equal(btc.categoryId, 'crypto');
  assert.equal(btc.title, 'Bitcoin');
});

test('review + classified SEAM boards are registered with the right kind', () => {
  const rev = resolveBoard('reviews');
  assert.ok(rev);
  assert.equal(rev.kind, 'review');
  assert.equal(rev.seoType, 'LocalBusiness');

  const cls = resolveBoard('classifieds/for-sale');
  assert.ok(cls);
  assert.equal(cls.kind, 'classified');
  assert.equal(cls.categoryId, 'classifieds');
});

test('prefix resolver: city/game/travel/biz slugs resolve programmatically', () => {
  const city = resolveBoard('city/austin');
  assert.ok(city, 'city/austin resolves');
  assert.equal(city.categoryId, 'local');
  assert.equal(city.kind, 'discussion');
  assert.equal(city.seoType, 'DiscussionForumPosting');
  assert.equal(city.programmatic, true);
  assert.match(city.title, /Austin/);
  assert.match(city.desc, /Austin/); // non-thin: slug woven into the description

  const city2 = resolveBoard('city/richardson-tx');
  assert.ok(city2);
  assert.match(city2.title, /Richardson Tx/);

  const game = resolveBoard('game/minecraft');
  assert.ok(game);
  assert.equal(game.categoryId, 'gaming');
  assert.equal(game.kind, 'wiki-linkout');
  assert.equal(game.seoType, 'DiscussionForumPosting');

  const travel = resolveBoard('travel/paris');
  assert.ok(travel);
  assert.equal(travel.categoryId, 'travel');
  assert.equal(travel.kind, 'qa');
  assert.equal(travel.seoType, 'QAPage'); // qa boards get the Q&A rich-result type

  const biz = resolveBoard('biz/joes-plumbing');
  assert.ok(biz);
  assert.equal(biz.kind, 'review');
  assert.equal(biz.seoType, 'LocalBusiness');
});

test('prefix resolver: junk, empty slugs, unknown prefixes, deep paths → null', () => {
  assert.equal(resolveBoard('city/'), null);           // empty slug
  assert.equal(resolveBoard('city'), null);            // no slug at all
  assert.equal(resolveBoard('nope/foo'), null);        // unknown prefix
  assert.equal(resolveBoard('city/Austin TX'), null);  // space / uppercase
  assert.equal(resolveBoard('city/austin/extra'), null); // too deep (Phase 1)
  assert.equal(resolveBoard('city/-bad-'), null);      // leading/trailing dash
  assert.equal(resolveBoard('/'), null);
  assert.equal(resolveBoard(''), null);
  assert.equal(resolveBoard('does-not-exist'), null);
});

test('resolveBoard tolerates surrounding/leading slashes and whitespace', () => {
  assert.ok(resolveBoard(' economy '));
  assert.ok(resolveBoard('/economy'));
  assert.ok(resolveBoard('city/austin/'));
});

test('resolveBoard is deterministic (same input → deep-equal output)', () => {
  assert.deepEqual(resolveBoard('city/austin'), resolveBoard('city/austin'));
  assert.deepEqual(resolveBoard('economy'), resolveBoard('economy'));
});

test('isBoard + boardMeta agree with resolveBoard', () => {
  assert.equal(isBoard('economy'), true);
  assert.equal(isBoard('city/austin'), true);
  assert.equal(isBoard('nope/foo'), false);
  assert.equal(isBoard('city/'), false);
  assert.deepEqual(boardMeta('economy'), resolveBoard('economy'));
  assert.equal(boardMeta('nope/foo'), null);
});

test('boardsByCategory groups static boards in CATEGORIES order; every board appears once', () => {
  const groups = boardsByCategory();
  assert.ok(groups.length >= 1);
  const order = groups.map((g) => g.categoryId);
  // groups follow CATEGORIES declaration order (filtered to non-empty)
  const expected = CATEGORIES.map((c) => c.id).filter((id) => boardsInCategory(id).length);
  assert.deepEqual(order, expected);
  const flat = groups.flatMap((g) => g.boards.map((b) => b.id));
  assert.equal(new Set(flat).size, flat.length, 'no duplicate ids across groups');
  assert.equal(flat.length, listBoards().length, 'every static board grouped exactly once');
});

test('boardSitemapEntries covers categories + boards, validates extras, dedupes', () => {
  const entries = boardSitemapEntries();
  const paths = entries.map((e) => e.path);
  assert.ok(paths.includes('/b/economy'));
  assert.ok(paths.includes('/b/crypto/bitcoin'));
  assert.ok(paths.includes('/c/crypto'));
  assert.ok(entries.every((e) => e.path.startsWith('/b/') || e.path.startsWith('/c/')));

  // extras: valid programmatic boards are added; junk is dropped
  const withExtra = boardSitemapEntries({ extra: ['city/austin', 'game/minecraft', 'nope/foo', 'city/'] });
  const ep = withExtra.map((e) => e.path);
  assert.ok(ep.includes('/b/city/austin'));
  assert.ok(ep.includes('/b/game/minecraft'));
  assert.ok(!ep.includes('/b/nope/foo'));
  // no duplicates even if an extra repeats a static board
  const dupe = boardSitemapEntries({ extra: ['economy', 'economy'] });
  const econEntries = dupe.filter((e) => e.path === '/b/economy');
  assert.equal(econEntries.length, 1);
});

test('flagship boards all resolve', () => {
  for (const id of FLAGSHIP_BOARDS) assert.ok(resolveBoard(id), `flagship ${id} resolves`);
});

test('forumRegistry exposes isBoard/boardMeta/boards for forum-core injection', () => {
  const reg = forumRegistry();
  assert.equal(typeof reg.isBoard, 'function');
  assert.equal(typeof reg.boardMeta, 'function');
  assert.equal(typeof reg.boards, 'function');
  assert.equal(reg.isBoard('city/austin'), true);
  assert.ok(reg.boardMeta('economy'));
  assert.ok(Array.isArray(reg.boards()));
});

test('never throws on garbage input', () => {
  assert.doesNotThrow(() => {
    resolveBoard(null); resolveBoard(undefined); resolveBoard(42); resolveBoard({}); resolveBoard([]);
    isBoard(null); boardMeta(undefined); boardsInCategory(null); boardsInCategory(42);
    boardSitemapEntries({ extra: null }); boardSitemapEntries({ extra: [null, 42, {}] });
    boardSitemapEntries(); boardSitemapEntries(null);
    seoTypeForKind(null);
  });
});
