// bounty-board.test.mjs — offline, deterministic (now injected), soft-fail. `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BOUNTIES, CATEGORIES, bountiesByCategory, getBounty, makeStore,
  startBounty, completeBounty, linkWallet, claimable, claim, progress, esc,
} from './bounty-board.mjs';
import { authorizeUrl } from '../melek-signer-oauth.mjs';
import { totalsFor } from '../../ambassadors/earnings.mjs';
import { referralsFor } from '../../ambassadors/attribution.mjs';
import { enroll } from '../../ambassadors/registry.mjs';

const T = 1_700_000_000_000;

test('social login URL builds via the shared MELEK-Signer OAuth flow', () => {
  const u = authorizeUrl({ clientId: 'melek-bounties', scope: 'identity', state: 'nonce1' });
  assert.match(u, /\/oauth2\/authorize/);
  assert.match(u, /client_id=melek-bounties/);
  assert.match(u, /scope=identity/);
  assert.match(u, /state=nonce1/);
});

test('registry covers every funnel category with valid verify types', () => {
  const cats = new Set(BOUNTIES.map((b) => b.category));
  for (const c of CATEGORIES) assert.ok(cats.has(c), `missing category ${c}`);
  for (const b of BOUNTIES) assert.ok(['auto', 'manual', 'referral'].includes(b.verify));
  // advanced graduation paths present
  assert.ok(getBounty('create-token'));
  assert.ok(getBounty('run-witness'));
  assert.ok(getBounty('curation-trail'));
});

test('bountiesByCategory groups all bounties under their category', () => {
  const g = bountiesByCategory();
  const flat = Object.values(g).flat();
  assert.equal(flat.length, BOUNTIES.length);
  assert.ok(g.foundational.length >= 1);
});

test('startBounty records a start timestamp; idempotent', () => {
  const s = makeStore();
  const r = startBounty({ socialId: 'google:1', bountyId: 'read-intro', now: T }, s);
  assert.equal(r.ok, true);
  assert.equal(r.startedAt, T);
  const again = startBounty({ socialId: 'google:1', bountyId: 'read-intro', now: T + 5 }, s);
  assert.equal(again.startedAt, T); // unchanged
});

test('completeBounty records a HELD earning on the shared ledger', async () => {
  const s = makeStore();
  const r = await completeBounty({ socialId: 'google:2', bountyId: 'read-intro', now: T }, s);
  assert.equal(r.ok, true);
  assert.equal(r.held.amount, getBounty('read-intro').rewardUnits);
  const t = totalsFor('google:2', { fs: s.fs, file: s.earningsFile });
  assert.equal(t.total, getBounty('read-intro').rewardUnits);
  assert.equal(t.paid, 0); // held, not paid
});

test('no double-claim on the same bounty', async () => {
  const s = makeStore();
  const first = await completeBounty({ socialId: 'google:3', bountyId: 'first-post', proof: 'x', now: T }, s);
  assert.equal(first.ok, true);
  const dup = await completeBounty({ socialId: 'google:3', bountyId: 'first-post', proof: 'x', now: T }, s);
  assert.equal(dup.ok, false);
  assert.match(dup.reason, /already completed/);
  const t = totalsFor('google:3', { fs: s.fs, file: s.earningsFile });
  assert.equal(t.total, getBounty('first-post').rewardUnits); // recorded once
});

test('THE GATE: earnings are NOT claimable before linkWallet, ARE after', async () => {
  const s = makeStore();
  await completeBounty({ socialId: 'gh:4', bountyId: 'read-intro', now: T }, s);
  const before = claimable({ socialId: 'gh:4' }, s);
  assert.equal(before.linked, false);
  assert.equal(before.claimable, 0);
  assert.equal(before.locked, before.held);
  assert.ok(before.held > 0);

  const link = linkWallet({ socialId: 'gh:4', account: 'vankush', now: T }, s);
  assert.equal(link.ok, true);
  assert.equal(link.chain, 'melek');

  const after = claimable({ socialId: 'gh:4' }, s);
  assert.equal(after.linked, true);
  assert.equal(after.claimable, after.held);
  assert.equal(after.locked, 0);
});

test('claim is refused until a wallet is linked (the unlock)', async () => {
  const s = makeStore();
  await completeBounty({ socialId: 'gh:5', bountyId: 'read-intro', now: T }, s);
  const c = claim({ socialId: 'gh:5' }, s);
  assert.equal(c.ok, false);
  assert.match(c.reason, /link a wallet/i);
  assert.ok(c.locked > 0);
});

