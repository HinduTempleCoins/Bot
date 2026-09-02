// site/botanica/server.test.mjs — offline. `node --test`. Drives the served loop through handler().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, INV, BALANCE, STARTERS, plotState, growSeconds } from './server.mjs';
import { materialsForPlant } from '../../integrations/games/plant-catalog.mjs';

// minimal req/res mock; resolves with {code, headers, body} when the handler ends the response.
function call(path) {
  return new Promise((resolve) => {
    const res = {
      _c: 200, _h: {}, _b: '',
      writeHead(c, h) { this._c = c; if (h) Object.assign(this._h, h); },
      end(b) { if (b) this._b += b; resolve({ code: this._c, headers: this._h, body: this._b, location: this._h.location }); },
    };
    handler({ url: path, method: 'GET' }, res);
  });
}

test('health + robots + llms respond', async () => {
  assert.equal((await call('/health')).body, 'ok');
  assert.match((await call('/robots.txt')).body, /User-agent|Sitemap/i);
  assert.match((await call('/llms.txt')).body, /Botanica/);
});

test('home page renders the farm with the Alpha badge and versatility framing', async () => {
  const r = await call('/?account=viewer&now=0');
  assert.equal(r.code, 200);
  assert.match(r.body, /Alpha/);
  assert.match(r.body, /Value = versatility|versatility/i);
  assert.ok(STARTERS.length >= 5);
});

test('the full loop: plant → grow → harvest materials → craft an item → sell', async () => {
  const a = 'player1';
  // marigold yields dye + flower — exactly charm_fortune's recipe
  assert.ok(materialsForPlant('marigold').includes('dye') && materialsForPlant('marigold').includes('flower'));

  // plant at now=0
  let r = await call(`/plant?account=${a}&plot=0&plant=marigold&now=0`);
  assert.equal(r.code, 302);

  // not ready yet immediately
  const state = await call(`/api/state?account=${a}&now=1`);
  assert.match(state.body, /"ready": false/);

  // harvest far in the future → materials land in inventory
  r = await call(`/harvest?account=${a}&plot=0&now=100000`);
  assert.equal(r.code, 302);
  assert.ok((INV.get(a).dye || 0) >= 1 && (INV.get(a).flower || 0) >= 1);

  // craft charm_fortune (consumes dye + flower, mints the item)
  r = await call(`/craft?account=${a}&item=charm_fortune&now=100000`);
  assert.equal(r.code, 302);
  assert.equal(INV.get(a).charm_fortune, 1);
  assert.ok(!INV.get(a).dye && !INV.get(a).flower); // materials consumed
});

test('harvest before ripe yields nothing; sell converts materials to Grain', async () => {
  const a = 'player2';
  await call(`/plant?account=${a}&plot=1&plant=wheat&now=0`);
  await call(`/harvest?account=${a}&plot=1&now=1`);          // too early
  assert.equal(INV.get(a) && INV.get(a).grain, undefined);
  await call(`/harvest?account=${a}&plot=1&now=100000`);     // now ripe
  assert.ok((INV.get(a).grain || 0) >= 1);
  await call(`/sell?account=${a}&now=100000`);
  assert.ok(balanceOf(a) > 0);
  assert.ok(!INV.get(a).grain); // sold off
});
function balanceOf(a) { return BALANCE.get(a) || 0; }

test('plotState + growSeconds are sane', () => {
  assert.ok(growSeconds('wheat') > 0);
  assert.deepEqual(plotState(null, 0), { empty: true });
  const s = plotState({ plantId: 'wheat', plantedAt: 0 }, 100000);
  assert.equal(s.ready, true);
});
