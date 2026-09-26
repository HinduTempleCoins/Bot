// ecosystem-nav.test.mjs — offline tests for the shared cross-property nav.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ECOSYSTEM_LINKS, links, navBar, navSidebar, navDrawer, NAV_DRAWER_JS } from './ecosystem-nav.mjs';

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
  // World Law is live:false → a <span class=...soon...>, not an <a href>
  assert.match(html, /soon/);
  assert.ok(!/<a[^>]*>World Law<\/a>/.test(html), 'World Law (not live) must not be a link yet');
});

test('MELEK and PRANA are live links: post on MELEK.Salon, contribute to PRANA (the mining guide)', () => {
  const html = navBar({});
  assert.match(html, /<a class="enav-link" href="https:\/\/melek\.salon">MELEK<\/a>/);
  assert.match(html, /<a class="enav-link" href="https:\/\/witness\.melek\.salon\/mine">PRANA<\/a>/);
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

// ── the drawer: a nav you can put away and bring back ───────────────────────────────────────────
test('navDrawer renders a real button wired to a real panel', () => {
  const h = navDrawer({ current: 'roadmap' });
  assert.match(h, /<button type=button class=enav-toggle/, 'the toggle must be a button, not a div');
  assert.match(h, /aria-expanded=true/);
  assert.match(h, /aria-controls=enav-panel/);
  assert.match(h, /id=enav-panel/, 'aria-controls must point at something that exists');
});

test('navDrawer renders OPEN without JavaScript', () => {
  const h = navDrawer();
  // The panel must not carry `hidden` in the markup — a nav that needs a script to appear is worse
  // than one that cannot be closed.
  assert.ok(!/class="enav-panel[^"]*"[^>]*\bhidden\b/.test(h), 'panel must not start hidden');
  assert.match(h, /enav-link/, 'links are present in the server-rendered HTML');
});

test('each group folds on its own, with no script at all', () => {
  const h = navDrawer({ openGroups: ['SoapBox'] });
  assert.equal((h.match(/<details class=enav-sec/g) || []).length, 3);
  // Only the requested group starts open.
  assert.equal((h.match(/<details class=enav-sec open>/g) || []).length, 1);
  assert.match(h, /<details class=enav-sec open><summary>SoapBox/);
});

test('navDrawer marks the current page and escapes everything', () => {
  const h = navDrawer({ current: 'roadmap', brand: '<script>x</script>', label: '"><b>' });
  assert.ok(!h.includes('<script>x'), 'brand must be escaped');
  assert.ok(!h.includes('"><b>'), 'label must be escaped');
  assert.match(h, /aria-current="page"/);
});

test('the drawer script guards every storage access', () => {
  // A private window or an embedded webview throws on localStorage. A nav that throws takes the
  // page down with it, so every access is wrapped.
  const js = NAV_DRAWER_JS;
  const reads = (js.match(/localStorage/g) || []).length;
  const guards = (js.match(/try\s*\{/g) || []).length;
  assert.ok(reads >= 2);
  assert.ok(guards >= 2, 'each localStorage access sits inside its own try');
  assert.match(js, /aria-expanded/, 'the script keeps the accessible state honest, not just the CSS');
  assert.ok(!/Escape/.test(js), 'no Escape key handling — phones do not have one');
  assert.match(js, /contains\(e\.target\)/, 'tap outside closes it, which is the gesture on a phone');
});

test('navBar and navSidebar still work — the drawer is additive', () => {
  assert.match(navBar({ current: 'roadmap' }), /<nav class=enav>/);
  assert.match(navSidebar({ current: 'roadmap' }), /enav-side/);
});
