// store-shared.test.js — proves Cheetah's store layer (store.js) and the
// orchestrator's discovery wiring read/write the SHARED multi-bot store
// (store/index.mjs), so Hathor can read Cheetah's findings from one substrate.
//
// (A) shared-store migration: a finding/whitelist written via cheetah/store.js
//     is readable through a bare Store at cheetah.findings / cheetah.whitelist.
// (B) discovery firing: scanPost, in the no-text-match branch, produces a
//     discovery (librarian "see also") comment when prior work lands in the band.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rm } from 'node:fs/promises';
import { Store } from '../store/index.mjs';
import { recordFinding, addWhitelist, isWhitelisted, isBlacklisted, NS } from './store.js';
import { scanPost } from './index.js';

function tmpRoot(tag) { return join(tmpdir(), `cheetah-shared-${tag}-${process.pid}`); }

// ---- (A) shared store -------------------------------------------------------

test('a finding recorded via store.js is readable through a bare shared Store at cheetah.findings', async () => {
  const root = tmpRoot('finding');
  await rm(root, { recursive: true, force: true });
  const { id } = await recordFinding(
    { post: { author: 'alice', permlink: 'p1' }, source: { kind: 'web', url: 'http://x' }, confidence: 0.8 },
    root,
  );
  // Hathor's view: open the SAME root with a plain Store and read the namespace.
  const hathorView = new Store(root);
  const items = await hathorView.all(NS.findings);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, id);
  assert.equal(items[0].post.author, 'alice');
  assert.equal(items[0].status, 'open');
  await rm(root, { recursive: true, force: true });
});

test('whitelist written via store.js lands in cheetah.whitelist and suppresses via isWhitelisted', async () => {
  const root = tmpRoot('wl');
  await rm(root, { recursive: true, force: true });
  await addWhitelist({ account: 'bob', reason: 'self-quote', evidence: 'http://bob.blog/x', addedBy: 'hathor' }, root);
  assert.equal(await isWhitelisted('bob', null, root), true);
  assert.equal(await isWhitelisted('carol', null, root), false);
  const hathorView = new Store(root);
  assert.equal((await hathorView.all(NS.whitelist)).length, 1);
  await rm(root, { recursive: true, force: true });
});

test('recordFinding is idempotent on (post, source) in the shared store', async () => {
  const root = tmpRoot('idem');
  await rm(root, { recursive: true, force: true });
  const a = await recordFinding({ post: { author: 'a', permlink: 'q' }, source: { kind: 'web', url: 'http://u' }, confidence: 0.7 }, root);
  const b = await recordFinding({ post: { author: 'a', permlink: 'q' }, source: { kind: 'web', url: 'http://u' }, confidence: 0.7 }, root);
  assert.equal(a.deduplicated, false);
  assert.equal(b.deduplicated, true);
  assert.equal((await new Store(root).all(NS.findings)).length, 1);
  await rm(root, { recursive: true, force: true });
});

// ---- (B) discovery wiring in the orchestrator -------------------------------

const PRIOR = {
  author: 'alice', permlink: 'graphene-dpos-primer',
  body: 'Graphene-family chains rely on delegated proof-of-stake. Witnesses are elected by stake-weighted voting and produce blocks in a round-robin schedule. Block intervals are three seconds.',
};

test('scanPost fires a discovery comment on a topically-related (not copied) post', async () => {
  // Original post that overlaps PRIOR's topic but is NOT a copy → lands in the
  // relatedness band → the no-text-match branch should produce a discovery intent.
  const post = {
    author: 'carol', permlink: 'wallet-ux',
    body: 'Delegated proof-of-stake elects witnesses by stake-weighted voting. I want to talk about why three second blocks feel fast to users and what that means for wallet UX and confirmation design.',
  };
  const r = await scanPost(post, { dryRun: true, corpus: [PRIOR] });
  assert.equal(r.intent, 'discovery-comment');
  assert.ok(Array.isArray(r.related) && r.related.length >= 1);
  assert.equal(r.related[0].author, 'alice');
  assert.match(r.comment, /alice/);
});

test('scanPost stays silent (no-match) on a truly unrelated post', async () => {
  const post = { author: 'dave', permlink: 'bananas', body: 'I bought bananas at the store and the cashier was kind. Bananas are a good fruit.' };
  const r = await scanPost(post, { dryRun: true, corpus: [PRIOR] });
  assert.equal(r.skipped, 'no-match');
});

test('scanPost suppresses discovery for a whitelisted author', async () => {
  // Whitelisting is keyed by account, not material — so even a related post
  // from a whitelisted author is suppressed (same guard as the crediting path).
  // Drive scanPost with an isolated storeRoot so the assertion exercises the
  // real suppression branch end-to-end.
  const root = tmpRoot('wl-disc');
  await rm(root, { recursive: true, force: true });
  await addWhitelist({ account: 'carol', reason: 'self-quote', evidence: 'http://carol.blog', addedBy: 'hathor' }, root);
  const post = {
    author: 'carol', permlink: 'wallet-ux-2',
    body: 'Delegated proof-of-stake elects witnesses by stake-weighted voting. I want to talk about why three second blocks feel fast to users and what that means for wallet UX and confirmation design.',
  };
  const r = await scanPost(post, { dryRun: true, corpus: [PRIOR], storeRoot: root });
  assert.equal(r.skipped, 'author-whitelisted');
  await rm(root, { recursive: true, force: true });
});

test('a near-copy does NOT route to discovery (that is detection territory)', async () => {
  // A body that is a near-copy of PRIOR will score above the discovery ceiling,
  // so discovery yields nothing; with no chain + an open-web finding absent,
  // detection's own match path handles it (here, against an empty corpus, the
  // near-copy of PRIOR has nothing to match, so it is silent — the point is it
  // does NOT mislabel as discovery).
  const nearCopy = { author: 'bob', permlink: 'x', body: PRIOR.body + ' I agree.' };
  const r = await scanPost(nearCopy, { dryRun: true, corpus: [PRIOR] });
  // PRIOR is the corpus; near-copy vs PRIOR is a detection MATCH (above the
  // detection threshold), so it routes to the crediting note, not discovery.
  assert.notEqual(r.intent, 'discovery-comment');
});
