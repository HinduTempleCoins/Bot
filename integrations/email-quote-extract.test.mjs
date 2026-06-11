// email-quote-extract.test.mjs — offline tests for the mention quote-extractor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  DEFAULT_TERMS,
  findMentions,
  extractFromEmail,
  toRecords,
  organizeByDate,
  organizeBySubject,
  renderMarkdown,
} from './email-quote-extract.mjs';

test('DEFAULT_TERMS includes the Van Kush Family brand set', () => {
  assert.ok(Array.isArray(DEFAULT_TERMS));
  assert.ok(DEFAULT_TERMS.includes('Van Kush Family'));
  assert.ok(DEFAULT_TERMS.includes('VKBT'));
  assert.ok(DEFAULT_TERMS.includes('CURE'));
});

test('esc escapes HTML and coerces non-strings', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(42), '42');
});

test('findMentions: term-in-sentence extraction pulls the whole sentence', () => {
  const body = 'Intro line. We love the Van Kush Family vibe here. Next thought.';
  const m = findMentions(body, ['Van Kush Family']);
  assert.equal(m.length, 1);
  assert.equal(m[0].term, 'Van Kush Family');
  assert.equal(m[0].quote, 'We love the Van Kush Family vibe here.');
  assert.ok(m[0].index > 0);
});

test('findMentions: case-insensitive matching', () => {
  const m = findMentions('shout out to vkbt today', ['VKBT']);
  assert.equal(m.length, 1);
  assert.equal(m[0].term, 'VKBT');
});

test('findMentions: context windowing clamps at string boundaries', () => {
  const body = 'CURE leads the line.';
  const m = findMentions(body, ['CURE'], { window: 9999 });
  assert.equal(m.length, 1);
  // before is empty (hit at index 0), after is the remainder — no out-of-range slicing.
  assert.equal(m[0].before, '');
  assert.equal(m[0].after, ' leads the line.');
  assert.equal(m[0].index, 0);
});

test('findMentions: small window trims context to size', () => {
  const body = 'xxxxxxxxxxVan Kush Familyyyyyyyyyy';
  const m = findMentions(body, ['Van Kush Family'], { window: 4 });
  assert.equal(m.length, 1);
  assert.equal(m[0].before, 'xxxx');
  assert.equal(m[0].after, 'yyyy');
});

test('findMentions: multi-term, sorted by index', () => {
  const body = 'MELEK first, then a nod to VKBT, and CURE at the end.';
  const m = findMentions(body, ['MELEK', 'VKBT', 'CURE']);
  assert.equal(m.length, 3);
  assert.deepEqual(m.map((x) => x.term), ['MELEK', 'VKBT', 'CURE']);
  // indices ascending
  assert.ok(m[0].index < m[1].index && m[1].index < m[2].index);
});

test('findMentions: multiple hits of the same term', () => {
  const m = findMentions('VKBT and VKBT again', ['VKBT']);
  assert.equal(m.length, 2);
  assert.notEqual(m[0].index, m[1].index);
});

test('findMentions: empty / garbage input returns []', () => {
  assert.deepEqual(findMentions(''), []);
  assert.deepEqual(findMentions(null), []);
  assert.deepEqual(findMentions(undefined), []);
  assert.deepEqual(findMentions('no brand tokens here', ['VKBT']), []);
  assert.deepEqual(findMentions('text', []), []);
  assert.deepEqual(findMentions('text', 'not-an-array').length >= 0, true); // falls back to DEFAULT_TERMS, no throw
});

test('extractFromEmail: normalizes date to ISO and collects mentions', () => {
  const rec = extractFromEmail({
    subject: 'Hello',
    date: '2026-01-02',
    from: 'a@b.com',
    body: 'A note about the Van Kush Family.',
  }, ['Van Kush Family']);
  assert.equal(rec.subject, 'Hello');
  assert.equal(rec.from, 'a@b.com');
  assert.ok(rec.date.startsWith('2026-01-02'));
  assert.equal(rec.mentions.length, 1);
});

test('extractFromEmail: bad input returns empty record shape', () => {
  const rec = extractFromEmail(null);
  assert.deepEqual(rec, { subject: '', date: null, from: '', mentions: [] });
  const rec2 = extractFromEmail('nope');
  assert.deepEqual(rec2, { subject: '', date: null, from: '', mentions: [] });
});

