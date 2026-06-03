// bio-nft-mint.test.mjs — OFFLINE tests for the Bio-NFT mint + MELEKSwap listing intents.
// Run: node --test integrations/bio-nft-mint.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildBioNft, mintIntent, listingIntent, contentHash, normalizeTier,
  assertDryRunSafe, HOLDS_KEYS, BROADCASTS,
  TIER1_NEURAL, TIER2_BEHAVIORAL,
} from './bio-nft-mint.mjs';

const OWNER = 'hathor-user-1';
const SALE_CONSENT = { subject: OWNER, granted: true, sale: true };

// ── content addressing ────────────────────────────────────────────────────────
test('contentHash is deterministic and order-independent', () => {
  const a = contentHash({ x: 1, y: 2 });
  const b = contentHash({ y: 2, x: 1 }); // different key order, same content
  assert.equal(a, b);
  assert.match(a, /^[a-f0-9]{64}$/);
  // a different value yields a different hash
  assert.notEqual(a, contentHash({ x: 1, y: 3 }));
});

test('normalizeTier accepts aliases and fails safe to Tier-1', () => {
  assert.equal(normalizeTier('neural'), TIER1_NEURAL);
  assert.equal(normalizeTier('TIER1'), TIER1_NEURAL);
  assert.equal(normalizeTier('behavioral'), TIER2_BEHAVIORAL);
  assert.equal(normalizeTier('tier2'), TIER2_BEHAVIORAL);
  assert.equal(normalizeTier('???'), TIER1_NEURAL); // fail-safe → highest protection
  assert.equal(normalizeTier(undefined), TIER1_NEURAL);
});

// ── buildBioNft: metadata shape + deterministic id ──────────────────────────────
test('buildBioNft produces the expected metadata shape', () => {
  const nft = buildBioNft({
    ownerId: OWNER,
    interpretation: { summary: 'eeg coherence', score: 0.8 },
    tier: 'neural',
    license: 'research-only',
  });
  assert.equal(nft.kind, 'bio-nft');
  assert.equal(nft.version, 1);
  assert.equal(nft.ownerId, OWNER);
  assert.equal(nft.tier, TIER1_NEURAL);
  assert.equal(nft.license, 'research-only');
  assert.equal(nft.licenseKnown, true);
  assert.match(nft.id, /^bionft_[a-f0-9]{32}$/);
  assert.match(nft.dataHash, /^[a-f0-9]{64}$/);
  assert.match(nft.interpretationHash, /^[a-f0-9]{64}$/);
  // on-chain footprint = hashes + license + tier ONLY (anchor pattern; no raw data)
  assert.deepEqual(Object.keys(nft.onChain).sort(),
    ['consentRequired', 'dataHash', 'interpretationHash', 'license', 'tier']);
  assert.ok(typeof nft.createdAt === 'string');
});

test('the off-chain raw data/interpretation is NEVER embedded (only the hash is)', () => {
  const interpretation = { secret: 'sensitive neural reading' };
  const nft = buildBioNft({ ownerId: OWNER, interpretation, tier: 'neural' });
  const blob = JSON.stringify(nft);
  assert.ok(!blob.includes('sensitive neural reading'), 'raw interpretation text must not appear in the NFT');
  // but its hash anchors it
  assert.equal(nft.interpretationHash, contentHash(interpretation));
});

test('content hash is deterministic across equal builds (content-addressed id)', () => {
  const args = { ownerId: OWNER, dataHash: contentHash({ vr: 'x' }), tier: 'behavioral', license: 'cc-by' };
  assert.equal(buildBioNft(args).id, buildBioNft(args).id);
  assert.equal(buildBioNft(args).dataHash, buildBioNft(args).dataHash);
});

test('a 64-hex dataHash is used verbatim as the anchor', () => {
  const h = contentHash('already-hashed-payload');
  const nft = buildBioNft({ ownerId: OWNER, dataHash: h, tier: 'behavioral' });
  assert.equal(nft.dataHash, h);
});

test('buildBioNft requires ownerId and an anchor', () => {
  assert.throws(() => buildBioNft({ tier: 'neural', interpretation: {} }), /ownerId/);
  assert.throws(() => buildBioNft({ ownerId: OWNER, tier: 'neural' }), /dataHash or an interpretation/);
});

test('license defaults to all-rights-reserved', () => {
  const nft = buildBioNft({ ownerId: OWNER, interpretation: { a: 1 }, tier: 'behavioral' });
  assert.equal(nft.license, 'all-rights-reserved');
});

// ── Tier-1 consent flag invariant ───────────────────────────────────────────────
test('INVARIANT: Tier-1 neural NFTs carry the no-sale-without-consent flag', () => {
  const neural = buildBioNft({ ownerId: OWNER, interpretation: { a: 1 }, tier: 'neural' });
  assert.equal(neural.consentRequired, true);
  assert.equal(neural.onChain.consentRequired, true);
});

