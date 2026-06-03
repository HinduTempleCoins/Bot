// bio-nft-mint.mjs — mint owned bio-data / interpretation as a tradable Bio-NFT, plus a
// MELEKSwap listing intent (queue #161). PURE + node:crypto only, NO network, NO real chain ops.
//
// This is the "scan-and-anchor" pattern (cf. bio-consent.mjs / soapbox/provenance.mjs) applied to
// ownership: the raw bio-data / interpretation stays OFF-CHAIN. Only a content-addressed hash plus
// a license + tier envelope is what would ever go on-chain. The NFT record is metadata that POINTS
// AT the data (by hash); it never embeds the raw signal.
//
// HARD INVARIANTS (asserted + tested):
//   - Tier-1 NEURAL NFTs carry a no-sale-without-explicit-consent flag (consentRequired:true).
//   - mintIntent / listingIntent are DRY-RUN / simulated by default. They NEVER sign and NEVER
//     move value unless an explicit `sign` function is injected. There is no built-in signer,
//     no key, no network, no broadcast in this module by construction.
//
//   import { buildBioNft, mintIntent, listingIntent } from './bio-nft-mint.mjs'
//   node integrations/bio-nft-mint.mjs        # offline demo / self-check
//
// Tier vocabulary mirrors bio-consent.mjs:
//   TIER1_NEURAL     — EEG / EMG / GSR / HRV / direct electrophysiology + their interpretation.
//                      Highest protection. NEVER salable without an explicit per-sale consent.
//   TIER2_BEHAVIORAL — VR-behavior / session telemetry / journal text. Lighter.

import { createHash } from 'node:crypto';

// ── tiers ──────────────────────────────────────────────────────────────────────
export const TIER1_NEURAL = 'TIER1_NEURAL';
export const TIER2_BEHAVIORAL = 'TIER2_BEHAVIORAL';
const TIERS = new Set([TIER1_NEURAL, TIER2_BEHAVIORAL]);

/** normalizeTier(tier) — accept the canonical tokens or loose aliases; unknown → fail-safe Tier-1.
 *  Same fail-safe philosophy as bio-consent.tierOf: an unclassified bio-NFT gets the HIGHER
 *  protection (and thus the consent-required gate), never the lighter one. */
export function normalizeTier(tier) {
  const t = String(tier || '').toUpperCase().trim();
  if (t === TIER1_NEURAL || t === 'TIER1' || t === '1' || t === 'NEURAL') return TIER1_NEURAL;
  if (t === TIER2_BEHAVIORAL || t === 'TIER2' || t === '2' || t === 'BEHAVIORAL') return TIER2_BEHAVIORAL;
  return TIER1_NEURAL; // fail-safe: unknown → highest protection
}

// Recognized licenses. Free-form strings are allowed through (passed verbatim), but we keep a
// known set so the metadata stays legible. CC0 = public-domain-style; "all-rights-reserved" default.
export const KNOWN_LICENSES = new Set([
  'all-rights-reserved', 'cc-by', 'cc-by-sa', 'cc-by-nc', 'cc0',
  'research-only', 'personal-use', 'commercial', 'custom',
]);

// ── content addressing ───────────────────────────────────────────────────────────
/** contentHash(input) — deterministic sha256 of a stable JSON serialization. Accepts a string
 *  (treated as an already-computed hash payload) or any JSON-able value. Object key order is
 *  normalized so the same logical content always hashes identically. */
export function contentHash(input) {
  if (typeof input === 'string') return createHash('sha256').update(input).digest('hex');
  return createHash('sha256').update(stableStringify(input ?? null)).digest('hex');
}

function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

// A dataHash may be supplied directly (already content-addressed, the off-chain anchor) OR derived
// from an interpretation payload. Either way only the HASH lives in the NFT — never the raw data.
function resolveDataHash({ dataHash, interpretation }) {
  if (typeof dataHash === 'string' && /^[a-f0-9]{64}$/i.test(dataHash.trim())) {
    return dataHash.trim().toLowerCase();
  }
  if (dataHash != null) return contentHash(dataHash); // non-64-hex value: hash it
  if (interpretation != null) return contentHash(interpretation);
  return null;
}

