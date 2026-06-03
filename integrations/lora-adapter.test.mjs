// lora-adapter.test.mjs — OFFLINE tests for the LoRA/QLoRA adapter registry + selection logic.
// Pure registry/selection; no training, no inference, no I/O.
// Run: node --test integrations/lora-adapter.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert';
import {
  registerAdapter, selectAdapter, list, applyPlan, _resetRegistry,
  TIER_USER, TIER_DOMAIN,
} from './lora-adapter.mjs';

const BASE = 'qwen2.5-coder:7b';
const OTHER_BASE = 'llama3.1:8b';

beforeEach(() => _resetRegistry());

// ── registration ────────────────────────────────────────────────────────────────
test('registerAdapter requires id, baseModel, path', () => {
  assert.throws(() => registerAdapter({ baseModel: BASE, path: '/a' }), /id is required/);
  assert.throws(() => registerAdapter({ id: 'x', path: '/a' }), /baseModel is required/);
  assert.throws(() => registerAdapter({ id: 'x', baseModel: BASE }), /path is required/);
});

test('registerAdapter stores a normalized record and is an idempotent upsert', () => {
  registerAdapter({ id: 'a1', owner: 'alice', domain: 'cryptology', baseModel: BASE, path: '/a1' });
  registerAdapter({ id: 'a1', owner: 'alice', domain: 'cryptology', baseModel: BASE, path: '/a1-v2' });
  const all = list();
  assert.equal(all.length, 1);
  assert.equal(all[0].path, '/a1-v2');
  assert.equal(all[0].owner, 'alice');
});

// ── selection precedence: user > domain > base ────────────────────────────────────
test('per-user adapter beats per-domain adapter', () => {
  registerAdapter({ id: 'dom', domain: 'cryptology', baseModel: BASE, path: '/dom' });
  registerAdapter({ id: 'alice', owner: 'alice', domain: 'cryptology', baseModel: BASE, path: '/alice' });
  const sel = selectAdapter({ user: 'alice', domain: 'cryptology', baseModel: BASE });
  assert.equal(sel.id, 'alice');
  assert.equal(sel.matchTier, TIER_USER);
});

test('per-domain adapter chosen when no per-user adapter exists for that user', () => {
  registerAdapter({ id: 'dom', domain: 'cryptology', baseModel: BASE, path: '/dom' });
  registerAdapter({ id: 'alice', owner: 'alice', domain: 'cryptology', baseModel: BASE, path: '/alice' });
  const sel = selectAdapter({ user: 'bob', domain: 'cryptology', baseModel: BASE });
  assert.equal(sel.id, 'dom');
  assert.equal(sel.matchTier, TIER_DOMAIN);
});

test('falls back to base (null) when nothing matches', () => {
  registerAdapter({ id: 'dom', domain: 'cryptology', baseModel: BASE, path: '/dom' });
  const sel = selectAdapter({ user: 'carol', domain: 'astronomy', baseModel: BASE });
  assert.equal(sel, null);
});

test("another user's per-user adapter does not leak across users", () => {
  registerAdapter({ id: 'alice', owner: 'alice', domain: 'cryptology', baseModel: BASE, path: '/alice' });
  // bob asks the same domain but there is only a user-owned adapter (no shared domain adapter)
  const sel = selectAdapter({ user: 'bob', domain: 'cryptology', baseModel: BASE });
  assert.equal(sel, null);
});

test('baseModel compatibility is mandatory — no cross-base overlay', () => {
  registerAdapter({ id: 'alice', owner: 'alice', domain: 'cryptology', baseModel: BASE, path: '/alice' });
  const sel = selectAdapter({ user: 'alice', domain: 'cryptology', baseModel: OTHER_BASE });
  assert.equal(sel, null);
});

// ── list filters ──────────────────────────────────────────────────────────────────
test('list filters by owner and by domain', () => {
  registerAdapter({ id: 'a1', owner: 'alice', domain: 'cryptology', baseModel: BASE, path: '/a1' });
  registerAdapter({ id: 'a2', owner: 'alice', domain: 'astronomy', baseModel: BASE, path: '/a2' });
  registerAdapter({ id: 'd1', domain: 'cryptology', baseModel: BASE, path: '/d1' });

  assert.equal(list().length, 3);
  assert.deepEqual(list({ owner: 'alice' }).map((a) => a.id).sort(), ['a1', 'a2']);
  assert.deepEqual(list({ domain: 'cryptology' }).map((a) => a.id).sort(), ['a1', 'd1']);
  assert.deepEqual(list({ owner: 'alice', domain: 'cryptology' }).map((a) => a.id), ['a1']);
});

// ── applyPlan keeps the base frozen ────────────────────────────────────────────────
test('applyPlan with an adapter overlays it on a frozen base, never modifying base weights', () => {
  const a = registerAdapter({ id: 'alice', owner: 'alice', domain: 'cryptology', baseModel: BASE, path: '/alice' });
  const plan = applyPlan(BASE, a);
  assert.equal(plan.baseModel, BASE);
  assert.equal(plan.baseFrozen, true);
  assert.equal(plan.modifiesBaseWeights, false);
  assert.equal(plan.adapter, 'alice');
  assert.equal(plan.adapterOwner, 'alice'); // Bio-NFT consent/ownership anchor preserved
  assert.equal(plan.mode, 'frozen-base+adapter');
});

test('applyPlan with no adapter is base-only and still frozen', () => {
  const plan = applyPlan(BASE, null);
  assert.equal(plan.mode, 'base-only');
  assert.equal(plan.baseFrozen, true);
  assert.equal(plan.modifiesBaseWeights, false);
  assert.equal(plan.adapter, null);
});

test('applyPlan rejects an adapter whose baseModel does not match', () => {
  const a = registerAdapter({ id: 'alice', owner: 'alice', baseModel: OTHER_BASE, path: '/alice' });
  assert.throws(() => applyPlan(BASE, a), /does not match/);
});