test('Tier-2 behavioral NFTs do NOT require consent to list', () => {
  const beh = buildBioNft({ ownerId: OWNER, dataHash: contentHash({ vr: 1 }), tier: 'behavioral' });
  assert.equal(beh.consentRequired, false);
});

// ── mintIntent: simulated by default, never moves value ──────────────────────────
test('mintIntent is simulated/dry-run by default and moves no value', () => {
  const nft = buildBioNft({ ownerId: OWNER, interpretation: { a: 1 }, tier: 'neural' });
  const intent = mintIntent(nft);
  assert.equal(intent.action, 'mint');
  assert.equal(intent.simulated, true);
  assert.equal(intent.signed, false);
  assert.equal(intent.movesValue, false);
  assert.equal(intent.consentRequired, true);
  assert.ok(!('signature' in intent), 'no signature without an injected signer');
  // op carries only the on-chain footprint
  assert.deepEqual(intent.op.payload, nft.onChain);
});

test('mintIntent signs ONLY when a sign function is injected', () => {
  const nft = buildBioNft({ ownerId: OWNER, interpretation: { a: 1 }, tier: 'neural' });
  let sawOp = null;
  const intent = mintIntent(nft, { sign: (op) => { sawOp = op; return 'SIG'; } });
  assert.equal(intent.signed, true);
  assert.equal(intent.simulated, false);
  assert.equal(intent.signature, 'SIG');
  assert.equal(sawOp.type, 'bio_nft_mint'); // the injected signer received the op
});

// ── listingIntent: dry-run + Tier-1 consent gate ─────────────────────────────────
test('listingIntent is BLOCKED for a Tier-1 NFT without explicit consent', () => {
  const neural = buildBioNft({ ownerId: OWNER, interpretation: { a: 1 }, tier: 'neural' });
  const intent = listingIntent(neural, { price: 100 });
  assert.equal(intent.blocked, true);
  assert.match(intent.reason, /consent/i);
  assert.equal(intent.signed, false);
  assert.equal(intent.movesValue, false);
  assert.ok(!('op' in intent), 'no op produced when blocked');
});

test('listingIntent proceeds (dry-run) for Tier-1 WITH explicit sale consent', () => {
  const neural = buildBioNft({ ownerId: OWNER, interpretation: { a: 1 }, tier: 'neural' });
  const intent = listingIntent(neural, { price: 100, consent: SALE_CONSENT });
  assert.equal(intent.blocked, false);
  assert.equal(intent.simulated, true);
  assert.equal(intent.signed, false);
  assert.equal(intent.movesValue, false);
  assert.equal(intent.market, 'MELEKSwap');
  assert.equal(intent.price, 100);
  assert.equal(intent.op.type, 'meleckswap_list');
});

test('listingIntent rejects consent that is not sale-scoped or not the owner', () => {
  const neural = buildBioNft({ ownerId: OWNER, interpretation: { a: 1 }, tier: 'neural' });
  assert.equal(listingIntent(neural, { price: 1, consent: { subject: OWNER, granted: true } }).blocked, true);
  assert.equal(listingIntent(neural, { price: 1, consent: { subject: 'someone-else', granted: true, sale: true } }).blocked, true);
});

test('Tier-2 listing needs no consent and defaults to MELEKSwap dry-run', () => {
  const beh = buildBioNft({ ownerId: OWNER, dataHash: contentHash({ vr: 1 }), tier: 'behavioral' });
  const intent = listingIntent(beh, { price: 5 });
  assert.equal(intent.blocked, false);
  assert.equal(intent.market, 'MELEKSwap');
  assert.equal(intent.simulated, true);
  assert.equal(intent.signed, false);
});

test('listingIntent requires a positive price (when not blocked)', () => {
  const beh = buildBioNft({ ownerId: OWNER, dataHash: contentHash({ vr: 1 }), tier: 'behavioral' });
  assert.throws(() => listingIntent(beh, { price: 0 }), /positive numeric price/);
  assert.throws(() => listingIntent(beh, {}), /positive numeric price/);
});

test('listingIntent signs ONLY when a sign function is injected', () => {
  const beh = buildBioNft({ ownerId: OWNER, dataHash: contentHash({ vr: 1 }), tier: 'behavioral' });
  const intent = listingIntent(beh, { price: 5, sign: () => 'LISTSIG' });
  assert.equal(intent.signed, true);
  assert.equal(intent.simulated, false);
  assert.equal(intent.signature, 'LISTSIG');
});

// ── module-level dry-run-safety invariant ────────────────────────────────────────
test('module holds no keys and never broadcasts (dry-run-safe sentinel)', () => {
  assert.equal(HOLDS_KEYS, false);
  assert.equal(BROADCASTS, false);
  assert.equal(assertDryRunSafe(), true);
});

test('mint/list reject anything that is not a Bio-NFT record', () => {
  assert.throws(() => mintIntent({ kind: 'not-an-nft' }), /Bio-NFT/);
  assert.throws(() => listingIntent({}, { price: 1 }), /Bio-NFT/);
});
