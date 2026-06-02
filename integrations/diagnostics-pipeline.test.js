// diagnostics-pipeline.test.js — pure shape/contract tests (no network, no fs).
// diagnose() takes a snapshot in-hand so we feed fixtures and assert the diagnostics object shape
// and that renderMarkdown / engineBlock return strings. engineBlock() reads the on-disk snapshot
// best-effort and must never throw, returning a string regardless.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diagnose, renderMarkdown, engineBlock } from './diagnostics-pipeline.mjs';

// A snapshot shaped like resource-center latest.json: news lean bullish on crypto, HE breadth up
// (confluence); gold news bearish but gold price up (divergence); an arbitrage proposal present.
const snapshot = {
  ts: '2026-06-02T00:00:00.000Z',
  metrics: {
    hiveEngine: { topGainers: [{ symbol: 'VKBT', change: 12 }], topLosers: [{ symbol: 'CURE', change: -3 }] },
    metals: { gold: { price: 2400, change: 1.2 } },
    indices: { sp500: { price: 5300, change: 0.4 } },
    dxy: { price: 105, change: 0.5 },
  },
  proposals: { proposals: [{ kind: 'arbitrage', summary: 'SWAP.HIVE edge 1.4%' }] },
  news: {
    assets: {
      crypto: { topic: 'crypto', headlineCount: 20, sentimentHint: 'bullish', sentimentScore: 0.4, mentions: { BTC: 5, ETH: 3 }, themes: [{ word: 'etf', count: 4 }] },
      gold: { topic: 'gold', headlineCount: 8, sentimentHint: 'bearish', sentimentScore: -0.3, mentions: { GOLD: 4 }, themes: [{ word: 'rates', count: 2 }] },
    },
  },
};

test('diagnose() returns the documented object shape', () => {
  const d = diagnose(snapshot);
  assert.equal(typeof d.ts, 'string');
  assert.ok(Array.isArray(d.signals), 'signals is an array');
  assert.ok(Array.isArray(d.suggestedMoves), 'suggestedMoves is an array');
  assert.ok(Array.isArray(d.teachingNotes), 'teachingNotes is an array');
  assert.equal(typeof d.sources, 'object');
  assert.deepEqual(
    Object.keys(d.sources).sort(),
    ['metrics', 'news', 'proposals', 'snapshot'],
  );
});

test('signals cross-reference saying-vs-doing (confluence + divergence)', () => {
  const d = diagnose(snapshot);
  const crypto = d.signals.find((s) => s.topic === 'crypto');
  const gold = d.signals.find((s) => s.topic === 'gold');
  assert.equal(crypto.kind, 'confluence', 'bullish news + breadth up = confluence');
  assert.equal(gold.kind, 'divergence', 'bearish news + price up = divergence');
});

test('every suggestedMove is advisory and carries a US-jurisdiction caveat', () => {
  const d = diagnose(snapshot);
  assert.ok(d.suggestedMoves.length > 0, 'at least one move derived');
  for (const m of d.suggestedMoves) {
    assert.equal(m.advisory, true, `${m.label} flagged advisory`);
    assert.ok(['exchange', 'bot', 'currency'].includes(m.kind), `${m.kind} is a valid move kind`);
    assert.match(m.usCaveat, /US-access/, 'carries the US caveat');
  }
});

test('teachingNotes are plain-English {title, lesson} pairs', () => {
  const d = diagnose(snapshot);
  assert.ok(d.teachingNotes.length >= 2);
  for (const t of d.teachingNotes) {
    assert.equal(typeof t.title, 'string');
    assert.ok(t.lesson.length > 20, 'lesson is a real sentence');
  }
});

test('renderMarkdown returns a non-empty string with the section header', () => {
  const md = renderMarkdown(diagnose(snapshot));
  assert.equal(typeof md, 'string');
  assert.match(md, /### Diagnostics — signals → suggested moves → teaching/);
  assert.match(md, /ADVISORY ONLY/);
});

test('degrades gracefully on a null / empty snapshot (never throws)', () => {
  const d = diagnose(null);
  assert.ok(Array.isArray(d.signals) && d.signals.length === 0);
  assert.equal(d.sources.snapshot, false);
  assert.equal(typeof renderMarkdown(d), 'string');
});

test('engineBlock() resolves to a string regardless of on-disk state', async () => {
  const out = await engineBlock();
  assert.equal(typeof out, 'string');
});
