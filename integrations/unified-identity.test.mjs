// unified-identity.test.mjs — offline, pure. node --test. Injects a deterministic keccak stub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyId, isPranaAddress, isMelekAccount, shadowPrana, indexRegistry, resolveIdentity, routeTransfer,
} from './unified-identity.mjs';

// deterministic 32-byte "keccak" stub for tests (NOT crypto — stable + distinct in the low 20 bytes).
const stubKeccak = (s) => {
  let h = '';
  for (let i = 0; i < s.length; i++) h += s.charCodeAt(i).toString(16).padStart(2, '0');
  return '0x' + h.repeat(Math.ceil(64 / Math.max(1, h.length))).slice(0, 64); // repeat content to fill 64
};

const ADDR = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

test('classify + validators', () => {
  assert.equal(classifyId(ADDR), 'prana');
  assert.equal(classifyId('@hathor'), 'melek');
  assert.equal(classifyId('hathor'), 'melek');
  assert.equal(classifyId('NOPE!!'), 'invalid');
  assert.equal(isPranaAddress(ADDR), true);
  assert.equal(isMelekAccount('@alice-1'), true);
});

test('shadowPrana is deterministic + valid 0x; null without keccak', () => {
  const a = shadowPrana('hathor', stubKeccak);
  assert.match(a, /^0x[0-9a-f]{40}$/);
  assert.equal(shadowPrana('hathor', stubKeccak), a); // deterministic
  assert.notEqual(shadowPrana('alice', stubKeccak), a); // distinct per account
  assert.equal(shadowPrana('hathor'), null); // no keccak
  assert.equal(shadowPrana('BAD!!', stubKeccak), null);
});

test('resolveIdentity: a @-only id gets a shadow PRANA; a linked id uses the real address', () => {
  const r1 = resolveIdentity('@bob', { keccak: stubKeccak });
  assert.equal(r1.melek, 'bob');
  assert.equal(r1.pranaIsShadow, true);
  assert.match(r1.prana, /^0x/);
  // with a link, the real address overrides the shadow
  const reg = indexRegistry({ links: { bob: ADDR } });
  const r2 = resolveIdentity('@bob', { registry: reg, keccak: stubKeccak });
  assert.equal(r2.prana, ADDR.toLowerCase());
  assert.equal(r2.pranaIsShadow, false);
});

test('resolveIdentity: a 0x id resolves its MELEK side only if linked', () => {
  const bare = resolveIdentity(ADDR, {});
  assert.equal(bare.prana, ADDR.toLowerCase());
  assert.equal(bare.melek, null);
  const reg = indexRegistry({ links: { carol: ADDR } });
  const linked = resolveIdentity(ADDR, { registry: reg });
  assert.equal(linked.melek, 'carol');
});

test('routeTransfer model A: token follows the recipient to THEIR native chain (wraps when cross-chain)', () => {
  const reg = indexRegistry({ links: { dave: ADDR } });
  // token on PRANA, sending to a PRANA id → local (already on its native chain)
  assert.deepEqual(
    routeTransfer({ toInput: ADDR, tokenChain: 'prana' }),
    { action: 'local', chain: 'prana', to: ADDR.toLowerCase(), wrap: null },
  );
  // token on PRANA, sending to a MELEK @ → WRAP onto MELEK (the @'s native chain)
  const toMelek = routeTransfer({ toInput: '@dave', tokenChain: 'prana', registry: reg, keccak: stubKeccak });
  assert.equal(toMelek.action, 'bridge');
  assert.equal(toMelek.chain, 'melek');
  assert.equal(toMelek.wrap, 'prana->melek');
  assert.equal(toMelek.to, 'dave');
  // token on MELEK, sending to a @ → local (@ is melek-native)
  assert.equal(routeTransfer({ toInput: '@dave', tokenChain: 'melek', registry: reg, keccak: stubKeccak }).action, 'local');
});

test('routeTransfer: a 0x recipient with a MELEK token wraps onto PRANA (their native chain), via shadow', () => {
  // token on MELEK (e.g. APIS), sending to a 0x → WRAP onto PRANA to the 0x address (local on PRANA after bridge)
  const r = routeTransfer({ toInput: ADDR, tokenChain: 'melek' });
  assert.equal(r.action, 'bridge');
  assert.equal(r.chain, 'prana');
  assert.equal(r.wrap, 'melek->prana');
  assert.equal(r.to, ADDR.toLowerCase());
});

test('routeTransfer: invalid id → unresolvable', () => {
  assert.equal(routeTransfer({ toInput: 'NOPE!!', tokenChain: 'prana' }).action, 'unresolvable');
});
