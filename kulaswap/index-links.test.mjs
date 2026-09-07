// index-links.test.mjs — OFFLINE. Guards the hard-coded outbound links in index.html against the
// chain registry. The "Verified contracts" link shipped pointing at the ALPHA/TESTNET Blockscout
// (pranascan.alpha.soapbox.community) while the page trades on PRANA MAINNET (712217) — a user
// clicking it to verify KULA / wVKBT / wCURE found nothing, because those addresses do not exist
// on the alpha chain. The link must always track CHAINS[DEFAULT_CHAIN].explorer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHAINS, DEFAULT_CHAIN } from './kula-config.mjs';

const html = readFileSync(fileURLToPath(new URL('./index.html', import.meta.url)), 'utf8');

test('the default chain is PRANA mainnet (712217), not the alpha testnet', () => {
  assert.equal(DEFAULT_CHAIN, 'prana');
  assert.equal(CHAINS[DEFAULT_CHAIN].chainId, 712217);
  assert.equal(CHAINS[DEFAULT_CHAIN].explorer, 'https://pranascan.soapbox.community');
});

test('"Verified contracts" points at the default chain\'s explorer', () => {
  const m = html.match(/<a href="([^"]+)"[^>]*>(?:(?!<\/a>).)*Verified contracts/s);
  assert.ok(m, 'the Verified contracts link is present in index.html');
  assert.equal(m[1], CHAINS[DEFAULT_CHAIN].explorer);
});

test('no alpha/testnet host is linked from the mainnet swap page', () => {
  for (const host of ['pranascan.alpha.soapbox.community', 'rpc.prana.alpha.melek.salon']) {
    assert.equal(html.includes(host), false, `index.html must not link the testnet host ${host}`);
  }
});

test('the footer does not call the mainnet deployment a testnet', () => {
  assert.equal(/Alpha software on (the )?PRANA testnet/i.test(html), false);
  assert.ok(/Alpha software on PRANA mainnet/.test(html));
});
