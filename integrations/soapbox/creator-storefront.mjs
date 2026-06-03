// creator-storefront.mjs — a Gumroad-style creator storefront on the OWNERSHIP end of the Library
// (queue #147). PURE logic, no network. Creators sell their OWN works/licenses; the actual files are
// hosted via the NFT host (the chain, not us as a publisher), and settlement is on SOAP.
//
// The load-bearing rule is the SAME one the Library runs on: WE NEVER SELL OTHER PEOPLE'S COPYRIGHTED
// FILES. So a product can only be created for a work that classifies as USER_NFT or our own corpus
// (HOST_FULL with user-borne / corpus ownership) — i.e. the sellable buckets. Anything that would land
// in METADATA_ONLY (someone else's in-copyright work) is rejected: you can't sell what you don't own.
//
// A product ALSO requires a fileHash — the content address the NFT host already holds. No file, no
// product. We never take the file itself; we reference what the NFT host is hosting.
//
//   import { createProduct, buildSellPage, purchaseIntent, creatorPayout } from './creator-storefront.mjs'
//   createProduct({ creatorId, title, priceSoap, license, fileHash, work? }) → product (own works only)
//   buildSellPage(product)            → HTML string (all inputs escaped)
//   purchaseIntent(product, { buyer }) → simulated, never-broadcast SOAP settlement intent
//   creatorPayout(sale)               → receive-only payout record (no value moves without injected sign)
//   node integrations/soapbox/creator-storefront.mjs   # offline demo

import { classify, BUCKETS } from './library-buckets.mjs';

// The buckets whose hosting basis is the user's OWN ownership — the only things sellable here.
// USER_NFT (their upload/mint/rights) and our own corpus (operator/MELEK originals).
const SELLABLE_BUCKETS = new Set([BUCKETS.USER_NFT, BUCKETS.HOST_FULL]);

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────
function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// SOAP is whole-token settlement here; clamp to a non-negative, 3-decimal amount.
function normPrice(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 1000) / 1000;
}

function fmtSoap(n) {
  return `${Number(n).toFixed(3)} SOAP`;
}

// Decide whether a work is sellable on this storefront. A product implies ownership: the creator is
// asserting these are THEIR rights, so the work is treated as user-owned unless its metadata already
// clears it as PD/open/corpus. We then require the resulting bucket to be a SELLABLE one — METADATA_ONLY
// (someone else's in-copyright file) is never sellable.
function ownershipCheck({ creatorId, license, work }) {
  const meta = { license, ...(work || {}) };
  // A storefront listing is an ownership assertion. If the caller didn't already mark the work as
  // corpus/PD/open, treat it as the creator's own (USER_NFT path). This never DOWNGRADES a clearer
  // signal — classify()'s precedence keeps corpus/PD/open as HOST_FULL.
  if (meta.owner == null && meta.userOwned == null && meta.ownedByUser == null &&
      meta.isOwn == null && meta.ownCorpus == null && meta.isCorpus == null) {
    meta.userOwned = true;
  }
  const c = classify(meta);
  return { ...c, sellable: SELLABLE_BUCKETS.has(c.bucket) && c.canHostFile === true };
}

// ── createProduct: own works only, requires a fileHash from the NFT host ──────────────────────────
/**
 * Create a storefront product for a creator's OWN work. PURE — no network, no I/O.
 *
 * @param {object} p
 * @param {string} p.creatorId  the creator's account/id (settlement payee)
 * @param {string} p.title      product title
 * @param {number} p.priceSoap  price in SOAP (>= 0)
 * @param {string} p.license    the license the buyer receives (and an ownership signal)
 * @param {string} p.fileHash   content address held by the NFT host — REQUIRED (no file → no product)
 * @param {object} [p.work]     optional work metadata passed through to the bucket classifier
 * @returns {object} product
 * @throws if creatorId/title missing, price invalid, fileHash missing, or work isn't sellable (own)
 */
export function createProduct({ creatorId, title, priceSoap, license, fileHash, work } = {}) {
  const cid = String(creatorId || '').trim();
  const ttl = String(title || '').trim();
  if (!cid) throw new Error('createProduct: creatorId is required');
  if (!ttl) throw new Error('createProduct: title is required');

  const price = normPrice(priceSoap);
  if (price == null) throw new Error('createProduct: priceSoap must be a non-negative number');

  // No file from the NFT host → no product. We never host or take the file ourselves.
  const hash = String(fileHash || '').trim();
  if (!hash) throw new Error('createProduct: fileHash (from the NFT host) is required — no file, no product');

  const own = ownershipCheck({ creatorId: cid, license, work });
  if (!own.sellable) {
    throw new Error(`createProduct: not sellable — only your OWN works/licenses may be sold here (bucket=${own.bucket}: ${own.reason})`);
  }

  return Object.freeze({
    kind: 'soapbox-creator-product',
    id: `prod_${hash.slice(0, 16)}`,
    creatorId: cid,
    title: ttl,
    priceSoap: price,
    settlementAsset: 'SOAP',
    license: String(license || '').trim() || 'all-rights-reserved',
    fileHash: hash,            // referenced on the NFT host; we do not hold the file
    hostedBy: 'nft-host',
    bucket: own.bucket,
    ownershipReason: own.reason,
  });
}

