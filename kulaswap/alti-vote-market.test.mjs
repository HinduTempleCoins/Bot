// alti-vote-market.test.mjs — offline, pure. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_WEIGHT, priceForWeight, weightForAlti, manaAffordableWeight, quoteVote, buildVoteOrder,
  renderQuote, mergeMarket, FULL_VOTE_MANA_BPS,
} from './alti-vote-market.mjs';

test('priceForWeight / weightForAlti are inverse at the default 100 ALTI/full-vote', () => {
  assert.equal(priceForWeight(MAX_WEIGHT), 100);          // 100% vote = 100 ALTI
  assert.equal(priceForWeight(MAX_WEIGHT / 2), 50);       // 50% vote = 50 ALTI
  assert.equal(weightForAlti(100), MAX_WEIGHT);           // 100 ALTI = 100%
  assert.equal(weightForAlti(50), MAX_WEIGHT / 2);        // 50 ALTI = 50%
  assert.equal(weightForAlti(0), 0);
});

test('weightForAlti caps at 100% (overpaying does not exceed a full vote)', () => {
  assert.equal(weightForAlti(10000), MAX_WEIGHT);
});

test('manaAffordableWeight respects the floor and the per-vote mana cost', () => {
  // full mana, default 10% floor → 90% of mana spendable → 90%/2% per-vote = far past a full vote → caps 100%
  assert.equal(manaAffordableWeight({ votingManaBps: MAX_WEIGHT }), MAX_WEIGHT);
  // only 2% mana above the floor → exactly one full vote's worth
  const w = manaAffordableWeight({ votingManaBps: 1000 + FULL_VOTE_MANA_BPS, floorBps: 1000 });
  assert.equal(w, MAX_WEIGHT);
  // at/below the floor → nothing affordable
  assert.equal(manaAffordableWeight({ votingManaBps: 1000, floorBps: 1000 }), 0);
});

test('quoteVote: a healthy voter delivers the full bought weight', () => {
  const q = quoteVote({ altiSpent: 50, votingManaBps: MAX_WEIGHT });
  assert.equal(q.ok, true);
  assert.equal(q.weightBps, 5000);
  assert.equal(q.weightPct, 50);
  assert.equal(q.altiCharged, 50);
  assert.equal(q.altiRefunded, 0);
  assert.equal(q.reason, 'full');
});

test('quoteVote: low mana clamps the weight and refunds the unspent ALTI', () => {
  // voter has only enough mana above the floor for ~25% — buyer paid for 80%
  const floorBps = 1000;
  const manaForQuarter = floorBps + FULL_VOTE_MANA_BPS * 0.25;  // 1000 + 50 = 1050
  const q = quoteVote({ altiSpent: 80, votingManaBps: manaForQuarter, floorBps });
  assert.equal(q.ok, true);
  assert.equal(q.clampedByMana, true);
  assert.equal(q.reason, 'mana-clamped');
  assert.equal(q.weightBps, 2500);          // 25%
  assert.equal(q.altiCharged, 25);          // charged only for delivered weight
  assert.equal(q.altiRefunded, 55);         // 80 - 25
});

test('quoteVote soft-fails below minimum and on a drained voter', () => {
  assert.equal(quoteVote({ altiSpent: 0 }).ok, false);
  assert.equal(quoteVote({ altiSpent: 0 }).reason, 'below-minimum');
  const drained = quoteVote({ altiSpent: 50, votingManaBps: 500, floorBps: 1000 });
  assert.equal(drained.ok, false);
  assert.equal(drained.reason, 'voter-out-of-mana');
  assert.equal(drained.altiRefunded, 50);
});

test('buildVoteOrder returns two unsigned intents (user ALTI spend + @soapbox vote)', () => {
  const o = buildVoteOrder({ account: '@bob', permlink: 'my-post', altiSpent: 50, altiSpendTo: '0xtreasury' });
  assert.equal(o.ok, true);
  assert.equal(o.spend.type, 'alti-spend');
  assert.equal(o.spend.from, 'bob');
  assert.equal(o.spend.to, '0xtreasury');
  assert.equal(o.spend.amount, 50);
  assert.equal(o.spend.unsigned, true);
  assert.equal(o.vote.type, 'graphene-vote');
  assert.equal(o.vote.voter, 'soapbox');     // default market voter
  assert.equal(o.vote.author, 'bob');        // defaults to the buyer
  assert.equal(o.vote.permlink, 'my-post');
  assert.equal(o.vote.weight, 5000);
  assert.equal(o.vote.unsigned, true);
});

test('buildVoteOrder honours a custom voter + explicit author, soft-fails on bad input', () => {
  const o = buildVoteOrder({ account: 'bob', author: 'alice', permlink: 'p', altiSpent: 100, market: { voter: '@curator' } });
  assert.equal(o.vote.voter, 'curator');
  assert.equal(o.vote.author, 'alice');
  assert.equal(o.vote.weight, MAX_WEIGHT);
  assert.equal(buildVoteOrder({ permlink: 'p', altiSpent: 10 }).ok, false); // no account
  assert.equal(buildVoteOrder({ account: 'bob', altiSpent: 10 }).ok, false); // no permlink
});

test('renderQuote escapes + reports refund/clamp; mergeMarket clamps spread', () => {
  const q = quoteVote({ altiSpent: 80, votingManaBps: 1050, floorBps: 1000 });
  const html = renderQuote(q);
  assert.match(html, /upvote from @soapbox/);
  assert.match(html, /refunded/);
  assert.match(html, /clamped/);
  assert.match(renderQuote({ ok: false, reason: 'voter-out-of-mana' }), /Can't fill/);
  assert.equal(mergeMarket({ spreadBps: 99999 }).spreadBps, 10000); // clamped
});
