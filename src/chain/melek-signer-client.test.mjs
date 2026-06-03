// melek-signer-client.test.mjs — offline tests for the MELEK-Signer client + mock.
// No network, no keys: transport is the in-process mock (the same contract the
// private melek-signer repo must implement — these tests are its fixture spec).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createSignerClient, createMockSigner, fromEnv, SignerError,
} from './melek-signer-client.mjs';

const TOKENS = {
  'tok-posting': { scopes: ['comment', 'vote', 'custom_json'] },
  'tok-signup': { scopes: ['transfer'] },
};

test('broadcast: in-scope op is signed and returns a tx result', async () => {
  const mock = createMockSigner({ tokens: TOKENS });
  const signer = createSignerClient({ url: 'http://mock', token: 'tok-posting', fetch: mock.fetch });
  const r = await signer.broadcast([['comment', { author: 'hathor', body: 'hi' }]], { clientRef: 'test-1' });
  assert.equal(r.ok, true);
  assert.match(r.id, /^mock-tx-/);
  assert.equal(r.client_ref, 'test-1');
  const audit = mock.audit();
  assert.equal(audit.length, 1);
  assert.equal(audit[0].at, 'accepted');
});

test('token scoping: posting token cannot request a transfer (403)', async () => {
  const mock = createMockSigner({ tokens: TOKENS });
  const signer = createSignerClient({ url: 'http://mock', token: 'tok-posting', fetch: mock.fetch });
  await assert.rejects(
    () => signer.broadcast([['transfer', { from: 'hathor', to: 'alice', amount: '10.000 MELEK' }]]),
    (e) => e instanceof SignerError && e.status === 403 && /outside token scope/.test(e.reason),
  );
  // §3c: rejected requests are audited too
  assert.equal(mock.audit()[0].at, 'rejected');
});

test('auth: unknown bearer token → 401', async () => {
  const mock = createMockSigner({ tokens: TOKENS });
  const signer = createSignerClient({ url: 'http://mock', token: 'tok-wrong', fetch: mock.fetch });
  await assert.rejects(
    () => signer.broadcast([['vote', { voter: 'hathor' }]]),
    (e) => e instanceof SignerError && e.status === 401,
  );
});

test('zero-WIF rule: a raw WIF passed as the token is refused at construction', () => {
  // WIF-shaped but constructed (never a literal — the repo's secret-scan
  // pre-commit hook rejects anything that even LOOKS like a key, correctly).
  const wif = '5' + 'K'.repeat(50);
  assert.throws(
    () => createSignerClient({ url: 'http://mock', token: wif }),
    /raw private key — refused/,
  );
});

test('token never leaks into error messages', async () => {
  const failingFetch = async () => { throw new Error('connect ECONNREFUSED tok-secret-value http://signer'); };
  const signer = createSignerClient({ url: 'http://signer', token: 'tok-secret-value', fetch: failingFetch });
  try {
    await signer.broadcast([['comment', { a: 1 }]]);
    assert.fail('should have thrown');
  } catch (e) {
    assert.equal(e.status, 0);
    assert.ok(!String(e.message).includes('tok-secret-value'), 'token must be redacted');
    assert.match(e.message, /\[redacted\]/);
  }
});

test('input validation: empty or malformed ops are refused client-side', async () => {
  const mock = createMockSigner({ tokens: TOKENS });
  const signer = createSignerClient({ url: 'http://mock', token: 'tok-posting', fetch: mock.fetch });
  await assert.rejects(() => signer.broadcast([]), /non-empty/);
  await assert.rejects(() => signer.broadcast([['comment']]), /\["kind", \{payload\}\]/);
  assert.equal(mock.audit().length, 0, 'malformed requests never reach the signer');
});

test('policy hook: PRE-SIGNER 4 engine plugs in and can reject with a reason', async () => {
  const policy = (ops) => {
    const [, payload] = ops[0];
    const amt = parseFloat(payload.amount || '0');
    return amt >= 5 && amt <= 15 ? { ok: true } : { ok: false, reason: 'amount outside [5,15] MELEK band' };
  };
  const mock = createMockSigner({ tokens: TOKENS, policy });
  const signer = createSignerClient({ url: 'http://mock', token: 'tok-signup', fetch: mock.fetch });

  const ok = await signer.broadcast([['transfer', { from: 'hathor', to: 'newbie', amount: '10.000 MELEK' }]]);
  assert.equal(ok.ok, true);

  await assert.rejects(
    () => signer.broadcast([['transfer', { from: 'hathor', to: 'attacker', amount: '5000.000 MELEK' }]]),
    (e) => e.status === 403 && /\[5,15\] MELEK band/.test(e.reason),
  );
});

test('fromEnv: unset → null (callers stay read-only); set → working client', async () => {
  assert.equal(fromEnv({}), null);
  const mock = createMockSigner({ tokens: TOKENS });
  const signer = fromEnv(
    { MELEK_SIGNER_URL: 'http://mock', MELEK_SIGNER_TOKEN: 'tok-posting' },
    { fetch: mock.fetch },
  );
  assert.ok(signer);
  const r = await signer.broadcast([['custom_json', { id: 'test' }]]);
  assert.equal(r.ok, true);
});

test('multi-op request: every op must be in scope', async () => {
  const mock = createMockSigner({ tokens: TOKENS });
  const signer = createSignerClient({ url: 'http://mock', token: 'tok-posting', fetch: mock.fetch });
  await assert.rejects(
    () => signer.broadcast([
      ['comment', { author: 'hathor', body: 'ok' }],
      ['transfer', { from: 'hathor', to: 'x', amount: '10.000 MELEK' }],
    ]),
    (e) => e.status === 403,
  );
});
