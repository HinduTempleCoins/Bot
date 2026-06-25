// melek-signer-login.test.mjs — Pentecaust "Login with MELEK" verifier. Offline, injected signer fetch.
import { test } from 'node:test';
import assert from 'node:assert';
import { makeMelekSignerVerify, installMelekSignerLogin } from './melek-signer-login.mjs';

test('verified login: signer returns a code → returns the account', async () => {
  let captured;
  const fetch = async (url, opts) => { captured = { url, body: JSON.parse(opts.body) }; return { json: async () => ({ code: 'abc123' }) }; };
  const verify = makeMelekSignerVerify({ fetch, signerUrl: 'http://signer', clientId: 'pentecaust' });
  const acct = await verify({}, { account: 'Walker1', password: 'walkmove2026' });
  assert.strictEqual(acct, 'walker1');                       // lowercased certified account
  assert.match(captured.url, /\/oauth2\/authorize$/);
  assert.strictEqual(captured.body.account, 'walker1');
  assert.strictEqual(captured.body.client_id, 'pentecaust');
});

test('wrong password: signer returns an error → null (no login)', async () => {
  const fetch = async () => ({ json: async () => ({ error: 'identity not verified' }) });
  const verify = makeMelekSignerVerify({ fetch, signerUrl: 'http://signer' });
  assert.strictEqual(await verify({}, { account: 'walker1', password: 'wrong' }), null);
});

test('missing creds and signer-unreachable both fail closed (null, no throw)', async () => {
  const verify = makeMelekSignerVerify({ fetch: async () => { throw new Error('down'); }, signerUrl: 'http://signer' });
  assert.strictEqual(await verify({}, {}), null);
  assert.strictEqual(await verify({}, { account: 'x', password: 'y' }), null); // fetch throws → null
});

test('installMelekSignerLogin registers the method on the auth module', () => {
  const methods = new Map();
  const auth = { registerMethod: (n, fn) => { methods.set(n, fn); return true; } };
  assert.strictEqual(installMelekSignerLogin(auth, { fetch: async () => ({ json: async () => ({}) }) }), true);
  assert.ok(methods.has('melek-signer'));
  assert.strictEqual(installMelekSignerLogin(null), false);
});
