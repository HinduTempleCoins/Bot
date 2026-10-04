// Offline. Checks the announcement against the repo's own article files and category list, so a link that
// would 404 on the live wiki fails here first. No network.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TITLE, BODY, PERMLINK, CATEGORY_LINKS, ARTICLE_FLOOR } from './hathor-wiki-announcement.mjs';
import { slugify } from '../site/wiki/render.mjs';
import { CATEGORIES } from '../site/wiki/categories.mjs';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PRIVATE = /(_private|secret|operator|\.local|scripture)/i;

const liveSlugs = new Set();
for (const d of ['articles', 'seed-articles']) {
  let files = [];
  try { files = fs.readdirSync(path.join(__dir, '..', 'site', 'wiki', d)); } catch { continue; }
  for (const f of files) if (f.endsWith('.wiki') && !PRIVATE.test(f)) liveSlugs.add(slugify(f));
}

const articleLinks = [...BODY.matchAll(/wiki\.soapbox\.community\/wiki\/([^)\s]+)/g)].map((m) => m[1]);
const categoryLinks = [...BODY.matchAll(/wiki\.soapbox\.community\/category\/([a-z-]+)/g)].map((m) => m[1]);

test('every article the announcement links to is a real article in the library', () => {
  assert.ok(liveSlugs.size >= 245, `expected the library to be loaded, got ${liveSlugs.size}`);
  assert.ok(articleLinks.length >= 25, `expected a real tour, got ${articleLinks.length} article links`);
  for (const slug of articleLinks) assert.ok(liveSlugs.has(slug), `announcement links a missing article: ${slug}`);
});

test('every subject category is linked, and every link is a real category', () => {
  const ids = new Set(CATEGORIES.map((c) => c.id));
  for (const id of categoryLinks) assert.ok(ids.has(id), `announcement links a missing category: ${id}`);
  for (const [id] of CATEGORY_LINKS) {
    assert.ok(ids.has(id), `CATEGORY_LINKS names a missing category: ${id}`);
    assert.ok(BODY.includes(`/category/${id})`), `category ${id} is declared but never linked`);
  }
  // nothing on the live wiki may be left out of the announcement
  for (const id of ids) assert.ok(CATEGORY_LINKS.some(([x]) => x === id), `category ${id} is not announced`);
});

test('the Autodidacts article is the first one a reader is sent to', () => {
  assert.equal(articleLinks[0], 'Autodidacts_and_Credentials');
  assert.match(BODY, /read this one first/);
});

test('the STEEM/HIVE/BLURT/MELEK/VKBT/CURE matrix is linked AND described', () => {
  assert.ok(articleLinks.includes('The_STEEM_HIVE_BLURT_MELEK_VKBT_and_CURE_Matrix'), 'the matrix page must be linked');
  // a bare link is not what was asked for — the post has to say what is in it
  assert.match(BODY, /the Specs/);
  assert.match(BODY, /how the\s*\n?\s*position was acquired/);
  assert.match(BODY, /purchased at market/i);
  assert.match(BODY, /given away through curation/i);
  assert.match(BODY, /a coin has a chain, a token is on one/);
});

test('Witness School is named and tied to the library', () => {
  assert.ok(articleLinks.includes('Witness_School'));
  assert.match(BODY, /witness\.melek\.salon/);
  assert.match(BODY, /every lesson sends you to the article/);
});

test('⭐ the post does NOT claim the wiki pays writers today', () => {
  // The intention is stated; a live payout is not. If this ever flips, it is a false earnings claim.
  assert.match(BODY, /We intend to pay the writers/);
  assert.match(BODY, /there is no contributor\s*\n?\s*payout running today/);
  assert.doesNotMatch(BODY, /we pay (our )?writers\b/i);
  assert.doesNotMatch(BODY, /get paid (today|now)\b/i);
});

test('⭐ the stated article count never overstates what is in the library', () => {
  assert.ok(ARTICLE_FLOOR <= liveSlugs.size,
    `the post claims more than ${ARTICLE_FLOOR} articles but the library holds ${liveSlugs.size}`);
  assert.ok(ARTICLE_FLOOR >= 250, 'the floor has fallen far behind the library — raise it');
  assert.ok(BODY.includes(`more than ${ARTICLE_FLOOR} articles`), 'the body must state the floor it exports');
  assert.match(BODY, /13 subject\s*\n?\s*categories/);
  assert.equal(CATEGORY_LINKS.length, 13);
});

test('it asks for other writers and states the sourcing standard', () => {
  assert.match(BODY, /it is not meant to be mine/);
  assert.match(BODY, /Show your sources/);
  assert.match(BODY, /established.*preclinical.*guess/s);
});

test('the post is well-formed: title, permlink, no unbalanced link syntax, no placeholders', () => {
  assert.match(TITLE, /Library of Ashurbanipal/);
  assert.match(PERMLINK, /^[a-z0-9-]+$/);
  assert.equal((BODY.match(/\[/g) || []).length, (BODY.match(/\]/g) || []).length);
  assert.doesNotMatch(BODY, /\{[a-z_]+\}|undefined|\[object/i);
  assert.ok(BODY.length > 3000 && BODY.length < 20000, `body length ${BODY.length}`);
});
