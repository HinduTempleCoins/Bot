// Offline test for karma.mjs — pure scoring, tiers, injected fetcher, store. No network/clock/disk-net.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.KARMA_STORE = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'karma-')), 'karma.json');
const k = await import('./karma.mjs');

test('scoreActivity is bounded 0..100 and rewards the §9 signals', () => {
  const empty = k.scoreActivity({});
  assert.equal(empty.score, 0, 'no activity → 0');

  const helpful = k.scoreActivity({
    postCount: 40, commentCount: 300, repliesToNewcomers: 60,
    upvotesGiven: 400, selfVotes: 10, accountAgeDays: 400, flagsGiven: 10, reputation: 70,
  });
  assert.ok(helpful.score > 60 && helpful.score <= 100, `helpful scores high (${helpful.score})`);

  // a pure self-voter gets near-zero generosity even with many votes.
  const selfish = k.scoreActivity({ upvotesGiven: 500, selfVotes: 500 });
  assert.equal(selfish.components.generosity, 0, 'all self-votes → no generosity credit');
});

test('generosity = share-to-others × volume (monotonic in both)', () => {
  const a = k.scoreActivity({ upvotesGiven: 100, selfVotes: 0 });
  const b = k.scoreActivity({ upvotesGiven: 100, selfVotes: 50 });
  assert.ok(a.components.generosity > b.components.generosity, 'more self-votes → less generosity');
});

test('grantTierFor maps scores to discretionary tiers', () => {
  assert.equal(k.grantTierFor(0).tier, 'newcomer');
  assert.equal(k.grantTierFor(30).tier, 'member');
  assert.equal(k.grantTierFor(60).tier, 'trusted');
  assert.equal(k.grantTierFor(90).tier, 'pillar');
  assert.ok(k.grantTierFor(90).grantMultiplier > k.grantTierFor(30).grantMultiplier);
});

test('normalizeReputation: bigger raw rep → higher 0..100, clamped', () => {
  assert.equal(k.normalizeReputation(0), 25);
  const low = k.normalizeReputation(1e9);
  const high = k.normalizeReputation(1e15);
  assert.ok(high > low);
  assert.ok(k.normalizeReputation(1e30) <= 100 && k.normalizeReputation(-1e15) >= 0);
});

test('computeKarma uses injected fetcher; save persists + rank sorts', async () => {
  k.__setFetchActivity(async (acct) => ({
    alice: { account: 'alice', postCount: 50, commentCount: 200, upvotesGiven: 300, selfVotes: 5, accountAgeDays: 500, repliesToNewcomers: 40 },
    bob: { account: 'bob', postCount: 1, upvotesGiven: 20, selfVotes: 20, accountAgeDays: 10 },
  }[acct] || { account: acct }));

  const a = await k.computeKarma('alice', { save: true });
  const b = await k.computeKarma('bob', { save: true });
  assert.ok(a.score > b.score, 'alice (helpful) > bob (self-voter newbie)');
  assert.ok(['trusted', 'pillar', 'member'].includes(a.tier));

  const rows = k.rank();
  assert.equal(rows[0].account, 'alice', 'rank sorts by score desc');
  assert.equal(rows.length, 2);
});

test('never touches the chain reward pool — record is advisory only', async () => {
  k.__setFetchActivity(async (acct) => ({ account: acct, postCount: 10 }));
  const r = await k.computeKarma('carol');
  // the record is pure data: a score + advisory grant/flag knobs, no broadcast, no transfer.
  assert.deepEqual(Object.keys(r).sort(), ['account', 'components', 'flagWeight', 'grantMultiplier', 'score', 'tier', 'updatedAt'].sort());
});
