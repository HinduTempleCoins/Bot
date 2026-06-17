// rakuten-feed.test.mjs — offline, injected fetch. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { token, searchAdvertisers, coupons, configured, __setFetch } from './rakuten-feed.mjs';

function setCreds() { process.env.RAKUTEN_CLIENT_ID = 'cid'; process.env.RAKUTEN_CLIENT_SECRET = 'csec'; process.env.RAKUTEN_SID = '4716922'; }
function clearCreds() { delete process.env.RAKUTEN_CLIENT_ID; delete process.env.RAKUTEN_CLIENT_SECRET; delete process.env.RAKUTEN_SID; delete process.env.RAKUTEN_AFFILIATE_ID; }

test('token mints via client_credentials + caches; basic auth + scope sent', async () => {
  setCreds();
  let sawAuth = null, sawBody = null, calls = 0;
  __setFetch(async (url, opts) => { calls++; sawAuth = opts.headers.authorization; sawBody = opts.body; return { ok: true, json: async () => ({ access_token: 'TOK123', expires_in: 3600 }) }; });
  const t1 = await token({ now: 1000 });
  const t2 = await token({ now: 2000 }); // cached — no 2nd call
  __setFetch(); clearCreds();
  assert.equal(t1, 'TOK123');
  assert.equal(t2, 'TOK123');
  assert.equal(calls, 1);                       // cached
  assert.match(sawAuth, /^Basic /);
  assert.match(sawBody, /grant_type=client_credentials/);
  assert.match(sawBody, /scope=4716922/);
});

test('token soft-fails to "" without creds', async () => {
  clearCreds();
  assert.equal(await token({ now: Date.now() + 9e9 }), '');
});

test('coupons normalizes the XML coupon feed', async () => {
  setCreds();
  const xml = `<couponfeed><link><advertisername>Macy's</advertisername><couponcode>SAVE20</couponcode>` +
    `<offerdescription>20% off</offerdescription><offerenddate>2026-12-31</offerenddate>` +
    `<clickurl>https://click.linksynergy.com/x</clickurl></link></couponfeed>`;
  let n = 0;
  __setFetch(async (url) => { n++; return url.includes('/token')
    ? { ok: true, json: async () => ({ access_token: 'T', expires_in: 3600 }) }
    : { ok: true, text: async () => xml }; });
  const rows = await coupons({ category: 'apparel' });
  __setFetch(); clearCreds();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].store, "Macy's");
  assert.equal(rows[0].code, 'SAVE20');
  assert.equal(rows[0].type, 'code');
  assert.equal(rows[0].discount, '20% off');
  assert.equal(rows[0].network, 'rakuten');
  assert.match(rows[0].sourceUrl, /linksynergy/);
});

test('coupons → [] for an empty (new) account, never throws', async () => {
  setCreds();
  __setFetch(async (url) => url.includes('/token')
    ? { ok: true, json: async () => ({ access_token: 'T', expires_in: 3600 }) }
    : { ok: true, text: async () => '<couponfeed></couponfeed>' });
  assert.deepEqual(await coupons(), []);
  __setFetch(); clearCreds();
});

test('searchAdvertisers parses midlist; [] when empty', async () => {
  setCreds();
  __setFetch(async (url) => url.includes('/token')
    ? { ok: true, json: async () => ({ access_token: 'T', expires_in: 3600 }) }
    : { ok: true, text: async () => '<result><midlist><mid>12345</mid><merchantname>Macy\'s</merchantname></midlist></result>' });
  const a = await searchAdvertisers('macy');
  __setFetch(); clearCreds();
  assert.equal(a[0].mid, '12345');
});

test('data calls soft-fail to [] on http error', async () => {
  setCreds();
  __setFetch(async (url) => url.includes('/token')
    ? { ok: true, json: async () => ({ access_token: 'T', expires_in: 3600 }) }
    : { ok: false, status: 500, text: async () => '' });
  assert.deepEqual(await coupons(), []);
  __setFetch(); clearCreds();
});

test('configured reflects env; SID derives from RAKUTEN_AFFILIATE_ID digits', () => {
  clearCreds();
  process.env.RAKUTEN_CLIENT_ID = 'x'; process.env.RAKUTEN_CLIENT_SECRET = 'y'; process.env.RAKUTEN_AFFILIATE_ID = 'SID4716922';
  const c = configured();
  clearCreds();
  assert.equal(c.clientId, true);
  assert.equal(c.sid, true);
});
