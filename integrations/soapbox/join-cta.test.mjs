// Offline tests for the shared Join-MELEK CTA. Pure — no disk, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinCta, withUtm, SIGNUP_URL } from './join-cta.mjs';

test('joinCta renders our own signup with UTM attribution for the source', () => {
  const html = joinCta({ source: 'hemp' });
  assert.match(html, /wallet\.melek\.salon\/signup/);
  assert.match(html, /utm_source=hemp/);
  assert.match(html, /utm_medium=content/);
  assert.match(html, /utm_campaign=join-melek/);
  // secondary CTAs to our other properties
  assert.match(html, /alpha\.kula\.money/);
  assert.match(html, /pool\.soapbox\.community/);
});

test('joinCta links ONLY to our own sites (no third-party brand)', () => {
  const html = joinCta({ source: 'soapbox-data' });
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 3);
  for (const h of hrefs) assert.match(h, /(melek\.salon|kula\.money|soapbox\.community)/, `${h} is ours`);
});

test('withUtm sanitizes the source and preserves the base URL', () => {
  const u = withUtm(SIGNUP_URL, { source: 'Hemp Vertical!!' });
  assert.match(u, /utm_source=hempvertical/);   // lowercased, stripped
  assert.ok(u.startsWith(SIGNUP_URL.split('?')[0]));
});

test('compact variant is a single-line row, still attributed', () => {
  const html = joinCta({ source: 'coupons', compact: true });
  assert.match(html, /join-cta compact/);
  assert.match(html, /utm_source=coupons/);
});

test('soft-fail — bad input never throws', () => {
  assert.doesNotThrow(() => joinCta());
  assert.doesNotThrow(() => joinCta({ source: null }));
  assert.equal(typeof joinCta({}), 'string');
});
