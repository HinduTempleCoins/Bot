// rules-floor.test.mjs — the deterministic Brief floor: scoring, ranking, bucketing, render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreItem, rankItems, buildFloor, renderMarkdown, esc, WEIGHTS } from './rules-floor.mjs';

const it = (o) => ({ id: 'x', file: '', section: '', text: '', status: 'open', ...o });

test('scoreItem: in_progress outranks open outranks blocked', () => {
  const ip = scoreItem(it({ id: 'a', status: 'in_progress' }));
  const op = scoreItem(it({ id: 'b', status: 'open' }));
  const bl = scoreItem(it({ id: 'c', status: 'blocked' }));
  assert.ok(ip > op && op > bl);
});

test('scoreItem: priority path (hathor/cheetah/signup/witness) adds weight', () => {
  const base = scoreItem(it({ file: 'misc/notes.md' }));
  const prio = scoreItem(it({ file: 'witness/monitor.mjs' }));
  assert.equal(prio - base, WEIGHTS.priorityPath);
});

test('scoreItem: operator-ask phrasing adds weight', () => {
  const base = scoreItem(it({ text: 'refactor the thing' }));
  const ask = scoreItem(it({ text: 'operator asked: refactor the thing' }));
  assert.ok(ask > base);
});

test('scoreItem: an unmet dependency lowers the score', () => {
  const free = scoreItem(it({ text: 'do it' }));
  const dep = scoreItem(it({ text: 'do it', dependsHint: 'needs Y' }));
  assert.ok(dep < free);
});

test('scoreItem: soft-fail on garbage → 0, never throws', () => {
  assert.equal(scoreItem(null), 0);
  assert.equal(scoreItem(undefined), 0);
  assert.equal(scoreItem(42), 0);
});

test('rankItems: drops done/closed, sorts most-urgent first, stable by id on ties', () => {
  const items = [
    it({ id: 'open1', status: 'open' }),
    it({ id: 'done1', status: 'done' }),
    it({ id: 'wip1', status: 'in_progress' }),
    it({ id: 'closed1', status: 'closed' }),
  ];
  const ranked = rankItems(items);
  assert.deepEqual(ranked.map((r) => r.id), ['wip1', 'open1']); // done+closed dropped, wip first
});

test('rankItems: identical input → identical order (deterministic)', () => {
  const items = [it({ id: 'b' }), it({ id: 'a' }), it({ id: 'c' })];
  assert.deepEqual(rankItems(items).map((x) => x.id), rankItems(items).map((x) => x.id));
});

test('rankItems: non-array → []', () => {
  assert.deepEqual(rankItems(null), []);
  assert.deepEqual(rankItems('nope'), []);
});

test('buildFloor: buckets into readFirst / doNext / blocked', () => {
  const items = [
    it({ id: 'a', status: 'in_progress' }),
    it({ id: 'b', status: 'open' }),
    it({ id: 'c', status: 'blocked' }),
    it({ id: 'd', status: 'open', dependsHint: 'needs Z' }),
  ];
  const f = buildFloor(items);
  assert.deepEqual(f.readFirst.map((x) => x.id), ['a']);
  assert.deepEqual(f.doNext.map((x) => x.id), ['b']);
  assert.deepEqual(f.blocked.map((x) => x.id).sort(), ['c', 'd']); // blocked + has-dependency
  assert.equal(f.counts.total, 4);
});

test('buildFloor: doNextCap moves overflow to deferred', () => {
  const items = Array.from({ length: 20 }, (_, i) => it({ id: `o${i}`, status: 'open' }));
  const f = buildFloor(items, { doNextCap: 5 });
  assert.equal(f.doNext.length, 5);
  assert.equal(f.deferred.length, 15);
});

test('buildFloor: empty / garbage → empty buckets, never throws', () => {
  const f = buildFloor(null);
  assert.equal(f.counts.total, 0);
  assert.deepEqual(f.readFirst, []);
});

test('renderMarkdown: stable, contains section headers, escapes fields', () => {
  const items = [it({ id: 'a', status: 'in_progress', text: 'finish <b>it</b>', file: 'witness/x.mjs' })];
  const md = renderMarkdown(buildFloor(items));
  assert.match(md, /Brief skeleton \(deterministic floor\)/);
  assert.match(md, /Read first/);
  assert.match(md, /&lt;b&gt;/); // text was esc()'d
  assert.equal(md, renderMarkdown(buildFloor(items))); // byte-identical
});

test('renderMarkdown: empty floor renders (none) sections without throwing', () => {
  const md = renderMarkdown(buildFloor([]));
  assert.match(md, /_\(none\)_/);
});

test('esc: escapes the five entities', () => {
  assert.equal(esc(`<a&"'>`), '&lt;a&amp;&quot;&#39;&gt;');
});