// ── buildBioNft ────────────────────────────────────────────────────────────────
/**
 * buildBioNft({ ownerId, dataHash, tier, license, interpretation })
 * → a license-bearing, content-addressed Bio-NFT metadata record.
 *
 * The off-chain data is NOT embedded. Only `dataHash` (the anchor), `license`, `tier`, and an
 * optional interpretation HASH are carried. Tier-1 NEURAL records get consentRequired:true.
 *
 * Returns a frozen plain object:
 *   {
 *     kind: 'bio-nft', version: 1,
 *     id,                       // content-addressed token id (sha256 of the canonical core)
 *     ownerId,
 *     tier, license,
 *     dataHash,                 // off-chain anchor (sha256 hex)
 *     interpretationHash|null,  // hash of interpretation if supplied (raw text NOT stored)
 *     consentRequired,          // TRUE for Tier-1 neural → no sale without explicit consent
 *     onChain: { dataHash, interpretationHash, license, tier, consentRequired },
 *     createdAt,
 *   }
 */
export function buildBioNft({ ownerId, dataHash, tier, license, interpretation } = {}) {
  if (!ownerId || typeof ownerId !== 'string') {
    throw new Error('buildBioNft: ownerId is required (string)');
  }
  const resolvedHash = resolveDataHash({ dataHash, interpretation });
  if (!resolvedHash) {
    throw new Error('buildBioNft: a dataHash or an interpretation is required to anchor the NFT');
  }

  const normTier = normalizeTier(tier);
  const lic = String(license || 'all-rights-reserved').toLowerCase().trim();
  const interpretationHash = interpretation != null ? contentHash(interpretation) : null;

  // INVARIANT: Tier-1 neural NFTs always require explicit per-sale consent.
  const consentRequired = normTier === TIER1_NEURAL;

  // The on-chain footprint: hashes + license + tier only. NO raw data, NO interpretation text.
  const onChain = {
    dataHash: resolvedHash,
    interpretationHash,
    license: lic,
    tier: normTier,
    consentRequired,
  };

  // Content-addressed token id from the stable core (owner + anchors + license + tier).
  const core = { ownerId, dataHash: resolvedHash, interpretationHash, license: lic, tier: normTier };
  const id = 'bionft_' + contentHash(core).slice(0, 32);

  const nft = {
    kind: 'bio-nft',
    version: 1,
    id,
    ownerId,
    tier: normTier,
    license: lic,
    licenseKnown: KNOWN_LICENSES.has(lic),
    dataHash: resolvedHash,
    interpretationHash,
    consentRequired,
    onChain,
    createdAt: new Date().toISOString(),
  };
  return Object.freeze(nft);
}

// ── mintIntent ───────────────────────────────────────────────────────────────────
/**
 * mintIntent(nft, { sign, broadcast } = {})
 * Produce a MINT intent for the Bio-NFT. DRY-RUN / simulated BY DEFAULT:
 *   - With no injected `sign`, returns { simulated:true, signed:false, ... } and moves nothing.
 *   - A `sign(op)` function may be injected by the caller; only then is it invoked. Even then,
 *     this module performs NO network broadcast itself (no `broadcast` is ever called here) and
 *     holds NO keys — the injected signer is wholly the caller's responsibility.
 * Tier-1 consent gate: a Tier-1 NEURAL NFT mint records consentRequired:true on the intent so the
 * downstream listing step can refuse a sale without explicit consent.
 */
export function mintIntent(nft, { sign } = {}) {
  assertNft(nft);

  // The standard-Graphene-shaped op we WOULD broadcast (custom_json over the on-chain footprint).
  // It carries only hashes + license + tier — never raw data.
  const op = {
    type: 'bio_nft_mint',
    nftId: nft.id,
    owner: nft.ownerId,
    payload: { ...nft.onChain },
  };

  const intent = {
    action: 'mint',
    nftId: nft.id,
    op,
    tier: nft.tier,
    consentRequired: nft.consentRequired,
    movesValue: false,        // minting never moves value in dry-run
    simulated: true,
    signed: false,
    createdAt: new Date().toISOString(),
  };

  if (typeof sign === 'function') {
    // A signer was explicitly injected → produce a signed (but still NOT broadcast) intent.
    intent.signed = true;
    intent.simulated = false;
    intent.signature = sign(op);
  }
  return Object.freeze(intent);
}

