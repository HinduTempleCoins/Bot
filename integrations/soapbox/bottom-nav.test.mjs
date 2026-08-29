// bottom-nav.test.mjs — offline tests for the reusable COLLAPSIBLE bottom nav. node --test, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bottomNav,
  bottomNavHtml,
  bottomNavCss,
  bottomNavScript,
  NAV_ITEMS,
  ICONS,
  esc,
} from './bottom-nav.mjs';

test('renders the 3 default tabs with labels', () => {
  const html = bottomNav();
  assert.match(html, />Explore</);
  assert.match(html, />Profile</);
  assert.match(html, />Wallet</);
  assert.equal((html.match(/<a /g) || []).length, 3);
});

test('default tabs carry hrefs to public domains', () => {
  const html = bottomNav();
  assert.match(html, /href="https:\/\/soapbox\.community\//); // explore
  assert.match(html, /href="https:\/\/melek\.salon\/@hathor"/); // profile
  assert.match(html, /href="https:\/\/melek\.salon\/@hathor\/wallet"/); // wallet
});

test('built on native <details>/<summary> for no-JS collapse', () => {
  const html = bottomNav();
  assert.match(html, /<details class="bnav"/);
  assert.match(html, /<summary /);
  assert.match(html, /<nav class="bnav-items" aria-label="Primary">/);
});

test('collapsed:false (default) → the bar starts OPEN', () => {
  const html = bottomNav();
  assert.match(html, /<details class="bnav" open data-bnav>/);
});

test('collapsed:true → the bar starts COLLAPSED (no open attribute)', () => {
  const html = bottomNav({ collapsed: true });
  assert.match(html, /<details class="bnav" data-bnav>/);
  assert.ok(!/<details class="bnav" open/.test(html), 'collapsed bar must not carry the open attribute');
});

test('active tab gets active class and aria-current', () => {
  const html = bottomNav({ active: 'wallet' });
  assert.match(html, /class="bnav-active" aria-current="page" data-nav="wallet"/);
  assert.equal((html.match(/aria-current="page"/g) || []).length, 1);
  assert.equal((html.match(/class="bnav-active"/g) || []).length, 1);
});

test('custom items render with their labels and hrefs', () => {
  const items = [
    { id: 'a', label: 'Alpha', href: 'https://melek.salon/a', icon: 'home' },
    { id: 'b', label: 'Beta', href: 'https://melek.salon/b', icon: 'search' },
  ];
  const html = bottomNav({ items, active: 'b' });
  assert.match(html, />Alpha</);
  assert.match(html, />Beta</);
  assert.match(html, /href="https:\/\/melek\.salon\/a"/);
  assert.match(html, /href="https:\/\/melek\.salon\/b"/);
  assert.equal((html.match(/<a /g) || []).length, 2);
});

test('SVG icons are present (items + the collapse chevron)', () => {
  const html = bottomNav();
  assert.ok(html.includes('<svg'), 'should contain inline svg');
  assert.ok(html.includes('bnav-chev'), 'the toggle chevron is present');
  assert.ok(ICONS.compass && ICONS.person && ICONS.wallet && ICONS.grid && ICONS.chevron,
    'icon set includes the defaults + chevron');
});

test('esc() escapes a hostile label and url — no raw injection', () => {
  const items = [{
    id: 'x',
    label: '<script>alert(1)</script>',
    href: 'https://evil"onmouseover="alert(1)',
    icon: 'home',
  }];
  const html = bottomNav({ items });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!/href="https:\/\/evil"onmouseover/.test(html), 'attribute break-out must be escaped');
  assert.match(html, /&quot;onmouseover/);
});

test('a hostile toggleLabel is escaped', () => {
  const html = bottomNav({ toggleLabel: '<b>x</b>' });
  assert.ok(!html.includes('<b>x</b>'));
  assert.match(html, /&lt;b&gt;x&lt;\/b&gt;/);
});

test('garbage / empty items soft-fail (no throw, skipped)', () => {
  assert.doesNotThrow(() => bottomNav({ items: [null, undefined, 42, {}, 'nope'] }));
  const html = bottomNav({ items: [null, undefined, 42, 'nope'] });
  assert.equal((html.match(/<a /g) || []).length, 0);
});

test('completely broken input never throws', () => {
  assert.doesNotThrow(() => bottomNav(null));
  assert.doesNotThrow(() => bottomNav('garbage'));
  assert.doesNotThrow(() => bottomNavHtml(undefined));
  assert.equal(typeof bottomNav(null), 'string');
});

test('bottom-anchored, collapse-aware CSS is present', () => {
  const css = bottomNavCss();
  assert.match(css, /position:fixed/);
  assert.match(css, /bottom:0/);
  assert.match(css, /\.bnav\[open\] \.bnav-chev\{transform:rotate\(180deg\)\}/); // expand affordance
  assert.ok(bottomNav().includes('position:fixed'));
});

test('theme-aware: dark-mode block present', () => {
  assert.match(bottomNavCss(), /@media \(prefers-color-scheme:dark\)/);
});

test('desktop treatment: default docks to a corner; showOnDesktop spans full width', () => {
  assert.match(bottomNavCss(), /@media \(min-width:768px\)/);
  assert.ok(!/min-width:768px/.test(bottomNavCss({ showOnDesktop: true })));
});

test('progressive-enhancement script remembers state, no network', () => {
  const js = bottomNavScript();
  assert.match(js, /localStorage/);
  assert.match(js, /addEventListener\("toggle"/);
  assert.match(js, /aria-expanded/);
  assert.ok(!/fetch|XMLHttpRequest|http/i.test(js), 'the script does no network');
  // noScript omits it
  assert.ok(!bottomNav({ noScript: true }).includes('<script'));
  assert.ok(bottomNav().includes('<script'));
});

test('baseUrls override the default hrefs', () => {
  const html = bottomNav({
    baseUrls: { profile: '/@alice', wallet: '/@alice/wallet', home: '/discover' },
  });
  assert.match(html, /href="\/@alice"/);
  assert.match(html, /href="\/@alice\/wallet"/);
  assert.match(html, /href="\/discover"/);
});

test('env vars override default hrefs (fallback below baseUrls)', () => {
  const prev = process.env.BOTTOM_NAV_PROFILE;
  process.env.BOTTOM_NAV_PROFILE = 'https://melek.salon/@env-user';
  try {
    assert.match(bottomNav(), /href="https:\/\/melek\.salon\/@env-user"/);
    assert.match(bottomNav({ baseUrls: { profile: '/@override' } }), /href="\/@override"/);
  } finally {
    if (prev === undefined) delete process.env.BOTTOM_NAV_PROFILE;
    else process.env.BOTTOM_NAV_PROFILE = prev;
  }
});

test('nav landmark + summary a11y present; svgs aria-hidden', () => {
  const html = bottomNav();
  assert.match(html, /<nav class="bnav-items" aria-label="Primary">/);
  assert.match(html, /<summary aria-label="/);
  assert.match(html, /aria-hidden="true"/);
});

test('output is a self-contained style + details (+ script) string', () => {
  const html = bottomNav();
  assert.ok(html.startsWith('<style>'));
  assert.ok(html.includes('</style><details'));
  assert.ok(html.includes('</details>'));
});

test('esc() basic behavior', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('NAV_ITEMS default set is Explore/Profile/Wallet', () => {
  assert.deepEqual(NAV_ITEMS.map((i) => i.id), ['explore', 'profile', 'wallet']);
});
