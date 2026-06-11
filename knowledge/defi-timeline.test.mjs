// defi-timeline.test.mjs — offline tests for the DeFi-era timeline data + renderer.
// node --test, no network, no I/O. Checks ordering, year lookup, soft-fail, and
// stable Markdown output.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ERAS,
  TRON_VS_ETHEREUM,
  timeline,
  eventsByYear,
  renderMarkdown,
  esc,
} from './defi-timeline.mjs';

test('ERAS is frozen and holds the three eras', () => {
  assert.ok(Object.isFrozen(ERAS));
  const ids = ERAS.map((e) => e.id).sort();
  assert.deepEqual(ids, ['defi', 'ico', 'ieo']);
});

test('timeline() returns eras in chronological order', () => {
  const t = timeline();
  assert.deepEqual(t.map((e) => e.id), ['ico', 'ieo', 'defi']);
  // strictly non-decreasing start years
  for (let i = 1; i < t.length; i++) {
    assert.ok(t[i].startYear >= t[i - 1].startYear, 'start years non-decreasing');
  }
});

test('timeline() is a copy — does not mutate ERAS order', () => {
  const before = ERAS.map((e) => e.id);
  timeline();
  assert.deepEqual(ERAS.map((e) => e.id), before);
});

test('eventsByYear finds the era spanning a year', () => {
  assert.deepEqual(eventsByYear(2017).map((e) => e.id), ['ico']);
  assert.deepEqual(eventsByYear(2019).map((e) => e.id), ['ieo']);
  assert.deepEqual(eventsByYear(2020).map((e) => e.id), ['defi']);
});

test('eventsByYear handles boundaries (inclusive span)', () => {
  assert.deepEqual(eventsByYear(2014).map((e) => e.id), ['ico']); // ico start
  assert.deepEqual(eventsByYear(2018).map((e) => e.id), ['ico']); // ico end
  assert.deepEqual(eventsByYear(2021).map((e) => e.id), ['defi']); // defi end
});

test('eventsByYear returns [] for years outside any era', () => {
  assert.deepEqual(eventsByYear(2010), []);
  assert.deepEqual(eventsByYear(2099), []);
});

test('eventsByYear soft-fails on bad input (no throw)', () => {
  assert.deepEqual(eventsByYear('not-a-year'), []);
  assert.deepEqual(eventsByYear(undefined), []);
  assert.deepEqual(eventsByYear(null), []);
  assert.deepEqual(eventsByYear(NaN), []);
});

test('eventsByYear accepts numeric strings', () => {
  assert.deepEqual(eventsByYear('2020').map((e) => e.id), ['defi']);
});

test('esc escapes HTML-significant characters', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('renderMarkdown is deterministic and stable', () => {
  const a = renderMarkdown();
  const b = renderMarkdown();
  assert.equal(a, b, 'two calls produce identical output');
  assert.equal(typeof a, 'string');
});

test('renderMarkdown contains the eras, platforms, and contrast', () => {
  const md = renderMarkdown();
  assert.match(md, /# DeFi history timeline: ICO → IEO → DeFi/);
  assert.match(md, /## ICO era \(2014–2018\)/);
  assert.match(md, /## IEO era \(2019\)/); // single-year span
  assert.match(md, /## DeFi era \(2020–2021\)/);
  assert.match(md, /Uniswap/);
  assert.match(md, /PancakeSwap/);
  assert.match(md, /SunSwap/);
  assert.ok(md.includes(TRON_VS_ETHEREUM.topic), 'contains the TRON-vs-Ethereum heading');
  assert.match(md, /\*\*TRON\*\*/);
  assert.match(md, /\*\*Ethereum\*\*/);
});

test('renderMarkdown orders era sections chronologically', () => {
  const md = renderMarkdown();
  const ico = md.indexOf('## ICO era');
  const ieo = md.indexOf('## IEO era');
  const defi = md.indexOf('## DeFi era');
  assert.ok(ico >= 0 && ieo >= 0 && defi >= 0);
  assert.ok(ico < ieo && ieo < defi, 'ICO before IEO before DeFi');
});
