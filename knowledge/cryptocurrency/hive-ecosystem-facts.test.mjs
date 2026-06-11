// knowledge/cryptocurrency/hive-ecosystem-facts.test.mjs — offline, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HIVE_FACTS,
  topics,
  fact,
  byTag,
  byTopic,
  search,
  render,
  esc,
} from './hive-ecosystem-facts.mjs';

test('HIVE_FACTS shape: every fact has id/topic/summary/detail/tags', () => {
  assert.ok(HIVE_FACTS.length >= 5);
  const ids = new Set();
  for (const f of HIVE_FACTS) {
    assert.equal(typeof f.id, 'string');
    assert.ok(f.id.length, 'id non-empty');
    assert.ok(!ids.has(f.id), `unique id ${f.id}`);
    ids.add(f.id);
    assert.equal(typeof f.topic, 'string');
    assert.ok(f.topic.length);
    assert.equal(typeof f.summary, 'string');
    assert.ok(f.summary.length);
    assert.equal(typeof f.detail, 'string');
    assert.ok(f.detail.length);
    assert.ok(Array.isArray(f.tags) && f.tags.length);
  }
});

test('covers the four queue-called-out subjects', () => {
  // 2020 fork
  assert.ok(search('2020').some((f) => /fork/i.test(f.summary + f.detail)));
  // Justin Sun takeover
  assert.ok(search('Justin Sun').length >= 1);
  assert.ok(byTag('takeover').length >= 1);
  // witness system
  assert.ok(byTopic('witness').length >= 1);
  // DPoS mechanics
  assert.ok(byTopic('dpos').length >= 1);
  assert.ok(search('Delegated Proof of Stake').length >= 1);
});

test('topics() returns distinct topic names', () => {
  const t = topics();
  assert.equal(new Set(t).size, t.length);
  assert.ok(t.includes('witness'));
  assert.ok(t.includes('dpos'));
});

test('fact() returns the matching fact or null', () => {
  const f = fact('hive-fork-2020');
  assert.ok(f);
  assert.equal(f.id, 'hive-fork-2020');
  assert.equal(f, HIVE_FACTS.find((x) => x.id === 'hive-fork-2020'));
});

test('fact() soft-fails on unknown / null / empty -> null', () => {
  assert.equal(fact('nope'), null);
  assert.equal(fact(null), null);
  assert.equal(fact(''), null);
  assert.equal(fact(undefined), null);
  assert.equal(fact('   '), null);
});

test('byTag is case-insensitive, soft-fails to []', () => {
  const a = byTag('history');
  assert.ok(a.length > 0);
  assert.deepEqual(byTag('HISTORY'), a);
  assert.deepEqual(byTag('no-such-tag'), []);
  assert.deepEqual(byTag(null), []);
  assert.deepEqual(byTag(''), []);
});

test('byTopic is case-insensitive, soft-fails to []', () => {
  assert.ok(byTopic('DPOS').length >= 1);
  assert.deepEqual(byTopic('dpos'), byTopic('DPoS'));
  assert.deepEqual(byTopic('nonsense'), []);
  assert.deepEqual(byTopic(null), []);
});

test('search matches over summary/detail/tags, case-insensitive', () => {
  assert.ok(search('tron').some((f) => /tron/i.test(f.detail) || f.tags.includes('tron')));
  assert.ok(search('price feed').length >= 1);
  assert.deepEqual(search('WITNESS'), search('witness'));
});

test('search soft-fails on empty / null / no-match -> []', () => {
  assert.deepEqual(search(''), []);
  assert.deepEqual(search('   '), []);
  assert.deepEqual(search(null), []);
  assert.deepEqual(search('zzz-no-match-xyz'), []);
});

test('render text is deterministic and mentions key subjects', () => {
  const txt = render();
  assert.equal(txt, render());
  assert.ok(txt.includes('witness'));
  assert.ok(txt.includes('DPoS') || txt.includes('dpos'));
});

test('render html escapes interpolation and builds a list', () => {
  const html = render({ html: true });
  assert.ok(html.startsWith('<ul'));
  assert.ok(html.includes('</ul>'));
  const bad = render({
    html: true,
    rows: [{ topic: 'X', summary: '<script>', detail: 'a&b', tags: ['"q"'] }],
  });
  assert.ok(!bad.includes('<script>'));
  assert.ok(bad.includes('&lt;script&gt;'));
  assert.ok(bad.includes('a&amp;b'));
});

test('render soft-fails on non-array rows', () => {
  assert.equal(render({ rows: null }), '');
  const emptyHtml = render({ rows: undefined, html: true });
  assert.ok(emptyHtml.startsWith('<ul'));
  assert.ok(emptyHtml.endsWith('</ul>'));
});

test('esc handles null/undefined and the five entities', () => {
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc('<>&"\''), '&lt;&gt;&amp;&quot;&#39;');
});
