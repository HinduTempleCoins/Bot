// forum-mention-parse.test.mjs — offline. Covers happy paths + edge / soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findMentions,
  extractPosts,
  buildTimeline,
  toMentionRecords,
  stripTags,
  normalizeWhitespace,
  esc,
} from './forum-mention-parse.mjs';

test('stripTags removes tags, script/style, and decodes entities', () => {
  assert.equal(normalizeWhitespace(stripTags('<b>hi</b> <i>there</i>')), 'hi there');
  assert.equal(normalizeWhitespace(stripTags('a<script>evil()</script>b')), 'a b');
  assert.equal(normalizeWhitespace(stripTags('x&amp;y &lt;z&gt; &quot;q&quot; &#39;a&#39;')), 'x&y <z> "q" \'a\'');
});

test('stripTags / normalizeWhitespace soft-fail on non-strings', () => {
  assert.equal(stripTags(null), '');
  assert.equal(stripTags(42), '');
  assert.equal(normalizeWhitespace(undefined), '');
  assert.equal(normalizeWhitespace('  a\n\t b  '), 'a b');
});

test('esc escapes HTML-significant chars', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('findMentions: finds case-insensitive hits with context + index', () => {
  const text = 'Intro. The VAN kush family posted this. End.';
  const hits = findMentions(text, ['Van Kush Family'], { context: 5 });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].quote, 'VAN kush family');
  assert.equal(hits[0].term, 'Van Kush Family');
  assert.equal(typeof hits[0].index, 'number');
  assert.ok(hits[0].context.includes('VAN kush family'));
});

test('findMentions: multiple hits, multiple terms, sorted by index', () => {
  const text = 'Van Kush Family one. Then VanKush again. Van Kush Family two.';
  const hits = findMentions(text, ['Van Kush Family', 'VanKush']);
  assert.equal(hits.length, 3);
  // sorted ascending by index
  for (let i = 1; i < hits.length; i++) assert.ok(hits[i].index >= hits[i - 1].index);
});

test('findMentions: defaults to Van Kush Family and soft-fails', () => {
  const hits = findMentions('mentions the Van Kush Family here');
  assert.equal(hits.length, 1);
  assert.deepEqual(findMentions('', ['x']), []);
  assert.deepEqual(findMentions(null), []);
  assert.deepEqual(findMentions('no match here', ['Van Kush Family']), []);
  // empty/garbage terms fall back to default
  assert.equal(findMentions('Van Kush Family', []).length, 1);
  assert.equal(findMentions('Van Kush Family', 'Van Kush Family').length, 1);
});

test('extractPosts: bitcointalk container parse', () => {
  const html = `
    <td class="poster_info"><b><a href="u=1">satoshifan</a></b></td>
    <td class="td_headerandpost"><div class="smalltext">June 03, 2017, 10:15:00 AM</div>
      <div class="post">Followed the Van Kush Family threads.</div></td>`;
  const posts = extractPosts(html, { site: 'bitcointalk' });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].author, 'satoshifan');
  assert.ok(posts[0].date.includes('June 03, 2017'));
  assert.ok(posts[0].body.includes('Van Kush Family'));
});

test('extractPosts: reddit container parse', () => {
  const html = `
    <div class="comment" data-author="hempgrower" data-timestamp="2018-01-02">
      <div class="md usertext-body"><p>The Van Kush Family is worth reading.</p></div>
    </div>`;
  const posts = extractPosts(html, { site: 'reddit' });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].author, 'hempgrower');
  assert.equal(posts[0].date, '2018-01-02');
  assert.ok(posts[0].body.includes('Van Kush Family'));
});

test('extractPosts: soft-fail on bad input / unknown site', () => {
  assert.deepEqual(extractPosts(null, { site: 'reddit' }), []);
  assert.deepEqual(extractPosts('', {}), []);
  assert.deepEqual(extractPosts('<p>no containers</p>', { site: 'bitcointalk' }), []);
  // unknown site falls through to bitcointalk parser (no crash)
  assert.ok(Array.isArray(extractPosts('<div class="post">hi</div>', { site: 'whatever' })));
});

test('buildTimeline: sorts ascending by date, unparseable last, stable', () => {
  const posts = [
    { author: 'b', date: 'June 05, 2017', body: 'second post body.' },
    { author: 'a', date: 'June 03, 2017', body: 'first post body. more.' },
    { author: 'c', date: 'not-a-date', body: 'undated body' },
  ];
  const tl = buildTimeline(posts);
  assert.equal(tl.length, 3);
  assert.equal(tl[0].author, 'a');
  assert.equal(tl[1].author, 'b');
  assert.equal(tl[2].author, 'c'); // unparseable sorts last
  assert.equal(tl[1].subject, 'second post body.');
  assert.ok(typeof tl[0].snippet === 'string');
});

test('buildTimeline: soft-fail + uses provided subject', () => {
  assert.deepEqual(buildTimeline(null), []);
  assert.deepEqual(buildTimeline('nope'), []);
  const tl = buildTimeline([{ date: '', author: 'x', subject: 'Custom', body: 'b' }, null]);
  assert.equal(tl.length, 1);
  assert.equal(tl[0].subject, 'Custom');
});

test('toMentionRecords: flattens mentions with post metadata', () => {
  const posts = [
    { author: 'a', date: 'June 03, 2017', body: 'Van Kush Family content here. Good.' },
    { author: 'b', date: 'June 04, 2017', body: 'nothing relevant' },
    { author: 'c', date: 'June 05, 2017', body: 'two Van Kush Family and Van Kush Family' },
  ];
  const recs = toMentionRecords(posts, ['Van Kush Family']);
  assert.equal(recs.length, 3); // 1 + 0 + 2
  assert.equal(recs[0].author, 'a');
  assert.equal(recs[0].date, 'June 03, 2017');
  assert.equal(recs[0].term, 'Van Kush Family');
  assert.ok(recs[0].subject.length > 0);
  assert.ok(typeof recs[0].context === 'string');
  assert.ok(recs.every(r => typeof r.index === 'number'));
});

test('toMentionRecords: soft-fail on bad input', () => {
  assert.deepEqual(toMentionRecords(null), []);
  assert.deepEqual(toMentionRecords([null, 42, {}]), []);
});

test('end-to-end: extract -> records on a bitcointalk dump', () => {
  const html = `
    <td class="poster_info"><b><a href="u=1">satoshifan</a></b></td>
    <td class="td_headerandpost"><div class="smalltext">June 03, 2017, 10:15:00 AM</div>
      <div class="post">Has anyone followed the Van Kush Family threads?</div></td>
    <td class="poster_info"><b><a href="u=2">hempgrower</a></b></td>
    <td class="td_headerandpost"><div class="smalltext">June 05, 2017, 09:00:00 AM</div>
      <div class="post">The Van Kush Family work predates this.</div></td>`;
  const posts = extractPosts(html, { site: 'bitcointalk' });
  assert.equal(posts.length, 2);
  const recs = toMentionRecords(posts);
  assert.equal(recs.length, 2);
  const tl = buildTimeline(posts);
  assert.equal(tl[0].author, 'satoshifan');
});
