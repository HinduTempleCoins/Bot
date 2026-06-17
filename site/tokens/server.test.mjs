// server.test.mjs — offline tests for the tokens portal handler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, esc, __setFetch } from './server.mjs';

function mockRes() {
  return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; } };
}
const get = async (url) => { const res = mockRes(); await handler({ url, method: 'GET' }, res); return res; };

test('esc neutralizes html', () => {
  assert.equal(esc('<script>"x"'), '&lt;script&gt;&quot;x&quot;');
});

test('/ serves the tokens list page', async () => {
  const r = await get('/');
  assert.equal(r.code, 200);
  assert.match(r.body, /MELEK Tokens/);
  assert.match(r.body, /All tokens/);
  assert.match(r.body, /Alpha/); // alpha badge
});

test('/create serves the turnkey token-launch form', async () => {
  const r = await get('/create');
  assert.equal(r.code, 200);
  assert.match(r.body, /Create a Token/);
  assert.match(r.body, /eth_sendTransaction/); // hands the descriptor to the wallet
  assert.match(r.body, /0x350d4d65/); // createToken selector embedded for the client encoder
  assert.match(r.body, />Create</); // nav tab present
});

test('/wallet has holdings + per-token toggle', async () => {
  const r = await get('/wallet');
  assert.equal(r.code, 200);
  assert.match(r.body, /Your holdings/);
  assert.match(r.body, /toggle it off/);
  assert.match(r.body, /melek_tokens_off/); // localStorage pref key
});

