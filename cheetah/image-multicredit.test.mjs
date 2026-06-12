// image-multicredit.test.mjs — a post carrying several images, each first seen elsewhere, must:
//   (1) count each image ONCE (no double-count on query-string URLs),
//   (2) credit EVERY distinct source (on-chain AND open-web), not just the loudest, and
//   (3) render each as a clickable link.
// All pure functions — no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractImageUrls } from './image-scan.js';
import { dedupeSources } from './index.js';
import { composeImageCreditNote } from './compose.js';

test('extractImageUrls counts query-string image URLs once, not twice', () => {
  const body = [
    '![a](https://cdn.example.com/a.jpg?w=600)',
    '![b](https://dummyimage.com/400x300/000/fff.png&text=Photo2)',
    '![c](https://example.org/clean.png)',
  ].join('\n\n');
  const urls = extractImageUrls(body);
  // Before the fix the bare-URL regex also matched the truncated `...jpg` / `...png`, doubling them.
  assert.equal(urls.length, 3, `expected 3 distinct images, got ${urls.length}: ${JSON.stringify(urls)}`);
  assert.ok(urls.includes('https://cdn.example.com/a.jpg?w=600'), 'keeps the full query-string URL');
  assert.ok(!urls.includes('https://cdn.example.com/a.jpg'), 'drops the truncated duplicate');
});

test('dedupeSources collapses to one entry per source, highest confidence, sorted', () => {
  const findings = [
    { source: { author: 'alice', permlink: 'p1' }, confidence: 0.8 },
    { source: { author: 'alice', permlink: 'p1' }, confidence: 0.95 }, // dup, higher conf
    { source: { author: 'bob', permlink: 'p2' }, confidence: 0.7 },
    { source: { url: 'https://news.site/photo' }, confidence: 0.85 },   // open-web source
  ];
  const out = dedupeSources(findings);
  assert.equal(out.length, 3, 'three distinct sources');
  assert.equal(out[0].author, 'alice');
  assert.equal(out[0].confidence, 0.95, 'kept the higher-confidence dup');
  assert.ok(out[1].confidence >= out[2].confidence, 'sorted by confidence desc');
});

test('composeImageCreditNote lists every source (on-chain + open-web) with links', () => {
  const note = composeImageCreditNote({
    match: true,
    sources: [
      { author: 'alice', permlink: 'orig-1', confidence: 0.98 },
      { url: 'https://flickr.com/x', title: 'Sunset by Joe', confidence: 0.86 }, // external
    ],
  }, 'seed');
  assert.match(note, /2 images/, 'mentions the count');
  assert.match(note, /\[@alice\/orig-1\]\(\/@alice\/orig-1\)/, 'on-chain source linked to /@author/permlink');
  assert.match(note, /\[Sunset by Joe\]\(https:\/\/flickr\.com\/x\)/, 'external source linked to its url');
  assert.match(note, /not accusing/i, 'credit-first, non-accusatory tone');
});

test('composeImageCreditNote still handles a single source (backward compatible)', () => {
  const note = composeImageCreditNote({ match: true, source: { author: 'alice', permlink: 'p' }, confidence: 0.9 }, 's');
  assert.match(note, /\/@alice\/p/);
  assert.doesNotMatch(note, /^\d+ images/, 'single-source note is not the multi format');
});
