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

// ── /factors — the non-growing shelf ────────────────────────────────────────────────────────────
test('/factors serves all four non-growing classes', async () => {
  const r = await call('/factors');
  assert.equal(r.code, 200);
  for (const cls of ['mineral', 'burnable', 'vessel', 'made']) assert.match(r.body, new RegExp(`id="${cls}"`));
  assert.match(r.body, /Diatomaceous Earth \(food grade\)/);
  assert.match(r.body, /Diatomaceous Earth \(pool \/ filter grade, calcined\)/);
  assert.match(r.body, /Glazed Offering Bowl/);
  assert.match(r.body, /Murti/);
});

test('/factors shows the safety facts on the page, not behind a link', async () => {
  const r = await call('/factors');
  assert.match(r.body, /cristobalite/);
  assert.match(r.body, /FOOD CONTACT/);
  assert.match(r.body, /CITES appendix-ii/);
  assert.match(r.body, /ASTM C738/);
  assert.match(r.body, /prana pratishtha/);
  // the leach table renders real numbers
  assert.match(r.body, /<td>flatware<\/td><td>3<\/td><td>0.5<\/td>/);
});

test('/factors reports the economy honestly — drains only, and the assumption is labelled', async () => {
  const r = await call('/factors');
  assert.match(r.body, /drains and 1 faucet/);
  assert.match(r.body, /Modelled magnitudes, not measured demand/);
});

test('/factors escapes its interpolation', async () => {
  const r = await call('/factors');
  // apostrophes inside the corpus text must come out escaped, never raw
  assert.ok(!r.body.includes("somebody else's"), 'raw apostrophe leaked into HTML');
  assert.match(r.body, /somebody else&#39;s ceremony/);
  assert.match(r.body, /operator&#39;s own tradition/);
  assert.match(r.body, /&lt;1%/, 'the < in "<1% crystalline silica" must be escaped');
});

test('/api/factors is machine-readable and carries the safety payload', async () => {
  const r = await call('/api/factors');
  assert.equal(r.code, 200);
  const j = JSON.parse(r.body);
  assert.deepEqual(j.classes, ['grown', 'mineral', 'burnable', 'vessel', 'made']);
  assert.ok(j.factors.length >= 30);
  const de = j.factors.find((f) => f.id === 'de_calcined');
  assert.ok(de.safety.some((l) => /cristobalite/.test(l.text)));
  const bowl = j.factors.find((f) => f.id === 'offering_bowl');
  assert.equal(bowl.foodContact, true);
  const oud = j.factors.find((f) => f.id === 'agarwood_chips');
  assert.equal(oud.sourcing.cites, 'appendix-ii');
  assert.equal(j.economy.faucets, 1);
  assert.ok(j.economy.headroom > 0);
});

test('/factors is in the sitemap and the llms manifest', async () => {
  assert.match((await call('/sitemap.xml')).body, /\/factors/);
  assert.match((await call('/llms.txt')).body, /Non-growing shelf/);
});
