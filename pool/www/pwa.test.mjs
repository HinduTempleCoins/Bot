// Tests for the PWA bits: manifest JSON validity, service-worker cache-list sanity, and the
// registration guard. All offline — just reads the static files + drives registerServiceWorker
// with fake navigator/location.
// Run: node --test pool/www/pwa.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { registerServiceWorker } from './pwa.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const read = (f) => readFileSync(join(here, f), 'utf8');

// ---------- manifest ----------
test('manifest.webmanifest is valid JSON with the required PWA fields', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'SoapBox Pool');
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/mycoins.html'); // add-to-home-screen opens the dashboard
  assert.equal(m.scope, '/');
  assert.ok(Array.isArray(m.icons) && m.icons.length >= 1, 'has at least one icon');
  for (const ic of m.icons) {
    assert.ok(ic.src, 'icon has a src');
    assert.ok(ic.type, 'icon has a type');
  }
  // referenced icons exist on disk
  for (const ic of m.icons) assert.doesNotThrow(() => read(ic.src.replace(/^\//, '')), `icon ${ic.src} exists`);
  // theme/background are valid-ish hex colors
  assert.match(m.theme_color, /^#[0-9a-fA-F]{3,8}$/);
  assert.match(m.background_color, /^#[0-9a-fA-F]{3,8}$/);
});

// ---------- service worker cache list ----------
test('sw.js precaches a small first-party shell, never the API, and is safe', () => {
  const sw = read('sw.js');

  // Pull the CACHE_LIST array out of the source and parse it.
  const m = sw.match(/const CACHE_LIST\s*=\s*(\[[\s\S]*?\]);/);
  assert.ok(m, 'CACHE_LIST is declared');
  const list = JSON.parse(m[1].replace(/'/g, '"').replace(/,(\s*\])/g, '$1'));

  assert.ok(list.includes('/'), 'caches the root');
  assert.ok(list.includes('/mycoins.html'), 'caches the dashboard shell');
  assert.ok(list.includes('/index.html'), 'caches the pool shell');
  assert.ok(list.includes('/manifest.webmanifest'), 'caches the manifest');
  assert.ok(list.length <= 12, 'cache list stays small');

  // every precached entry is same-origin first-party and not an API/ws path
  for (const entry of list) {
    assert.ok(entry.startsWith('/'), `entry ${entry} is first-party absolute`);
    assert.ok(!entry.startsWith('//') && !/^https?:/.test(entry), `entry ${entry} is not cross-origin`);
    assert.ok(!entry.startsWith('/api/') && entry !== '/ws', `entry ${entry} is not a live endpoint`);
  }

  // the SW explicitly keeps live endpoints off the cache (network-first / passthrough)
  assert.match(sw, /\/api\//);
  assert.match(sw, /network-first|never persisted|never cache/i);
  // a versioned cache so updates evict the old one on activate
  assert.match(sw, /CACHE_VERSION/);
  assert.match(sw, /caches\.delete/);
});

// ---------- registration guard ----------
test('registerServiceWorker no-ops without serviceWorker support', () => {
  assert.equal(registerServiceWorker({}, { protocol: 'https:', hostname: 'x' }), false);
  assert.equal(registerServiceWorker(null, null), false);
});

test('registerServiceWorker requires a secure context', () => {
  const calls = [];
  const nav = { serviceWorker: { register: (...a) => { calls.push(a); return Promise.resolve(); } } };
  // insecure http on a real host -> refuse
  assert.equal(registerServiceWorker(nav, { protocol: 'http:', hostname: 'pool.soapbox.community' }), false);
  assert.equal(calls.length, 0);
  // https -> register at root scope
  assert.equal(registerServiceWorker(nav, { protocol: 'https:', hostname: 'pool.soapbox.community' }), true);
  assert.deepEqual(calls[0], ['/sw.js', { scope: '/' }]);
  // localhost over http is allowed (dev)
  assert.equal(registerServiceWorker(nav, { protocol: 'http:', hostname: 'localhost' }), true);
});

// ---------- the pages wire up the PWA ----------
test('index.html and mycoins.html link the manifest and register the SW', () => {
  for (const f of ['index.html', 'mycoins.html']) {
    const html = read(f);
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/, `${f} links manifest`);
    assert.match(html, /theme-color/, `${f} sets theme-color`);
    assert.match(html, /apple-mobile-web-app-capable/, `${f} is iOS add-to-home-screen capable`);
    assert.match(html, /src="pwa\.mjs"/, `${f} loads the SW registration`);
  }
});

test('index.html has the Measure-my-device card wired to measure.mjs', () => {
  const html = read('index.html');
  for (const id of ['measure', 'mm-run', 'mm-status', 'mm-hashrate', 'mm-threads', 'mm-earnings']) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
  assert.match(html, /src="measure\.mjs"/);
  assert.match(html, /Measure your own device/i);
  // honesty: local-only, no address, fractions of a cent
  assert.match(html, /hashes only on your device/i);
  assert.match(html, /no\s+payout address/i);
  assert.match(html, /nothing is submitted to the pool/i);
  assert.match(html, /fractions of a cent/i);
});
