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
  // ⚠️ NOT every page may carry it, and that is deliberate — do not "fix" this into a 100% coverage
  // assertion. A blanket injection was tried and broke real invariants held by other suites:
  //   · site/idlegames + site/flashlight assert NO external <script src> at all — they are offline-
  //     capable by promise, and a beacon tag is an external script.
  //   · site/hub, site/witness, site/hathor-live, site/oversight assert soapy.blog appears NOWHERE on
  //     a public page — the collector is the PRIVATE admin host and naming it on a public surface leaks
  //     it. Those invariants landed AFTER the beacon was hand-injected on the box, and the two were
  //     never reconciled; the invariant wins, so those six directories carry no beacon.
  // The real anti-drift property is the assert above: every page that DOES carry a tag carries the
  // canonical one. The floor just catches a mass-removal.
  assert.ok(carriers > 50, `expected the network to be instrumented, found ${carriers}`);
});

test('the collector is on the PRIVATE admin host, never a public subdomain', () => {
  // Analytics is private. It must not sit on a crawlable soapbox.community subdomain.
  assert.match(BEACON_BASE, /^https:\/\/soapy\.blog$/);
  assert.ok(!BEACON_TAG.includes('soapbox.community'), 'no public subdomain in the tag');
});

test('⚠️ the sendBeacon payload is text/plain — application/json is rejected in no-cors mode', () => {
  // sendBeacon dispatches no-cors, which permits only the CORS-safelisted content types. A Blob
  // typed application/json never leaves the browser, and no server header can fix it. This was
  // shipped once and cost the whole network its analytics; only a real browser surfaced it.
  assert.match(BEACON_JS, /type:"text\/plain;charset=UTF-8"/);
  assert.ok(!BEACON_JS.includes('application/json'), 'no non-safelisted content type anywhere');
});

test('a refused sendBeacon falls through to the fetch instead of returning as if sent', () => {
  assert.match(BEACON_JS, /if\(navigator\.sendBeacon\(/, 'the return value is checked');
});
