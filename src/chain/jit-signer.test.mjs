// jit-signer.test.mjs — the ephemeral one-shot signer: env-gated, key-role selection,
// never engages without the explicit flag. Offline (fake client; key fixture assembled).
import { test } from 'node:test';
import assert from 'node:assert';
import { PrivateKey } from '@hiveio/dhive';
import { jitSignerFromEnv, jitEnabled } from './jit-signer.mjs';

// a real-shape testnet WIF assembled at runtime via dhive (never a literal in this file)
const wif = (seed) => PrivateKey.fromLogin('jit-test', 'Pjit-' + seed, 'active').toString();

function fakeClient() {
  const calls = [];
  return {
    calls,
    broadcast: { sendOperations: async (ops, key) => { calls.push({ ops, key }); return { id: 'tx1' }; } },
  };
}

test('disabled without the explicit flag, even with a key present', () => {
  const env = { HATHOR_ACTIVE_KEY: wif('a') };
  assert.equal(jitEnabled(env), false);
  assert.equal(jitSignerFromEnv({ client: fakeClient() }, env), null);
});

test('disabled with the flag but no key', () => {
  assert.equal(jitSignerFromEnv({ client: fakeClient() }, { MELEK_JIT_BROADCAST: '1' }), null);
});

test('feed_publish signs with the ACTIVE key', async () => {
  const env = { MELEK_JIT_BROADCAST: '1', HATHOR_ACTIVE_KEY: wif('a'), HATHOR_POSTING_KEY: wif('p') };
  const client = fakeClient();
  const s = jitSignerFromEnv({ client }, env);
  const r = await s.broadcast([['feed_publish', { publisher: 'hathor' }]]);
  assert.equal(r.id, 'tx1');
  assert.equal(client.calls[0].key.toString(), env.HATHOR_ACTIVE_KEY);
});

test('comment/vote sign with the POSTING key', async () => {
  const env = { MELEK_JIT_BROADCAST: '1', HATHOR_ACTIVE_KEY: wif('a'), HATHOR_POSTING_KEY: wif('p') };
  const client = fakeClient();
  const s = jitSignerFromEnv({ client }, env);
  await s.broadcast([['comment', {}], ['vote', {}]]);
  assert.equal(client.calls[0].key.toString(), env.HATHOR_POSTING_KEY);
});

test('posting-only env still covers posting ops; active ops fall back to active when present', async () => {
  const env = { MELEK_JIT_BROADCAST: '1', HATHOR_POSTING_KEY: wif('p') };
  const client = fakeClient();
  const s = jitSignerFromEnv({ client }, env);
  await s.broadcast([['vote', {}]]);
  assert.equal(client.calls[0].key.toString(), env.HATHOR_POSTING_KEY);
  await assert.rejects(() => s.broadcast([['feed_publish', {}]]), /no active key/);
});
