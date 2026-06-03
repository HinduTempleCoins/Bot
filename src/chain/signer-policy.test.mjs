// signer-policy.test.mjs — offline tests for the MELEK-Signer policy engine.
//
//   node --test src/chain/signer-policy.test.mjs
//
// All deterministic: injected clock, in-memory store, stub chain lookup, array
// audit sink. No network, no Date.now() in any decision path.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createPolicy,
  makeMemoryStore,
  parseMelek,
  formatMelek,
  DEFAULT_CONFIG,
} from './signer-policy.mjs';

import { createMockSigner, createSignerClient } from './melek-signer-client.mjs';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// A fixed "now" so every age/window calc is reproducible.
const NOW = 1_700_000_000_000;

// Build a policy + its observable backing (audit array, store) in one shot.
function harness(overrides = {}) {
  const audit = [];
  const store = overrides.store || makeMemoryStore();
  const ages = overrides.ages || {}; // name -> ageMs (or thrown sentinel)
  const chain = overrides.chain || {
    async accountAgeMs(name) {
      if (ages[name] === 'throw') throw new Error('rpc down');
      return name in ages ? ages[name] : null; // null = unknown by default
    },
  };
  const policy = createPolicy({
    clock: overrides.clock || (() => NOW),
    chain,
    store,
    audit: (e) => audit.push(e),
    config: overrides.config || {},
  });
  return { policy, audit, store, chain };
}

function transfer({ from = 'hathor', to = 'newbie', amount = '10.000 MELEK' } = {}) {
  return [['transfer', { from, to, amount }]];
}

const TOKEN = { name: 'tok-signup', scopes: ['transfer'], clientRef: 'signup-grant-newbie' };

// ── asset parsing ─────────────────────────────────────────────────────────────

test('parseMelek parses valid 3-decimal MELEK to milli-units', () => {
  assert.deepEqual(parseMelek('10.000 MELEK'), { ok: true, milli: 10000 });
  assert.deepEqual(parseMelek('  5.500 MELEK '), { ok: true, milli: 5500 });
  assert.equal(formatMelek(12500), '12.500 MELEK');
});

test('parseMelek rejects floats, wrong asset, wrong precision', () => {
  assert.equal(parseMelek('10.00 MELEK').ok, false);   // 2 decimals
  assert.equal(parseMelek('10.000 HIVE').ok, false);   // wrong symbol
  assert.equal(parseMelek('10 MELEK').ok, false);      // no decimals
  assert.equal(parseMelek(10).ok, false);              // not a string
});

// ── Rule 1: op-kind allowlist ──────────────────────────────────────────────────

test('Rule 1: accepts a transfer inside the allowlist', async () => {
  const { policy } = harness({ ages: { newbie: HOUR } });
  const v = await policy(transfer(), TOKEN);
  assert.deepEqual(v, { ok: true });
});

test('Rule 1: rejects a non-transfer op kind', async () => {
  const { policy, audit } = harness({ ages: { newbie: HOUR } });
  const v = await policy([['account_update', { account: 'hathor' }]], TOKEN);
  assert.equal(v.ok, false);
  assert.match(v.reason, /not permitted by policy/);
  assert.equal(audit.at(-1).decision, 'reject');
});

test('Rule 1: token scope narrows the policy allowlist (intersection)', async () => {
  // Policy allows transfer, but a token scoped to vote-only → nothing permitted.
  const { policy } = harness({ ages: { newbie: HOUR } });
  const v = await policy(transfer(), { name: 'tok-x', scopes: ['vote'] });
  assert.equal(v.ok, false);
  assert.match(v.reason, /not permitted/);
});

test('Rule 1: rejects multi-op bundle (outside signup-grant envelope)', async () => {
  const { policy } = harness({ ages: { newbie: HOUR } });
  const v = await policy([...transfer(), ['transfer', { from: 'hathor', to: 'two', amount: '10.000 MELEK' }]], TOKEN);
  assert.equal(v.ok, false);
  assert.match(v.reason, /single transfer/);
});

// ── Rule 2: recipient account age ───────────────────────────────────────────────

test('Rule 2: rejects a recipient older than 24h', async () => {
  const { policy, audit } = harness({ ages: { newbie: DAY + HOUR } });
  const v = await policy(transfer(), TOKEN);
  assert.equal(v.ok, false);
  assert.match(v.reason, /too old/);
  assert.equal(audit.at(-1).decision, 'reject');
});

test('Rule 2: fails closed when account age is unknown', async () => {
  const { policy } = harness({ ages: {} }); // accountAgeMs returns null
  const v = await policy(transfer(), TOKEN);
  assert.equal(v.ok, false);
  assert.match(v.reason, /age unknown/);
});

test('Rule 2: fails closed when the chain lookup throws', async () => {
  const { policy } = harness({ ages: { newbie: 'throw' } });
  const v = await policy(transfer(), TOKEN);
  assert.equal(v.ok, false);
  assert.match(v.reason, /lookup failed/);
});

