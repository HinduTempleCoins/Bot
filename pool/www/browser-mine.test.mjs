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

// ---- Performance & throttles — measured (Addendum 26), under the mining stuff ----
test('throttles section: present below the mining stuff, plain-language + measured numbers', () => {
  const i = (id) => html.indexOf(`id="${id}"`);
  assert.ok(i('throttles') > 0, 'has #throttles section');
  // it sits under all the mining stuff (after the per-coin menu + the launcher)
  assert.ok(i('throttles') > i('launcher'), 'throttles is below the download/mining stuff');
  // describes every throttle the addendum names
  assert.match(html, /Performance &amp; throttles &mdash; measured/i);
  assert.match(html, /background-tab/i);
  assert.match(html, /thermal/i);
  assert.match(html, /battery saver/i);
  assert.match(html, /screen-off/i);
  assert.match(html, /iOS/i);
  assert.match(html, /throttle slider/i);
  // shows measured numbers (browser H/s and a native reference) + a live readout pointer
  assert.match(html, /8\.8 H\/s/);
  assert.match(html, /H\/s/);
  assert.match(html, /Measure your own device/i);
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

// ---------------------------------------------------------------------------
// wallet-first prefill (operator 2026-06-06: pool IS the wallet — never ask cold)
// ---------------------------------------------------------------------------
import { prefillFromWallet } from './browser-mine.mjs';
import { MyCoinsStore } from './mycoins.mjs';

function fakeStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, v) };
}
function fakeInput(value = '') {
  return { value, inserted: null, insertAdjacentElement(_, el) { this.inserted = el; } };
}
function fakeDoc() {
  const made = [];
  return {
    made,
    getElementById: () => null,
    createElement: (tag) => { const el = { tag, style: {} }; made.push(el); return el; },
  };
}

test('prefillFromWallet fills the field from the shared wallet store', () => {
  const store = new MyCoinsStore(fakeStorage());
  store.add({ coin: 'monero', address: '4TESTADDR', network: 'stagenet' });
  const input = fakeInput('');
  const got = prefillFromWallet(input, { coin: 'monero', store, doc: fakeDoc() });
  assert.equal(got, '4TESTADDR');
  assert.equal(input.value, '4TESTADDR');
});

test('prefillFromWallet never overwrites a typed address and offers wallet creation when empty-handed', () => {
  const store = new MyCoinsStore(fakeStorage()); // empty store
  const input = fakeInput('USER_TYPED');
  const doc = fakeDoc();
  const got = prefillFromWallet(input, { coin: 'monero', store, doc });
  assert.equal(got, null);
  assert.equal(input.value, 'USER_TYPED');
  // the create-your-wallet link is injected and points at the wallet page
  assert.equal(input.inserted.href, '/wallet/');
  assert.match(input.inserted.textContent, /create your wallet/i);
});

test('prefillFromWallet soft-fails with no store/DOM (node env)', () => {
  assert.equal(prefillFromWallet(fakeInput(), { store: null, doc: null }), null);
  assert.equal(prefillFromWallet(null), null);
});