test('/earnings has the per-post earnings UI', async () => {
  const r = await get('/earnings');
  assert.equal(r.code, 200);
  assert.match(r.body, /all the SCOT tokens you'll earn|will this post earn/i);
  assert.match(r.body, /\/api\/earnings/);
});

test('nav links to the multi-chain automation portal', async () => {
  const r = await get('/');
  assert.match(r.body, /Steem.Blurt.Hive.MELEK/);
  assert.match(r.body, /auto\.alpha\.melek\.salon/);
});

test('/token/:SYMBOL links to the Nitrous tribe page', async () => {
  const r = await get('/token/ALPHA');
  assert.equal(r.code, 200);
  assert.match(r.body, /ALPHA/);
  assert.match(r.body, /nitrous\/ALPHA/);
});

test('/api/earnings projects across tribes (injected engine)', async () => {
  __setFetch(async (url) => {
    if (url.includes('/rpc')) return { ok: true, json: async () => ({ result: { category: 'alphatribe', json_metadata: JSON.stringify({ tags: ['alphatribe'] }) } }) };
    if (url.includes('/contracts/tribes')) return { ok: true, json: async () => ({ rules: [{ symbol: 'ALPHA', tag: 'alphatribe', enabled: true, emission: 1000, authorPct: 60, curve: 'linear' }] }) };
    if (url.includes('/contracts/payouts')) return { ok: true, json: async () => ({ posts: [{ author: 'a', permlink: 'b', weight: 250 }, { author: 'x', permlink: 'y', weight: 750 }] }) };
    return { ok: false, json: async () => ({}) };
  });
  const res = mockRes();
  await handler({ url: '/api/earnings?author=a&permlink=b', method: 'GET' }, res);
  __setFetch();
  assert.equal(res.code, 200);
  const d = JSON.parse(res.body);
  assert.equal(d.totalTokens, 1);
  assert.equal(d.earnings[0].symbol, 'ALPHA');
  assert.equal(d.earnings[0].total, 250);
  assert.equal(d.earnings[0].author, 150);
});

test('/vote serves the ALTI Vote Shop page', async () => {
  const r = await get('/vote');
  assert.equal(r.code, 200);
  assert.match(r.body, /Buy a MELEK upvote with ALTI/);
  assert.match(r.body, /Vote Shop/);      // nav tab present
  assert.match(r.body, /Quote the vote/);
});

test('/api/vote-quote prices a vote (mana param avoids the chain call)', async () => {
  const res = mockRes();
  await handler({ url: '/api/vote-quote?author=@bob&permlink=my-post&alti=50&mana=10000', method: 'GET' }, res);
  assert.equal(res.code, 200);
  const d = JSON.parse(res.body);
  assert.equal(d.ok, true);
  assert.equal(d.quote.weightPct, 50);     // 50 ALTI at default 100/full = 50%
  assert.equal(d.vote.author, 'bob');      // @ stripped
  assert.equal(d.vote.permlink, 'my-post');
  assert.equal(d.vote.weight, 5000);
});

test('/api/vote-quote soft-fails below minimum', async () => {
  const res = mockRes();
  await handler({ url: '/api/vote-quote?author=bob&permlink=p&alti=0&mana=10000', method: 'GET' }, res);
  const d = JSON.parse(res.body);
  assert.equal(d.ok, false);
  assert.equal(d.reason, 'below-minimum');
});

test('/api/vote-quote reads voter mana from the chain (clamps when nearly drained)', async () => {
  // voting_power 1100 (11%) → only 100 bps above the 10% floor → ~half a full vote's worth of mana
  __setFetch(async () => ({ ok: true, json: async () => ({ result: [{ voting_power: 1100 }] }) }));
  const res = mockRes();
  await handler({ url: '/api/vote-quote?author=bob&permlink=p&alti=100', method: 'GET' }, res);
  __setFetch();
  const d = JSON.parse(res.body);
  assert.equal(d.ok, true);
  assert.equal(d.quote.clampedByMana, true); // 100 ALTI wants 100% but mana only supports 50%
  assert.equal(d.quote.weightPct, 50);
});

test('/faucet serves Hathor\'s daily-claim page', async () => {
  const r = await get('/faucet');
  assert.equal(r.code, 200);
  assert.match(r.body, /Hathor's faucet/);
  assert.match(r.body, /once a day/);
  assert.match(r.body, />Faucet</); // nav tab
});

test('/api/faucet-claim: a fresh account gets the base drip, then is rate-limited', async () => {
  const acct = 'freshclaimer';
  const a = await get('/api/faucet-claim?account=' + acct);
  const da = JSON.parse(a.body);
  assert.equal(da.ok, true);
  assert.equal(da.amount, 1);          // base drip for a neutral new account
  assert.equal(da.token, 'APIS');
  // immediate second claim → cooldown (the in-memory ledger recorded the first)
  const b = await get('/api/faucet-claim?account=' + acct);
  const db = JSON.parse(b.body);
  assert.equal(db.ok, false);
  assert.equal(db.reason, 'cooldown');
  assert.ok(db.nextClaimAt > 0);
});

test('/api/faucet-claim soft-fails without an account', async () => {
  const r = await get('/api/faucet-claim?account=');
  const d = JSON.parse(r.body);
  assert.equal(d.ok, false);
  assert.equal(d.reason, 'no-account');
});

test('/standing serves the Crypt-ology viewer', async () => {
  const r = await get('/standing');
  assert.equal(r.code, 200);
  assert.match(r.body, /How Hathor sees you/);
  assert.match(r.body, />How We Stand</); // nav tab
});

test('/api/standing returns a disposition (new account = welcoming, 0 interactions)', async () => {
  const r = await get('/api/standing?account=@stranger');
  const d = JSON.parse(r.body);
  assert.equal(d.ok, true);
  assert.equal(d.stance, 'welcoming');
  assert.equal(d.totalInteractions, 0);
  assert.ok(d.coordinates);
});

test('/api/standing soft-fails without an account', async () => {
  const d = JSON.parse((await get('/api/standing?account=')).body);
  assert.equal(d.ok, false);
  assert.equal(d.reason, 'no-account');
});

test('unknown route soft-404s, never throws', async () => {
  const r = await get('/nope');
  assert.equal(r.code, 404);
  assert.match(r.body, /Not found/);
});
