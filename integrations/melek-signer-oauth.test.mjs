// melek-signer-oauth.test.mjs — shared redirect "Login with MELEK" flow. OFFLINE, injected fetch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeUrl, exchangeCode, signerUrl } from './melek-signer-oauth.mjs';

test('authorizeUrl builds the hosted-login redirect with client_id, scope, redirect_uri, state', () => {
  const u = new URL(authorizeUrl({
    clientId: 'autovote', scope: ['vote', 'comment'],
    redirectUri: 'https://auto.alpha.melek.salon/melek-signer/callback', state: 'nonce123',
    url: 'https://signer.melek.salon',
  }));
  assert.equal(u.origin + u.pathname, 'https://signer.melek.salon/oauth2/authorize');
  assert.equal(u.searchParams.get('client_id'), 'autovote');
  assert.equal(u.searchParams.get('scope'), 'vote comment');
  assert.equal(u.searchParams.get('redirect_uri'), 'https://auto.alpha.melek.salon/melek-signer/callback');
  assert.equal(u.searchParams.get('state'), 'nonce123');
});

test('authorizeUrl requires a clientId', () => {
  assert.throws(() => authorizeUrl({ scope: 'vote' }), /clientId required/);
});

test('exchangeCode posts the code and returns {account, token, scopes}', async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { json: async () => ({ access_token: 'TOK', account: 'Walker1', scope: 'vote comment' }) };
  };
  const r = await exchangeCode({ clientId: 'autovote', code: 'C1', url: 'https://signer.melek.salon' }, fetchImpl);
  assert.deepEqual(r, { account: 'walker1', token: 'TOK', scopes: ['vote', 'comment'] });
  assert.match(captured.url, /\/oauth2\/token$/);
  assert.equal(captured.body.code, 'C1');
  assert.equal(captured.body.client_id, 'autovote');
});

test('exchangeCode soft-fails to null (no token, bad json, fetch throw, missing args)', async () => {
  assert.equal(await exchangeCode({ clientId: 'a', code: 'c' }, async () => ({ json: async () => ({}) })), null);
  assert.equal(await exchangeCode({ clientId: 'a', code: 'c' }, async () => ({ json: async () => { throw new Error('x'); } })), null);
  assert.equal(await exchangeCode({ clientId: 'a', code: 'c' }, async () => { throw new Error('down'); }), null);
  assert.equal(await exchangeCode({ clientId: 'a' }, async () => ({ json: async () => ({ access_token: 'T' }) })), null); // no code
});

test('signerUrl defaults to the public signer', () => {
  assert.match(signerUrl(), /^https?:\/\//);
});