// ── buildSellPage: a simple HTML sell page; ALL inputs escaped ────────────────────────────────────
/**
 * Render a simple Gumroad-style sell page for a product. Returns an HTML string with every
 * product-derived value HTML-escaped (no injection). PURE.
 */
export function buildSellPage(product) {
  if (!product || typeof product !== 'object') throw new Error('buildSellPage: product required');
  const title = esc(product.title);
  const creator = esc(product.creatorId);
  const price = esc(fmtSoap(product.priceSoap));
  const license = esc(product.license);
  const hash = esc(product.fileHash);
  const id = esc(product.id);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — by ${creator}</title>
</head>
<body>
<main class="soapbox-storefront">
  <h1 class="product-title">${title}</h1>
  <p class="product-creator">by ${creator}</p>
  <p class="product-price" data-asset="SOAP">${price}</p>
  <p class="product-license">License: ${license}</p>
  <p class="product-host">Hosted on the NFT host · <code>${hash}</code></p>
  <form method="post" action="/buy/${id}" data-settlement="SOAP">
    <button type="submit" class="buy-button">Buy for ${price}</button>
  </form>
  <p class="product-note">Settlement on SOAP. The file lives on the NFT host; this storefront only sells the creator's own works.</p>
</main>
</body>
</html>`;
}

// ── purchaseIntent: simulated SOAP settlement; never moves value without an injected signer ────────
/**
 * Build a DRY-RUN settlement intent for a purchase. PURE and SIMULATED — it describes a SOAP transfer
 * but NEVER broadcasts. Value only moves if the caller passes an explicit `sign` function (a signer
 * boundary that this module never supplies). With no signer, `broadcast` stays false.
 *
 * @param {object} product            a product from createProduct()
 * @param {object} opts
 * @param {string} opts.buyer         buyer account/id
 * @param {function} [opts.sign]      OPTIONAL injected signer; without it, this is dry-run only
 * @returns {object} intent { dryRun, broadcast, transfer, ... }
 */
export function purchaseIntent(product, { buyer, sign } = {}) {
  if (!product || typeof product !== 'object') throw new Error('purchaseIntent: product required');
  const b = String(buyer || '').trim();
  if (!b) throw new Error('purchaseIntent: buyer is required');

  const transfer = Object.freeze({
    from: b,
    to: product.creatorId,
    amount: product.priceSoap,
    asset: 'SOAP',
    memo: `purchase:${product.id}`,
  });

  // SIMULATED by construction. A real broadcast requires an injected signer this module never holds.
  const signed = typeof sign === 'function' ? sign(transfer) : null;

  return Object.freeze({
    kind: 'soapbox-purchase-intent',
    dryRun: signed == null,        // no signer → pure dry-run
    broadcast: false,              // this module never broadcasts; value never moves here
    productId: product.id,
    buyer: b,
    transfer,
    signed,                        // null unless the caller injected a signer
    grantsLicense: product.license,
    deliversFileHash: product.fileHash,
  });
}

// ── creatorPayout: receive-only ───────────────────────────────────────────────────────────────────
/**
 * Produce a RECEIVE-ONLY payout record for a settled sale. PURE — it records what the creator is owed
 * and credits it; it does not, and cannot, send funds. `direction` is fixed to 'receive'.
 *
 * @param {object} sale  { productId, creatorId, buyer, amount/priceSoap, ... }
 * @returns {object} payout
 */
export function creatorPayout(sale = {}) {
  if (!sale || typeof sale !== 'object') throw new Error('creatorPayout: sale required');
  const payee = String(sale.creatorId || '').trim();
  if (!payee) throw new Error('creatorPayout: sale.creatorId is required');

  const amt = normPrice(sale.amount != null ? sale.amount : sale.priceSoap);
  if (amt == null) throw new Error('creatorPayout: sale amount (SOAP) must be a non-negative number');

  return Object.freeze({
    kind: 'soapbox-creator-payout',
    direction: 'receive',          // receive-only; this never debits/sends
    payee,
    asset: 'SOAP',
    amount: amt,
    productId: sale.productId || null,
    buyer: sale.buyer || null,
    settled: false,                // a record of what's owed; settlement is an out-of-band signed op
  });
}

// ── CLI demo (offline) ─────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('creator-storefront.mjs')) {
  const product = createProduct({
    creatorId: 'alice',
    title: 'My Synth Album <vol.1>',
    priceSoap: 12.5,
    license: 'CC BY-NC 4.0',
    fileHash: 'bafy0011223344556677889900aabbccdd',
  });
  console.log('PRODUCT:', JSON.stringify(product, null, 2));
  console.log('\nSELL PAGE:\n' + buildSellPage(product));
  console.log('\nPURCHASE INTENT (dry-run):', JSON.stringify(purchaseIntent(product, { buyer: 'bob' }), null, 2));
  console.log('\nPAYOUT (receive-only):', JSON.stringify(creatorPayout({ productId: product.id, creatorId: 'alice', buyer: 'bob', amount: 12.5 }), null, 2));
  try {
    createProduct({ creatorId: 'mallory', title: "Someone Else's Bestseller", priceSoap: 5, license: 'all-rights-reserved', fileHash: 'x', work: { rights: 'All rights reserved', owner: 'penguin-random-house' } });
  } catch (e) {
    console.log('\nREJECTED (not own):', e.message);
  }
}
