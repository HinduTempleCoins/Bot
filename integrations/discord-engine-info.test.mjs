import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEngine, engineInfo } from './discord-engine-info.mjs';

// a fake fetch routing engine API paths to fixtures
function fakeFetch(routes) {
  return async (url) => {
    for (const [frag, body] of Object.entries(routes)) {
      if (url.includes(frag)) return { ok: true, json: async () => body };
    }
    return { ok: false, json: async () => null };
  };
}

test('parseEngine routes verbs', () => {
  assert.equal(parseEngine('!engine').kind, 'overview');
  assert.equal(parseEngine('!token MANNA').symbol, 'MANNA');
  assert.deepEqual({ ...parseEngine('!engine balance @alice MANNA') }, { kind: 'balance', account: 'alice', symbol: 'MANNA' });
  assert.equal(parseEngine('!payouts SCROLL').kind, 'payouts');
  assert.equal(parseEngine('hello'), null);
});

test('overview lists tokens', async () => {
  const f = fakeFetch({ '/api/tokens': [{ symbol: 'MANNA', supply: '1000', issuer: 'hathor' }, { symbol: 'SCROLL', supply: '500', issuer: 'initminer' }] });
  const out = await engineInfo('!engine', { fetch: f });
  assert.match(out, /MELEK-Engine/);
  assert.match(out, /MANNA/);
  assert.match(out, /SCROLL/);
});

test('token detail shows supply + issuer + tribe', async () => {
  const f = fakeFetch({
    '/api/tokens?symbol=SCROLL': [{ symbol: 'SCROLL', supply: '500', maxSupply: '1000000', issuer: 'initminer', precision: 3 }],
    '/api/tribes': [{ symbol: 'SCROLL', tag: 'scroll', emissionPerWindow: '100', authorBps: 5000 }],
  });
  const out = await engineInfo('!token SCROLL', { fetch: f });
  assert.match(out, /SCROLL/);
  assert.match(out, /supply: 500/);
  assert.match(out, /issuer: @initminer/);
  assert.match(out, /SCOT tribe/);
  assert.match(out, /scroll/);
});

test('unknown token replies cleanly', async () => {
  const f = fakeFetch({ '/api/tokens?symbol=NOPE': [] });
  assert.match(await engineInfo('!token NOPE', { fetch: f }), /No MELEK-Engine token/);
});

test('balance lists holdings', async () => {
  const f = fakeFetch({ '/api/balances': [{ symbol: 'MANNA', balance: '42', stake: '10' }] });
  const out = await engineInfo('!engine balance @alice', { fetch: f });
  assert.match(out, /@alice/);
  assert.match(out, /MANNA: 42/);
  assert.match(out, /10 staked/);
});

test('payouts lists recent rewards', async () => {
  const f = fakeFetch({ '/api/payouts': [{ author: 'vrhathor', permlink: 'p1', authorAmount: '50', curatorAmount: '50' }] });
  const out = await engineInfo('!payouts SCROLL', { fetch: f });
  assert.match(out, /vrhathor\/p1/);
  assert.match(out, /author 50/);
});

test('soft-fails to a friendly string on a dead API', async () => {
  const dead = async () => { throw new Error('ECONNREFUSED'); };
  assert.match(await engineInfo('!engine', { fetch: dead }), /no tokens found|MELEK-Engine/);
  assert.equal(await engineInfo('not a command', { fetch: dead }), '');
});
