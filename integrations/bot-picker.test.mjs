// bot-picker.test.mjs — offline, no network. Covers the pick-a-bot surface:
//   listStrategies mirrors the registry; simulatePick is dry-run for every strategy id; garbage
//   input soft-fails; and — load-bearing — NOTHING in the output path can carry a signer/WIF/key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listStrategies, simulatePick, handler, esc, SAMPLE_SNAPSHOT } from './bot-picker.mjs';
import { STRATEGIES } from './trade-strategies.mjs';

const IDS = Object.keys(STRATEGIES); // peg-arb, grid, market-make, dca, momentum, nudge, wall

// Tiny fake req/res so we can exercise handler() with no real http server.
function fakeReq({ method = 'GET', url = '/', body = null } = {}) {
  const handlers = {};
  const req = {
    method, url,
    headers: { 'content-type': 'application/json' },
    on(ev, cb) { handlers[ev] = cb; return req; },
  };
  // drive the data/end events on next tick so handler's readJson resolves
  queueMicrotask(() => {
    if (body != null && handlers.data) handlers.data(typeof body === 'string' ? body : JSON.stringify(body));
    if (handlers.end) handlers.end();
  });
  return req;
}
function fakeRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(c, h) { this.code = c; this.headers = h; },
    end(b) { this.body = b || ''; this._done = true; },
    json() { return JSON.parse(this.body || '{}'); },
  };
}

test('listStrategies returns the registry: all 7 ids, label, desc, proven flag', () => {
  const list = listStrategies();
  assert.equal(list.length, IDS.length);
  assert.deepEqual(list.map((s) => s.id).sort(), IDS.slice().sort());
  for (const s of list) {
    assert.equal(typeof s.label, 'string');
    assert.ok(s.label.length > 0);
    assert.equal(typeof s.desc, 'string');
    assert.equal(typeof s.proven, 'boolean');
  }
  // peg-arb is the proven one, matching the registry
  const peg = list.find((s) => s.id === 'peg-arb');
  assert.equal(peg.proven, true);
  assert.equal(STRATEGIES['peg-arb'].proven, true);
});

test('simulatePick returns a dry-run result for every strategy id', () => {
  for (const id of IDS) {
    const sim = simulatePick(id, SAMPLE_SNAPSHOT);
    assert.equal(sim.ok, true, `${id} should be ok`);
    assert.equal(sim.strategyId, id);
    assert.equal(sim.dryRun, true);
    assert.equal(sim.signer, null);
    assert.equal(typeof sim.summary, 'string');
    assert.ok(Array.isArray(sim.orders));
    // every order (if any) is frozen dry-run with a null signer
    for (const o of sim.orders) {
      assert.equal(o.dryRun, true, `${id} order must be dryRun`);
      assert.equal(o.signer, null, `${id} order signer must be null`);
      assert.ok(Object.isFrozen(o), `${id} order must be frozen`);
    }
  }
});

test('peg-arb actually proposes a dry-run BUY on the underpriced sample', () => {
  const sim = simulatePick('peg-arb', SAMPLE_SNAPSHOT);
  assert.equal(sim.ok, true);
  assert.ok(sim.orders.length >= 1, 'sample is HE-underpriced → expect an order');
  assert.equal(sim.orders[0].side, 'buy');
  assert.equal(sim.orders[0].dryRun, true);
  assert.equal(sim.orders[0].signer, null);
});

test('garbage input soft-fails without throwing', () => {
  assert.doesNotThrow(() => simulatePick('not-a-real-bot', SAMPLE_SNAPSHOT));
  const bad = simulatePick('not-a-real-bot', SAMPLE_SNAPSHOT);
  assert.equal(bad.ok, false);
  assert.equal(bad.signer, null);
  assert.deepEqual(bad.orders, []);

  // undefined / null / non-object args
  for (const arg of [undefined, null, 42, '', {}, []]) {
    const sim = simulatePick(arg, undefined, undefined);
    assert.equal(typeof sim, 'object');
    assert.equal(sim.signer, null);
    assert.ok(Array.isArray(sim.orders));
  }
  // a snapshot of pure junk still soft-fails to a hold, never throws
  const junk = simulatePick('grid', { symbol: 123, hePrice: 'xyz', buyBook: 'nope' });
  assert.equal(junk.signer, null);
  assert.ok(Array.isArray(junk.orders));
});

