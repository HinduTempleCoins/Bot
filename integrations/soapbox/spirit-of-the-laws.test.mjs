// spirit-of-the-laws.test.mjs — offline tests for the Spirit-of-the-Laws corpus loader.
// node --test, no network, reads the committed JSON.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  load, cases, casesFor, blurbsFor, readingList, montesquieu, counterpoint,
  methods, themes, renderCase, renderBlurb, escapeHtml, __setData,
} from './spirit-of-the-laws.mjs';

test('loads the committed corpus with cases[]', () => {
  __setData(null);
  const d = load({ fresh: true });
  assert.ok(d && !d._error, 'corpus loaded without error flag');
  assert.ok(Array.isArray(d.cases) && d.cases.length >= 8, 'has a substantial cases[]');
});

test('every case carries a real citation, source_url, pincite, and a verified-or-flagged quote', () => {
  __setData(null);
  for (const c of cases()) {
    assert.ok(c.case && c.citation, `case has name + citation: ${c.case}`);
    assert.ok(/^https?:\/\//.test(c.source_url || ''), `case has http(s) source_url: ${c.case}`);
    assert.ok(c.pincite, `case has a pincite: ${c.case}`);
    // Charter §3: a quote is either present (verified) or explicitly null WITH a verify note.
    if (c.quote == null) {
      assert.ok(/verify/i.test(c.quote_note || ''), `null quote is flagged to verify: ${c.case}`);
    } else {
      assert.equal(typeof c.quote, 'string');
      assert.ok(c.quote.length > 0, `non-empty quote: ${c.case}`);
    }
  }
});

test('the canonical required cases are present with correct citations', () => {
  __setData(null);
  const byName = Object.fromEntries(cases().map((c) => [c.case, c]));
  assert.equal(byName['Riggs v. Palmer'].citation, '115 N.Y. 506 (1889)');
  assert.equal(byName['Church of the Holy Trinity v. United States'].citation, '143 U.S. 457 (1892)');
  assert.ok(byName["Heydon's Case"], "Heydon's Case present");
  assert.match(byName["Heydon's Case"].citation, /1584/);
});

test('at least three opinions cite Montesquieu by name (method tag)', () => {
  __setData(null);
  const mont = casesFor('separation-of-powers-Montesquieu');
  assert.ok(mont.length >= 3, `>=3 Montesquieu cases, got ${mont.length}`);
  const names = mont.map((c) => c.case);
  assert.ok(names.includes('Mistretta v. United States'));
  assert.ok(names.includes('Bowsher v. Synar'));
});

test('casesFor is case-insensitive and unknown methods return []', () => {
  __setData(null);
  assert.deepEqual(casesFor('PURPOSIVIST').map((c) => c.case), casesFor('purposivist').map((c) => c.case));
  assert.deepEqual(casesFor('nope'), []);
  assert.deepEqual(casesFor(''), []);
  assert.deepEqual(casesFor(null), []);
});

test('methods() and themes() are non-empty and sorted', () => {
  __setData(null);
  const m = methods();
  assert.ok(m.length >= 3);
  assert.deepEqual(m, [...m].sort());
  const t = themes();
  assert.ok(t.includes('letter-vs-spirit'));
  assert.ok(t.includes('separation-of-powers'));
  assert.ok(t.includes('mischief-rule'));
});

test('blurbsFor returns a verbatim string ending with a case cite, or "" for unknown', () => {
  __setData(null);
  const b = blurbsFor('letter-vs-spirit');
  assert.match(b, /143 U\.S\. 457/);
  assert.match(blurbsFor('mischief-rule'), /Heydon/);
  assert.equal(blurbsFor('does-not-exist'), '');
  assert.equal(blurbsFor(''), '');
});

test('readingList has verified real editions with why + source_url', () => {
  __setData(null);
  const rl = readingList();
  assert.ok(rl.length >= 5, `>=5 books, got ${rl.length}`);
  const authors = rl.map((r) => r.author).join(' | ');
  assert.match(authors, /Montesquieu/);
  assert.match(authors, /Scalia/);
  for (const r of rl) {
    assert.ok(r.title && r.why, `book has title + why: ${r.author}`);
  }
});

test('montesquieu() and counterpoint() return populated blocks', () => {
  __setData(null);
  assert.ok(montesquieu().work && /1748/.test(montesquieu().work));
  assert.ok(Array.isArray(counterpoint().positions) && counterpoint().positions.length >= 1);
});

test('renderCase escapes and includes source link; renderBlurb wraps the blurb', () => {
  __setData(null);
  const c = cases().find((x) => x.case === 'Church of the Holy Trinity v. United States');
  const html = renderCase(c);
  assert.match(html, /<article class="sol-case"/);
  assert.match(html, /<a href="http/);
  assert.match(html, /143 U\.S\. 457/);
  // a flagged (null-quote) case renders the verify note, not an empty blockquote
  const chadha = cases().find((x) => x.quote == null);
  if (chadha) assert.match(renderCase(chadha), /not yet verified/i);
  const b = renderBlurb('separation-of-powers');
  assert.match(b, /<p class="sol-teach"/);
});

test('renderCase escapes injected HTML (no raw tags leak)', () => {
  __setData({ cases: [{ case: '<x>', citation: '"c"', source_url: 'http://e', pincite: 'p', quote: '<b>hi</b>', method: 'm' }], blurbs: {}, reading_list: [], montesquieu: {}, counterpoint: {} });
  const html = renderCase(cases()[0]);
  assert.ok(!html.includes('<b>hi</b>'), 'raw quote HTML is escaped');
  assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/);
  __setData(null);
});

test('soft-fail: bad data never throws, returns empty shapes', () => {
  __setData({ nonsense: true });
  assert.deepEqual(cases(), []);
  assert.deepEqual(casesFor('purposivist'), []);
  assert.equal(blurbsFor('letter-vs-spirit'), '');
  assert.deepEqual(readingList(), []);
  assert.equal(renderCase(null), '');
  assert.equal(renderBlurb('x'), '');
  __setData(null);
});

test('escapeHtml handles null/undefined and the five entities', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(`&<>"'`), '&amp;&lt;&gt;&quot;&#39;');
});