test('Rule 2: accepts a recipient created right at the 24h boundary', async () => {
  const { policy } = harness({ ages: { newbie: DAY } }); // exactly 24h → inclusive
  const v = await policy(transfer(), TOKEN);
  assert.equal(v.ok, true);
});

// ── Rule 3: amount band + fixed/tiered ──────────────────────────────────────────

test('Rule 3: rejects amount below the band', async () => {
  const { policy } = harness({ ages: { newbie: HOUR }, config: { amount: { mode: 'tiered' } } });
  const v = await policy(transfer({ amount: '4.999 MELEK' }), TOKEN);
  assert.equal(v.ok, false);
  assert.match(v.reason, /outside band/);
});

test('Rule 3: rejects amount above the band', async () => {
  const { policy } = harness({ ages: { newbie: HOUR }, config: { amount: { mode: 'tiered' } } });
  const v = await policy(transfer({ amount: '15.001 MELEK' }), TOKEN);
  assert.equal(v.ok, false);
  assert.match(v.reason, /outside band/);
});

test('Rule 3: tiered mode allows any in-band amount; fixed mode pins to fixedMelek', async () => {
  // tiered: 5.000 and 15.000 both allowed.
  const tiered = harness({ ages: { a: HOUR, b: HOUR }, config: { amount: { mode: 'tiered' } } });
  assert.equal((await tiered.policy(transfer({ to: 'a', amount: '5.000 MELEK' }), TOKEN)).ok, true);
  assert.equal((await tiered.policy(transfer({ to: 'b', amount: '15.000 MELEK' }), TOKEN)).ok, true);

  // fixed (default 10.000): an in-band-but-not-fixed amount is rejected.
  const fixed = harness({ ages: { c: HOUR } });
  const v = await fixed.policy(transfer({ to: 'c', amount: '7.000 MELEK' }), TOKEN);
  assert.equal(v.ok, false);
  assert.match(v.reason, /!= fixed grant/);
});

test('Rule 3: rejects malformed / wrong-asset amounts', async () => {
  const { policy } = harness({ ages: { newbie: HOUR } });
  assert.equal((await policy(transfer({ amount: '10 MELEK' }), TOKEN)).ok, false);
  assert.equal((await policy(transfer({ amount: '10.000 HIVE' }), TOKEN)).ok, false);
});

// ── Rule 4: per-recipient lifetime cap ──────────────────────────────────────────

test('Rule 4: a second grant to the same recipient is rejected forever', async () => {
  const { policy, store } = harness({ ages: { newbie: HOUR } });
  const first = await policy(transfer(), TOKEN);
  assert.equal(first.ok, true);
  assert.equal(store.granted('newbie'), true);
  const second = await policy(transfer(), TOKEN);
  assert.equal(second.ok, false);
  assert.match(second.reason, /already received/);
});

test('Rule 4: a rejected request does NOT consume the lifetime slot', async () => {
  // First attempt fails on amount (fixed mode), so the slot stays open.
  const { policy } = harness({ ages: { newbie: HOUR } });
  const bad = await policy(transfer({ amount: '6.000 MELEK' }), TOKEN);
  assert.equal(bad.ok, false);
  const good = await policy(transfer({ amount: '10.000 MELEK' }), TOKEN);
  assert.equal(good.ok, true);
});

// ── Rule 5: per-day sliding window ──────────────────────────────────────────────

test('Rule 5: rejects once the per-day cap is reached', async () => {
  const { policy } = harness({
    config: { perDayCap: 2 },
    chain: { async accountAgeMs() { return HOUR; } }, // every recipient is fresh
  });
  assert.equal((await policy(transfer({ to: 'r1' }), TOKEN)).ok, true);
  assert.equal((await policy(transfer({ to: 'r2' }), TOKEN)).ok, true);
  const third = await policy(transfer({ to: 'r3' }), TOKEN);
  assert.equal(third.ok, false);
  assert.match(third.reason, /per-day grant cap/);
});

test('Rule 5: window slides — grants older than windowMs no longer count', async () => {
  const store = makeMemoryStore();
  // Seed two grants 25h in the past (outside a 24h window).
  store.markGranted('old1', NOW - 25 * HOUR);
  store.markGranted('old2', NOW - 25 * HOUR);
  const { policy } = harness({
    store,
    config: { perDayCap: 2 },
    chain: { async accountAgeMs() { return HOUR; } },
  });
  // Despite 2 lifetime grants, none are inside the window → fresh recipient passes.
  const v = await policy(transfer({ to: 'new' }), TOKEN);
  assert.equal(v.ok, true);
});

// ── Rule 6: audit log ───────────────────────────────────────────────────────────

