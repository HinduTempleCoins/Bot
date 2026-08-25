// tribulum.test.mjs — offline tests for the Tribulum Farm HTTP surface. node --test, no network:
// we drive the exported handler(req,res) with fake req/res objects. Deterministic clock via ?now=.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, farmPage, esc } from './server.mjs';

const DAY = 86400 * 1000;
const T0 = Date.UTC(2026, 0, 1);

// tiny fake req/res that capture the response for assertions.
function mockRes() {
  return {
    statusCode: null, headers: null, body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; return this; },
    end(chunk) { if (chunk != null) this.body += chunk; this.ended = true; return this; },
  };
}
async function call(path) {
  const res = mockRes();
  await handler({ url: path, method: 'GET' }, res);
  return res;
}

test('home / returns 200 with the plot grid', async () => {
  const res = await call('/?account=alice');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /farm-grid/);
  assert.match(res.body, /Tribulum Farm/);
});

test('home shows the Alpha badge and in-game-only note', async () => {
  const res = await call('/');
  assert.match(res.body, /class=alpha>Alpha</);
  assert.match(res.body, /no fiat/i);
});

test('/health is a plain-text ok', async () => {
  const res = await call('/health');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

test('/api/farm returns JSON for an account (offline)', async () => {
  const res = await call('/api/farm?account=jsontest');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /application\/json/);
  const data = JSON.parse(res.body);
  assert.equal(data.account, 'jsontest');
  assert.ok(Array.isArray(data.plots));
  assert.equal(data.currency, 'GRAIN');
  assert.equal(data.balance, 0);
});

test('plant → grow → harvest → sell full loop through the routes', async () => {
  const acct = 'looptest';
  // plant on plot 0 at T0
  const planted = await call(`/plant?account=${acct}&plot=0&seed=auto-sour&now=${T0}`);
  assert.equal(planted.statusCode, 302);

  // farm now shows the crop growing
  const mid = await call(`/api/farm?account=${acct}&now=${T0 + DAY / 2}`);
  const midData = JSON.parse(mid.body);
  assert.equal(midData.plots[0].empty, undefined);
  assert.equal(midData.plots[0].ripe, false);

  // ripe at +1 day
  const ripe = await call(`/api/farm?account=${acct}&now=${T0 + DAY}`);
  assert.equal(JSON.parse(ripe.body).plots[0].ripe, true);

  // harvest it
  await call(`/harvest?account=${acct}&plot=0&now=${T0 + DAY}`);
  const afterHarvest = JSON.parse((await call(`/api/farm?account=${acct}`)).body);
  assert.ok(afterHarvest.inventory.length > 0);       // crop is now in inventory
  assert.equal(afterHarvest.plots[0].empty, true);     // plot cleared

  // sell the harvest → Grain balance rises
  await call(`/sell?account=${acct}`);
  const afterSell = JSON.parse((await call(`/api/farm?account=${acct}`)).body);
  assert.ok(afterSell.balance > 0);
  assert.equal(afterSell.inventory.length, 0);         // inventory cleared into Grain
});

test('harvest before ripe does not add to inventory (soft reject)', async () => {
  const acct = 'earlytest';
  await call(`/plant?account=${acct}&plot=0&seed=auto-sour&now=${T0}`);
  await call(`/harvest?account=${acct}&plot=0&now=${T0 + DAY / 2}`); // too early
  const data = JSON.parse((await call(`/api/farm?account=${acct}`)).body);
  assert.equal(data.inventory.length, 0);
  assert.equal(data.plots[0].empty, undefined);        // still growing, not cleared
});

test('planting on an occupied plot is a no-op (soft)', async () => {
  const acct = 'occ';
  await call(`/plant?account=${acct}&plot=0&seed=auto-sour&now=${T0}`);
  await call(`/plant?account=${acct}&plot=0&seed=daily-diesel&now=${T0}`); // occupied
  const data = JSON.parse((await call(`/api/farm?account=${acct}`)).body);
  assert.equal(data.plots[0].seedId, 'auto-sour');     // original crop unchanged
});

test('accounts are isolated', async () => {
  await call(`/plant?account=iso-a&plot=0&seed=auto-sour&now=${T0}`);
  const b = JSON.parse((await call('/api/farm?account=iso-b')).body);
  assert.ok(b.plots.every((p) => p.empty));
});

test('robots.txt, sitemap.xml, sitemap-index.xml, llms.txt serve', async () => {
  const robots = await call('/robots.txt');
  assert.equal(robots.statusCode, 200);
  assert.match(robots.body, /Sitemap:/i);
  const sitemap = await call('/sitemap.xml');
  assert.equal(sitemap.statusCode, 200);
  assert.match(sitemap.headers['content-type'], /xml/);
  const sindex = await call('/sitemap-index.xml');
  assert.equal(sindex.statusCode, 200);
  const llms = await call('/llms.txt');
  assert.equal(llms.statusCode, 200);
  assert.match(llms.body, /Tribulum/);
});

test('unknown path redirects home', async () => {
  const res = await call('/nope');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

test('farmPage escapes the account name', () => {
  const html = farmPage('<script>alert(1)</script>', T0);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(html, /&lt;script&gt;/);
});

test('esc escapes html metacharacters', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('handler never throws on garbage requests', async () => {
  await assert.doesNotReject(() => call('/plant'));                       // no params
  await assert.doesNotReject(() => call('/harvest?account=x&plot=abc'));  // bad plot
  await assert.doesNotReject(() => call('/sell'));                        // nothing to sell
  await assert.doesNotReject(() => call('/api/farm?now=notanumber'));
});
