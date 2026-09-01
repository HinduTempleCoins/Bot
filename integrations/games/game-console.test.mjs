// game-console.test.mjs — offline, deterministic. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerGame, registerBuiltIns, getGame, listGames, directory, launchDescriptor,
  WAX_MAPPING, UNIFIED_IDENTITY, SHARED_MARKET, CHAINS, ASSET_STANDARDS,
} from './game-console.mjs';

test('built-ins register MELEK Move first, plus the games built this session', () => {
  const n = registerBuiltIns();
  assert.equal(n, 8);
  const ids = listGames().map((g) => g.id);
  assert.equal(ids[0], 'melek-move'); // operator's ask: Move on the console
  for (const id of ['kush-farm', 'kush-breeding', 'pass-a-joint', 'quick-farm', 'kula-arcade', 'creatures', 'tribulum']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
});

test('MELEK Move manifest is accurate (MELEK chain, real-value MELEK reward, counsel note)', () => {
  registerBuiltIns();
  const m = getGame('melek-move');
  assert.equal(m.chain, 'melek');
  assert.equal(m.reward.token, 'MELEK');
  assert.equal(m.reward.cashable, true);
  assert.equal(m.reward.realValue, true);
  assert.equal(m.compliance.lane, 'real-value');
  assert.ok(m.compliance.note && m.compliance.note.length > 0);
  assert.equal(m.module, 'integrations/games/move-economy.mjs');
});

test('validation rejects malformed manifests', () => {
  assert.throws(() => registerGame({ name: 'x', chain: 'prana', category: 'arcade', entry: '/x', reward: { token: 'PLAY', cashable: false } }), /id required/);
  assert.throws(() => registerGame({ id: 'x', name: 'x', chain: 'mars', category: 'arcade', entry: '/x', reward: { token: 'PLAY', cashable: false } }), /chain must be/);
  assert.throws(() => registerGame({ id: 'x', name: 'x', chain: 'prana', category: 'nope', entry: '/x', reward: { token: 'PLAY', cashable: false } }), /unknown category/);
  assert.throws(() => registerGame({ id: 'x', name: 'x', chain: 'prana', category: 'arcade', entry: '/x', reward: { token: 'T' } }), /reward.cashable/);
});

test('compliance gate: a cashable reward must set realValue AND carry a counsel note', () => {
  assert.throws(
    () => registerGame({ id: 'bad', name: 'Bad', chain: 'prana', category: 'farming', entry: '/b', reward: { token: 'KULA', cashable: true } }),
    /realValue=true/,
  );
  assert.throws(
    () => registerGame({ id: 'bad2', name: 'Bad2', chain: 'prana', category: 'farming', entry: '/b', reward: { token: 'KULA', cashable: true, realValue: true } }),
    /compliance.note/,
  );
  registerBuiltIns(); // clean up
});

test('non-cashable games default to the safe PLAY lane', () => {
  registerBuiltIns();
  for (const id of ['pass-a-joint', 'quick-farm', 'kula-arcade', 'tribulum']) {
    assert.equal(getGame(id).compliance.lane, 'non-cashable-play', id);
  }
  for (const id of ['melek-move', 'kush-farm', 'kush-breeding', 'creatures']) {
    assert.equal(getGame(id).compliance.lane, 'real-value', id);
  }
});

test('listGames filters by category, chain, and cashable', () => {
  registerBuiltIns();
  assert.deepEqual(listGames({ chain: 'melek' }).map((g) => g.id), ['melek-move']);
  assert.ok(listGames({ category: 'farming' }).map((g) => g.id).includes('kush-farm'));
  const play = listGames({ cashable: false }).map((g) => g.id);
  assert.ok(play.includes('pass-a-joint') && !play.includes('melek-move'));
});

test('directory groups by category and counts the two lanes', () => {
  registerBuiltIns();
  const d = directory();
  assert.equal(d.counts.total, 8);
  assert.equal(d.counts.realValue, 4);
  assert.equal(d.counts.play, 4);
  assert.equal(d.identity, UNIFIED_IDENTITY);
  assert.equal(d.market, SHARED_MARKET);
  assert.ok(d.byCategory['move-to-earn'].some((g) => g.id === 'melek-move'));
});

test('launchDescriptor is the unified-login handshake and binds the shared market', () => {
  registerBuiltIns();
  const d = launchDescriptor('melek-move', { account: 'hathor' });
  assert.equal(d.game.id, 'melek-move');
  assert.equal(d.identity.provider, 'melek-signer');
  assert.equal(d.identity.account, 'hathor');
  assert.deepEqual(d.walletScopes, ['melek-account']);
  assert.equal(d.market, SHARED_MARKET);
  assert.equal(d.lane, 'real-value');
  assert.throws(() => launchDescriptor('nope'), /unknown game/);
});

test('WAX mapping documents the four pillars we imitate', () => {
  const keys = Object.keys(WAX_MAPPING);
  assert.ok(keys.includes('WAX Cloud Wallet'));
  assert.ok(keys.includes('AtomicAssets (NFT standard)'));
  assert.ok(keys.includes('AtomicHub (marketplace)'));
  assert.ok(keys.includes('dApp directory'));
  assert.equal(SHARED_MARKET.name, 'KulaSwap');
  assert.ok(CHAINS.includes('melek') && CHAINS.includes('prana'));
  assert.ok(ASSET_STANDARDS.includes('erc1155'));
});
