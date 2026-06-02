// render.test.js — the page factory's render layer is pure (data in → HTML out), so we test the
// components directly: formatting, the inline sparkline, Clarity rendering, supply bar, and that the
// layout emits the SEO surface (canonical, OpenGraph, JSON-LD) the brief requires.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, usd, compactUsd, pct, sparkline, clarityBadge, clarityCard, supplyBar, layout } from './render.mjs';

test('money + percent formatting', () => {
  assert.equal(usd(null), '—');
  assert.equal(compactUsd(1.39e12), '$1.39T');
  assert.equal(compactUsd(5e9), '$5.00B');
  assert.match(pct(3.2), /up.*3\.20%/);
  assert.match(pct(-1.5), /down.*1\.50%/);
});

test('esc neutralizes HTML', () => {
  assert.equal(esc('<script>"&'), '&lt;script&gt;&quot;&amp;');
});

test('sparkline draws a path from >=2 points, empty otherwise', () => {
  assert.match(sparkline([1, 2, 3, 2, 4]), /<path d="M.*L.*" /);
  assert.doesNotMatch(sparkline([1]), /<path/);            // too few points
  assert.match(sparkline([5, 4, 3]), /stroke="#f85149"/);  // downtrend = red
  assert.match(sparkline([3, 4, 5]), /stroke="#3fb950"/);  // uptrend = green
});

test('clarity badge + card reflect value and band', () => {
  assert.match(clarityBadge(null), /Clarity —/);
  assert.match(clarityBadge({ value: 56, band: 'moderate' }), /Clarity 56/);
  const cardHtml = clarityCard({ value: 56, band: 'moderate', inputs: { holder_dist: 47 }, notes: { holder_dist: '82 holders' }, method: 'observable-facts-v1' });
  assert.match(cardHtml, /holder dist/);
  assert.match(cardHtml, /opaque.*not.*scam/i);            // the load-bearing disclaimer
});

test('supply bar fills proportionally and never divides by zero', () => {
  assert.match(supplyBar({ circulating: 50, total: 100, max: 100 }), /width:50\.0%/);
  assert.match(supplyBar({}), /width:0\.0%/);
  assert.match(supplyBar({ circulating: 10, total: 0, max: 0 }), /∞/);  // no cap → infinity glyph
});

test('layout emits SEO surface', () => {
  const html = layout({ title: 'Bitcoin', description: 'd', canonical: 'https://x/c', jsonld: { '@type': 'Thing' }, body: '<p>hi</p>' });
  assert.match(html, /<link rel=canonical href="https:\/\/x\/c">/);
  assert.match(html, /property="og:title"/);
  assert.match(html, /application\/ld\+json/);
  assert.match(html, /<p>hi<\/p>/);
});
