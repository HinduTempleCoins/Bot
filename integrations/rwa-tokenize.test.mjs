// rwa-tokenize.test.mjs — OFFLINE tests for the RWA tokenization scaffold (task #200).
// Run: node --test integrations/rwa-tokenize.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import {
  ASSET_CLASSES, UIA_RULES,
  draftTokenization, validateUIA, deedTwin, mintPlan, contentHash,
  assertDryRunSafe, HOLDS_KEYS, BROADCASTS,
} from './rwa-tokenize.mjs';

// ── registry ─────────────────────────────────────────────────────────────────────
test('ASSET_CLASSES registry exposes expected classes with required fields + notes', () => {
  for (const key of ['real_estate', 'vehicle', 'commodity', 'ip_rights', 'revenue_share']) {
    assert.ok(ASSET_CLASSES[key], `missing class ${key}`);
    assert.ok(Array.isArray(ASSET_CLASSES[key].required) && ASSET_CLASSES[key].required.length > 0);
    assert.equal(typeof ASSET_CLASSES[key].note, 'string');
  }
});

// ── draftTokenization: valid real-estate ─────────────────────────────────────────
test('valid real-estate draft passes with the right compliance flags', () => {
  const r = draftTokenization({
    assetClass: 'real_estate', name: 'Temple Lot Token', symbol: 'TEMPLE', supply: 1000, precision: 4,
    title: 'Deed-2026-001', jurisdiction: 'US-TX', valuation: { amount: 250000, currency: 'USD' },
  });
  assert.equal(r.ok, true);
  assert.equal(r.assetClass, 'real_estate');
  assert.ok(r.complianceFlags.includes('requires-SPV'));
  assert.ok(r.complianceFlags.includes('securities-review-likely'));
  assert.ok(r.complianceFlags.includes('KYC-gate-recommended'));
  // an existing asset must NOT be flagged speculative
  assert.ok(!r.complianceFlags.includes('place-before-built'));
  assert.ok(!r.complianceFlags.includes('speculative-not-yet-existing'));
  // descriptor shape
  assert.equal(r.descriptor.symbol, 'TEMPLE');
  assert.equal(r.descriptor.spv.type, 'special-purpose-vehicle');
  assert.equal(r.descriptor.backing.existing, true);
  assert.equal(r.descriptor.deedTwin.kind, 'deed-twin');
  assert.match(r.descriptor.deedTwin.hash, /^[a-f0-9]{64}$/);
});

// ── draftTokenization: place-before-built (planned / not yet existing) ────────────
test('a planned (not-yet-built) asset gets place-before-built + speculative flags', () => {
  const r = draftTokenization({
    assetClass: 'real_estate', name: 'Future Wing', symbol: 'WING', supply: 500, precision: 2,
    title: 'planned-deed', jurisdiction: 'US-TX', valuation: { amount: 1, currency: 'USD' },
    status: 'planned',
  });
  assert.equal(r.ok, true);
  assert.ok(r.complianceFlags.includes('place-before-built'), 'must hard-flag place-before-built');
  assert.ok(r.complianceFlags.includes('speculative-not-yet-existing'), 'must hard-flag speculative');
  assert.equal(r.descriptor.backing.existing, false);
  assert.ok(r.warnings.some((w) => /does not yet physically exist/.test(w)));
});

// ── draftTokenization: missing required fields ───────────────────────────────────
test('missing required fields → ok:false with warnings', () => {
  const r = draftTokenization({ assetClass: 'real_estate', symbol: 'X' }); // no title/jurisdiction/valuation
  assert.equal(r.ok, false);
  assert.equal(r.descriptor, null);
  assert.ok(r.warnings.length >= 1);
  assert.ok(r.warnings.some((w) => /title/.test(w)));
  assert.ok(r.warnings.some((w) => /jurisdiction/.test(w)));
  assert.ok(r.warnings.some((w) => /valuation/.test(w)));
});

test('unknown asset class → ok:false (soft-fail, no throw)', () => {
  const r = draftTokenization({ assetClass: 'unobtainium' });
  assert.equal(r.ok, false);
  assert.ok(r.warnings.some((w) => /unknown assetClass/.test(w)));
});

test('draftTokenization soft-fails on garbage input (no throw)', () => {
  assert.doesNotThrow(() => draftTokenization(null));
  assert.doesNotThrow(() => draftTokenization(undefined));
  assert.equal(draftTokenization(42).ok, false);
});