test('NOTHING in the output path can carry a signer / WIF / key', () => {
  // Try to smuggle a key in via every channel: snapshot, params, state.
  // A sentinel that is NOT shaped like a real key (so the repo's key-pattern
  // pre-commit hook doesn't flag it) but still proves nothing leaks: if this
  // string appears anywhere in the output, an input channel leaked through.
  const poison = 'POISON_SENTINEL_must_never_appear_in_output';
  for (const id of IDS) {
    const sim = simulatePick(
      id,
      { ...SAMPLE_SNAPSHOT, signer: 'evil', wif: poison, key: poison },
      {
        params: { signer: 'evil', wif: poison, key: poison },
        state: { ...{ inventoryToken: 100, inventoryHive: 25 }, signer: 'evil', wif: poison },
      },
    );
    const blob = JSON.stringify(sim);
    assert.ok(!blob.includes(poison), `${id}: a WIF leaked into the output`);
    // top-level signer is always null
    assert.equal(sim.signer, null);
    // no order carries a non-null signer or any key-ish field
    for (const o of sim.orders) {
      assert.equal(o.signer, null);
      assert.ok(!('wif' in o));
      assert.ok(!('key' in o));
      assert.notEqual(o.signer, 'evil');
    }
  }
});

test('handler GET /api/bots returns the strategy list as JSON', async () => {
  const res = fakeRes();
  await handler(fakeReq({ method: 'GET', url: '/api/bots' }), res);
  assert.equal(res.code, 200);
  const out = res.json();
  assert.equal(out.ok, true);
  assert.equal(out.bots.length, IDS.length);
});

test('handler POST /api/bots/simulate returns a dry-run sim (no market = sample snapshot)', async () => {
  const res = fakeRes();
  await handler(fakeReq({ method: 'POST', url: '/api/bots/simulate', body: { strategyId: 'peg-arb' } }), res);
  assert.equal(res.code, 200);
  const out = res.json();
  assert.equal(out.ok, true);
  assert.equal(out.dryRun, true);
  assert.equal(out.signer, null);
  for (const o of out.orders) { assert.equal(o.dryRun, true); assert.equal(o.signer, null); }
});

test('handler POST with a bad body soft-fails (200, ok:false, no signer)', async () => {
  const res = fakeRes();
  await handler(fakeReq({ method: 'POST', url: '/api/bots/simulate', body: { nope: 1 } }), res);
  assert.equal(res.code, 200);
  const out = res.json();
  assert.equal(out.ok, false);
  assert.equal(out.signer, null);
});

test('handler uses an INJECTED fetch for live data and soft-fails to the sample when fetch throws', async () => {
  // injected fetch that throws → must NOT throw out of the handler, falls back to sample
  const throwing = async () => { throw new Error('network down'); };
  const res = fakeRes();
  await handler(
    fakeReq({ method: 'POST', url: '/api/bots/simulate', body: { strategyId: 'grid', live: true } }),
    res,
    { fetch: throwing, marketUrl: 'http://example/market' },
  );
  assert.equal(res.code, 200);
  const out = res.json();
  assert.equal(out.ok, true);
  assert.equal(out.signer, null);

  // injected fetch that returns data → merged over the sample, still dry-run
  const good = async () => ({ json: async () => ({ hePrice: 0.02, mid: 0.02, realUsd: 0.20, hiveUsd: 0.30 }) });
  const res2 = fakeRes();
  await handler(
    fakeReq({ method: 'POST', url: '/api/bots/simulate', body: { strategyId: 'peg-arb', live: true } }),
    res2,
    { fetch: good, marketUrl: 'http://example/market' },
  );
  const out2 = res2.json();
  assert.equal(out2.ok, true);
  assert.equal(out2.dryRun, true);
  for (const o of out2.orders) assert.equal(o.signer, null);
});

test('handler GET / serves the page via injected readPage (no disk dependency)', async () => {
  const res = fakeRes();
  await handler(fakeReq({ method: 'GET', url: '/' }), res, { readPage: async () => '<!doctype html><h1>Pick a Bot</h1>' });
  assert.equal(res.code, 200);
  assert.match(res.headers['Content-Type'], /text\/html/);
  assert.match(res.body, /Pick a Bot/);
});

test('handler unknown route → 404 JSON', async () => {
  const res = fakeRes();
  await handler(fakeReq({ method: 'GET', url: '/nope' }), res);
  assert.equal(res.code, 404);
  assert.equal(res.json().ok, false);
});

test('esc() escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});
