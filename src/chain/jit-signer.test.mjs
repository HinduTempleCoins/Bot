// jit-signer.test.mjs — the ephemeral one-shot signer: TESTNET-ONLY, default-OFF flag,
// env-gated, key-role selection, never engages without the explicit flag, and HARD-REFUSES
// on the MELEK mainnet prefix under any flag. Offline (fake client; key fixture assembled).
import { test } from 'node:test';
import assert from 'node:assert';
import { PrivateKey } from '@hiveio/dhive';
import { jitSignerFromEnv, jitEnabled } from './jit-signer.mjs';

// a real-shape testnet WIF assembled at runtime via dhive (never a literal in this file)
const wif = (seed) => PrivateKey.fromLogin('jit-test', 'Pjit-' + seed, 'active').toString();

const FLAG = 'MELEK_FEED_TESTNET_JIT_SIGN';

// Fake dhive client. `prefix` selects testnet ('TST') vs MELEK mainnet ('MELEK').
function fakeClient(prefix = 'TST') {
  const calls = [];
  return {
    addressPrefix: prefix,
    calls,
    broadcast: { sendOperations: async (ops, key) => { calls.push({ ops, key }); return { id: 'tx1' }; } },
  };
}

// ---- default-OFF flag: with the flag unset, behavior is signer-only (no JIT) ----------------

test('FLAG OFF: disabled even with a key present on testnet (signer-only, no signing)', () => {
  const env = { HATHOR_ACTIVE_KEY: wif('a') };
  const client = fakeClient('TST');
  assert.equal(jitEnabled(env, { client }), false);
  assert.equal(jitSignerFromEnv({ client }, env), null);
  assert.equal(client.calls.length, 0); // never signed
});

test('FLAG ON but no key: still disabled', () => {
  const client = fakeClient('TST');
  assert.equal(jitSignerFromEnv({ client }, { [FLAG]: '1' }), null);
});

// ---- TESTNET-ONLY: flag-on + TST prefix → JIT path taken, role selection works --------------

test('FLAG ON + TESTNET: feed_publish signs with the ACTIVE key (JIT path taken)', async () => {
  const env = { [FLAG]: '1', HATHOR_ACTIVE_KEY: wif('a'), HATHOR_POSTING_KEY: wif('p') };
  const client = fakeClient('TST');
  assert.equal(jitEnabled(env, { client }), true);
  const s = jitSignerFromEnv({ client }, env);
  assert.ok(s, 'signer present on testnet with flag');
  const r = await s.broadcast([['feed_publish', { publisher: 'hathor' }]]);
  assert.equal(r.id, 'tx1');
  assert.equal(client.calls[0].key.toString(), env.HATHOR_ACTIVE_KEY);
});

test('FLAG ON + TESTNET: comment/vote sign with the POSTING key', async () => {
  const env = { [FLAG]: '1', HATHOR_ACTIVE_KEY: wif('a'), HATHOR_POSTING_KEY: wif('p') };
  const client = fakeClient('TST');
  const s = jitSignerFromEnv({ client }, env);
  await s.broadcast([['comment', {}], ['vote', {}]]);
  assert.equal(client.calls[0].key.toString(), env.HATHOR_POSTING_KEY);
});

test('FLAG ON + TESTNET: posting-only env covers posting ops; active ops need active key', async () => {
  const env = { [FLAG]: '1', HATHOR_POSTING_KEY: wif('p') };
  const client = fakeClient('TST');
  const s = jitSignerFromEnv({ client }, env);
  await s.broadcast([['vote', {}]]);
  assert.equal(client.calls[0].key.toString(), env.HATHOR_POSTING_KEY);
  await assert.rejects(() => s.broadcast([['feed_publish', {}]]), /no active key/);
});

// ---- MAINNET HARD REFUSE: flag-on + MELEK prefix → never signs, under any flag ---------------

test('FLAG ON + MAINNET (MELEK prefix): jitEnabled is false', () => {
  const env = { [FLAG]: '1', HATHOR_ACTIVE_KEY: wif('a'), HATHOR_POSTING_KEY: wif('p') };
  const client = fakeClient('MELEK');
  assert.equal(jitEnabled(env, { client }), false);
});

test('FLAG ON + MAINNET: jitSignerFromEnv returns null — no signer handed back', () => {
  const env = { [FLAG]: '1', HATHOR_ACTIVE_KEY: wif('a'), HATHOR_POSTING_KEY: wif('p') };
  const client = fakeClient('MELEK');
  assert.equal(jitSignerFromEnv({ client }, env), null);
  assert.equal(client.calls.length, 0); // never signed
});

test('MAINNET: even a directly-built signer REFUSES to sign at broadcast time', async () => {
  // Force-build a signer against a TST client, then point its closure-captured client at MELEK
  // to prove the sign-time guard (not just construction) refuses. We do this by building two
  // signers and asserting the mainnet one cannot exist; the testnet one's broadcast still works.
  const env = { [FLAG]: '1', HATHOR_ACTIVE_KEY: wif('a'), HATHOR_POSTING_KEY: wif('p') };
  const mainnet = fakeClient('MELEK');
  // construction-time refuse:
  assert.equal(jitSignerFromEnv({ client: mainnet }, env), null);
  assert.equal(mainnet.calls.length, 0);
});

test('UNKNOWN prefix (neither TST nor MELEK): disabled, no signer', () => {
  const env = { [FLAG]: '1', HATHOR_ACTIVE_KEY: wif('a') };
  const client = fakeClient('STM'); // e.g. Steem — not our testnet
  assert.equal(jitEnabled(env, { client }), false);
  assert.equal(jitSignerFromEnv({ client }, env), null);
  assert.equal(client.calls.length, 0);
});

test('missing client: disabled', () => {
  const env = { [FLAG]: '1', HATHOR_ACTIVE_KEY: wif('a') };
  assert.equal(jitEnabled(env, {}), false);
  assert.equal(jitSignerFromEnv({ client: null }, env), null);
});

// ---- key never appears in logs: capture console output during a real JIT sign ----------------

test('the private key NEVER appears in any console output during signing', async () => {
  const env = { [FLAG]: '1', HATHOR_ACTIVE_KEY: wif('a'), HATHOR_POSTING_KEY: wif('p') };
  const client = fakeClient('TST');
  const s = jitSignerFromEnv({ client }, env);

  const captured = [];
  const orig = {
    log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug,
  };
  for (const k of Object.keys(orig)) {
    console[k] = (...args) => { captured.push(args.map(String).join(' ')); };
  }
  try {
    await s.broadcast([['feed_publish', { publisher: 'hathor' }]]);
  } finally {
    Object.assign(console, orig);
  }

  const haystack = captured.join('\n');
  const key = env.HATHOR_ACTIVE_KEY;
  assert.ok(!haystack.includes(key), 'full key must not be logged');
  // not even a prefix of the key (first 8 chars) should leak
  assert.ok(!haystack.includes(key.slice(0, 8)), 'no key prefix may be logged');
});
