// zero-payout-runner.test.mjs — offline tests for the live zero-payout curation round.
// No network, no keys: fetch + castVote are injected; the dedupe file lives in a temp dir.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runZeroPayoutCuration, excludedAccounts, loadVoted, saveVoted, DEFAULTS,
} from './zero-payout-runner.mjs';

const tmpDb = () => join(mkdtempSync(join(tmpdir(), 'zp-')), 'voted.json');

// A fake RPC: returns a fixed page of get_discussions_by_created posts.
function fakeFetch(posts) {
  return async () => ({ json: async () => ({ result: posts }) });
}

const future = new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString().replace('T', ' ').replace(/\..*/, '');
const old = new Date(Date.now() - 60 * 60 * 1000).toISOString().replace('T', ' ').replace(/\..*/, '');

const POSTS = [
  { author: 'alice', permlink: 'p1', parent_author: '', pending_payout_value: '0.000 MELEK', cashout_time: future, created: old },
  { author: 'hathor', permlink: 'self', parent_author: '', pending_payout_value: '0.000 MELEK', cashout_time: future, created: old }, // self — excluded
  { author: 'bob', permlink: 'paid', parent_author: '', pending_payout_value: '1.234 MELEK', cashout_time: future, created: old }, // already paid — skipped
  { author: 'carol', permlink: 'c1', parent_author: '', pending_payout_value: '0.000 MELEK', cashout_time: future, created: old },
  { author: 'dave', permlink: 'reply', parent_author: 'alice', pending_payout_value: '0.000 MELEK', cashout_time: future, created: old }, // comment — skipped
];

test('excludedAccounts covers curator + self-deal guard + affiliated', () => {
  const ex = excludedAccounts({ curator: 'hathor' });
  assert.ok(ex.has('hathor'));   // curator + curation-engine selfAccounts
  assert.ok(ex.has('thoth'));    // affiliated default
  assert.ok(ex.has('vankush'));
});

test('dry run selects real $0.00 payable top-level posts, casts nothing', async () => {
  const dbPath = tmpDb();
  const res = await runZeroPayoutCuration({
    fetch: fakeFetch(POSTS), castVote: undefined, dbPath, minAgeSec: 0, curator: 'hathor',
  });
  assert.equal(res.dryRun, true);
  assert.equal(res.cast.length, 0);
  const authors = res.selected.map((p) => p.author).sort();
  assert.deepEqual(authors, ['alice', 'carol']); // hathor(self), bob(paid), dave(comment) all excluded
});

test('live run casts gentle-weight votes, dedupes, persists, caps at topN', async () => {
  const dbPath = tmpDb();
  const votes = [];
  const castVote = async (v) => { votes.push(v); return { id: 'tx-' + votes.length }; };
  const res = await runZeroPayoutCuration({
    fetch: fakeFetch(POSTS), castVote, dbPath, minAgeSec: 0, curator: 'hathor', weight: 3000, topN: 1,
  });
  assert.equal(res.dryRun, false);
  assert.equal(res.cast.length, 1);            // capped at topN=1
  assert.equal(votes[0].weight, 3000);         // gentle 30%
  assert.equal(votes[0].voter, 'hathor');
  assert.ok(existsSync(dbPath));               // dedupe persisted
  const persisted = JSON.parse(readFileSync(dbPath, 'utf8'));
  assert.equal(persisted.length, 1);
});

test('dedupe set skips a post already voted in a prior round', async () => {
  const dbPath = tmpDb();
  // Pre-seed the dedupe file with alice/p1 (the freshest → first pick).
  saveVoted(new Set(['alice/p1']), dbPath);
  const votes = [];
  const castVote = async (v) => { votes.push(v); return { id: 'x' }; };
  const res = await runZeroPayoutCuration({
    fetch: fakeFetch(POSTS), castVote, dbPath, minAgeSec: 0, curator: 'hathor', topN: 10,
  });
  const voted = votes.map((v) => `${v.author}/${v.permlink}`);
  assert.ok(!voted.includes('alice/p1'));      // skipped — already in dedupe
  assert.ok(voted.includes('carol/c1'));       // carol still lifted
});

test('soft-fails to a dry-ish result when the RPC throws', async () => {
  const dbPath = tmpDb();
  const badFetch = async () => { throw new Error('boom'); };
  const res = await runZeroPayoutCuration({ fetch: badFetch, castVote: async () => ({}), dbPath, curator: 'hathor' });
  assert.equal(res.selected.length, 0);
  assert.equal(res.cast.length, 0);            // nothing selected → nothing cast, no throw
});

test('loadVoted/saveVoted round-trip; unreadable path → empty set', () => {
  const dbPath = tmpDb();
  assert.equal(loadVoted(dbPath).size, 0);
  saveVoted(new Set(['a/b', 'c/d']), dbPath);
  const back = loadVoted(dbPath);
  assert.ok(back.has('a/b') && back.has('c/d'));
  assert.equal(loadVoted('/no/such/dir/nope.json').size, 0);
});

test('voteGapMs spaces casts between votes (each vote awaits the gap)', async () => {
  const dbPath = tmpDb();
  const stamps = [];
  const castVote = async () => { stamps.push(Date.now()); return { id: 'x' }; };
  await runZeroPayoutCuration({
    fetch: fakeFetch(POSTS), castVote, dbPath, minAgeSec: 0, curator: 'hathor', topN: 2, voteGapMs: 40,
  });
  assert.equal(stamps.length, 2);
  assert.ok(stamps[1] - stamps[0] >= 35, 'second cast waited out the gap'); // ~40ms gap after first
});

test('DEFAULTS are sane (gentle weight, capped, local RPC, melek tag)', () => {
  assert.ok(DEFAULTS.weight >= 1 && DEFAULTS.weight <= 10000);
  assert.equal(DEFAULTS.tag, 'melek');
  assert.ok(DEFAULTS.rpcUrl.includes('18090'));
  assert.ok(DEFAULTS.topN >= 1);
});
