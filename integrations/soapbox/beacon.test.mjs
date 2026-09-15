// The beacon is injected into 99 server files. A change here changes every page on the network, so the
// invariants are tested rather than trusted: no cookies, no identifiers, nothing but path and referrer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import { BEACON_TAG, BEACON_JS, beaconTag, BEACON_BASE } from './beacon.mjs';

test('the tag is quote-safe for splicing into any HTML template', () => {
  assert.ok(!BEACON_TAG.includes("'"), 'no single quotes — would break single-quoted JS strings');
  assert.ok(!BEACON_TAG.includes('`'), 'no backticks — would break template literals');
  assert.ok(!BEACON_TAG.includes('${'), 'no interpolation — it is a literal, not a template');
});

test('the tag carries BOTH the script and the no-JS pixel', () => {
  assert.match(BEACON_TAG, /<script defer src="[^"]+\/b\.js"><\/script>/);
  assert.match(BEACON_TAG, /<noscript><img src="[^"]+\/px\.gif"/);
});

test('beaconTag() points at an alternate collector without a trailing slash', () => {
  const t = beaconTag('https://stage.example.org/');
  assert.match(t, /https:\/\/stage\.example\.org\/b\.js/);
  assert.ok(!t.includes('example.org//'));
});

test('the client script sends ONLY path and referrer — no identifier of any kind', () => {
  assert.match(BEACON_JS, /location\.pathname/);
  assert.match(BEACON_JS, /document\.referrer/);
  for (const forbidden of ['document.cookie', 'localStorage', 'sessionStorage', 'indexedDB',
    'canvas', 'screen.', 'navigator.plugins', 'crypto.randomUUID']) {
    assert.ok(!BEACON_JS.includes(forbidden), `must not touch ${forbidden}`);
  }
});

test('the client script can never throw onto a page it is a guest on', () => {
  assert.match(BEACON_JS, /^\(function\(\)\{try\{/);
  assert.match(BEACON_JS, /catch\(e\)\{\}\}\)\(\);$/);
  assert.match(BEACON_JS, /\.catch\(/, 'the fetch fallback swallows its own rejection too');
});

test('sendBeacon is tried BEFORE fetch — it is the one that survives page unload', () => {
  assert.ok(BEACON_JS.indexOf('sendBeacon') < BEACON_JS.indexOf('fetch('), 'sendBeacon first');
});

test('the collector serves exactly the script this module defines — they cannot drift', () => {
  const server = readFileSync(new URL('../../site/analytics/server.mjs', import.meta.url), 'utf8');
  assert.match(server, /from '\.\.\/\.\.\/integrations\/soapbox\/beacon\.mjs'/);
  assert.match(server, /path === '\/b\.js'/);
  assert.match(server, /res\.end\(BEACON_JS\)/);
});

test('the injected tag on the network matches this module byte for byte', () => {
  // If someone hand-edits a page's tag, this catches it — 99 copies of a string is exactly the kind of
  // thing that silently diverges.
  const files = globSync('site/*/server.mjs', { cwd: new URL('../../', import.meta.url).pathname });
  let carriers = 0;
  for (const rel of files) {
    const src = readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');
    if (rel === 'site/analytics/server.mjs') continue;   // the collector serves /b.js, it does not load it
    if (!src.includes('/b.js')) continue;
    carriers++;
    assert.ok(src.includes(BEACON_TAG), `${rel} carries a tag that is not the canonical one`);
  }
  assert.ok(carriers >= 90, `expected the network to be instrumented, found ${carriers}`);
});

test('the collector host is a first-party SoapBox host, not an ad-tech vendor', () => {
  assert.match(BEACON_BASE, /^https:\/\/[a-z]+\.soapbox\.community$/);
});
