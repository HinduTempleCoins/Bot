// widgets.test.mjs — OFFLINE tests for the pure HTML-string widget helpers. No network, no DOM.
// Each test asserts: (1) a string is returned, (2) it contains the expected structural markers,
// (3) injection is neutralized (a symbol/value of `<script>` never appears raw), (4) missing/zero
// inputs are handled (— / 0 / empty-but-valid markup, no throw).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  tradingViewChart,
  sparklineSvg,
  countersBar,
  clarityBadge,
  lastUpdated,
  sentimentPill,
} from './widgets.mjs';

// An ATTACKER-CONTROLLED raw `<script>alert` or a raw closing `</script>` from user input must never
// survive. (Legit framework <script> openers are fine — we only forbid the injected payload markers.)
const noRawScript = (html, label) => {
  assert.ok(!html.includes('<script>alert'), `${label}: raw <script>alert present`);
  assert.ok(!html.includes('alert(1)</script>'), `${label}: injected closing </script> leaked`);
  assert.ok(!html.includes('alert(2)</script>'), `${label}: injected closing </script> leaked`);
  assert.ok(!html.includes('alert(3)</script>'), `${label}: injected closing </script> leaked`);
};

test('esc neutralizes the dangerous characters', () => {
  assert.equal(esc('<script>"&\'</script>'), '&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});

test('tradingViewChart returns markup with the lightweight-charts CDN + canvas', () => {
  const html = tradingViewChart({ symbol: 'BTC', theme: 'dark' });
  assert.equal(typeof html, 'string');
  assert.match(html, /lightweight-charts/);
  assert.match(html, /createChart/);
  assert.match(html, /tv-chart-canvas/);
  assert.match(html, /BTC/);
});

test('tradingViewChart escapes an injected symbol everywhere (attr + script)', () => {
  const html = tradingViewChart({ symbol: '<script>alert(1)</script>', theme: 'dark' });
  noRawScript(html, 'tradingViewChart');
  assert.ok(!html.includes('alert(1)</script>'), 'closing </script> after alert leaked');
  // the visible title path escapes it
  assert.match(html, /&lt;script&gt;/);
  // inside the inline JS it is JSON+unicode-escaped
  assert.match(html, /\\u003c/);
});

test('tradingViewChart clamps theme and handles no args', () => {
  const evil = tradingViewChart({ symbol: 'X', theme: 'dark"><script>alert(2)</script>' });
  noRawScript(evil, 'tradingViewChart theme');
  assert.match(evil, /data-theme="dark"/); // unknown theme clamps to dark
  const bare = tradingViewChart();
  assert.equal(typeof bare, 'string');
  assert.match(bare, /createChart/);
  assert.match(tradingViewChart({ symbol: 'X', theme: 'light' }), /data-theme="light"/);
});

test('sparklineSvg draws a path for >=2 points, up vs down stroke', () => {
  const up = sparklineSvg([1, 2, 3, 4]);
  assert.match(up, /<svg/);
  assert.match(up, /<path/);
  assert.match(up, /#3fb950/); // last >= first → green
  const down = sparklineSvg([4, 3, 2, 1]);
  assert.match(down, /#f85149/); // last < first → red
});

test('sparklineSvg handles missing/short/garbage input as empty valid svg', () => {
  for (const bad of [undefined, null, [], [1], 'nope', [NaN, NaN], [Infinity, 1]]) {
    const html = sparklineSvg(bad);
    assert.equal(typeof html, 'string');
    assert.match(html, /<svg[^>]*><\/svg>|<svg[^>]*>\s*<\/svg>/);
    assert.ok(!html.includes('<path'), `expected no path for ${JSON.stringify(bad)}`);
  }
});

test('countersBar shows all four labels, formats ints, — for missing, 0 for zero', () => {
  const html = countersBar({ holders: 1234, witnesses: 21, watchers: 0, views: 1000000 });
  assert.equal(typeof html, 'string');
  for (const l of ['Holders', 'Witnesses', 'Watchers', 'Views']) assert.match(html, new RegExp(l));
  assert.match(html, /1,234/);
  assert.match(html, /1,000,000/);
  assert.match(html, />0</); // watchers zero renders as 0, not —
});

test('countersBar with no input renders all dashes, no throw', () => {
  const html = countersBar();
  assert.equal(typeof html, 'string');
  const dashes = (html.match(/—/g) || []).length;
  assert.equal(dashes, 4);
});

test('clarityBadge bands by score and handles missing', () => {
  assert.match(clarityBadge(95), /c-high/);
  assert.match(clarityBadge(70), /c-moderate/);
  assert.match(clarityBadge(50), /c-limited/);
  assert.match(clarityBadge(10), /c-opaque/);
  assert.match(clarityBadge(95), /Clarity 95/);
  assert.match(clarityBadge(null), /c-unknown/);
  assert.match(clarityBadge(undefined), /Clarity —/);
  assert.match(clarityBadge(0), /Clarity 0/); // zero is a real score, not missing
});

test('lastUpdated accepts ISO/epoch/Date and renders "never" for junk', () => {
  const iso = lastUpdated('2026-06-03T12:34:56Z');
  assert.match(iso, /<time datetime="2026-06-03T12:34:56/);
  assert.match(iso, /2026-06-03 12:34Z/);
  assert.match(lastUpdated(Date.UTC(2026, 5, 3)), /<time datetime=/);
  assert.match(lastUpdated(new Date('2026-06-03T00:00:00Z')), /<time datetime=/);
  for (const bad of [undefined, null, '', 'not-a-date', NaN]) {
    assert.match(lastUpdated(bad), /never/, `expected never for ${String(bad)}`);
  }
});

test('lastUpdated escapes an injected timestamp string', () => {
  const html = lastUpdated('<script>alert(3)</script>');
  // invalid date → never, but ensure even attempted strings never leak raw script
  noRawScript(html, 'lastUpdated');
});

test('sentimentPill normalizes fraction and percent scales', () => {
  assert.match(sentimentPill(0.9), /up/);          // +0.9 fraction → bullish
  assert.match(sentimentPill(-0.9), /down/);        // bearish
  assert.match(sentimentPill(0), /gold/);           // neutral
  assert.match(sentimentPill(95), /up/);            // 0..100 percent high → bullish
  assert.match(sentimentPill(5), /down/);           // 0..100 percent low → bearish
  assert.match(sentimentPill(50), /gold/);          // mid percent → neutral
  assert.match(sentimentPill(NaN), /c-unknown/);
  assert.match(sentimentPill(undefined), /Sentiment —/);
});

test('every widget returns a non-empty string for normal input', () => {
  const outs = [
    tradingViewChart({ symbol: 'ETH', theme: 'dark' }),
    sparklineSvg([1, 2, 3]),
    countersBar({ holders: 1 }),
    clarityBadge(80),
    lastUpdated(Date.now()),
    sentimentPill(0.5),
  ];
  for (const o of outs) {
    assert.equal(typeof o, 'string');
    assert.ok(o.length > 0);
  }
});
