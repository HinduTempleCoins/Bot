// condenser-beacon-proxy.test.mjs — the guard for the 2026-11-13 melek.salon outage.
//
// The proxy imports from integrations/soapbox/page-meta.mjs. When `ensureBeacon` was deleted from
// that module (beacon removed network-wide, 2026-10-21) this file still imported it, so the service
// died at import time with `does not provide an export named 'ensureBeacon'` and crash-looped
// ~25,000 times. Caddy proxies every melek.salon path that is not a static handler to this process,
// so the whole front end answered 502 for 23 hours.
//
// Importing this module at all is therefore the load-bearing assertion: a missing named import is a
// SyntaxError at link time and fails the suite instead of the site.
//
// OFFLINE: no server is started (the listen call is guarded by the process.argv[1] check), no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transformHtml } from './condenser-beacon-proxy.mjs';

const GTAG = '<script async src="https://www.googletagmanager.com/gtag/js?id=G-63ZBEY1EVG"></script>';
const page = (head = '') => `<!doctype html><html><head><title>A Post</title>${head}</head><body><p>hi</p></body></html>`;

test('the module imports — every named import it takes still exists upstream', () => {
  assert.equal(typeof transformHtml, 'function');
});

test('Google Analytics is stripped out of the SSR head shell', () => {
  const out = transformHtml(page(GTAG), 'melek.salon', '/trending');
  assert.ok(!out.includes('G-63ZBEY1EVG'), 'the GA property id must not survive');
  assert.ok(!out.includes('googletagmanager'), 'and neither must the loader');
  assert.ok(out.includes('<p>hi</p>'), 'the body is passed through untouched');
});

test('no pageview beacon is injected — the collector was removed network-wide', () => {
  const out = transformHtml(page(GTAG), 'melek.salon', '/@hathor');
  assert.ok(!/analytics\.soapbox\.community/.test(out), 'no collector call');
  assert.ok(!/navigator\.sendBeacon/.test(out), 'no beacon call');
});

test('a page with no canonical gets one for its own path, with the query dropped', () => {
  const out = transformHtml(page(), 'melek.salon', '/trending?sort=hot');
  assert.ok(out.includes('<link rel="canonical" href="https://melek.salon/trending">'));
});

test('a page that already declares a canonical keeps the one it has', () => {
  const mine = '<link rel="canonical" href="https://melek.salon/melek/@melek/image-test">';
  const out = transformHtml(page(mine), 'melek.salon', '/melek/@melek/image-test?x=1');
  assert.equal(out.match(/rel="canonical"/g).length, 1);
  assert.ok(out.includes(mine));
});

test('link-preview tags are filled in from the page itself', () => {
  const out = transformHtml(page(), 'melek.salon', '/trending');
  assert.match(out, /property="og:title"/);
  assert.match(out, /A Post/);
});

test('a junk host never reaches the markup, and odd input never throws', () => {
  const out = transformHtml(page(), 'melek.salon/evil"><script>', '/trending');
  assert.ok(!out.includes('<script>'), 'a host that is not a hostname is not interpolated');
  assert.equal(typeof transformHtml('', '', ''), 'string');
  assert.equal(typeof transformHtml('not html at all', 'melek.salon', '/'), 'string');
});