// ── validateUIA ──────────────────────────────────────────────────────────────────
test('validateUIA accepts a valid descriptor', () => {
  const v = validateUIA({ symbol: 'TEMPLE', precision: 4, maxSupply: 1000 });
  assert.equal(v.valid, true);
  assert.deepEqual(v.errors, []);
});

test('validateUIA rejects a too-long symbol', () => {
  const v = validateUIA({ symbol: 'WAYTOOLONGSYMBOLXX', precision: 4, maxSupply: 1000 });
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => /symbol/.test(e)));
});

test('validateUIA rejects lowercase / malformed symbols', () => {
  assert.equal(validateUIA({ symbol: 'lower', precision: 2, maxSupply: 100 }).valid, false);
  assert.equal(validateUIA({ symbol: 'A', precision: 2, maxSupply: 100 }).valid, false); // too short
  assert.equal(validateUIA({ symbol: 'BAD.', precision: 2, maxSupply: 100 }).valid, false); // trailing dot
});

test('validateUIA rejects excessive precision', () => {
  const v = validateUIA({ symbol: 'TEMPLE', precision: 99, maxSupply: 1000 });
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => /precision/.test(e)));
});

test('validateUIA rejects max-supply that overflows int64 when scaled by precision', () => {
  const v = validateUIA({ symbol: 'BIG', precision: 12, maxSupply: 100000000000 }); // *10^12 > 2^63-1
  assert.equal(v.valid, false);
  assert.ok(v.errors.some((e) => /maxSupply/.test(e)));
});

test('validateUIA flags missing fields without throwing', () => {
  const v = validateUIA({});
  assert.equal(v.valid, false);
  assert.ok(v.errors.length >= 3);
});

test('UIA_RULES exposes the int64 ceiling as a bigint', () => {
  assert.equal(UIA_RULES.MAX_SUPPLY_INT64, 9223372036854775807n);
});

// ── deedTwin ─────────────────────────────────────────────────────────────────────
test('deedTwin returns a content-addressable descriptor (deterministic)', () => {
  const asset = { assetClass: 'real_estate', title: 'Deed-1', jurisdiction: 'US-TX', valuation: 100, owner: 'hathor' };
  const a = deedTwin(asset);
  const b = deedTwin({ ...asset }); // same logical content
  assert.equal(a.kind, 'deed-twin');
  assert.match(a.hash, /^[a-f0-9]{64}$/);
  assert.equal(a.hash, b.hash, 'deterministic for same input');
  // different content → different hash
  assert.notEqual(a.hash, deedTwin({ ...asset, title: 'Deed-2' }).hash);
});

test('deedTwin honors an injected hasher (no crypto secret needed)', () => {
  const t = deedTwin({ assetClass: 'vehicle', vin: 'VIN123' }, { hasher: (s) => 'cid:' + s.length });
  assert.match(t.hash, /^cid:\d+$/);
});

// ── mintPlan (DRY-RUN ONLY) ──────────────────────────────────────────────────────
test('mintPlan always returns dryRun:true with ordered steps and never executes', () => {
  const { descriptor } = draftTokenization({
    assetClass: 'real_estate', symbol: 'TEMPLE', supply: 1000, precision: 4,
    title: 'Deed-1', jurisdiction: 'US-TX', valuation: 100,
  });
  const p = mintPlan(descriptor);
  assert.equal(p.dryRun, true);
  assert.equal(p.executed, false);
  assert.ok(Array.isArray(p.steps) && p.steps.length > 0);
  // steps are ordered
  assert.deepEqual(p.steps.map((s) => s.n), p.steps.map((_, i) => i + 1));
  // asset_create / asset_issue are described but only as plan text
  assert.ok(p.steps.some((s) => s.op === 'asset_create'));
  assert.ok(p.steps.some((s) => s.op === 'asset_issue'));
});

test('mintPlan stays dryRun even on a bad/empty descriptor (soft-fail)', () => {
  assert.equal(mintPlan(undefined).dryRun, true);
  assert.equal(mintPlan({}).dryRun, true);
});

// ── HARD INVARIANTS: no keys, no broadcast ───────────────────────────────────────
test('module holds no keys and never broadcasts', () => {
  assert.equal(HOLDS_KEYS, false);
  assert.equal(BROADCASTS, false);
  assert.equal(assertDryRunSafe(), true);
});

test('contentHash is deterministic + order-independent', () => {
  assert.equal(contentHash({ a: 1, b: 2 }), contentHash({ b: 2, a: 1 }));
  assert.match(contentHash('x'), /^[a-f0-9]{64}$/);
});
