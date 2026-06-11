import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify,
  permalink,
  bumpVersion,
  isValidPermlink,
  esc,
} from './permlink.mjs';

// ---- slugify: basic folding ------------------------------------------------

test('slugify lowercases and hyphenates words', () => {
  assert.equal(slugify('Hello MELEK World'), 'hello-melek-world');
});

test('slugify collapses punctuation/whitespace runs to single hyphen', () => {
  assert.equal(slugify('  foo   ---   bar!!!  '), 'foo-bar');
  assert.equal(slugify('a, b. c'), 'a-b-c');
});

test('slugify trims leading/trailing hyphens, no doubles', () => {
  const s = slugify('---Witness, Hathor!---');
  assert.equal(s, 'witness-hathor');
  assert.ok(!s.startsWith('-') && !s.endsWith('-'));
  assert.ok(!s.includes('--'));
});

test('slugify ASCII-folds diacritics', () => {
  assert.equal(slugify('Café déjà vu résumé'), 'cafe-deja-vu-resume');
  assert.equal(slugify('Žižek über Ñoño'), 'zizek-uber-nono');
});

test('slugify strips emoji and other unicode entirely', () => {
  assert.equal(slugify('launch 🚀 day 🎉'), 'launch-day');
  assert.equal(slugify('🔥🔥🔥'), '');
  // CJK has no a-z0-9 mapping -> stripped
  assert.equal(slugify('東京 tokyo'), 'tokyo');
});

test('slugify clamps to 256 chars and never ends in a hyphen', () => {
  const long = 'word '.repeat(200); // far over 256
  const s = slugify(long);
  assert.ok(s.length <= 256);
  assert.ok(!s.endsWith('-'));
  assert.ok(isValidPermlink(s));
});

test('slugify soft-fails on bad input', () => {
  assert.equal(slugify(''), '');
  assert.equal(slugify(null), '');
  assert.equal(slugify(undefined), '');
  assert.equal(slugify({}), '');
  assert.equal(slugify([]), '');
  assert.equal(slugify('!!!'), '');
  assert.equal(slugify(42), '42'); // finite number coerces
});

// ---- isValidPermlink -------------------------------------------------------

test('isValidPermlink accepts legal permlinks', () => {
  assert.ok(isValidPermlink('hello'));
  assert.ok(isValidPermlink('hello-melek-world'));
  assert.ok(isValidPermlink('a1-b2-c3'));
  assert.ok(isValidPermlink('2026-06-10-intro-v2'));
});

test('isValidPermlink rejects illegal permlinks', () => {
  assert.ok(!isValidPermlink('Hello'));        // uppercase
  assert.ok(!isValidPermlink('-lead'));         // leading hyphen
  assert.ok(!isValidPermlink('trail-'));        // trailing hyphen
  assert.ok(!isValidPermlink('double--hyphen'));// double hyphen
  assert.ok(!isValidPermlink('has space'));     // space
  assert.ok(!isValidPermlink('under_score'));   // underscore not allowed
  assert.ok(!isValidPermlink(''));              // empty
  assert.ok(!isValidPermlink('a'.repeat(257))); // too long
});

test('isValidPermlink soft-fails on non-string', () => {
  assert.equal(isValidPermlink(null), false);
  assert.equal(isValidPermlink(undefined), false);
  assert.equal(isValidPermlink({}), false);
});

test('slugify output is always a valid permlink (or empty)', () => {
  for (const t of ['Hello World', 'Café 🚀!!!', '---x---', 'A B C', 'a'.repeat(500)]) {
    const s = slugify(t);
    if (s) assert.ok(isValidPermlink(s), `expected valid permlink for ${JSON.stringify(t)}, got ${s}`);
  }
});

// ---- bumpVersion -----------------------------------------------------------

test('bumpVersion adds v2 when no version present', () => {
  assert.equal(bumpVersion('my-post'), 'my-post-v2');
});

test('bumpVersion increments existing version', () => {
  assert.equal(bumpVersion('my-post-v2'), 'my-post-v3');
  assert.equal(bumpVersion('my-post-v9'), 'my-post-v10');
  assert.equal(bumpVersion('my-post-v99'), 'my-post-v100');
});

