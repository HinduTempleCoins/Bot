// rwa-tokenize.mjs — Real-World-Asset (RWA) tokenization SCAFFOLD (task #200, doc-19 concepts).
//
// ⚠️ COMPLIANCE-AWARE SCAFFOLD — DESIGN / DATA LAYER ONLY. EVERYTHING HERE IS DRY-RUN BY
//    CONSTRUCTION. This module NEVER mints, NEVER signs, NEVER broadcasts, holds NO keys and
//    touches NO chain. It produces PLANS and DESCRIPTORS that a separate, reviewed signer WOULD
//    act on. LEGAL REVIEW IS REQUIRED before any real issuance — tokenizing a real-world asset is
//    very likely a securities event in most jurisdictions. Treat every output as a draft for review.
//
// Covers the doc-19 concepts:
//   • SPV structuring          — the asset is held by a Special-Purpose Vehicle; the token represents
//                                a claim against the SPV, not raw ownership of the dirt/metal/car.
//   • deed/title "digital twin" — a content-addressed descriptor that POINTS AT the off-chain legal
//                                instrument (deed/title) by hash. The instrument itself never goes
//                                on-chain; only its fingerprint + locator do.
//   • place-before-built       — tokenizing BEFORE the asset physically exists (asset.status==='planned').
//                                This is HARD-FLAGGED as speculative so it can never be silently shipped
//                                as if backed by a real, existing thing.
//   • UIA compliance flags     — BitShares-style User-Issued-Asset validation (symbol/precision/supply).
//
// HARD INVARIANTS (asserted + tested):
//   - No keys, no network, no broadcast in this module (HOLDS_KEYS===false, BROADCASTS===false).
//   - mintPlan() ALWAYS returns { dryRun:true, ... } and never executes anything.
//   - draftTokenization() FLAGS a planned (not-yet-existing) asset as place-before-built + speculative.
//
//   import { ASSET_CLASSES, draftTokenization, validateUIA, deedTwin, mintPlan } from './rwa-tokenize.mjs'
//   node integrations/rwa-tokenize.mjs        # offline demo / self-check
//
// Pure / soft-fail: functions return result objects ({ ok:false, warnings:[...] } etc.) rather than
// throwing to the caller.

import { createHash } from 'node:crypto';

// ── stable serialization + content addressing (no secrets) ───────────────────────
function stableStringify(v) {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}

/** contentHash(input, hasher?) — deterministic content fingerprint. Uses node:crypto sha256 by
 *  default; a caller may inject a `hasher(string)->string` (e.g. an IPFS CID-er) instead. NO secret
 *  material is involved — this is a public content fingerprint, not a signature. */
export function contentHash(input, hasher) {
  const payload = typeof input === 'string' ? input : stableStringify(input ?? null);
  if (typeof hasher === 'function') return String(hasher(payload));
  return createHash('sha256').update(payload).digest('hex');
}

// ── asset-class registry ─────────────────────────────────────────────────────────
// Each class declares the fields a draft REQUIRES, plus a plain-language compliance note. The
// `securities` hint drives the default 'securities-review-likely' flag — most RWA tokens are
// investment contracts, so it defaults true and only obvious non-investment cases turn it off.
export const ASSET_CLASSES = {
  real_estate: {
    label: 'Real Estate',
    required: ['title', 'jurisdiction', 'valuation'],
    securities: true,
    note: 'Land/title transfer + securities law both apply. SPV typically holds the deed; token is a claim on the SPV.',
  },
  vehicle: {
    label: 'Vehicle',
    required: ['vin', 'jurisdiction', 'valuation'],
    securities: false,
    note: 'Titled chattel. DMV/registry title is the source of truth; fractionalizing it usually triggers securities review.',
  },
  commodity: {
    label: 'Commodity',
    required: ['commodity', 'quantity', 'unit', 'custody'],
    securities: true,
    note: 'Must be backed by audited, custodied physical stock (a warehouse receipt / vault attestation).',
  },
  ip_rights: {
    label: 'Intellectual-Property Rights',
    required: ['ipType', 'registration', 'jurisdiction'],
    securities: true,
    note: 'Patent/trademark/copyright assignment. Revenue-bearing IP tokens are typically securities.',
  },
  revenue_share: {
    label: 'Revenue Share',
    required: ['source', 'sharePct', 'term'],
    securities: true,
    note: 'A claim on future cash flows — almost certainly an investment contract. Securities counsel required.',
  },
  art_collectible: {
    label: 'Art / Collectible',
    required: ['title', 'provenance', 'valuation'],
    securities: false,
    note: 'Provenance + authenticity attestation are load-bearing. Fractional ownership can become a security.',
  },
  equity_interest: {
    label: 'Equity Interest (LLC/Corp)',
    required: ['entity', 'jurisdiction', 'sharePct'],
    securities: true,
    note: 'Direct ownership interest in a legal entity — a security by definition in most jurisdictions.',
  },
};