test('toRecords: flat one-row-per-mention array', () => {
  const emails = [
    { subject: 'S1', date: '2026-01-01', from: 'x', body: 'VKBT and MELEK here' },
    { subject: 'S2', date: '2026-01-02', from: 'y', body: 'nothing relevant' },
  ];
  const rows = toRecords(emails, ['VKBT', 'MELEK']);
  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.subject && r.term && typeof r.quote === 'string'));
  assert.deepEqual(rows.map((r) => r.term).sort(), ['MELEK', 'VKBT']);
});

test('toRecords: bad/empty input returns []', () => {
  assert.deepEqual(toRecords(), []);
  assert.deepEqual(toRecords(null), []);
  assert.deepEqual(toRecords('nope'), []);
  assert.deepEqual(toRecords([]), []);
});

test('organizeByDate: buckets and sorts ascending, no-date last', () => {
  const records = [
    { date: '2026-03-01T00:00:00.000Z', subject: 'C', from: 'z', mentions: [] },
    { date: '2026-01-01T00:00:00.000Z', subject: 'A', from: 'x', mentions: [] },
    { date: null, subject: 'No', from: 'q', mentions: [] },
    { date: '2026-02-01T00:00:00.000Z', subject: 'B', from: 'y', mentions: [] },
  ];
  const grouped = organizeByDate(records);
  const order = grouped.map((g) => g.date);
  assert.deepEqual(order, ['2026-01-01', '2026-02-01', '2026-03-01', 'no-date']);
});

test('organizeByDate: same-day records share a bucket', () => {
  const records = [
    { date: '2026-01-01T08:00:00Z', subject: 'morning', mentions: [] },
    { date: '2026-01-01T20:00:00Z', subject: 'evening', mentions: [] },
  ];
  const grouped = organizeByDate(records);
  assert.equal(grouped.length, 1);
  assert.equal(grouped[0].items.length, 2);
});

test('organizeByDate: bad input returns []', () => {
  assert.deepEqual(organizeByDate(null), []);
  assert.deepEqual(organizeByDate('nope'), []);
});

test('organizeBySubject: groups by subject, empty -> (no subject)', () => {
  const records = [
    { subject: 'Topic A', term: 'VKBT', quote: 'q1' },
    { subject: 'Topic A', term: 'MELEK', quote: 'q2' },
    { subject: '', term: 'CURE', quote: 'q3' },
  ];
  const by = organizeBySubject(records);
  assert.equal(by['Topic A'].length, 2);
  assert.equal(by['(no subject)'].length, 1);
});

test('organizeBySubject: bad input returns {}', () => {
  assert.deepEqual(organizeBySubject(null), {});
  assert.deepEqual(organizeBySubject('nope'), {});
});

test('renderMarkdown: date-grouped digest with flat rows', () => {
  const emails = [{ subject: 'Promo', date: '2026-01-01', from: 'op', body: 'The Van Kush Family rocks.' }];
  const rows = toRecords(emails);
  const md = renderMarkdown(organizeByDate(rows));
  assert.ok(md.includes('## 2026-01-01'));
  assert.ok(md.includes('Van Kush Family'));
  assert.ok(md.includes('Promo'));
});

test('renderMarkdown: record-shape (mentions) digest', () => {
  const records = [
    extractFromEmail({ subject: 'S', date: '2026-01-01', from: 'f', body: 'VKBT mention here.' }, ['VKBT']),
  ];
  const md = renderMarkdown(organizeByDate(records));
  assert.ok(md.includes('VKBT'));
  assert.ok(md.includes('mention here'));
});

test('renderMarkdown: subject-object shape', () => {
  const by = organizeBySubject([{ subject: 'Topic', term: 'CURE', quote: 'a cure quote' }]);
  const md = renderMarkdown(by);
  assert.ok(md.includes('## Topic'));
  assert.ok(md.includes('CURE'));
});

test('renderMarkdown: empty / bad input returns empty string', () => {
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown([]), '');
  assert.equal(renderMarkdown(42), '');
});
