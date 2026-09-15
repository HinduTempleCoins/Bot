// The registry and the crawl surface must not drift. A host advertised to crawlers that does not
// resolve is the failure this file exists to prevent: data.soapbox.community sat in PUBLIC_SITES
// returning 000, so every sitemap-index we published pointed a crawler at a dead host.

import test from 'node:test';
import assert from 'node:assert/strict';
import { SURFACES, CATEGORIES, counts, live, built, bySlug, PROBED_ON } from './portfolio.mjs';
import { PUBLIC_SITES } from './crawlers.mjs';

test('⭐ every host advertised to crawlers is LIVE in the portfolio', () => {
  const byHost = Object.fromEntries(SURFACES.map((s) => [s.host, s]));
  for (const p of PUBLIC_SITES) {
    const host = new URL(p.url).host;
    const s = byHost[host];
    assert.ok(s, `${host} is in PUBLIC_SITES but not in the portfolio registry`);
    assert.equal(s.state, 'live', `${host} is advertised to crawlers but is "${s.state}"`);
  }
});

test('⛔ no admin host reaches the crawl registry', () => {
  for (const p of PUBLIC_SITES) {
    assert.doesNotMatch(p.url, /soapy\.blog|\/\/admin\.|\/\/console\.|\/\/analytics\./, p.url);
  }
});

test('PUBLIC_SITES entries are unique and well formed', () => {
  assert.equal(new Set(PUBLIC_SITES.map((s) => s.slug)).size, PUBLIC_SITES.length);
  assert.equal(new Set(PUBLIC_SITES.map((s) => s.url)).size, PUBLIC_SITES.length);
  for (const p of PUBLIC_SITES) {
    assert.match(p.url, /^https:\/\//, `${p.slug} must be https`);
    assert.ok(!p.url.endsWith('/'), `${p.slug} must have no trailing slash`);
    assert.ok(p.name, `${p.slug} needs a name`);
  }
});

test('the portfolio counts add up and the probe date is real', () => {
  const c = counts();
  assert.equal(c.live, live().length);
  assert.equal(c.built, built().length);
  assert.match(PROBED_ON, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(new Date(PROBED_ON).getTime() > 0);
});

test('a built surface is never quietly promoted by adding it to the crawl registry', () => {
  // The only way to move a host into PUBLIC_SITES is to flip its portfolio state to live, which
  // requires a probe. That coupling is the point.
  const advertised = new Set(PUBLIC_SITES.map((p) => new URL(p.url).host));
  for (const s of built()) assert.ok(!advertised.has(s.host), `${s.host} is built, not live — do not advertise it`);
});
