// ecosystem-nav.test.mjs — offline tests for the shared cross-property nav.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECOSYSTEM_LINKS, links, navBar, navSidebar } from './ecosystem-nav.mjs';

test('registry has the live properties + grouped', () => {
  const keys = ECOSYSTEM_LINKS.map((l) => l.key);
  for (const k of ['roadmap', 'soapbox', 'data', 'law', 'politics', 'oversight', 'melek-testnet']) {
    assert.ok(keys.includes(k), `missing ${k}`);
  }
  assert.ok(links({ group: 'SoapBox' }).length >= 6);
  assert.ok(links({ group: 'Chains' }).length >= 2);
});

test('navBar links live properties + marks current + never shows admin/soapy', () => {
  const html = navBar({ current: 'roadmap' });
  assert.match(html, /vankushfamily\.com/);
  assert.match(html, /law\.soapbox\.community/);
  assert.match(html, /alpha\.melek\.salon/);
  assert.match(html, /current/); // roadmap marked current
  assert.ok(!/soapy\.blog/.test(html), 'admin must never appear in the nav');
});

test('not-live links render muted "soon" and are not anchors', () => {
  const html = navBar({});
  // PRANA is live:false → a <span class=...soon...>, not an <a href>
  assert.match(html, /soon/);
  assert.ok(!/<a[^>]*>PRANA<\/a>/.test(html), 'PRANA (not live) must not be a link yet');
});

test('navSidebar renders group titles', () => {
  const html = navSidebar({ current: 'data' });
  assert.match(html, /enav-side/);
  assert.match(html, /Project/);
  assert.match(html, /SoapBox/);
  assert.match(html, /Chains/);
});

test('env override repoints a link', () => {
  const prev = process.env.LAW_SITE;
  process.env.LAW_SITE = 'https://staging-law.example';
  // re-import with cache bust
  return import('./ecosystem-nav.mjs?bust=' + Date.now()).then((m) => {
    assert.match(m.navBar({}), /staging-law\.example/);
    if (prev === undefined) delete process.env.LAW_SITE; else process.env.LAW_SITE = prev;
  });
});
