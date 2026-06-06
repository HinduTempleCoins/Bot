// Tests for the WALLET front door (pool/www/wallet/index.html + pool/www/wallet/wallet.mjs).
// All offline, no DOM, no network. Run: node --test pool/www/wallet.test.mjs
//
// Covers: the page structure & honesty (all coins present, custody banner, spend lock,
// PRANA migration note), and the pure controller helpers (quickActions, walletCardHtml,
// setupSpendToggle safety) — escaping verified, no telemetry / external scripts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'wallet', 'index.html'), 'utf8');

test('wallet/index.html: nav marks Wallet current, links to Pool + My Coins', () => {
  assert.match(html, /aria-current="page"[^>]*>\s*Wallet|Wallet<\/a>/i);
  assert.match(html, /href="\.\.\/index\.html"/);   // back to Pool
  assert.match(html, /href="\.\.\/mycoins\.html"/);  // over to My Coins
  assert.ok(html.includes('id="wallet-cards"'), 'has the wallet card container');
});

test('wallet/index.html: ALL coins are present (not just Zephyr)', () => {
  // The cards are rendered from WALLET_COINS at runtime, but the hero copy must name them
  // so the page is honest about covering every coin.
  assert.match(html, /Zephyr/);
  assert.match(html, /Monero/);
  assert.match(html, /EVM/);
  assert.match(html, /Ethereum Classic/);
  assert.match(html, /PRANA/);
});

test('wallet/index.html: custody banner is non-custodial and honest', () => {
  assert.match(html, /[Nn]on-custodial/);
  assert.match(html, /never leaves your browser/i);
  assert.match(html, /stores nothing/i);
  assert.match(html, /shown\s+<strong>once<\/strong>|shown <strong>once/i);
});

test('wallet/index.html: spend-lock toggle present and labelled HONESTLY (not wired)', () => {
  assert.ok(html.includes('id="spend-toggle"'), 'has the spend toggle');
  assert.match(html, /Locked/);
  assert.match(html, /Approve/);
  assert.match(html, /same wallet/i);
  assert.match(html, /Receiving and mining never need this toggle/i);
  assert.match(html, /Not wired yet|does not exist in this build/i);
});

test('wallet/index.html: PRANA -> Akasha migration note (same seed comes with you)', () => {
  assert.match(html, /akasha\.soapbox\.community/);
  assert.match(html, /same seed/i);
  assert.match(html, /comes with you/i);
});

test('wallet/index.html: no telemetry and no external scripts', () => {
  // Only same-origin module scripts; the single inline script is the theme bootstrap.
  assert.ok(!/src="https?:\/\//.test(html), 'no remote <script src>');
  assert.ok(!/<link[^>]+href="https?:\/\//.test(html), 'no remote stylesheet');
  assert.ok(!/fetch\(|XMLHttpRequest|navigator\.sendBeacon|analytics|gtag|ga\(/.test(html), 'no telemetry in HTML');
  assert.match(html, /<script type="module" src="wallet\.mjs">/);
});

test('wallet.mjs: imports headless and exports its public helpers', async () => {
  const mod = await import('./wallet/wallet.mjs');
  assert.equal(typeof mod.quickActions, 'function');
  assert.equal(typeof mod.walletCardHtml, 'function');
  assert.equal(typeof mod.setupSpendToggle, 'function');
  assert.equal(typeof mod.PRANA_MIGRATION_NOTE, 'string');
  assert.match(mod.PRANA_MIGRATION_NOTE, /akasha\.soapbox\.community/);
  assert.match(mod.PRANA_MIGRATION_NOTE, /same seed/i);
});

test('wallet.mjs: quickActions deep-link to existing surfaces; Send is gated', async () => {
  const { quickActions } = await import('./wallet/wallet.mjs');
  const acts = quickActions('zephyr');
  const live = acts.filter((a) => a.live);
  // Mine, Pool stats, My Coins are live and point at existing pages (relative to /wallet/).
  assert.ok(live.find((a) => /Mine/.test(a.label) && a.href === '../index.html#mine'));
  assert.ok(live.find((a) => /Pool stats/.test(a.label) && a.href === '../index.html#mine'));
  assert.ok(live.find((a) => /My Coins/.test(a.label) && a.href === '../mycoins.html'));
  // Send is present but not live (no href) and gated on PRANA.
  const send = acts.find((a) => /Send/.test(a.label));
  assert.equal(send.live, false);
  assert.equal(send.href, null);
  assert.equal(send.soon, 'PRANA');
});

test('wallet.mjs: walletCardHtml renders a card per coin with generate + paste paths', async () => {
  const { walletCardHtml } = await import('./wallet/wallet.mjs');
  for (const [coin, expect] of [['zephyr', 'Zephyr'], ['monero', 'Monero'], ['ethereum_classic', 'Ethereum Classic']]) {
    const card = walletCardHtml(coin, undefined);
    assert.match(card, new RegExp(expect));
    assert.match(card, /data-act="generate"/);
    assert.match(card, /data-act="paste"/);
    assert.match(card, /data-act="paste-save"/);
    assert.match(card, new RegExp(`data-coin="${coin}"`));
  }
  // EVM card notes it covers ETC now + PRANA later.
  assert.match(walletCardHtml('ethereum_classic', undefined), /covers Ethereum Classic now, PRANA at launch/);
  // Unknown coin -> empty string (no crash).
  assert.equal(walletCardHtml('nope', undefined), '');
});

test('wallet.mjs: walletCardHtml shows saved addresses and escapes them', async () => {
  const { walletCardHtml } = await import('./wallet/wallet.mjs');
  const group = { coin: 'zephyr', addresses: [{ address: 'ZEPH<script>x</script>"&' }] };
  const card = walletCardHtml('zephyr', group);
  assert.ok(card.includes('ZEPH&lt;script&gt;x&lt;/script&gt;&quot;&amp;'), 'address is HTML-escaped');
  assert.ok(!card.includes('<script>x</script>'), 'no unescaped script slips through');
  // Empty group -> the "no wallet yet" prompt instead.
  assert.match(walletCardHtml('zephyr', undefined), /No ZEPH wallet yet/);
});

test('wallet.mjs: setupSpendToggle is safe without the button (headless)', async () => {
  const mod = await import('./wallet/wallet.mjs');
  const prevDoc = globalThis.document;
  globalThis.document = { querySelector: () => null, addEventListener: () => {}, documentElement: { getAttribute: () => null } };
  assert.doesNotThrow(() => mod.setupSpendToggle());
  if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
});
