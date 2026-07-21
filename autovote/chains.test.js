import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import {
  CHAINS, DEFAULT_CHAIN, getChain, isMainnet, chainSupportsAuth, publicChains, publicChain,
} from './chains.js';
import { Store, userKey } from './store.js';
import { hsConfig, configured, getLoginURL } from './hivesigner.js';

test('chain registry: melek mainnet is default; melek-testnet is testnet; hive/steem/blurt are mainnet', () => {
  assert.equal(DEFAULT_CHAIN, 'melek');
  assert.equal(getChain('melek').network, 'mainnet');
  assert.equal(isMainnet('melek'), true);
  assert.equal(getChain('melek-testnet').network, 'testnet');
  assert.equal(isMainnet('melek-testnet'), false);
  for (const id of ['hive', 'steem', 'blurt']) {
    assert.equal(isMainnet(id), true, `${id} is mainnet`);
  }
  assert.equal(getChain('nope'), null);
});

test('auth methods per chain match operator policy', () => {
  // MELEK: MELEK-Signer (keyless, our own signer) preferred, throwaway posting key as fallback.
  assert.deepEqual(getChain('melek-testnet').authMethods, ['melek-signer', 'postingkey']);
  assert.equal(chainSupportsAuth('melek-testnet', 'melek-signer'), true);
  // MELEK-Signer is MELEK-only (it knows our chain); not offered on Hive/Steem/Blurt.
  assert.equal(chainSupportsAuth('hive', 'melek-signer'), false);
  // Hive: HiveSigner works.
  assert.equal(chainSupportsAuth('hive', 'hivesigner'), true);
  assert.equal(chainSupportsAuth('hive', 'whalevault'), true);
  // Steem/Blurt: WhaleVault works, HiveSigner does not.
  assert.equal(chainSupportsAuth('steem', 'hivesigner'), false);
  assert.equal(chainSupportsAuth('steem', 'whalevault'), true);
  assert.equal(chainSupportsAuth('blurt', 'hivesigner'), false);
  assert.equal(chainSupportsAuth('blurt', 'whalevault'), true);
});

test('publicChain hides RPC internals but exposes what the client needs', () => {
  const p = publicChain('hive');
  assert.equal(p.id, 'hive');
  assert.ok(p.authMethods.includes('hivesigner'));
  assert.equal(p.rpcs, undefined, 'no rpcs leaked');
  assert.equal(p.chainId, undefined, 'no chainId leaked');
  assert.equal(publicChains().length, Object.keys(CHAINS).length);
});

test('hivesigner: not configured without env → pending state, no login URL', () => {
  const saved = { app: process.env.HIVESIGNER_APP, cb: process.env.HIVESIGNER_CALLBACK };
  delete process.env.HIVESIGNER_APP; delete process.env.HIVESIGNER_CALLBACK;
  assert.equal(configured(), false);
  assert.equal(getLoginURL('state123'), null);
  process.env.HIVESIGNER_APP = 'autovote.app';
  process.env.HIVESIGNER_CALLBACK = 'https://auto.alpha.melek.salon/hivesigner/callback';
  assert.equal(configured(), true);
  const url = getLoginURL('state123');
  assert.match(url, /oauth2\/authorize/);
  assert.match(url, /client_id=autovote\.app/);
  assert.match(url, /scope=vote/);
  assert.match(url, /state=state123/);
  // restore
  if (saved.app) process.env.HIVESIGNER_APP = saved.app; else delete process.env.HIVESIGNER_APP;
  if (saved.cb) process.env.HIVESIGNER_CALLBACK = saved.cb; else delete process.env.HIVESIGNER_CALLBACK;
});

// ── store migration ──────────────────────────────────────────────────────────

function tmpPath() {
  return path.join(os.tmpdir(), `autovote-mig-${Date.now()}-${Math.random().toString(16).slice(2)}.json`);
}

test('store migration: legacy single-chain store upgrades additively to the default chain', () => {
  const p = tmpPath();
  // Write a pre-upgrade store (no chain fields; users keyed by bare username).
  const legacy = {
    users: { initminer: { username: 'initminer', postingKey: '5Jabc', createdAt: 111 } },
    trails: [{ id: 't1', owner: 'initminer', target: 'leader', weight: 100 }],
    fanbases: [{ id: 'f1', owner: 'initminer', authors: ['alice'], weight: 80 }],
    schedules: [],
    votes: [{ id: 'v1', owner: 'initminer', author: 'alice', permlink: 'p', weight: 10000, ok: true, at: 222 }],
  };
  fs.writeFileSync(p, JSON.stringify(legacy));

  const store = new Store(p);
  const DEF = DEFAULT_CHAIN;
  // User re-keyed to <default>:initminer, posting key + createdAt preserved.
  const u = store.getUser(DEF, 'initminer');
  assert.ok(u, 'user migrated');
  assert.equal(u.chain, DEF);
  assert.equal(u.authMethod, 'postingkey');
  assert.equal(u.postingKey, '5Jabc');
  assert.equal(u.createdAt, 111, 'createdAt preserved');
  assert.equal(store.data.users[userKey(DEF, 'initminer')].username, 'initminer');
  // Rules + votes stamped with the default chain.
  assert.equal(store.data.trails[0].chain, DEF);
  assert.equal(store.data.fanbases[0].chain, DEF);
  assert.equal(store.data.votes[0].chain, DEF);
  // History preserved + queryable per chain.
  assert.equal(store.votesFor(DEF, 'initminer').length, 1);
  assert.equal(store.hasVoted(DEF, 'initminer', 'alice', 'p'), true);

  // Idempotent: reloading doesn't double-migrate.
  const store2 = new Store(p);
  assert.equal(Object.keys(store2.data.users).length, 1);
  assert.equal(store2.getUser(DEF, 'initminer').postingKey, '5Jabc');
  fs.unlinkSync(p);
});

test('store: rules/votes are scoped per chain', () => {
  const p = tmpPath();
  const store = new Store(p);
  store.upsertUser('melek-testnet', 'me', 'postingkey', { postingKey: 'k' });
  store.upsertUser('hive', 'me', 'hivesigner', { hsToken: 'TOK' });
  store.addFanbase({ chain: 'melek-testnet', owner: 'me', authors: ['alice'], weight: 100 });
  store.addFanbase({ chain: 'hive', owner: 'me', authors: ['bob'], weight: 50 });

  const melekRules = store.rulesFor('melek-testnet', 'me');
  const hiveRules = store.rulesFor('hive', 'me');
  assert.equal(melekRules.fanbases.length, 1);
  assert.equal(melekRules.fanbases[0].authors[0], 'alice');
  assert.equal(hiveRules.fanbases.length, 1);
  assert.equal(hiveRules.fanbases[0].authors[0], 'bob');
  assert.equal(store.activeChains().sort().join(','), 'hive,melek-testnet');
  fs.unlinkSync(p);
});

test('store: upsertUser switching auth method preserves identity, swaps credential', () => {
  const p = tmpPath();
  const store = new Store(p);
  store.upsertUser('hive', 'me', 'postingkey', { postingKey: 'WIF' });
  let u = store.getUser('hive', 'me');
  assert.equal(u.authMethod, 'postingkey');
  store.upsertUser('hive', 'me', 'hivesigner', { hsToken: 'TOK' });
  u = store.getUser('hive', 'me');
  assert.equal(u.authMethod, 'hivesigner');
  assert.equal(u.hsToken, 'TOK');
  fs.unlinkSync(p);
});
