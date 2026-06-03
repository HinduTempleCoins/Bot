// chains-hud.test.mjs — offline tests for the admin CHAINS board (#206).
// All sources are injected via __setSources; nothing touches the network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chainsBoard, headline, renderBoard, escapeHtml, WATCHED, __setSources,
} from './chains-hud.mjs';

// A small fake watch list so tests don't depend on env/defaults.
const WATCH = [
  { key: 'melek', label: 'MELEK', kind: 'graphene', accounts: [{ account: 'hathor', asset: 'MELEK' }], deployed: ['hathor witness'], configured: true },
  { key: 'hive', label: 'HIVE', kind: 'graphene', accounts: [{ account: 'kalivankush', asset: 'HIVE', heTokens: true }], deployed: ['HE readers'], configured: true },
  { key: 'soap', label: 'SOAP', kind: 'bitshares', accounts: [{ account: 'soapacct', asset: 'SOAP' }], deployed: ['DEX'], configured: true },
  { key: 'prana', label: 'PRANA', kind: 'evm', accounts: [], deployed: ['EVM'], configured: false },
];

function goodSources({ throwOn } = {}) {
  return {
    balanceReader: async (chainKey, account) => {
      if (throwOn === chainKey) throw new Error(`boom:${chainKey}`);
      const table = {
        melek: { balance: 100 },
        hive: { balance: 50 },
        soap: { balance: 7 },
      };
      return table[chainKey] || { error: 'no balance' };
    },
    heTokensReader: async (account) => {
      if (account === 'kalivankush') return [{ symbol: 'SWAP.HIVE', balance: 25 }, { symbol: 'DUST', balance: 0 }];
      return [];
    },
    chainStatusReader: async (chainKey) => {
      if (throwOn === chainKey) throw new Error(`status boom:${chainKey}`);
      const up = { melek: true, hive: true, soap: true, prana: false };
      return up[chainKey] ? { up: true, height: 123 } : { up: false };
    },
  };
}

test('chainsBoard assembles holdings + status from injected fakes', async () => {
  __setSources(goodSources());
  const board = await chainsBoard({ watched: WATCH });
  __setSources({});

  assert.equal(board.chains.length, 4);
  const melek = board.chains.find((c) => c.key === 'melek');
  assert.equal(melek.status, 'up');
  assert.equal(melek.ok, true);
  assert.deepEqual(melek.holdings, [{ account: 'hathor', asset: 'MELEK', amount: 100 }]);
  assert.deepEqual(melek.deployed, ['hathor witness']);

  // HIVE: native + HE token (zero-balance DUST filtered out)
  const hive = board.chains.find((c) => c.key === 'hive');
  const assets = hive.holdings.map((h) => h.asset).sort();
  assert.deepEqual(assets, ['HIVE', 'SWAP.HIVE']);
  assert.ok(!hive.holdings.some((h) => h.asset === 'DUST'));

  // unconfigured chain → calm configure-me state, ok:true, status unknown
  const prana = board.chains.find((c) => c.key === 'prana');
  assert.equal(prana.ok, true);
  assert.equal(prana.status, 'unknown');
  assert.equal(prana.holdings.length, 0);
  assert.match(prana.note, /configure me/i);

  assert.ok(typeof board.asOf === 'string' && board.asOf.length > 0);
});

test('one chain throwing → that chain unknown/ok:false, others fine', async () => {
  __setSources(goodSources({ throwOn: 'hive' }));
  const board = await chainsBoard({ watched: WATCH });
  __setSources({});

  const hive = board.chains.find((c) => c.key === 'hive');
  assert.equal(hive.ok, false);
  assert.equal(hive.status, 'unknown');

  // other chains unaffected
  const melek = board.chains.find((c) => c.key === 'melek');
  assert.equal(melek.ok, true);
  assert.equal(melek.status, 'up');
  assert.equal(melek.holdings[0].amount, 100);
});

test('totals.byAsset aggregates across chains', async () => {
  // Two chains both holding MELEK should sum.
  const watched = [
    { key: 'melek', label: 'MELEK', accounts: [{ account: 'a', asset: 'MELEK' }], deployed: [], configured: true },
    { key: 'hive', label: 'HIVE', accounts: [{ account: 'b', asset: 'MELEK' }], deployed: [], configured: true },
  ];
  __setSources({
    balanceReader: async (chainKey) => ({ balance: chainKey === 'melek' ? 100 : 40 }),
    heTokensReader: async () => [],
    chainStatusReader: async () => ({ up: true, height: 1 }),
  });
  const board = await chainsBoard({ watched });
  __setSources({});

  assert.equal(board.totals.byAsset.MELEK, 140);
});

test('headline is plain English', async () => {
  __setSources(goodSources());
  const board = await chainsBoard({ watched: WATCH });
  __setSources({});
  const h = headline(board);
  assert.match(h, /chains watched/);
  assert.match(h, /reachable/);
  assert.match(h, /biggest holding/);
  // 4 watched, 3 reachable (prana down)
  assert.match(h, /4 chains watched, 3 reachable/);
});

test('headline never throws on empty/garbage', () => {
  assert.match(headline(null), /nothing watched/i);
  assert.match(headline({}), /nothing watched/i);
});

test('renderBoard escapes a malicious account name + carries read-only line', async () => {
  const watched = [
    { key: 'melek', label: 'MELEK', accounts: [{ account: '<img src=x onerror=alert(1)>', asset: 'MELEK' }], deployed: ['<script>evil()</script>'], configured: true },
  ];
  __setSources({
    balanceReader: async () => ({ balance: 5 }),
    heTokensReader: async () => [],
    chainStatusReader: async () => ({ up: true, height: 1 }),
  });
  const board = await chainsBoard({ watched });
  __setSources({});
  const html = renderBoard(board);

  // no raw injection survives
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('<script>evil()'));
  assert.ok(html.includes('&lt;img src=x'));
  assert.ok(html.includes('&lt;script&gt;evil()'));
  // read-only line present
  assert.match(html, /read-only — no keys/i);
  // headline present
  assert.match(html, /chains watched/);
});

test('escapeHtml handles all five entities + nullish', () => {
  assert.equal(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
});

test('WATCHED contains no key material (no WIF-shaped strings)', () => {
  const blob = JSON.stringify(WATCHED);
  // Graphene WIF: base58, ~51 chars, typically starts with '5'. EVM privkey: 0x + 64 hex.
  assert.equal(/\b5[1-9A-HJ-NP-Za-km-z]{50,51}\b/.test(blob), false, 'WIF-shaped string found');
  assert.equal(/0x[0-9a-fA-F]{64}\b/.test(blob), false, 'EVM-privkey-shaped string found');
  assert.equal(/\b(wif|posting|active|owner|priv|secret)key\b/i.test(blob), false, 'key field name found');
});

test('chainsBoard never throws even with no sources at all (defensive imports soft-fail)', async () => {
  __setSources({});
  const board = await chainsBoard({ watched: WATCH });
  __setSources({});
  assert.equal(board.chains.length, 4);
  for (const c of board.chains) assert.ok(typeof c.ok === 'boolean');
});
