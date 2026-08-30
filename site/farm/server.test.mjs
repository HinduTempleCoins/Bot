// server.test.mjs — KULA Token Farm page. OFFLINE. Server-renders from kulaswap/kula-farm.mjs; deterministic.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, __setFetch } from './server.mjs';

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}
const req = (path) => ({ url: path });
const j = (o) => JSON.parse(o.body);

test('GET / renders the KULA Farm page with the emission split, a pool APR + the ve-boost', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.equal(o.code, 200); assert.match(o.type, /text\/html/);
  assert.match(o.body, /KULA<\/b> Farm/);
  assert.match(o.body, /Alpha/);
  assert.match(o.body, /Emission split/);
  assert.match(o.body, /APR/);
  assert.match(o.body, /veKULA/);
  assert.match(o.body, /seeds\.soapbox\.community/);   // points back to the grow game
});

test('/api/farm returns the model: surfaces, pools, boosts, lottery', async () => {
  const { res, o } = cap(); await handler(req('/api/farm'), res);
  assert.equal(o.code, 200);
  const m = j(o);
  assert.equal(m.ok, true);
  assert.ok(Array.isArray(m.surfaces) && m.surfaces.length >= 6);
  assert.ok(m.surfaces.some((s) => s.key === 'lp' && s.bps > 0));
  assert.ok(Array.isArray(m.pools) && m.pools.length >= 1);
  assert.ok(Array.isArray(m.boosts) && m.boosts.every((b) => b.boost >= 1));
  assert.ok(m.lotto && typeof m.lotto.potUsd === 'number');
});

test('page renders the wMELEK→APIS-Hash staking panel with the PERMANENT warning', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /Permanently stake wMELEK/);
  assert.match(o.body, /APIS-Hash/);
  assert.match(o.body, /no unstake/);          // permanence warned
  assert.match(o.body, /Forever-Lock/);
});

test('/api/apishash proxies the engine workerbee views (injected fetch)', async () => {
  __setFetch(async (u) => {
    const body = u.includes('/balances') ? [{ symbol: 'WMELEK', balance: '120' }]
      : u.includes('/apishash') ? { apisHash: '120' }
      : u.includes('/pending') ? { pending: '3.5' }
      : { emissionPerDay: 1000 };
    return { ok: true, json: async () => body };
  });
  const { res, o } = cap(); await handler(req('/api/apishash?account=@Bob'), res);
  const d = j(o);
  assert.equal(d.ok, true);
  assert.equal(d.account, 'bob');
  assert.equal(d.wmelek, '120');
  assert.equal(d.apisHash, '120');
  assert.equal(d.pending, '3.5');
  assert.equal(d.emissionPerDay, 1000);
  __setFetch(null);
});

test('/api/stake-op builds a foreverLock op; validates amount', async () => {
  let { res, o } = cap(); await handler(req('/api/stake-op?account=bob&amount=50'), res);
  let d = j(o);
  assert.equal(d.ok, true);
  assert.equal(d.op[0], 'custom_json');
  const env = JSON.parse(d.op[1].json);
  assert.equal(env.contractName, 'workerbee');
  assert.equal(env.contractAction, 'foreverLock');
  assert.equal(env.contractPayload.amount, '50');
  assert.match(d.summary, /PERMANENT/);
  ({ res, o } = cap()); await handler(req('/api/stake-op?account=bob&amount=0'), res);
  assert.equal(j(o).ok, false);
});

test('GET / renders the guided hub: progress meter + the four tiles', async () => {
  const { res, o } = cap(); await handler(req('/'), res);
  assert.match(o.body, /Your farm path/);
  assert.match(o.body, /class=tiles/);
  assert.match(o.body, /Forever-Lock/);        // apis tile
  assert.match(o.body, /Burn-Mine/);           // burnmine tile
  assert.match(o.body, /Earn MWALI/);          // liquidity tile
  assert.match(o.body, /Coming soon/);         // gated tiles until deployed
  assert.match(o.body, /window\.__FARM__/);    // client config injected
});

test('/api/hub returns four tiles with steps + gated flags + progress', async () => {
  const { res, o } = cap(); await handler(req('/api/hub'), res);
  const d = j(o);
  assert.equal(d.ok, true);
  assert.equal(d.tiles.length, 4);
  assert.ok(d.tiles.every((t) => t.what && t.why && Array.isArray(t.steps)));
  assert.ok(d.tiles.find((t) => t.id === 'liquidity').gated);   // gauge not deployed → gated
  assert.ok(d.progress && d.progress.total === 4);
});

test('/api/prana returns public EVM config (MWALI address) with gauge/burnMine gated until deployed', async () => {
  const { res, o } = cap(); await handler(req('/api/prana'), res);
  const d = j(o);
  assert.equal(d.ok, true);
  assert.equal(d.chainId, 712217);
  assert.match(d.mwali, /^0x[0-9a-fA-F]{40}$/);   // MWALI = the PoL/liquidity reward, live on mainnet
  assert.equal(d.gaugeLive, false);                // staged, not deployed
  assert.equal(d.burnMineLive, false);
  assert.ok(!/PRANA_DEPLOYER|key|WIF/i.test(o.body)); // never leaks key material
});

test('/health ok; unknown path 404', async () => {
  let { res, o } = cap(); await handler(req('/health'), res);
  assert.equal(o.code, 200); assert.equal(j(o).ok, true);
  ({ res, o } = cap()); await handler(req('/nope'), res);
  assert.equal(o.code, 404);
});
