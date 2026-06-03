import { test } from 'node:test';
import assert from 'node:assert';
import { resolveTokenUri, clarityScore, rankNfts, resolvesToRealContent } from './nft-search.mjs';

// ── resolveTokenUri: ipfs / arweave / passthrough ─────────────────────────────────────────────────
test('resolveTokenUri rewrites ipfs:// to the gateway', () => {
  assert.equal(resolveTokenUri('ipfs://bafyCID/metadata.json'), 'https://ipfs.io/ipfs/bafyCID/metadata.json');
});

test('resolveTokenUri collapses the doubled ipfs://ipfs/ prefix', () => {
  assert.equal(resolveTokenUri('ipfs://ipfs/bafyCID'), 'https://ipfs.io/ipfs/bafyCID');
});

test('resolveTokenUri handles bare /ipfs/ and ipfs/ paths', () => {
  assert.equal(resolveTokenUri('/ipfs/CID/x.pdf'), 'https://ipfs.io/ipfs/CID/x.pdf');
  assert.equal(resolveTokenUri('ipfs/CID'), 'https://ipfs.io/ipfs/CID');
});

test('resolveTokenUri rewrites ar:// to arweave', () => {
  assert.equal(resolveTokenUri('ar://TX123'), 'https://arweave.net/TX123');
});

test('resolveTokenUri leaves https/data URIs untouched', () => {
  assert.equal(resolveTokenUri('https://example.com/a.json'), 'https://example.com/a.json');
  assert.equal(resolveTokenUri('data:application/json,{}'), 'data:application/json,{}');
});

test('resolveTokenUri reads token objects and returns null on empty', () => {
  assert.equal(resolveTokenUri({ tokenUri: 'ipfs://C/x' }), 'https://ipfs.io/ipfs/C/x');
  assert.equal(resolveTokenUri({ image: 'ipfs://C/img.png' }), 'https://ipfs.io/ipfs/C/img.png');
  assert.equal(resolveTokenUri(''), null);
  assert.equal(resolveTokenUri(null), null);
  assert.equal(resolveTokenUri({}), null);
});

// ── resolvesToRealContent: doc/book vs bare image ─────────────────────────────────────────────────
test('resolvesToRealContent: true for a pdf/epub file, false for an image-only token', () => {
  assert.equal(resolvesToRealContent({ animation_url: 'ipfs://C/book.pdf' }), true);
  assert.equal(resolvesToRealContent({ tokenUri: 'ipfs://C/novel.epub' }), true);
  assert.equal(resolvesToRealContent({ contentType: 'document' }), true);
  assert.equal(resolvesToRealContent({ image: 'ipfs://C/pic.jpg', mimeType: 'image/jpeg' }), false);
  assert.equal(resolvesToRealContent({ image: 'ipfs://C/pic.png' }), false);
});

// ── clarityScore + rankNfts: spam JPEG sinks below real content ────────────────────────────────────
const SPAM_JPEG = {
  name: 'gm wagmi #4823',
  image: 'ipfs://Cspam/4823.jpg',
  mimeType: 'image/jpeg',
  contractVerified: false,
  holders: 1,
  salesCount: 0,
};

const REAL_BOOK = {
  name: 'The Convergence (full text)',
  animation_url: 'ipfs://Cbook/convergence.pdf',
  image: 'ipfs://Cbook/cover.png',
  mimeType: 'application/pdf',
  contractVerified: true,
  collection: { verified: true, ownerCount: 1200 },
  holders: 1200,
  salesCount: 340,
  volume: 50000,
  creator: { verified: true, collectionsCreated: 8 },
};

test('clarityScore: real-content book scores well above a spam JPEG', () => {
  const spam = clarityScore(SPAM_JPEG);
  const book = clarityScore(REAL_BOOK);
  assert.ok(book.score > spam.score, `book ${book.score} should beat spam ${spam.score}`);
  assert.ok(spam.score < 40, `spam JPEG should be near the floor, got ${spam.score}`);
  assert.ok(book.score > 70, `verified book should be high, got ${book.score}`);
  // content sub-score is the discriminator: book reads as a doc, spam as an image.
  assert.equal(book.parts.content, 95);
  assert.equal(spam.parts.content, 12);
});

test('clarityScore is pure: same input → same output, no network', () => {
  assert.deepEqual(clarityScore(SPAM_JPEG), clarityScore(SPAM_JPEG));
});

test('clarityScore tolerates junk input without throwing', () => {
  assert.equal(typeof clarityScore(null).score, 'number');
  assert.equal(typeof clarityScore(undefined).score, 'number');
  assert.equal(typeof clarityScore('nope').score, 'number');
});

test('rankNfts: spam JPEG ranks below a real-content token', () => {
  const ranked = rankNfts([SPAM_JPEG, REAL_BOOK]);
  assert.equal(ranked.length, 2);
  assert.equal(ranked[0].name, REAL_BOOK.name, 'real book first');
  assert.equal(ranked[1].name, SPAM_JPEG.name, 'spam JPEG last');
  assert.ok(ranked[0].clarity > ranked[1].clarity);
  assert.ok('clarityParts' in ranked[0]);
});

test('rankNfts: returns [] for non-arrays', () => {
  assert.deepEqual(rankNfts(null), []);
  assert.deepEqual(rankNfts('x'), []);
});

test('rankNfts: verified high-holder token sorts above an unverified low-holder one', () => {
  const lo = { name: 'lo', image: 'ipfs://x/a.pdf', mimeType: 'application/pdf', holders: 2 };
  const hi = { name: 'hi', animation_url: 'ipfs://x/b.pdf', contractVerified: true, holders: 5000, salesCount: 100 };
  const ranked = rankNfts([lo, hi]);
  assert.equal(ranked[0].name, 'hi');
});
