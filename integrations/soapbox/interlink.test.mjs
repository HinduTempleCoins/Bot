// The whole point of this module is that links exist and point somewhere real. The tests are about
// that, and about the two directions never disagreeing.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOARD_LINKS, boardsForCategory, boardsForArticle, relatedForBoard,
  renderForumRelated, renderWikiRelated, allTargets, wikiCategoryUrl, wikiArticleUrl, boardUrl,
  articleTitle, boardTitle,
} from './interlink.mjs';

// The wiki's real category ids, from its live sitemap.
const WIKI_CATEGORIES = ['start', 'chains', 'entrainment', 'substances', 'plants', 'religion', 'people', 'verticals', 'other'];

test('⭐ every wiki category referenced actually exists on the wiki', () => {
  // A category that has been renamed produces a dead link on every board that names it, which is
  // worse than no link at all.
  for (const [board, v] of Object.entries(BOARD_LINKS)) {
    for (const c of v.wikiCategories || []) {
      assert.ok(WIKI_CATEGORIES.includes(c), `board ${board} points at unknown wiki category "${c}"`);
    }
  }
});

test('the two directions agree — a board that names a category is reachable from it', () => {
  for (const [board, v] of Object.entries(BOARD_LINKS)) {
    for (const c of v.wikiCategories || []) {
      assert.ok(boardsForCategory(c).includes(board), `${c} should lead back to ${board}`);
    }
    for (const a of v.wikiArticles || []) {
      assert.ok(boardsForArticle(a).includes(board), `${a} should lead back to ${board}`);
    }
  }
});

test('unknown ids degrade to empty, never to a broken render', () => {
  assert.deepEqual(boardsForCategory('nope'), []);
  assert.deepEqual(boardsForCategory(''), []);
  assert.deepEqual(boardsForArticle(undefined), []);
  assert.deepEqual(relatedForBoard('nope'), { categories: [], articles: [], apps: [] });
  assert.equal(renderForumRelated('nope'), '');
  assert.equal(renderWikiRelated({ categoryId: 'nope' }), '');
  assert.equal(renderWikiRelated({}), '');
});

test('a forum board renders both halves: read it, and use it', () => {
  const html = renderForumRelated('library');
  assert.match(html, /Read up on this/);
  assert.match(html, /Use it/);
  assert.match(html, /wiki\.soapbox\.community\/category\/substances/);
  assert.match(html, /plate\.soapbox\.community/);
});

test('a wiki category sends the reader to every board that discusses it', () => {
  const html = renderWikiRelated({ categoryId: 'chains' });
  assert.match(html, /Discuss this on the forum/);
  for (const b of boardsForCategory('chains')) {
    assert.ok(html.includes(boardUrl(b)), `missing link to ${b}`);
  }
  assert.match(html, /peer-awarded merit/);
});

test('a nested board id survives URL building', () => {
  assert.equal(boardUrl('crypto/melek'), 'https://forum.soapbox.community/b/crypto/melek');
  assert.match(renderWikiRelated({ categoryId: 'chains' }), /\/b\/crypto\/melek/);
});

test('every app link is https and points at a real host, never localhost', () => {
  for (const [board, v] of Object.entries(BOARD_LINKS)) {
    for (const a of v.apps || []) {
      assert.match(a.url, /^https:\/\//, `${board}: ${a.name} must be https`);
      assert.ok(!/localhost|127\.0\.0\.1/.test(a.url), `${board}: ${a.name} points at localhost`);
      assert.ok(a.name && a.why, `${board}: ${a.name} needs a name and a reason`);
    }
  }
});

test('hostile ids are escaped, not reflected', () => {
  const html = renderWikiRelated({ categoryId: 'chains' }) + renderForumRelated('library');
  assert.ok(!html.includes('<script>'), 'no raw script');
  assert.match(wikiArticleUrl('a b<script>'), /%3Cscript%3E/);
});

test('titles are humanised from slugs', () => {
  assert.equal(articleTitle('Cannabis_Harm_Reduction'), 'Cannabis Harm Reduction');
  assert.equal(boardTitle('crypto/melek'), 'Melek');
  assert.equal(boardTitle('scam-alert'), 'Scam Alert');
});

test('allTargets lists every link for a dead-link sweep', () => {
  const t = allTargets();
  assert.ok(t.length > 20, `expected a real link set, got ${t.length}`);
  for (const u of t) assert.match(u, /^https:\/\//, `${u} must be absolute https`);
  assert.equal(new Set(t).size, t.length, 'no duplicates');
});
