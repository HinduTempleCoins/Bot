// site-routes.test.mjs — offline tests for the declarative site route manifest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUTES,
  routesByVisibility,
  findRoute,
  normalizePath,
  renderManifest,
  esc,
} from './site-routes.mjs';

test('ROUTES is a non-empty array of well-shaped entries', () => {
  assert.ok(Array.isArray(ROUTES));
  assert.ok(ROUTES.length > 0);
  for (const r of ROUTES) {
    assert.equal(typeof r.path, 'string');
    assert.ok(r.path.startsWith('/'), `path must start with / : ${r.path}`);
    assert.equal(typeof r.title, 'string');
    assert.ok(r.title.length > 0);
    assert.equal(typeof r.module, 'string');
    assert.ok(r.module.endsWith('.mjs'), `module must be an .mjs file : ${r.module}`);
    assert.equal(typeof r.public, 'boolean');
    assert.equal(typeof r.description, 'string');
  }
});

test('paths are unique (normalized)', () => {
  const seen = new Set();
  for (const r of ROUTES) {
    const p = normalizePath(r.path);
    assert.ok(!seen.has(p), `duplicate path ${p}`);
    seen.add(p);
  }
});

test('the new pages are all present: landing, tutorial, mail, moderation', () => {
  for (const p of ['/landing', '/tutorial', '/mail', '/moderation']) {
    assert.ok(findRoute(p), `expected route ${p} to exist`);
  }
});

test('public/admin split is correct', () => {
  const { public: pub, admin } = routesByVisibility();
  assert.ok(pub.length > 0);
  assert.ok(admin.length > 0);
  // every public entry is public:true, every admin entry is public:false
  assert.ok(pub.every((r) => r.public === true));
  assert.ok(admin.every((r) => r.public === false));
  // moderation is admin (gated); landing/tutorial/mail are public
  assert.equal(findRoute('/moderation').public, false);
  assert.equal(findRoute('/landing').public, true);
  assert.equal(findRoute('/tutorial').public, true);
  assert.equal(findRoute('/mail').public, true);
  // split partition covers every route exactly once
  assert.equal(pub.length + admin.length, ROUTES.length);
});

test('findRoute: exact match, normalization, and misses', () => {
  const m = findRoute('/mail');
  assert.equal(m.title, 'Mail — Email Signup & Notices');
  // normalization: trailing slash and missing leading slash both resolve
  assert.equal(findRoute('/mail/'), m);
  assert.equal(findRoute('mail'), m);
  // home resolves from "" and "/"
  assert.ok(findRoute('/'));
  assert.equal(findRoute(''), findRoute('/'));
  // miss returns undefined
  assert.equal(findRoute('/does-not-exist'), undefined);
});

test('findRoute is soft on bad input (never throws)', () => {
  assert.equal(findRoute(null), findRoute('/'));
  assert.equal(findRoute(undefined), findRoute('/'));
  assert.doesNotThrow(() => findRoute({}));
});

test('normalizePath edge cases', () => {
  assert.equal(normalizePath(''), '/');
  assert.equal(normalizePath('/'), '/');
  assert.equal(normalizePath('tutorial'), '/tutorial');
  assert.equal(normalizePath('/mail/'), '/mail');
  assert.equal(normalizePath('//a//b//'), '/a/b');
  assert.equal(normalizePath(null), '/');
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a>&"'), '&lt;a&gt;&amp;&quot;');
  assert.equal(esc(null), '');
});

test('renderManifest produces escaped HTML containing the new routes', () => {
  const html = renderManifest();
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /\/landing/);
  assert.match(html, /\/tutorial/);
  assert.match(html, /\/mail/);
  assert.match(html, /\/moderation/);
  // no raw em-dash-free injection: title with & must be escaped in output
  assert.match(html, /&amp;/);
});
