// knowledge/cryptocurrency/steem-hive-fork.test.mjs
//
// Offline tests for the Steem -> Hive 2020 fork knowledge module. No network,
// no clock, no disk. Covers the happy path plus edge / soft-fail cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  FACTS,
  esc,
  lookup,
  timeline,
  renderMarkdown,
} from './steem-hive-fork.mjs';

test('FACTS is a frozen, non-empty array of well-formed entries', () => {
  assert.ok(Array.isArray(FACTS));
  assert.ok(FACTS.length >= 5);
  assert.ok(Object.isFrozen(FACTS));
  const seen = new Set();
  for (const e of FACTS) {
    assert.ok(Object.isFrozen(e), 'each entry is frozen');
    for (const k of ['topic', 'plain', 'detail', 'date', 'source']) {
      assert.equal(typeof e[k], 'string', `${k} is a string`);
      assert.ok(e[k].length > 0, `${k} is non-empty`);
    }
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/, 'date is ISO yyyy-mm-dd');
    assert.ok(!seen.has(e.topic), `topic ${e.topic} is unique`);
    seen.add(e.topic);
  }
});

test('FACTS covers the four required spec beats', () => {
  const topics = FACTS.map((e) => e.topic);
  assert.ok(topics.includes('tron-acquisition'), 'Justin Sun / Tron acquisition');
  assert.ok(topics.includes('soft-fork-0.22.2'), 'soft fork 0.22.2 freeze');
  assert.ok(topics.includes('exchange-vote-seizure'), 'exchange-stake witness seizure');
  assert.ok(topics.includes('hive-hard-fork'), 'March 2020 Hive hard fork');
  assert.ok(topics.includes('airdrop-exclusion'), 'airdrop excluding flagged accounts');
});

test('esc() escapes the five HTML metacharacters and coerces null/undefined', () => {
  assert.equal(esc(`<a href="x" data='y'>&</a>`),
    '&lt;a href=&quot;x&quot; data=&#39;y&#39;&gt;&amp;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(42), '42');
});

test('lookup() is case-insensitive and trims', () => {
  const hit = lookup('Hive-Hard-Fork');
  assert.ok(hit);
  assert.equal(hit.topic, 'hive-hard-fork');
  assert.equal(lookup('  tron-acquisition  ').topic, 'tron-acquisition');
});

test('lookup() soft-fails to null on unknown / empty / null', () => {
  assert.equal(lookup('no-such-topic'), null);
  assert.equal(lookup(''), null);
  assert.equal(lookup('   '), null);
  assert.equal(lookup(null), null);
  assert.equal(lookup(undefined), null);
});

test('timeline() is sorted ascending by date and does not mutate FACTS', () => {
  const before = FACTS.map((e) => e.topic);
  const t = timeline();
  assert.equal(t.length, FACTS.length);
  for (let i = 1; i < t.length; i++) {
    assert.ok(t[i - 1].date <= t[i].date, 'dates non-decreasing');
  }
  // earliest event (2016 ninja-mined launch) sorts first; Hive fork last.
  assert.equal(t[0].topic, 'ninja-mined-stake');
  assert.deepEqual(FACTS.map((e) => e.topic), before, 'FACTS order unchanged');
});

test('timeline() ordering is deterministic across calls', () => {
  assert.deepEqual(
    timeline().map((e) => e.topic),
    timeline().map((e) => e.topic),
  );
});

test('renderMarkdown() is deterministic, dated, and esc()-clean', () => {
  const md = renderMarkdown();
  assert.equal(md, renderMarkdown(), 'deterministic');
  assert.match(md, /^# Steem -> Hive \(2020\)/);
  // every entry rendered with its date heading
  for (const e of FACTS) {
    assert.ok(md.includes(`## ${e.date} — ${e.topic}`), `${e.topic} heading present`);
    assert.ok(md.includes(`_Source: ${esc(e.source)}_`), `${e.topic} source present`);
  }
  // no raw angle brackets leaked from interpolation beyond the literal header arrow
  assert.ok(!md.includes('<script'), 'no raw markup injected');
});

test('module never throws on hostile lookup input', () => {
  assert.doesNotThrow(() => lookup({}));
  assert.doesNotThrow(() => lookup([]));
  assert.doesNotThrow(() => lookup(0));
});
