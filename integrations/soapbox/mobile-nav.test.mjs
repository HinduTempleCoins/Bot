// mobile-nav.test.mjs — offline tests for the reusable mobile bottom nav. node --test, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderMobileNav,
  mobileNavHtml,
  mobileNavCss,
  NAV_ITEMS,
  ICONS,
  esc,
} from './mobile-nav.mjs';

test('renders the 3 default tabs with labels', () => {
  const html = renderMobileNav();
  assert.match(html, />Explore</);
  assert.match(html, />Profile</);
  assert.match(html, />Wallet</);
  // three anchors
  assert.equal((html.match(/<a /g) || []).length, 3);
});

test('default tabs carry hrefs to public domains', () => {
  const html = renderMobileNav();
  assert.match(html, /href="https:\/\/soapbox\.community\//); // explore
  assert.match(html, /href="https:\/\/melek\.salon\/@hathor"/); // profile
  assert.match(html, /href="https:\/\/melek\.salon\/@hathor\/wallet"/); // wallet
});

test('active tab gets active class and aria-current', () => {
  const html = renderMobileNav({ active: 'wallet' });
  assert.match(html, /class="mnav-active" aria-current="page" data-nav="wallet"/);
  // exactly one active tab / one aria-current across the bar
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  assert.equal((html.match(/class="mnav-active"/g) || []).length, 1);
});

test('custom items render with their labels and hrefs', () => {
  const items = [
    { id: 'a', label: 'Alpha', href: 'https://melek.salon/a', icon: 'home' },
    { id: 'b', label: 'Beta', href: 'https://melek.salon/b', icon: 'search' },
  ];
  const html = renderMobileNav({ items, active: 'b' });
  assert.match(html, />Alpha</);
  assert.match(html, />Beta</);
  assert.match(html, /href="https:\/\/melek\.salon\/a"/);
  assert.match(html, /href="https:\/\/melek\.salon\/b"/);
  assert.match(html, /data-nav="b"[^>]*aria-current|aria-current="page" data-nav="b"/);
  assert.equal((html.match(/<a /g) || []).length, 2);
});

test('SVG icons are present in the output', () => {
  const html = renderMobileNav();
  assert.ok(html.includes('<svg'), 'should contain inline svg');
  // default items use compass/person/wallet icons
  assert.ok(html.includes(ICONS.compass.slice(0, 20)));
  assert.ok(ICONS.person && ICONS.wallet && ICONS.grid && ICONS.search && ICONS.home,
    'icon set includes person/wallet/grid/search/home spares');
});

test('esc() escapes a hostile label and url — no raw injection', () => {
  const items = [{
    id: 'x',
    label: '<script>alert(1)</script>',
    href: 'https://evil"onmouseover="alert(1)',
    icon: 'home',
  }];
  const html = renderMobileNav({ items });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!/href="https:\/\/evil"onmouseover/.test(html), 'attribute break-out must be escaped');
  assert.match(html, /&quot;onmouseover/);
});

test('garbage / empty items soft-fail (no throw, skipped)', () => {
  assert.doesNotThrow(() => renderMobileNav({ items: [null, undefined, 42, {}, 'nope'] }));
  const html = renderMobileNav({ items: [null, undefined, 42, 'nope'] });
  // none of those are valid -> zero anchors
  assert.equal((html.match(/<a /g) || []).length, 0);
});

test('completely broken input never throws', () => {
  assert.doesNotThrow(() => renderMobileNav(null));
  assert.doesNotThrow(() => renderMobileNav('garbage'));
  assert.doesNotThrow(() => mobileNavHtml(undefined));
  assert.equal(typeof renderMobileNav(null), 'string');
});

test('fixed-position CSS is present', () => {
  const css = mobileNavCss();
  assert.match(css, /position:fixed/);
  assert.match(css, /bottom:0/);
  assert.ok(renderMobileNav().includes('position:fixed'));
});

test('default CSS hides on desktop; showOnDesktop keeps it', () => {
  assert.match(mobileNavCss(), /@media \(min-width:768px\)\{\.mnav\{display:none\}\}/);
  assert.ok(!/display:none/.test(mobileNavCss({ showOnDesktop: true })));
});

test('baseUrls override the default hrefs', () => {
  const html = renderMobileNav({
    baseUrls: { profile: '/@alice', wallet: '/@alice/wallet', home: '/discover' },
  });
  assert.match(html, /href="\/@alice"/);
  assert.match(html, /href="\/@alice\/wallet"/);
  assert.match(html, /href="\/discover"/);
});

test('env vars override default hrefs (fallback below baseUrls)', () => {
  const prev = process.env.MOBILE_NAV_PROFILE;
  process.env.MOBILE_NAV_PROFILE = 'https://melek.salon/@env-user';
  try {
    const html = renderMobileNav();
    assert.match(html, /href="https:\/\/melek\.salon\/@env-user"/);
    // baseUrls still beats env
    const html2 = renderMobileNav({ baseUrls: { profile: '/@override' } });
    assert.match(html2, /href="\/@override"/);
  } finally {
    if (prev === undefined) delete process.env.MOBILE_NAV_PROFILE;
    else process.env.MOBILE_NAV_PROFILE = prev;
  }
});

test('nav landmark and aria-label present for accessibility', () => {
  const html = renderMobileNav();
  assert.match(html, /<nav class="mnav" aria-label="Primary">/);
  // svgs are aria-hidden so labels carry the a11y name
  assert.match(html, /aria-hidden="true"/);
});

test('output is a self-contained style + nav string', () => {
  const html = renderMobileNav();
  assert.ok(html.startsWith('<style>'));
  assert.ok(html.includes('</style><nav'));
});

test('esc() basic behavior', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('NAV_ITEMS default set is Explore/Profile/Wallet', () => {
  assert.deepEqual(NAV_ITEMS.map((i) => i.id), ['explore', 'profile', 'wallet']);
});