test('claim returns an UNSIGNED, signable payout intent — no keys, signs nothing', async () => {
  const s = makeStore();
  await completeBounty({ socialId: 'gh:6', bountyId: 'first-post', proof: 'y', now: T }, s);
  linkWallet({ socialId: 'gh:6', account: 'vankush', now: T }, s);
  const c = claim({ socialId: 'gh:6' }, s);
  assert.equal(c.ok, true);
  assert.equal(c.signed, false);
  assert.equal(c.unsigned, true);
  assert.ok(Array.isArray(c.calls) && c.calls.length === 1);
  assert.equal(c.calls[0].unsigned, true);
  assert.equal(c.account, 'vankush');
  const blob = JSON.stringify(c).toLowerCase();
  assert.ok(!/wif|private|posting_key|"key"/.test(blob), 'no key material in the intent');
});

test('EVM wallet links on PRANA and claims via the escrow rail', async () => {
  const s = makeStore();
  await completeBounty({ socialId: 'dc:7', bountyId: 'first-post', proof: 'z', now: T }, s);
  const link = linkWallet({ socialId: 'dc:7', account: '0x' + 'a'.repeat(40), now: T }, s);
  assert.equal(link.ok, true);
  assert.equal(link.chain, 'prana');
  const c = claim({ socialId: 'dc:7' }, s);
  assert.equal(c.ok, true);
  assert.equal(c.calls[0].chain, 'prana');
  assert.equal(c.calls[0].contract, 'ContributionBountyEscrow');
});

test('referral bounty ties the referred signup into the attribution tree', async () => {
  const s = makeStore();
  const qr = { fs: s.fs, file: 'mem:qr' };
  const enrolled = await enroll('alice', { fs: s.fs, file: s.registryFile, qr, karma: 42, tenureDays: 30, now: T });
  assert.equal(enrolled.ok, true);
  const code = enrolled.ambassador.code; // amb-alice

  const r = await completeBounty(
    { socialId: 'gh:ref', bountyId: 'refer-friend', proof: { newAccount: 'bobby', ref: code }, now: T }, s,
  );
  assert.equal(r.ok, true);
  assert.equal(r.leg, 'referral');
  assert.ok(r.attribution && r.attribution.attributed === true);
  const rows = referralsFor('alice', { fs: s.fs, file: s.referralsFile });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].newAccount, 'bobby');
});

test('progress reports per-category completion + funnel balances', async () => {
  const s = makeStore();
  await completeBounty({ socialId: 'gh:8', bountyId: 'read-intro', now: T }, s);
  const p = progress({ socialId: 'gh:8' }, s);
  assert.equal(p.ok, true);
  assert.equal(p.completedCount, 1);
  assert.equal(p.byCategory.foundational.done, 1);
  assert.ok(p.byCategory.foundational.total >= 1);
  assert.equal(p.linked, false);
  assert.ok(p.held > 0);
  assert.ok(Array.isArray(p.next));
});

test('manual/referral bounties require proof; auto ones self-serve', async () => {
  const s = makeStore();
  const noProof = await completeBounty({ socialId: 'gh:9', bountyId: 'join-discord', now: T }, s);
  assert.equal(noProof.ok, false);
  assert.match(noProof.reason, /proof/);
  const auto = await completeBounty({ socialId: 'gh:9', bountyId: 'read-intro', now: T }, s);
  assert.equal(auto.ok, true);
});

test('soft-fail on bad input; never throws', async () => {
  const s = makeStore();
  assert.equal((await completeBounty({ socialId: '', bountyId: 'read-intro' }, s)).ok, false);
  assert.equal((await completeBounty({ socialId: 'x', bountyId: 'nope' }, s)).ok, false);
  assert.equal(startBounty({ socialId: 'x', bountyId: 'nope' }, s).ok, false);
  assert.equal(linkWallet({ socialId: 'x', account: 'no' }, s).ok, false);
  assert.equal(claimable({ socialId: '' }, s).ok, false);
  assert.equal(claim({ socialId: '' }, s).ok, false);
  assert.equal(progress({ socialId: '' }, s).ok, false);
});

test('esc escapes XSS metacharacters', () => {
  assert.equal(esc('<script>"&\''), '&lt;script&gt;&quot;&amp;&#39;');
});
