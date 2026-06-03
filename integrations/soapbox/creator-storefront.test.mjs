// creator-storefront.test.mjs — guards for the Gumroad-style creator storefront (queue #147). PURE,
// OFFLINE. No network. Run: node --test integrations/soapbox/creator-storefront.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProduct, buildSellPage, purchaseIntent, creatorPayout } from './creator-storefront.mjs';

const base = {
  creatorId: 'alice',
  title: 'My Album',
  priceSoap: 10,
  license: 'CC BY-NC 4.0',
  fileHash: 'bafyABC1234567890deadbeef',
};

// ── createProduct: requires a fileHash from the NFT host ───────────────────────────────────────────
test('createProduct requires a fileHash (no file, no product)', () => {
  assert.throws(() => createProduct({ ...base, fileHash: undefined }), /fileHash/);
  assert.throws(() => createProduct({ ...base, fileHash: '' }), /fileHash/);
  assert.throws(() => createProduct({ ...base, fileHash: '   ' }), /fileHash/);
});

test('createProduct builds an own-work product referencing the NFT host', () => {
  const p = createProduct(base);
  assert.equal(p.kind, 'soapbox-creator-product');
  assert.equal(p.creatorId, 'alice');
  assert.equal(p.priceSoap, 10);
  assert.equal(p.settlementAsset, 'SOAP');
  assert.equal(p.fileHash, base.fileHash);
  assert.equal(p.hostedBy, 'nft-host');
  assert.ok(['USER_NFT', 'HOST_FULL'].includes(p.bucket));
});

test('createProduct validates required fields and price', () => {
  assert.throws(() => createProduct({ ...base, creatorId: '' }), /creatorId/);
  assert.throws(() => createProduct({ ...base, title: '' }), /title/);
  assert.throws(() => createProduct({ ...base, priceSoap: -1 }), /priceSoap/);
  assert.throws(() => createProduct({ ...base, priceSoap: 'free' }), /priceSoap/);
});

// ── only own / sellable works (three-bucket reuse) ────────────────────────────────────────────────
test('createProduct rejects someone elses in-copyright work (METADATA_ONLY not sellable)', () => {
  assert.throws(
    () => createProduct({
      ...base,
      creatorId: 'mallory',
      license: 'all-rights-reserved',
      work: { rights: 'All rights reserved', owner: 'big-publisher' },
    }),
    /not sellable|own works/i,
  );
});

test('createProduct allows our own corpus and explicit user-owned works', () => {
  const corpus = createProduct({ ...base, work: { owner: 'melek' } });
  assert.equal(corpus.bucket, 'HOST_FULL');
  const owned = createProduct({ ...base, license: 'all-rights-reserved', work: { userOwned: true, rights: 'in copyright' } });
  assert.equal(owned.bucket, 'USER_NFT');
});

// ── buildSellPage escapes HTML injection ──────────────────────────────────────────────────────────
test('buildSellPage escapes HTML in every input', () => {
  const p = createProduct({
    ...base,
    title: '<script>alert(1)</script>',
    creatorId: 'al"ice<x>',
  });
  const html = buildSellPage(p);
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'title escaped');
  assert.ok(!html.includes('al"ice<x>'), 'raw creator must not appear');
  assert.ok(html.includes('&quot;') && html.includes('&lt;x&gt;'), 'creator escaped');
  assert.ok(html.includes(p.fileHash), 'hash present (no special chars to escape here)');
});

test('buildSellPage requires a product', () => {
  assert.throws(() => buildSellPage(null), /product/);
});

// ── purchaseIntent is simulated (dry-run, never broadcasts) ───────────────────────────────────────
test('purchaseIntent is a dry-run that never broadcasts without an injected signer', () => {
  const p = createProduct(base);
  const intent = purchaseIntent(p, { buyer: 'bob' });
  assert.equal(intent.kind, 'soapbox-purchase-intent');
  assert.equal(intent.dryRun, true);
  assert.equal(intent.broadcast, false);
  assert.equal(intent.signed, null);
  assert.equal(intent.transfer.from, 'bob');
  assert.equal(intent.transfer.to, 'alice');
  assert.equal(intent.transfer.amount, 10);
  assert.equal(intent.transfer.asset, 'SOAP');
});

test('purchaseIntent still does not broadcast even when a signer is injected', () => {
  const p = createProduct(base);
  let called = false;
  const intent = purchaseIntent(p, { buyer: 'bob', sign: (t) => { called = true; return { sig: 'SIMULATED', op: t }; } });
  assert.equal(called, true, 'injected signer is invoked');
  assert.equal(intent.dryRun, false, 'a signer was injected');
  assert.equal(intent.broadcast, false, 'this module NEVER broadcasts / moves value');
  assert.deepEqual(intent.signed, { sig: 'SIMULATED', op: intent.transfer });
});

test('purchaseIntent requires a buyer and a product', () => {
  const p = createProduct(base);
  assert.throws(() => purchaseIntent(p, {}), /buyer/);
  assert.throws(() => purchaseIntent(null, { buyer: 'bob' }), /product/);
});

// ── creatorPayout is receive-only ─────────────────────────────────────────────────────────────────
test('creatorPayout is receive-only and does not settle', () => {
  const payout = creatorPayout({ productId: 'prod_x', creatorId: 'alice', buyer: 'bob', amount: 10 });
  assert.equal(payout.kind, 'soapbox-creator-payout');
  assert.equal(payout.direction, 'receive');
  assert.equal(payout.payee, 'alice');
  assert.equal(payout.asset, 'SOAP');
  assert.equal(payout.amount, 10);
  assert.equal(payout.settled, false);
});

test('creatorPayout accepts priceSoap alias and validates inputs', () => {
  const payout = creatorPayout({ creatorId: 'alice', priceSoap: 7.5 });
  assert.equal(payout.amount, 7.5);
  assert.throws(() => creatorPayout({ creatorId: '' }), /creatorId/);
  assert.throws(() => creatorPayout({ creatorId: 'alice', amount: -3 }), /amount/);
});

// ── no value-moving / broadcast surface anywhere ──────────────────────────────────────────────────
test('the module never exposes a broadcast/send capability', () => {
  const p = createProduct(base);
  const intent = purchaseIntent(p, { buyer: 'bob' });
  const payout = creatorPayout({ creatorId: 'alice', amount: 1 });
  // nothing produced here claims to have moved value
  assert.equal(intent.broadcast, false);
  assert.equal(payout.settled, false);
  assert.equal(payout.direction, 'receive');
});
