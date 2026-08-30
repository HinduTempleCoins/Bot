// hub-model.test.mjs — the guided-hub tile model. OFFLINE, pure, deterministic.
import { test } from 'node:test';
import assert from 'node:assert';
import { hubTiles, tileState, progressSummary, hasAddr, ABIS } from './hub-model.mjs';

const LIVE = '0x36C6921e2CECe9DEc7a5AAC42bC6738011F2a1c9';

test('hasAddr accepts real 0x addresses, rejects zero/blank/garbage', () => {
  assert.equal(hasAddr(LIVE), true);
  assert.equal(hasAddr('0x0000000000000000000000000000000000000000'), false);
  assert.equal(hasAddr(''), false);
  assert.equal(hasAddr('nope'), false);
  assert.equal(hasAddr(undefined), false);
});

test('hubTiles returns the four mechanics in order', () => {
  const tiles = hubTiles({ engine: { stakeToken: 'WMELEK' }, prana: { name: 'PRANA', chainId: 712217 } });
  assert.deepEqual(tiles.map((t) => t.id), ['apis', 'burnmine', 'liquidity', 'vekula']);
  // apis + vekula are always live; burnmine + liquidity gate until their contracts are configured.
  assert.equal(tiles.find((t) => t.id === 'apis').gated, false);
  assert.equal(tiles.find((t) => t.id === 'vekula').gated, false);
  assert.equal(tiles.find((t) => t.id === 'burnmine').gated, true);
  assert.equal(tiles.find((t) => t.id === 'liquidity').gated, true);
  // every tile carries plain-language what/why + ordered steps
  for (const t of tiles) {
    assert.ok(t.what && t.why && Array.isArray(t.steps) && t.steps.length >= 1, `tile ${t.id} complete`);
  }
});

test('the APIS tile names the stake token and warns PERMANENT', () => {
  const t = hubTiles({ engine: { stakeToken: 'WMELEK' } }).find((x) => x.id === 'apis');
  assert.match(t.title, /WMELEK/);
  assert.match(t.warn, /PERMANENT/);
  assert.equal(t.action.kind, 'engine');
  assert.equal(t.action.op, 'foreverLock');
});

test('liquidity tile ungates + exposes LP pairs + MWALI reward when the gauge is deployed', () => {
  const cfg = {
    prana: { gauge: LIVE, mwali: LIVE, lp: { wvkbtKula: '0xE3e01d327bC2bee7a5754c1E7Ff23158E017688E', wcureKula: '0x521786d5ede921c7E8f248796acA10e5370149a3' } },
  };
  const t = hubTiles(cfg).find((x) => x.id === 'liquidity');
  assert.equal(t.gated, false);
  assert.equal(t.action.kind, 'evm');
  assert.equal(t.action.rewardToken, LIVE);
  assert.equal(t.action.pairs.length, 2);
  assert.match(t.action.pairs[0].name, /wVKBT/);
});

test('burnmine tile ungates when a BurnMine address is configured', () => {
  const t = hubTiles({ prana: { burnMine: LIVE } }).find((x) => x.id === 'burnmine');
  assert.equal(t.gated, false);
  assert.equal(t.action.address, LIVE);
});

test('tileState: gated wins; engine/onchain thresholds + local marks light a tile', () => {
  const tiles = hubTiles({ prana: { gauge: LIVE, burnMine: LIVE } });
  const apis = tiles.find((t) => t.id === 'apis');
  const liq = tiles.find((t) => t.id === 'liquidity');
  const bm = tiles.find((t) => t.id === 'burnmine');
  assert.equal(tileState(apis, {}), 'grey');
  assert.equal(tileState(apis, { engine: { apisHash: 5 } }), 'lit');
  assert.equal(tileState(liq, { onchain: { gaugeStaked: 0 } }), 'grey');
  assert.equal(tileState(liq, { onchain: { gaugeStaked: 12 } }), 'lit');
  assert.equal(tileState(bm, { marks: { burnmine: true } }), 'lit');
  // gated tile stays gated regardless of marks
  const gatedLiq = hubTiles({}).find((t) => t.id === 'liquidity');
  assert.equal(tileState(gatedLiq, { marks: { liquidity: true } }), 'gated');
});

test('progressSummary counts lit / total / gated', () => {
  const tiles = hubTiles({});   // burnmine + liquidity gated
  const p = progressSummary(tiles, { engine: { apisHash: 1 }, marks: { vekula: true } });
  assert.equal(p.total, 4);
  assert.equal(p.gated, 2);
  assert.equal(p.done, 2);       // apis (engine) + vekula (local)
  assert.equal(p.pct, 50);
});

test('ABIS carry the calls the client needs', () => {
  assert.ok(ABIS.BurnMine.some((s) => s.includes('mine(')));
  assert.ok(ABIS.LiquidityGauge.some((s) => s.includes('stake(')));
  assert.ok(ABIS.LiquidityGauge.some((s) => s.includes('getReward')));
  assert.ok(ABIS.ERC20.some((s) => s.includes('approve')));
});

test('tileState never throws on junk input', () => {
  assert.equal(tileState(null, null), 'grey');
  assert.equal(tileState(undefined), 'grey');
});
