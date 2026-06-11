// moderation-report.test.mjs — offline tests for the operator moderation digest.
// Runs fully offline (no network, no fs writes); exercises happy + edge paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { report, esc } from './moderation-report.mjs';

// A realistic flag-pipe summary()+reviewQueue() pair.
const sampleSummary = {
  byKind: { spam: 3, scam: 1, csam: 1, harassment: 2 },
  byStatus: { pending: 5, dismissed: 1, actioned: 1 },
  total: 7,
  gatedPending: 1,
};
const sampleQueue = [
  { id: 'a', target: '@bob/post', kind: 'csam', severity: 5, reason: 'reported', gated: true, status: 'pending', filedAt: '2026-06-11T00:00:00Z' },
  { id: 'b', target: '@eve/scam', kind: 'scam', severity: 4, reason: 'phishing link', gated: false, status: 'pending', filedAt: '2026-06-11T01:00:00Z' },
  { id: 'c', target: '@spammer/x', kind: 'spam', severity: 2, reason: 'flood', gated: false, status: 'pending', filedAt: '2026-06-11T02:00:00Z' },
];

test('report renders a markdown digest with header and totals', () => {
  const md = report({ summary: sampleSummary, queue: sampleQueue });
  assert.equal(typeof md, 'string');
  assert.match(md, /^# Moderation report/);
  assert.match(md, /Total flags: 7/);
  assert.match(md, /pending: 5/);
});

test('counts by kind appear sorted biggest-first', () => {
  const md = report({ summary: sampleSummary, queue: sampleQueue });
  assert.match(md, /## By kind/);
  const byKindBlock = md.split('## By kind')[1].split('## By status')[0];
  // spam (3) should come before harassment (2) before scam/csam (1)
  assert.ok(byKindBlock.indexOf('spam: 3') < byKindBlock.indexOf('harassment: 2'));
  assert.ok(byKindBlock.indexOf('harassment: 2') < byKindBlock.indexOf('scam: 1'));
});

test('by status section renders', () => {
  const md = report({ summary: sampleSummary, queue: sampleQueue });
  assert.match(md, /## By status/);
  assert.match(md, /pending: 5/);
  assert.match(md, /dismissed: 1/);
});

test('gated CSAM is called out separately with its pending count', () => {
  const md = report({ summary: sampleSummary, queue: sampleQueue });
  assert.match(md, /## Gated \(CSAM\)/);
  assert.match(md, /1 pending gated flag/);
  assert.match(md, /Do NOT auto-action/);
});

test('zero gated pending renders the zero line', () => {
  const md = report({ summary: { ...sampleSummary, gatedPending: 0 }, queue: [] });
  assert.match(md, /0 pending gated flags/);
});

test('top pending flags listed most-severe first, capped at topN', () => {
  const md = report({ summary: sampleSummary, queue: sampleQueue, topN: 2 });
  assert.match(md, /max 2/);
  const topBlock = md.split('## Top pending flags')[1];
  // csam (sev5) before scam (sev4); spam (sev2) dropped by the cap
  assert.ok(topBlock.indexOf('csam') < topBlock.indexOf('scam'));
  assert.ok(!topBlock.includes('flood'));
  assert.match(topBlock, /\[GATED\]/);
  assert.match(topBlock, /\[sev 5\]/);
});

test('gatedPending falls back to counting the queue when summary omits it', () => {
  const sumNoGated = { byKind: {}, byStatus: { pending: 1 }, total: 1 };
  const md = report({ summary: sumNoGated, queue: [
    { id: 'g', target: '@x/y', kind: 'csam', severity: 5, gated: true, status: 'pending' },
  ] });
  assert.match(md, /1 pending gated flag/);
});

test('esc neutralizes html and markdown control chars and newlines', () => {
  assert.equal(esc('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;');
  // '#' is intentionally NOT stripped (it lives inside escaped entities like &#39;); newline-collapse defuses headings.
  assert.equal(esc('a|b`c*d_e~g'), 'abcdeg');
  assert.equal(esc('line1\nline2'), 'line1 line2');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('crafted target/reason cannot break the markdown layout', () => {
  const md = report({
    summary: { byKind: { spam: 1 }, byStatus: { pending: 1 }, total: 1, gatedPending: 0 },
    queue: [{ id: 'z', target: '@evil/x\n## INJECTED', kind: 'spam', severity: 3, reason: 'a|b`c', gated: false, status: 'pending' }],
  });
  // the injected heading must not survive as a real heading
  assert.ok(!/\n## INJECTED/.test(md));
  assert.ok(!md.includes('a|b`c'));
});

test('empty / missing input degrades gracefully without throwing', () => {
  const md = report();
  assert.equal(typeof md, 'string');
  assert.match(md, /# Moderation report/);
  assert.match(md, /Total flags: 0/);
  assert.match(md, /\(none\)/);          // empty by-kind
  assert.match(md, /\(none pending\)/);  // empty top flags
});

test('garbage types are tolerated (soft-fail)', () => {
  const md = report({ summary: 'nope', queue: 'nope', topN: -5 });
  assert.equal(typeof md, 'string');
  assert.match(md, /# Moderation report/);
});

test('non-object flags in the queue are filtered out', () => {
  const md = report({
    summary: { byKind: {}, byStatus: {}, total: 0, gatedPending: 0 },
    queue: [null, 42, 'x', { id: 'ok', target: '@a/b', kind: 'spam', severity: 1, status: 'pending' }],
  });
  assert.match(md, /spam: /.test(md) ? /spam/ : /@a\/b/);
  assert.match(md, /@a\/b/);
});