// ── listingIntent ─────────────────────────────────────────────────────────────────
/**
 * listingIntent(nft, { price, market = 'MELEKSwap', currency = 'MELEK', consent, sign } = {})
 * Produce a MELEKSwap LISTING intent. DRY-RUN by default; never signs without injected `sign`.
 *
 * Tier-1 INVARIANT: a Tier-1 NEURAL NFT may NOT be put up for sale without explicit consent.
 * Without `consent.granted === true` matching the owner, the listing is BLOCKED (no op produced,
 * blocked:true), and nothing is signed or moved.
 */
export function listingIntent(nft, { price, market = 'MELEKSwap', currency = 'MELEK', consent, sign } = {}) {
  assertNft(nft);

  const base = {
    action: 'list',
    nftId: nft.id,
    market,
    tier: nft.tier,
    consentRequired: nft.consentRequired,
    movesValue: false, // dry-run: a listing intent moves nothing
    simulated: true,
    signed: false,
    createdAt: new Date().toISOString(),
  };

  // Tier-1 consent gate — no sale without explicit per-sale consent from the owner.
  if (nft.consentRequired && !consentGrantsSale(consent, nft.ownerId)) {
    return Object.freeze({
      ...base,
      blocked: true,
      reason: 'Tier-1 neural NFT: explicit owner consent required before listing for sale',
    });
  }

  const px = Number(price);
  if (!Number.isFinite(px) || px <= 0) {
    throw new Error('listingIntent: a positive numeric price is required');
  }

  const op = {
    type: 'meleckswap_list',
    market,
    nftId: nft.id,
    seller: nft.ownerId,
    price: px,
    currency,
    payload: { ...nft.onChain },
  };

  const intent = { ...base, blocked: false, price: px, currency, op };

  if (typeof sign === 'function') {
    intent.signed = true;
    intent.simulated = false;
    intent.signature = sign(op);
  }
  return Object.freeze(intent);
}

// A sale consent grants when it explicitly authorizes this owner's sale.
//   consent = { subject|owner, granted: true, sale?: true }
function consentGrantsSale(consent, ownerId) {
  if (!consent || consent.granted !== true) return false;
  const subj = consent.subject ?? consent.owner;
  if (subj && subj !== ownerId) return false; // consent must be for the owner
  // a Tier-1 sale needs the sale-specific opt-in to be true
  return consent.sale === true;
}

function assertNft(nft) {
  if (!nft || typeof nft !== 'object' || nft.kind !== 'bio-nft') {
    throw new Error('expected a Bio-NFT record from buildBioNft()');
  }
  if (!TIERS.has(nft.tier)) throw new Error(`invalid NFT tier: ${nft.tier}`);
}

// ── HARD INVARIANT: no built-in signer / no value movement in dry-run ───────────────
// Machine-checkable sentinel: this module holds no key, no network client, no broadcaster.
export const HOLDS_KEYS = false;
export const BROADCASTS = false;
export function assertDryRunSafe() {
  if (HOLDS_KEYS !== false) throw new Error('dry-run invariant violated: HOLDS_KEYS is set');
  if (BROADCASTS !== false) throw new Error('dry-run invariant violated: BROADCASTS is set');
  return true;
}
assertDryRunSafe();

// ── CLI demo (offline) ──────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('bio-nft-mint.mjs')) {
  const neural = buildBioNft({
    ownerId: 'hathor-user-1',
    interpretation: { summary: 'dream-state EEG coherence reading', score: 0.82 },
    tier: 'neural',
    license: 'research-only',
  });
  console.log('Tier-1 NFT:', neural.id, 'consentRequired=', neural.consentRequired);
  console.log('mint (dry-run):', JSON.stringify(mintIntent(neural)).slice(0, 120), '...');
  const blocked = listingIntent(neural, { price: 100 });
  console.log('list w/o consent → blocked=', blocked.blocked, '/', blocked.reason);
  const listed = listingIntent(neural, { price: 100, consent: { subject: 'hathor-user-1', granted: true, sale: true } });
  console.log('list w/ consent → simulated=', listed.simulated, 'signed=', listed.signed, 'price=', listed.price);

  const behavioral = buildBioNft({
    ownerId: 'hathor-user-1',
    dataHash: contentHash({ vr: 'session-123' }),
    tier: 'behavioral',
    license: 'cc-by',
  });
  console.log('\nTier-2 NFT:', behavioral.id, 'consentRequired=', behavioral.consentRequired);
  console.log('list (no consent needed):', listingIntent(behavioral, { price: 5 }).blocked === false);
  console.log('dry-run-safe invariant:', assertDryRunSafe());
}