// ---- the start handler logs in with the POOL-network address (stagenet twin) ----
// Regression guard for the 2026-06-06 live bug: the wallet auto-fill put a mainnet
// address in the field, the pool (Monero stagenet) rejected the login, and the miner
// "didn't work". The glue must convert via poolLoginAddress before BrowserMiner.start.
test('browser-mine converts the address to the pool network before login', () => {
  const src = readFileSync(join(here, 'browser-mine.mjs'), 'utf8');
  assert.match(src, /poolLoginAddress\(/, 'imports + calls poolLoginAddress');
  const startIdx = src.indexOf("startBtn.addEventListener('click'");
  const convIdx = src.indexOf('poolLoginAddress(', startIdx);
  const minerStartIdx = src.indexOf('miner.start(', startIdx);
  assert.ok(convIdx > startIdx && convIdx < minerStartIdx, 'conversion happens inside the start handler, before miner.start');
});

// ---------------------------------------------------------------------------
// Zephyr-first coin resolution (operator: ZEPH is the default browser/phone coin;
// Monero is the graceful fallback that must never break live mining).
// ---------------------------------------------------------------------------
import {
  pickBrowserCoin, resolveBrowserCoin, BROWSER_CHAINS, BROWSER_COINS,
} from './browser-mine.mjs';

test('BROWSER_CHAINS / BROWSER_COINS list Zephyr FIRST', () => {
  assert.equal(BROWSER_CHAINS[0].coin, 'zephyr', 'zephyr leads the chains');
  assert.equal(BROWSER_CHAINS[1].coin, 'monero');
  assert.equal(BROWSER_COINS[0].key, 'zephyr', 'zephyr leads the preference order');
  assert.equal(BROWSER_COINS[1].key, 'monero');
  // Monero is the only one that needs the stagenet-twin login conversion.
  assert.equal(BROWSER_COINS.find((c) => c.key === 'monero').convert, true);
  assert.equal(BROWSER_COINS.find((c) => c.key === 'zephyr').convert, false);
});

test('pickBrowserCoin picks Zephyr when its pool is live', () => {
  const r = pickBrowserCoin([{ id: 'xmr-stagenet' }, { id: 'zeph', poolStats: {} }]);
  assert.equal(r.coin.key, 'zephyr');
  assert.equal(r.zephyrLive, true);
});

test('pickBrowserCoin accepts the poolId field and is case-insensitive', () => {
  const r = pickBrowserCoin([{ poolId: 'ZEPH' }]);
  assert.equal(r.coin.key, 'zephyr');
  assert.equal(r.zephyrLive, true);
});

test('pickBrowserCoin falls back to Monero when ZEPH is absent', () => {
  const r = pickBrowserCoin([{ id: 'xmr-stagenet' }]);
  assert.equal(r.coin.key, 'monero');
  assert.equal(r.zephyrLive, false);
  assert.match(r.reason, /not yet listed/);
});

test('pickBrowserCoin falls back to Monero when ZEPH is present but disabled', () => {
  const r = pickBrowserCoin([{ id: 'zeph', enabled: false }, { id: 'xmr-stagenet' }]);
  assert.equal(r.coin.key, 'monero');
  assert.equal(r.zephyrLive, false);
  assert.match(r.reason, /not yet accepting/);
});

test('pickBrowserCoin falls back to Monero on a null/garbage pool list (API unreachable)', () => {
  for (const bad of [null, undefined, 'nope', 42, {}]) {
    const r = pickBrowserCoin(bad);
    assert.equal(r.coin.key, 'monero', `garbage ${JSON.stringify(bad)} → monero fallback`);
    assert.equal(r.zephyrLive, false);
  }
});

test('resolveBrowserCoin reads /api/pools via injected fetch and prefers Zephyr', async () => {
  const fetchImpl = async (url) => {
    assert.equal(url, '/api/pools');
    return { json: async () => ({ pools: [{ id: 'zeph' }, { id: 'xmr-stagenet' }] }) };
  };
  const r = await resolveBrowserCoin(fetchImpl);
  assert.equal(r.coin.key, 'zephyr');
  assert.equal(r.zephyrLive, true);
});

test('resolveBrowserCoin soft-fails to Monero when the fetch throws', async () => {
  const fetchImpl = async () => { throw new Error('network down'); };
  const r = await resolveBrowserCoin(fetchImpl);
  assert.equal(r.coin.key, 'monero');
  assert.equal(r.zephyrLive, false);
});

test('resolveBrowserCoin tolerates a bare array response (no .pools wrapper)', async () => {
  const fetchImpl = async () => ({ json: async () => [{ id: 'zeph' }] });
  const r = await resolveBrowserCoin(fetchImpl);
  assert.equal(r.coin.key, 'zephyr');
});

// ---- the browser-mine page copy / picker is Zephyr-first ----
test('index.html browser-mine picker lists Zephyr above Monero', () => {
  const pick = html.indexOf('id="bm-coin-pick"');
  assert.ok(pick > 0, 'has the coin picker');
  const z = html.indexOf('value="zephyr"', pick);
  const m = html.indexOf('value="monero"', pick);
  assert.ok(z > 0 && m > 0, 'both radios present');
  assert.ok(z < m, 'zephyr radio comes before monero');
  assert.ok(html.includes('id="bm-zeph-status"'), 'has the ZEPH status line the glue updates');
});
