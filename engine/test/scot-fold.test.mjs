/**
 * scot-fold.test.mjs — the L1-vote → SCOT-reward FOLD + payout crank (the bridge that was missing).
 * Proves the operator's model: a no-stake AUTHOR earns; a staker CURATOR earns (stake = power to
 * give out); a no-stake VOTER's vote is rejected. Offline, deterministic.
 *
 * Run: node --test engine/test/scot-fold.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { State } from '../lib/state.mjs';
import { Engine } from '../lib/engine.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { tokens } from '../contracts/tokens.mjs';
import { rewards } from '../contracts/rewards.mjs';
import { fromBaseUnits } from '../lib/decimal.mjs';

const ctx = (sender, blockNum = 1) => ({ sender, blockNum, blockId: 'b', txId: 't', authLevel: 'active' });
const bal = (s, account, symbol) => {
  const r = s.findOne('balances', { account, symbol });
  return r ? Number(fromBaseUnits(r.balance, 3)) : 0;
};

test('SCOT fold: no-stake AUTHOR earns, staker CURATOR earns, no-stake VOTER rejected', () => {
  const s = new State(null);
  bootstrapGenesis(s);
  const eng = new Engine(s);

  // alice mints TRIBE (fund her APIS to burn the create fee — genesis issuer holds APIS).
  const apisIssuer = s.meta.genesisIssuer || 'hathor';
  tokens.transfer(s, ctx(apisIssuer), { symbol: 'APIS', to: 'alice', quantity: '500' });
  assert.ok(tokens.create(s, ctx('alice'), { symbol: 'TRIBE', name: 'Tribe', precision: 3, maxSupply: '1000000' }).ok);

  // bob = staker (power to give out); carol = no stake; dave = author with NO TRIBE at all.
  tokens.issue(s, ctx('alice'), { symbol: 'TRIBE', to: 'bob', quantity: '100' });
  tokens.stake(s, ctx('bob'), { symbol: 'TRIBE', quantity: '100' });

  // make it a tribe: emit 100/window, 5-block window, 50/50, tag 'mytribe'
  assert.ok(rewards.setReward(s, ctx('alice'), { symbol: 'TRIBE', emissionPerWindow: '100', windowBlocks: 5, authorBps: 5000, curve: 'linear', tag: 'mytribe' }).ok);

  // dave posts tagged 'mytribe' (he holds ZERO TRIBE); bob (staker) + carol (no stake) vote.
  eng.processSocial({ kind: 'comment', author: 'dave', permlink: 'p1', tags: ['mytribe'], blockNum: 1, blockId: 'b' });
  eng.processSocial({ kind: 'vote', voter: 'bob', author: 'dave', permlink: 'p1', blockNum: 2, blockId: 'b', txId: 't' });
  eng.processSocial({ kind: 'vote', voter: 'carol', author: 'dave', permlink: 'p1', blockNum: 2, blockId: 'b', txId: 't' });

  // a vote on a post with NO tribe tag must fold to nothing
  eng.processSocial({ kind: 'comment', author: 'dave', permlink: 'untagged', tags: ['random'], blockNum: 1, blockId: 'b' });
  eng.processSocial({ kind: 'vote', voter: 'bob', author: 'dave', permlink: 'untagged', blockNum: 2, blockId: 'b', txId: 't' });

  // before the window matures (opened block 2, matures 2+5=7): nothing paid
  eng.crankPayouts({ blockNum: 3, blockId: 'b', txId: 't' });
  assert.equal(bal(s, 'dave', 'TRIBE'), 0, 'author not paid before maturity');

  // after maturity: payout fires
  eng.crankPayouts({ blockNum: 8, blockId: 'b', txId: 't' });
  assert.equal(bal(s, 'dave', 'TRIBE'), 50, 'no-stake AUTHOR earns the 50% author share');
  assert.equal(bal(s, 'bob', 'TRIBE'), 50, 'staker CURATOR earns the 50% curation share');
  assert.equal(bal(s, 'carol', 'TRIBE'), 0, 'no-stake VOTER earns nothing (vote rejected)');

  // idempotent crank: re-running pays nothing more
  eng.crankPayouts({ blockNum: 9, blockId: 'b', txId: 't' });
  assert.equal(bal(s, 'dave', 'TRIBE'), 50, 'payout is idempotent');
});
