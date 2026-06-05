// Tests for the browser-mining page: the index.html structure/order + honesty copy, the
// vendored RandomX library correctness (the load-bearing "this is real, not a demo" claim),
// and that the page glue is importable headless.
// Run: node --test pool/www/browser-mine.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomx_init_cache, randomx_create_vm } from './vendor/randomx/randomx.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'index.html'), 'utf8');

// ---- vendored RandomX is REAL (official test vector) ----
test('vendored randomx.js matches the official RandomX test vector (real, not a demo)', () => {
  const cache = randomx_init_cache('test key 000');
  const vm = randomx_create_vm(cache);
  const hex = vm.calculate_hex_hash('This is a test');
  assert.equal(hex, '639183aae1bf4c9a35884cb46b09cad9175f04efd7684e7262a0ac1c2f0b4e3f');
});

// ---- page order: browser mining is on TOP, then the Download story (Addendum 22) ----
test('layout order — browser mining, then download/launcher, then doors/wizard', () => {
  const i = (id) => html.indexOf(`id="${id}"`);
  assert.ok(i('browser-mine') > 0, 'has browser-mine section');
  assert.ok(i('launcher') > 0, 'has launcher section');
  assert.ok(i('doors-section') > 0, 'has doors section');
  assert.ok(i('browser-mine') < i('launcher'), 'browser mining is above the download story');
  assert.ok(i('launcher') < i('doors-section'), 'download story is above the doors/wizard');
});

// ---- the section has the operator-required controls + counters ----
test('browser-mine section has address, throttle, start/stop, and live counters', () => {
  for (const id of ['bm-addr', 'bm-throttle', 'bm-start', 'bm-stop', 'bm-status', 'bm-hashrate', 'bm-accepted', 'bm-threads']) {
    assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
  }
});

// ---- honesty copy is present (participation, fractions of a cent, ad-blocker note) ----
test('honesty copy: real shares, fractions of a cent, ad-blocker/CoinHive note, battery', () => {
  assert.match(html, /real shares/i);
  assert.match(html, /fractions of a cent/i);
  assert.match(html, /participation, and it is real/i);
  assert.match(html, /CoinHive/i);
  assert.match(html, /opt-in/i);
  assert.match(html, /battery/i);
});

// ---- the launcher "Download story" answers what/for-whom (Addendum 22) ----
test('download story states what it provides and for whom', () => {
  assert.match(html, /What it provides/i);
  assert.match(html, /For whom/i);
  assert.match(html, /SHA256/i);
  assert.match(html, /our own currencies join this same menu/i);
});

// ---- glue is importable headless and initBrowserMine no-ops without the DOM ----
test('browser-mine.mjs imports headless and initBrowserMine is safe without DOM', async () => {
  const mod = await import('./browser-mine.mjs');
  assert.equal(typeof mod.initBrowserMine, 'function');
  // No document with #bm-start present -> should return without throwing.
  globalThis.document = { querySelector: () => null, addEventListener: () => {} };
  assert.doesNotThrow(() => mod.initBrowserMine());
  delete globalThis.document;
});
