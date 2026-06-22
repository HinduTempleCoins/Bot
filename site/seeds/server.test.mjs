// server.test.mjs — Seeds wallet page. OFFLINE. Catalog always renders; balances filter via injected fetch.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, __setFetch } from './server.mjs';

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}
const req = (path) => ({ url: path });
const j = (o) => JSON.parse(o.body);

test('GET / renders the wallet-gated Seeds NFT collection', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /<b>Seeds<\/b>/);
  assert.match(o.body, /Alpha/);
  assert.match(o.body, /Connect Wallet/);            // wallet-gated
  assert.match(o.body, /NFT/);                        // NFT framing
  assert.match(o.body, /MELEK-Engine/);
  assert.match(o.body, /VANKUSH/);                    // a seed token-id from the collection
  assert.match(o.body, /Owned/);                      // owned-count affordance
});

test('/api/seeds returns only the seed NFTs you own (injected fetch)', async () => {
  __setFetch(async () => ({ ok: true, json: async () => ({ nfts: [
    { symbol: 'MELEK', balance: '100' },
    { symbol: 'VANKUSH', balance: '7' },
    { symbol: 'PUNICGOLD', balance: '0' },            // owned 0 → excluded
    { symbol: 'KULA', balance: '5' },
  ] }) }));
  const { res, o } = cap(); await handler(req('/api/seeds?account=@Tester'), res);
  assert.equal(o.code, 200);
  const d = j(o);
  assert.equal(d.ok, true);
  assert.equal(d.account, 'tester');                  // normalized
  assert.ok(d.collection);
  assert.equal(d.seeds.length, 1);                    // only the owned seed survived
  assert.equal(d.seeds[0].symbol, 'VANKUSH');
  assert.equal(d.seeds[0].owned, '7');
  __setFetch(null);
});

test('/api/seeds with no account soft-returns; /api/catalog lists seeds; /health + 404', async () => {
  let { res, o } = cap(); await handler(req('/api/seeds'), res);
  assert.equal(j(o).ok, false); assert.deepEqual(j(o).seeds, []);
  ({ res, o } = cap()); await handler(req('/api/catalog'), res);
  assert.equal(j(o).ok, true); assert.ok(j(o).seeds.length >= 10);
  ({ res, o } = cap()); await handler(req('/health'), res);
  assert.equal(o.code, 200); assert.equal(j(o).ok, true);
  ({ res, o } = cap()); await handler(req('/nope'), res);
  assert.equal(o.code, 404);
});