test('bumpVersion is monotonic across repeated application', () => {
  let p = 'intro';
  p = bumpVersion(p); // intro-v2
  p = bumpVersion(p); // intro-v3
  p = bumpVersion(p); // intro-v4
  assert.equal(p, 'intro-v4');
  // each step strictly increases the parsed N
  assert.ok(isValidPermlink(p));
});

test('bumpVersion handles a bare version token', () => {
  assert.equal(bumpVersion('v3'), 'v4');
});

test('bumpVersion does not treat non-version trailing digits as a version', () => {
  // 'post-2' has no '-vN' marker; it is just a base -> implicit v2
  assert.equal(bumpVersion('post-2'), 'post-2-v2');
});

test('bumpVersion clamps to 256 chars', () => {
  const base = 'a'.repeat(256);
  const out = bumpVersion(base);
  assert.ok(out.length <= 256);
  assert.ok(out.endsWith('-v2'));
  assert.ok(isValidPermlink(out));
});

test('bumpVersion soft-fails on bad input', () => {
  assert.equal(bumpVersion(''), '');
  assert.equal(bumpVersion(null), '');
  assert.equal(bumpVersion(undefined), '');
  assert.equal(bumpVersion({}), '');
});

// ---- permalink -------------------------------------------------------------

test('permalink with just a title returns the slug', () => {
  assert.equal(permalink({ title: 'Hello MELEK' }), 'hello-melek');
});

test('permalink omits suffix for version < 2', () => {
  assert.equal(permalink({ title: 'Intro', version: 1 }), 'intro');
  assert.equal(permalink({ title: 'Intro', version: 0 }), 'intro');
  assert.equal(permalink({ title: 'Intro' }), 'intro');
});

test('permalink appends -vN for version >= 2', () => {
  assert.equal(permalink({ title: 'My Title', version: 2 }), 'my-title-v2');
  assert.equal(permalink({ title: 'My Title', version: 5 }), 'my-title-v5');
});

test('permalink date-prefixes from string or Date', () => {
  assert.equal(permalink({ title: 'Intro', date: '2026-06-10' }), '2026-06-10-intro');
  const d = new Date('2026-06-10T12:00:00Z');
  assert.equal(permalink({ title: 'Intro', date: d }), '2026-06-10-intro');
});

test('permalink combines date prefix and version suffix', () => {
  assert.equal(
    permalink({ title: 'Witness Report', date: '2026-06-10', version: 3 }),
    '2026-06-10-witness-report-v3'
  );
});

test('permalink ignores bad date silently', () => {
  assert.equal(permalink({ title: 'Intro', date: 'not-a-date' }), 'intro');
  assert.equal(permalink({ title: 'Intro', date: 12345 }), 'intro');
  assert.equal(permalink({ title: 'Intro', date: new Date('bad') }), 'intro');
});

test('permalink output is always valid or empty', () => {
  for (const spec of [
    { title: 'Hello 🚀', version: 2, date: '2026-06-10' },
    { title: 'a'.repeat(500), version: 4 },
    { title: 'Café', version: 12 },
  ]) {
    const p = permalink(spec);
    if (p) assert.ok(isValidPermlink(p), `expected valid for ${JSON.stringify(spec)}, got ${p}`);
  }
});

test('permalink soft-fails on bad input', () => {
  assert.equal(permalink({ title: '' }), '');
  assert.equal(permalink({ title: '🔥' }), '');
  assert.equal(permalink({}), '');
  assert.equal(permalink(null), '');
  assert.equal(permalink(undefined), '');
  assert.equal(permalink('not-an-object'), '');
});

// collision resolution: bumpVersion on a permalink yields a deterministic next
test('collision resolution is deterministic via bumpVersion', () => {
  const base = permalink({ title: 'Same Title' }); // same-title
  const v2 = bumpVersion(base);                     // same-title-v2
  const v3 = bumpVersion(v2);                        // same-title-v3
  assert.equal(base, 'same-title');
  assert.equal(v2, 'same-title-v2');
  assert.equal(v3, 'same-title-v3');
});

// ---- esc -------------------------------------------------------------------

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('esc soft-fails on non-string', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc({}), '');
  assert.equal(esc(42), '42');
});
