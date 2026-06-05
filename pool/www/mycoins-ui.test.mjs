// Tests for the My Coins page: the mycoins.html structure + honest gating, and the
// mycoins-ui.mjs glue (importable headless; rail HTML honesty for Stake/Trade).
//
// Run: node --test pool/www/mycoins-ui.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(here, 'mycoins.html'), 'utf8');

test('mycoins.html: nav marks My Coins current, links back to Pool', () => {
  assert.match(html, /aria-current="page"[^>]*>My Coins|My Coins<\/a>/i);
  assert.match(html, /href="index\.html"/);
  assert.ok(html.includes('id="add-coin"'), 'has add-coin section');
  assert.ok(html.includes('id="mc-list"'), 'has the coin list container');
});

test('mycoins.html: spend-lock toggle is present and labelled HONESTLY (not wired yet)', () => {
  assert.ok(html.includes('id="spend-toggle"'), 'has the spend toggle');
  assert.match(html, /Locked/);
  assert.match(html, /Approve/);
  assert.match(html, /same wallet/i);            // one-wallet contract (Addendum 25)
  assert.match(html, /Receiving and mining never need this toggle/i);
  assert.match(html, /does not exist in this build|Not wired yet/i); // honesty: send not implemented
});

test('mycoins.html: add-a-coin offers generate-in-browser AND paste, with custody honesty', () => {
  assert.ok(html.includes('id="ac-generate"'), 'generate button');
  assert.ok(html.includes('id="ac-paste"'), 'paste button');
  assert.match(html, /keys never leave/i);
  assert.match(html, /receive-only/i);
});

test('mycoins-ui.mjs: imports headless; railHtml gates Stake/Trade honestly', async () => {
  const mod = await import('./mycoins-ui.mjs');
  assert.equal(typeof mod.railHtml, 'function');
  const rail = mod.railHtml('zephyr', 'ZEPHs123');
  // Mine + Wallet + Info are live options; Stake + Trade are present but disabled/gated.
  assert.match(rail, /Mine/);
  assert.match(rail, /Wallet/);
  assert.match(rail, /Info/);
  assert.match(rail, /Stake/);
  assert.match(rail, /Trade/);
  assert.match(rail, /PRANA/);                 // honest "opens with PRANA / DEX seam"
  assert.match(rail, /disabled/);              // not fake functionality
});

test('mycoins-ui.mjs: setupSpendToggle is exported and safe without the button', async () => {
  const mod = await import('./mycoins-ui.mjs');
  const prevDoc = globalThis.document;
  globalThis.document = { querySelector: () => null, addEventListener: () => {}, documentElement: { getAttribute: () => null } };
  assert.doesNotThrow(() => mod.setupSpendToggle());
  if (prevDoc === undefined) delete globalThis.document; else globalThis.document = prevDoc;
});