// ── UIA constraints (BitShares User-Issued-Asset style) ──────────────────────────
// Symbol: 3..16 chars, uppercase A-Z plus optional one '.' prefix segment, no leading/trailing dot.
// Precision: integer 0..12 (Graphene caps asset precision at 12). Max-supply must fit signed int64.
export const UIA_RULES = Object.freeze({
  SYMBOL_MIN: 3,
  SYMBOL_MAX: 16,
  SYMBOL_RE: /^[A-Z][A-Z0-9]{1,14}(\.[A-Z][A-Z0-9]{1,14})?$/,
  PRECISION_MIN: 0,
  PRECISION_MAX: 12,
  MAX_SUPPLY_INT64: 9223372036854775807n, // 2^63 - 1
});

/** validateUIA(descriptor) → { valid, errors:[...] }. Pure, never throws.
 *  Checks symbol shape/length, precision range, and that max-supply (scaled by precision) fits int64. */
export function validateUIA(descriptor) {
  const errors = [];
  const d = descriptor && typeof descriptor === 'object' ? descriptor : {};

  // symbol
  const symbol = d.symbol;
  if (typeof symbol !== 'string' || symbol.length === 0) {
    errors.push('symbol: required (string)');
  } else {
    if (symbol.length < UIA_RULES.SYMBOL_MIN) errors.push(`symbol: too short (min ${UIA_RULES.SYMBOL_MIN})`);
    if (symbol.length > UIA_RULES.SYMBOL_MAX) errors.push(`symbol: too long (max ${UIA_RULES.SYMBOL_MAX})`);
    if (!UIA_RULES.SYMBOL_RE.test(symbol)) errors.push('symbol: must be uppercase A-Z/0-9 (optional one "." segment), letter-led, no trailing dot');
  }

  // precision
  const precision = d.precision;
  if (!Number.isInteger(precision)) {
    errors.push('precision: required (integer)');
  } else if (precision < UIA_RULES.PRECISION_MIN || precision > UIA_RULES.PRECISION_MAX) {
    errors.push(`precision: out of range (must be ${UIA_RULES.PRECISION_MIN}..${UIA_RULES.PRECISION_MAX})`);
  }

  // max supply (whole units) → must be a positive integer that, scaled by precision, fits int64.
  const supply = d.maxSupply ?? d.supply;
  if (supply == null) {
    errors.push('maxSupply: required');
  } else {
    let units;
    try {
      units = typeof supply === 'bigint' ? supply : BigInt(Math.trunc(Number(supply)));
    } catch {
      units = null;
    }
    if (units == null || !Number.isFinite(Number(supply)) || Number(supply) <= 0) {
      errors.push('maxSupply: must be a positive integer');
    } else if (Number.isInteger(precision) && precision >= UIA_RULES.PRECISION_MIN && precision <= UIA_RULES.PRECISION_MAX) {
      // Graphene stores supply as integer "satoshis" = units * 10^precision.
      const scaled = units * (10n ** BigInt(precision));
      if (scaled > UIA_RULES.MAX_SUPPLY_INT64) {
        errors.push('maxSupply: too large — supply scaled by precision exceeds int64 (2^63-1)');
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// ── deed / title digital twin ────────────────────────────────────────────────────
/** deedTwin(asset, { hasher } = {}) → a content-addressable descriptor for an off-chain legal
 *  instrument (deed/title/registration). The instrument itself is NEVER embedded; only a fingerprint
 *  + a locator hint + the legal-key fields go on-chain. Deterministic for the same logical input.
 *
 *  Returns: { kind:'deed-twin', class, instrument, jurisdiction, locator, hash, note } */
export function deedTwin(asset, { hasher } = {}) {
  const a = asset && typeof asset === 'object' ? asset : {};
  const cls = ASSET_CLASSES[a.assetClass] || null;
  // The legal "what" of the instrument: pick the identifying fields that exist on the asset.
  const instrument = a.title || a.vin || a.registration || a.entity || a.commodity || a.source || null;
  const jurisdiction = a.jurisdiction || null;
  // A locator points at WHERE the off-chain instrument lives (a URI/registry ref), if supplied.
  const locator = a.deedUri || a.titleUri || a.documentUri || null;

  // The fingerprint is over the stable legal core only — never over any raw document bytes here.
  const core = {
    assetClass: a.assetClass ?? null,
    instrument,
    jurisdiction,
    valuation: a.valuation ?? null,
    issuedTo: a.owner ?? a.ownerId ?? null,
  };
  const hash = contentHash(core, hasher);

  return Object.freeze({
    kind: 'deed-twin',
    class: cls ? cls.label : (a.assetClass ?? 'unknown'),
    instrument,
    jurisdiction,
    locator,                         // null if the off-chain document URI wasn't supplied
    hash,                            // content fingerprint pointing AT the off-chain instrument
    note: 'Content fingerprint of the off-chain legal instrument. The instrument itself stays off-chain.',
  });
}

// ── draftTokenization ────────────────────────────────────────────────────────────
/**
 * draftTokenization(asset) → a tokenization DRAFT for an RWA. Soft-fail: returns
 *   { ok:false, warnings:[...] } on bad input instead of throwing.
 *
 * On success:
 *   {
 *     ok: true,
 *     assetClass,
 *     descriptor: { name, symbol, supply, precision, backing, spv, deedTwin },
 *     complianceFlags: [...],   // e.g. requires-SPV, securities-review-likely, KYC-gate-recommended,
 *                               //      and the HARD place-before-built + speculative-not-yet-existing
 *                               //      flags when asset.status === 'planned'
 *     warnings: [...],
 *   }
 */
export function draftTokenization(asset, { hasher } = {}) {
  const warnings = [];
  const a = asset && typeof asset === 'object' ? asset : {};

  const spec = ASSET_CLASSES[a.assetClass];
  if (!spec) {
    return {
      ok: false,
      assetClass: a.assetClass ?? null,
      descriptor: null,
      complianceFlags: [],
      warnings: [`unknown assetClass: ${JSON.stringify(a.assetClass)} — must be one of ${Object.keys(ASSET_CLASSES).join(', ')}`],
    };
  }

  // required-field validation
  const missing = spec.required.filter((f) => a[f] == null || a[f] === '');
  for (const f of missing) warnings.push(`missing required field for ${a.assetClass}: ${f}`);

  // compliance flags — every RWA token gets an SPV + KYC recommendation by default.
  const complianceFlags = ['requires-SPV', 'KYC-gate-recommended', 'legal-review-required'];
  if (spec.securities) complianceFlags.push('securities-review-likely');

  // HARD place-before-built handling: tokenizing a not-yet-existing asset.
  const status = String(a.status || 'existing').toLowerCase();
  if (status === 'planned' || status === 'pre-construction' || status === 'not-built') {
    complianceFlags.push('place-before-built');                // tokenized before it physically exists
    complianceFlags.push('speculative-not-yet-existing');      // backing is a promise, not a thing
    warnings.push('place-before-built: this asset does not yet physically exist — token is speculative and backed by a future deliverable, not an existing thing');
  }

  if (missing.length) {
    // Still emit the flags + a partial descriptor so the operator sees WHAT is missing, but ok:false.
    return { ok: false, assetClass: a.assetClass, descriptor: null, complianceFlags, warnings };
  }

  // SPV descriptor — the legal wrapper that holds the asset; the token is a claim on this entity.
  const spv = {
    type: 'special-purpose-vehicle',
    name: a.spvName || `SPV-${String(a.assetClass).toUpperCase()}-${(a.symbol || 'RWA')}`,
    jurisdiction: a.spvJurisdiction || a.jurisdiction || null,
    holds: spec.label,
    note: 'The SPV holds the real-world asset; the token represents a claim against the SPV, not raw title.',
  };

  // backing descriptor — what stands behind each token.
  const backing = {
    class: spec.label,
    valuation: a.valuation ?? null,
    existing: !(status === 'planned' || status === 'pre-construction' || status === 'not-built'),
    custody: a.custody ?? null,
    note: spec.note,
  };

  const descriptor = {
    name: a.name || `${spec.label} Token`,
    symbol: a.symbol || null,
    supply: a.supply ?? a.maxSupply ?? null,
    precision: a.precision ?? 0,
    backing,
    spv,
    deedTwin: deedTwin({ ...a }, { hasher }),
  };

  if (!descriptor.symbol) warnings.push('no symbol supplied — descriptor.symbol is null; set one before validateUIA');

  return { ok: true, assetClass: a.assetClass, descriptor, complianceFlags, warnings };
}

// ── mintPlan (DRY-RUN ONLY) ──────────────────────────────────────────────────────
/**
 * mintPlan(descriptor) → { dryRun:true, steps:[...] }
 * The ordered steps a reviewed, external signer WOULD take to issue this UIA. This function NEVER
 * executes any of them — it only describes them. There is no signer, no key, no network here.
 */
export function mintPlan(descriptor) {
  const d = descriptor && typeof descriptor === 'object' ? descriptor : {};
  const sym = d.symbol || '<SYMBOL>';
  const uia = validateUIA(d);

  const steps = [
    { n: 1, op: 'legal-review', desc: 'Securities/legal counsel signs off on the SPV + offering structure.' },
    { n: 2, op: 'spv-formation', desc: `Form/confirm the SPV (${d.spv?.name || 'SPV'}) that holds the real-world asset.` },
    { n: 3, op: 'deed-twin-anchor', desc: `Record the deed/title digital-twin fingerprint (${d.deedTwin?.hash || '<hash>'}) — off-chain instrument stays off-chain.` },
    { n: 4, op: 'kyc-gate', desc: 'Stand up the KYC/AML allowlist for permitted holders.' },
    { n: 5, op: 'asset_create', desc: `Graphene asset_create for UIA "${sym}" (precision ${d.precision ?? 0}, max-supply ${d.supply ?? '<supply>'}).` },
    { n: 6, op: 'asset_issue', desc: `asset_issue against the SPV-backed reserve, per the reviewed offering.` },
  ];

  return Object.freeze({
    dryRun: true,                 // ALWAYS true — this module never executes
    executed: false,
    symbol: sym,
    uiaValid: uia.valid,
    uiaErrors: uia.errors,
    steps,
    note: 'DRY-RUN plan only. No signing, no broadcast, no keys. A reviewed external signer performs these steps.',
  });
}

// ── HARD INVARIANT: no keys / no network / no broadcast ──────────────────────────
export const HOLDS_KEYS = false;
export const BROADCASTS = false;
export function assertDryRunSafe() {
  if (HOLDS_KEYS !== false) throw new Error('dry-run invariant violated: HOLDS_KEYS is set');
  if (BROADCASTS !== false) throw new Error('dry-run invariant violated: BROADCASTS is set');
  return true;
}
assertDryRunSafe();

// ── CLI demo (offline) ───────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('rwa-tokenize.mjs')) {
  const existing = draftTokenization({
    assetClass: 'real_estate', name: 'Temple Lot Token', symbol: 'TEMPLE', supply: 1000, precision: 4,
    title: 'Deed-2026-001', jurisdiction: 'US-TX', valuation: { amount: 250000, currency: 'USD' },
    deedUri: 'ipfs://example-deed',
  });
  console.log('real-estate draft ok=', existing.ok, 'flags=', existing.complianceFlags.join(', '));
  console.log('  deed twin hash=', existing.descriptor.deedTwin.hash.slice(0, 16), '...');

  const planned = draftTokenization({
    assetClass: 'real_estate', name: 'Future Wing', symbol: 'WING', supply: 500, precision: 2,
    title: 'planned-deed', jurisdiction: 'US-TX', valuation: { amount: 1, currency: 'USD' }, status: 'planned',
  });
  console.log('\nplanned draft flags=', planned.complianceFlags.join(', '));

  console.log('\nUIA valid (good):', validateUIA({ symbol: 'TEMPLE', precision: 4, maxSupply: 1000 }).valid);
  console.log('UIA valid (bad symbol):', validateUIA({ symbol: 'this-is-way-too-long-and-lowercase', precision: 4, maxSupply: 1000 }));

  const plan = mintPlan(existing.descriptor);
  console.log('\nmintPlan dryRun=', plan.dryRun, 'steps=', plan.steps.length);
  console.log('dry-run-safe invariant:', assertDryRunSafe());
}
