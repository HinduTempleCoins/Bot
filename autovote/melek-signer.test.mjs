// melek-signer.test.mjs — MELEK-Signer login + broadcast client. OFFLINE, injected fetch. Never logs a key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { login, voteViaMelekSigner, broadcast, configured, msConfig } from './melek-signer.js';

test('configured() is true by default — our own signer has a default URL', () => {
  assert.equal(configured(), true);
  assert.match(msConfig().url, /^http/);
  assert.equal(msConfig().clientId, 'autovote');
});

test('login: authorize → exchange code → returns {account, token}', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) });
    if (url.endsWith('/oauth2/authorize')) return { ok: true, json: async () => ({ code: 'CODE1' }) };
    if (url.endsWith('/oauth2/token')) return { ok: true, json: async () => ({ access_token: 'TOK1', account: 'walker1' }) };
    throw new Error('unexpected ' + url);
  };
  const r = await login({ account: 'Walker1', password: 'pw12345' }, fetchImpl);
  assert.deepEqual(r, { account: 'walker1', token: 'TOK1' });   // account lowercased
  assert.match(calls[0].url, /\/oauth2\/authorize$/);
  assert.equal(calls[0].body.account, 'walker1');
  assert.equal(calls[0].body.client_id, 'autovote');
  assert.equal(calls[1].body.code, 'CODE1');
});

test('login: bad password (authorize 401, no code) → throws the signer error', async () => {
  const fetchImpl = async () => ({ ok: false, json: async () => ({ error: 'identity not verified' }) });
  await assert.rejects(() => login({ account: 'x', password: 'bad' }, fetchImpl), /identity not verified/);
});

test('login: missing creds → throws WITHOUT calling the signer', async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return { ok: true, json: async () => ({}) }; };
  await assert.rejects(() => login({ account: '', password: '' }, fetchImpl));
  assert.equal(called, false);
});

test('voteViaMelekSigner: POSTs a vote op to /v1/broadcast with the Bearer token', async () => {
  let captured;
  const fetchImpl = async (url, opts) => {
    captured = { url, headers: opts.headers, body: JSON.parse(opts.body) };
    return { ok: true, json: async () => ({ ok: true, result: { id: 'tx1' } }) };
  };
  const r = await voteViaMelekSigner('TOK1', { voter: 'walker1', author: 'a', permlink: 'p', weight: 5000 }, fetchImpl);
  assert.deepEqual(r, { id: 'tx1' });
  assert.match(captured.url, /\/v1\/broadcast$/);
  assert.equal(captured.headers.Authorization, 'Bearer TOK1');
  assert.deepEqual(captured.body.ops[0], ['vote', { voter: 'walker1', author: 'a', permlink: 'p', weight: 5000 }]);
});

test('broadcast: signer returns {ok:false} → throws (never silently succeeds)', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ ok: false, error: 'policy rejected' }) });
  await assert.rejects(() => broadcast('TOK1', [['vote', {}]], fetchImpl), /policy rejected/);
});

// The login path is account-agnostic: it works for the REAL MELEK testnet bot society
// (envuser1–6 + angelicaibot — all confirmed on-chain) exactly as it does for any account.
// A mock signer issues a token ONLY for the right (account,password) pair — the same thing the
// live signer does by checking the password against each account's on-chain key.
test('the whole bot society logs in via MELEK-Signer; wrong password is rejected per-bot', async () => {
  const ROSTER = {
    envuser1: 'sol-pw-1', envuser2: 'mina-pw-2', envuser3: 'vero-pw-3',
    envuser4: 'dax-pw-4', envuser5: 'pip-pw-5', envuser6: 'nova-pw-6',
    angelicaibot: 'angel-pw-7',
  };
  const signerFor = (acct, pw) => async (url, opts) => {
    const b = JSON.parse(opts.body);
    if (url.endsWith('/oauth2/authorize')) {
      return (b.account === acct && b.password === pw)
        ? { ok: true, json: async () => ({ code: `C-${acct}` }) }
        : { ok: false, json: async () => ({ error: 'identity not verified' }) };
    }
    return { ok: true, json: async () => ({ access_token: `T-${acct}`, account: acct }) };
  };
  for (const [acct, pw] of Object.entries(ROSTER)) {
    const r = await login({ account: acct, password: pw }, signerFor(acct, pw));
    assert.deepEqual(r, { account: acct, token: `T-${acct}` }, `${acct} should log in`);
    await assert.rejects(() => login({ account: acct, password: 'WRONG' }, signerFor(acct, pw)),
      /identity not verified/, `${acct} with a wrong password must be rejected`);
  }
});