test('Rule 6: every accept AND reject is audited with shape {at,decision,reason,ops,clientRef}', async () => {
  const { policy, audit } = harness({ ages: { newbie: HOUR, oldie: DAY * 5 } });
  await policy(transfer({ to: 'newbie' }), TOKEN);                 // accept
  await policy(transfer({ to: 'oldie' }), TOKEN);                  // reject (age)

  assert.equal(audit.length, 2);
  const [acc, rej] = audit;

  assert.equal(acc.decision, 'accept');
  assert.equal(acc.reason, null);
  assert.equal(acc.at, NOW);
  assert.equal(acc.clientRef, 'signup-grant-newbie');
  assert.equal(acc.token, 'tok-signup');           // name only, never a secret
  assert.deepEqual(acc.ops, [{ kind: 'transfer', from: 'hathor', to: 'newbie', amount: '10.000 MELEK' }]);

  assert.equal(rej.decision, 'reject');
  assert.match(rej.reason, /too old/);
  assert.deepEqual(rej.ops[0].to, 'oldie');
});

test('Rule 6: audit never carries a raw token/key — only the token name', async () => {
  const { policy, audit } = harness({ ages: { newbie: HOUR } });
  await policy(transfer(), { name: 'tok-signup', scopes: ['transfer'], secret: 'WIF-DO-NOT-LOG' });
  const entry = audit.at(-1);
  assert.equal(entry.token, 'tok-signup');
  assert.equal(JSON.stringify(entry).includes('WIF-DO-NOT-LOG'), false);
});

// ── construction guards ─────────────────────────────────────────────────────────

test('createPolicy refuses to build without an injected clock', () => {
  assert.throws(() => createPolicy({ chain: { accountAgeMs() {} }, store: makeMemoryStore() }), /clock injection required/);
});

test('createPolicy refuses to build without chain.accountAgeMs or store', () => {
  assert.throws(() => createPolicy({ clock: () => NOW, store: makeMemoryStore() }), /accountAgeMs/);
  assert.throws(() => createPolicy({ clock: () => NOW, chain: { accountAgeMs() {} } }), /store/);
});

test('DEFAULT_CONFIG encodes the §3c band [5.000, 15.000] and 100/day cap', () => {
  assert.equal(DEFAULT_CONFIG.amountBand.minMelek, 5.0);
  assert.equal(DEFAULT_CONFIG.amountBand.maxMelek, 15.0);
  assert.equal(DEFAULT_CONFIG.perDayCap, 100);
  assert.deepEqual(DEFAULT_CONFIG.allowedOps, ['transfer']);
});

// ── mock-signer integration (the load-bearing wiring proof) ─────────────────────

test('integration: createPolicy wired into createMockSigner accepts an in-policy signup grant', async () => {
  const policy = createPolicy({
    clock: () => NOW,
    chain: { async accountAgeMs() { return HOUR; } },
    store: makeMemoryStore(),
    audit: () => {},
  });
  const mock = createMockSigner({
    tokens: { 'tok-signup': { name: 'tok-signup', scopes: ['transfer'] } },
    policy,
  });
  const signer = createSignerClient({ url: 'http://mock', token: 'tok-signup', fetch: mock.fetch });
  const r = await signer.broadcast(transfer({ to: 'fresh' }), { clientRef: 'signup-grant-fresh' });
  assert.equal(r.ok, true);
  assert.equal(mock.audit().at(-1).at, 'accepted');
});

test('integration: an out-of-band transfer is REJECTED by the policy and audited (both layers)', async () => {
  const policyAudit = [];
  const policy = createPolicy({
    clock: () => NOW,
    chain: { async accountAgeMs() { return HOUR; } },
    store: makeMemoryStore(),
    audit: (e) => policyAudit.push(e),
  });
  const mock = createMockSigner({
    tokens: { 'tok-signup': { name: 'tok-signup', scopes: ['transfer'] } },
    policy,
  });
  const signer = createSignerClient({ url: 'http://mock', token: 'tok-signup', fetch: mock.fetch });

  // 99.000 MELEK is in-scope (transfer) but way outside the [5,15] band.
  await assert.rejects(
    signer.broadcast(transfer({ to: 'fresh', amount: '99.000 MELEK' }), { clientRef: 'evil-drain' }),
    (err) => {
      assert.equal(err.name, 'SignerError');
      assert.equal(err.status, 403);
      assert.match(err.reason, /rejected by policy|outside band/);
      return true;
    },
  );

  // Policy layer audited the reject...
  assert.equal(policyAudit.at(-1).decision, 'reject');
  assert.match(policyAudit.at(-1).reason, /outside band/);
  // ...and the signer's own independent audit path recorded it too (§3c: two paths).
  assert.equal(mock.audit().at(-1).at, 'rejected');
});

test('integration: an out-of-scope op kind is rejected before policy even runs', async () => {
  let policyCalls = 0;
  const policy = createPolicy({
    clock: () => NOW,
    chain: { async accountAgeMs() { policyCalls += 1; return HOUR; } },
    store: makeMemoryStore(),
    audit: () => {},
  });
  const mock = createMockSigner({
    tokens: { 'tok-signup': { name: 'tok-signup', scopes: ['transfer'] } },
    policy,
  });
  const signer = createSignerClient({ url: 'http://mock', token: 'tok-signup', fetch: mock.fetch });
  await assert.rejects(
    signer.broadcast([['vote', { voter: 'hathor', author: 'a', permlink: 'p', weight: 1 }]], { clientRef: 'x' }),
    /outside token scope/,
  );
});
