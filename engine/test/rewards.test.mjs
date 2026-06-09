/**
 * rewards.test.mjs — the Scotbot-equivalent reward-emission contract.
 *
 * Offline, deterministic. Verifies: rule config + issuer-only auth, vote weight
 * by stake + curve, payout math (author/curator split sums to emission, dust to
 * author), pro-rata curator distribution, supply-cap honoured, replay
 * determinism, and soft-fail-never-throw on bad input.
 *
 * Run: node --test engine/test/rewards.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { State } from '../lib/state.mjs';
import { Engine } from '../lib/engine.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { tokens } from '../contracts/tokens.mjs';
import { rewards, applyCurve, isqrt } from '../contracts/rewards.mjs';
import { toBaseUnits, fromBaseUnits } from '../lib/decimal.mjs';

// Build a fresh engine state with a custom token "TRIBE" issued by `issuer`,
// and give some accounts staked balances so they have vote weight.
function fresh() {
  const s = new State(null);
  bootstrapGenesis(s);
  return s;
}

function ctx(sender, blockNum = 1) {
  return { sender, blockNum, blockId: 'b', txId: 't', authLevel: 'active' };
}

// Create + issue + stake a custom token. Returns the symbol.
function makeTribe(s, issuer = 'alice', precision = 3) {
  // bypass the APIS fee by minting the issuer some APIS first (genesis issuer
  // holds it; transfer a little to alice so create() can burn the fee).
  tokens.transfer(s, ctx('hathor'), { symbol: 'APIS', to: issuer, quantity: '500' });
  const r = tokens.create(s, ctx(issuer), {
    symbol: 'TRIBE',
    name: 'My Tribe',
    precision,
    maxSupply: '1000000',
  });
  assert.ok(r.ok, r.error);
  // issue some TRIBE and stake it across voters
  tokens.issue(s, ctx(issuer), { symbol: 'TRIBE', to: 'bob', quantity: '100' });
  tokens.issue(s, ctx(issuer), { symbol: 'TRIBE', to: 'carol', quantity: '300' });
  tokens.stake(s, ctx('bob'), { symbol: 'TRIBE', quantity: '100' });
  tokens.stake(s, ctx('carol'), { symbol: 'TRIBE', quantity: '300' });
  return 'TRIBE';
}

test('isqrt + curves are deterministic integer math', () => {
  assert.equal(isqrt(0n), 0n);
  assert.equal(isqrt(1n), 1n);
  assert.equal(isqrt(144n), 12n);
  assert.equal(isqrt(145n), 12n);
  assert.equal(applyCurve('linear', 1000n), 1000n);
  assert.equal(applyCurve('sqrt', 144n), 12n);
  assert.equal(applyCurve('quadratic', 2_000_000n), (2_000_000n * 2_000_000n) / 1_000_000n);
  assert.equal(applyCurve('linear', 0n), 0n);
});

test('setReward: issuer-only, validates fields, stored as config', () => {
  const s = fresh();
  makeTribe(s);
  // non-issuer rejected
  const bad = rewards.setReward(s, ctx('mallory'), {
    symbol: 'TRIBE',
    emissionPerWindow: '10',
    windowBlocks: 5,
  });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /only issuer/);

  // bad curve rejected (soft-fail, no throw)
  const badCurve = rewards.setReward(s, ctx('alice'), {
    symbol: 'TRIBE',
    emissionPerWindow: '10',
    windowBlocks: 5,
    curve: 'exponential',
  });
  assert.equal(badCurve.ok, false);

  const good = rewards.setReward(s, ctx('alice'), {
    symbol: 'TRIBE',
    emissionPerWindow: '10',
    windowBlocks: 5,
    authorBps: 6000,
    curve: 'linear',
  });
  assert.ok(good.ok);
  const rule = s.findOne('rewardRules', { symbol: 'TRIBE' });
  assert.equal(rule.authorBps, 6000);
  assert.equal(rule.windowBlocks, 5);
  assert.equal(rule.curve, 'linear');
  assert.equal(rule.enabled, true);
});

test('vote: weight = staked balance through curve; requires stake', () => {
  const s = fresh();
  makeTribe(s);
  rewards.setReward(s, ctx('alice'), { symbol: 'TRIBE', emissionPerWindow: '10', windowBlocks: 3 });

  // bob votes (100 staked @ precision 3 = 100000 base units)
  const v1 = rewards.vote(s, ctx('bob', 1), { author: 'dave', permlink: 'post-1', symbol: 'TRIBE' });
  assert.ok(v1.ok);
  assert.equal(v1.votes, 1);

  // carol votes (300 staked)
  const v2 = rewards.vote(s, ctx('carol', 1), { author: 'dave', permlink: 'post-1', symbol: 'TRIBE' });
  assert.ok(v2.ok);
  assert.equal(v2.votes, 2);

  // an account with no stake cannot accrue weight
  const v3 = rewards.vote(s, ctx('mallory', 1), { author: 'dave', permlink: 'post-1', symbol: 'TRIBE' });
  assert.equal(v3.ok, false);
  assert.match(v3.error, /no stake weight/);

  const post = s.findOne('rewardPosts', { symbol: 'TRIBE', postKey: 'dave/post-1' });
  // total weight = 100000 + 300000 = 400000 (linear curve)
  assert.equal(post.rewardWeight, '400000');
});

test('payout: author/curator split sums to emission; pro-rata; dust to author', () => {
  const s = fresh();
  makeTribe(s);
  // 50/50 split, linear, window 2 blocks, emit 12 TRIBE/window
  rewards.setReward(s, ctx('alice'), {
    symbol: 'TRIBE',
    emissionPerWindow: '12',
    windowBlocks: 2,
    authorBps: 5000,
    curve: 'linear',
  });
  // votes at block 1: bob(100) + carol(300) staked
  rewards.vote(s, ctx('bob', 1), { author: 'dave', permlink: 'p1', symbol: 'TRIBE' });
  rewards.vote(s, ctx('carol', 1), { author: 'dave', permlink: 'p1', symbol: 'TRIBE' });

  // matures at block 1+2 = 3; payout at block 3
  const before = BigInt(s.findOne('tokens', { symbol: 'TRIBE' }).supply);
  const r = rewards.payout(s, ctx('cranker', 3), { symbol: 'TRIBE' });
  assert.ok(r.ok);
  assert.equal(r.paid, 1);

  const after = BigInt(s.findOne('tokens', { symbol: 'TRIBE' }).supply);
  // exactly emissionPerWindow (12 TRIBE @ prec 3 = 12000) minted
  assert.equal(after - before, 12000n);

  // author (dave) gets 50% + dust = 6 TRIBE; curators share 6 TRIBE pro-rata:
  // bob weight 100000 / total 400000 -> 25% of 6000 = 1500 -> 1.5 TRIBE
  // carol 300000/400000 -> 75% of 6000 = 4500 -> 4.5 TRIBE
  const bal = (acct) => fromBaseUnits(BigInt(s.findOne('balances', { account: acct, symbol: 'TRIBE' }).balance), 3);
  assert.equal(bal('dave'), '6.000');
  assert.equal(bal('bob'), '1.500');
  // carol had 300 staked (0 liquid left after staking) — earns 4.5 liquid
  assert.equal(bal('carol'), '4.500');

  // sum of all minted equals emission (no value created/destroyed beyond pool)
  const minted = 6000n + 1500n + 4500n;
  assert.equal(minted, 12000n);

  // idempotent: re-running payout pays nothing more
  const r2 = rewards.payout(s, ctx('cranker', 4), { symbol: 'TRIBE' });
  assert.equal(r2.paid, 0);
  assert.equal(BigInt(s.findOne('tokens', { symbol: 'TRIBE' }).supply), after);
});

test('payout: not matured yet pays nothing', () => {
  const s = fresh();
  makeTribe(s);
  rewards.setReward(s, ctx('alice'), { symbol: 'TRIBE', emissionPerWindow: '5', windowBlocks: 10 });
  rewards.vote(s, ctx('bob', 1), { author: 'dave', permlink: 'p', symbol: 'TRIBE' });
  const r = rewards.payout(s, ctx('x', 5), { symbol: 'TRIBE' }); // matures at 11
  assert.equal(r.paid, 0);
});

test('payout respects supply cap (immutable): emits at most remaining', () => {
  const s = fresh();
  tokens.transfer(s, ctx('hathor'), { symbol: 'APIS', to: 'alice', quantity: '500' });
  tokens.create(s, ctx('alice'), {
    symbol: 'CAPD',
    name: 'Capped',
    precision: 0,
    maxSupply: '10',
    supplyCapImmutable: true,
  });
  // issue + stake so a voter exists; this consumes 8 of the 10 cap
  tokens.issue(s, ctx('alice'), { symbol: 'CAPD', to: 'bob', quantity: '8' });
  tokens.stake(s, ctx('bob'), { symbol: 'CAPD', quantity: '8' });
  rewards.setReward(s, ctx('alice'), {
    symbol: 'CAPD',
    emissionPerWindow: '100', // wants 100 but only 2 left under the cap
    windowBlocks: 1,
    authorBps: 10000, // all to author to make the cap math clean
  });
  rewards.vote(s, ctx('bob', 1), { author: 'dave', permlink: 'p', symbol: 'CAPD' });
  rewards.payout(s, ctx('x', 2), { symbol: 'CAPD' });
  const tok = s.findOne('tokens', { symbol: 'CAPD' });
  assert.equal(tok.supply, tok.maxSupply); // exactly capped, never exceeded
  assert.equal(BigInt(tok.supply), 10n);
});

test('determinism: same op history -> same state hash via the Engine', () => {
  function run() {
    const s = fresh();
    const e = new Engine(s);
    makeTribe(s);
    // drive votes/payout through the Engine op path (posting auth on vote)
    e.process({
      sender: 'alice', authLevel: 'active', blockNum: 2, blockId: 'b2', txId: 'r1',
      json: JSON.stringify({ contractName: 'rewards', contractAction: 'setReward',
        contractPayload: { symbol: 'TRIBE', emissionPerWindow: '8', windowBlocks: 1, authorBps: 5000 } }),
    });
    for (const [voter, blk, tx] of [['bob', 3, 'v1'], ['carol', 3, 'v2']]) {
      e.process({
        sender: voter, authLevel: 'posting', blockNum: blk, blockId: 'b3', txId: tx,
        json: JSON.stringify({ contractName: 'rewards', contractAction: 'vote',
          contractPayload: { author: 'dave', permlink: 'p', symbol: 'TRIBE' } }),
      });
    }
    e.process({
      sender: 'cranker', authLevel: 'posting', blockNum: 5, blockId: 'b5', txId: 'pay',
      json: JSON.stringify({ contractName: 'rewards', contractAction: 'payout',
        contractPayload: { symbol: 'TRIBE' } }),
    });
    return s.hash();
  }
  assert.equal(run(), run());
});

test('soft-fail: unknown token / no rule / bad payload never throw', () => {
  const s = fresh();
  assert.equal(rewards.setReward(s, ctx('a'), { symbol: 'NOPE', emissionPerWindow: '1', windowBlocks: 1 }).ok, false);
  assert.equal(rewards.vote(s, ctx('a'), { symbol: 'NOPE', author: 'x', permlink: 'y' }).ok, false);
  assert.equal(rewards.payout(s, ctx('a'), { symbol: 'NOPE' }).ok, false);
  // missing fields
  makeTribe(s);
  assert.equal(rewards.setReward(s, ctx('alice'), { symbol: 'TRIBE', emissionPerWindow: '0', windowBlocks: 1 }).ok, false);
  assert.equal(rewards.setReward(s, ctx('alice'), { symbol: 'TRIBE', emissionPerWindow: '1', windowBlocks: 0 }).ok, false);
});

test('rewards via Engine requires ACTIVE for setReward, POSTING ok for vote', () => {
  const s = fresh();
  const e = new Engine(s);
  makeTribe(s);
  // setReward with posting auth must be rejected by the engine auth gate
  const r = e.process({
    sender: 'alice', authLevel: 'posting', blockNum: 2, blockId: 'b', txId: 't1',
    json: JSON.stringify({ contractName: 'rewards', contractAction: 'setReward',
      contractPayload: { symbol: 'TRIBE', emissionPerWindow: '1', windowBlocks: 1 } }),
  });
  assert.equal(r.ok, false);
  assert.match(r.error, /active auth/);
});
