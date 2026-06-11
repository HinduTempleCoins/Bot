// render.test.mjs — the MELEK registration-page renderer (render.mjs). Pure, fully offline.
// Jobs: (1) XSS guard — every caller-supplied value (username, key strings, brand, referrer/token)
// must be escaped before it reaches the HTML; (2) custody/UX fidelity — all four keys render with
// plain-language help, blank keys show a "generating" placeholder, the page is noindex, and the
// form posts to the configured route; (3) soft-fail — bad/empty opts produce a valid page, never throw.
// Run: node --test site/signup-pages/render.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderRegisterPage, esc, KEYS } from './render.mjs';

test('esc escapes the HTML metacharacters and nullish', () => {
  assert.equal(esc(`<>&"`), '&lt;&gt;&amp;&quot;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('renders a full standalone HTML page with MELEK branding by default', () => {
  const html = renderRegisterPage();
  assert.ok(html.startsWith('<!doctype html>'), 'is a full document');
  assert.ok(/<html lang=en>/.test(html));
  assert.ok(html.includes('MELEK'), 'MELEK brand present');
  assert.ok(/<form method=post action="\/account\/register">/.test(html), 'default post route');
  assert.ok(/name=username/.test(html), 'username field present');
  assert.ok(/I saved my keys/.test(html), 'create-account button present');
});

test('the page is noindex (staging / non-public surface)', () => {
  assert.ok(/<meta name=robots content="noindex">/.test(renderRegisterPage()));
});

test('shows all four keys with plain-language help and no crypto jargon', () => {
  const html = renderRegisterPage();
  for (const k of KEYS) {
    assert.ok(html.includes(k.label), `${k.label} shown`);
    assert.ok(html.includes(esc(k.help)), `${k.label} help shown`);
  }
  // PLAIN language: no Graphene/WIF/posting-authority jargon on the page.
  assert.ok(!/Graphene/i.test(html), 'no "Graphene"');
  assert.ok(!/\bWIF\b/.test(html), 'no "WIF"');
  assert.ok(!/posting authority/i.test(html), 'no "posting authority"');
});

test('blank keys render a generating placeholder; provided keys render as given', () => {
  const blank = renderRegisterPage();
  assert.ok(/generating in your browser/.test(blank), 'placeholder when no keys');

  const filled = renderRegisterPage({ keys: { owner: 'PUB_OWNER_PLACEHOLDER', active: 'PUB_ACTIVE', posting: 'PUB_POST', memo: 'PUB_MEMO' } });
  assert.ok(filled.includes('PUB_OWNER_PLACEHOLDER'), 'owner key string shown');
  assert.ok(filled.includes('PUB_MEMO'), 'memo key string shown');
});

test('username, brand, postUrl, referrer and token are all escaped (XSS guard)', () => {
  const html = renderRegisterPage({
    username: '"><script>alert(1)</script>',
    brand: '<b>Evil</b>',
    postUrl: '/x"><script>alert(2)</script>',
    referrer: '"><img src=x onerror=alert(3)>',
    token: '"><script>alert(4)</script>',
  });
  assert.ok(!/<script>alert/i.test(html), 'no live script from any field');
  assert.ok(!/<img src=x onerror/i.test(html), 'no live img from referrer');
  assert.ok(html.includes('&lt;script&gt;alert(1)'), 'username escaped');
  assert.ok(html.includes('&lt;b&gt;Evil&lt;/b&gt;'), 'brand escaped');
});

test('a hostile key string is escaped, not rendered as live HTML', () => {
  const html = renderRegisterPage({ keys: { owner: '<script>alert(5)</script>' } });
  assert.ok(!/<script>alert\(5\)/i.test(html), 'no live script from key value');
  assert.ok(html.includes('&lt;script&gt;alert(5)'), 'key value escaped');
});

test('referrer and token render as hidden inputs only when present', () => {
  const without = renderRegisterPage();
  assert.ok(!/name=referrer/.test(without), 'no referrer input when absent');
  assert.ok(!/name=token/.test(without), 'no token input when absent');

  const withVals = renderRegisterPage({ referrer: 'punicwax', token: 'abc123' });
  assert.ok(/<input type=hidden name=referrer value="punicwax">/.test(withVals));
  assert.ok(/<input type=hidden name=token value="abc123">/.test(withVals));
});

test('soft-fail: bad opts never throw, produce a valid default page', () => {
  for (const bad of [null, undefined, 42, 'nope', [], { keys: 'not-an-object' }]) {
    let html;
    assert.doesNotThrow(() => { html = renderRegisterPage(bad); });
    assert.ok(html.startsWith('<!doctype html>'), 'still a full page');
    assert.ok(html.includes('MELEK'), 'still branded');
  }
});

test('a custom brand and postUrl flow through', () => {
  const html = renderRegisterPage({ brand: 'MELEK', postUrl: '/signup/finish', tagline: 'Join us' });
  assert.ok(/action="\/signup\/finish"/.test(html));
  assert.ok(html.includes('Join us'));
});
