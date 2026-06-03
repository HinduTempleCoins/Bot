import { test } from 'node:test';
import assert from 'node:assert';
import { BRIDGES, routeQuote, bridgePolicy, DEFAULT_MAX_BRIDGED_VALUE } from './bridge.mjs';

test('registry holds the curated bridges, all tagged with an audit tier', () => {
  const ids = BRIDGES.map((b) => b.id);
  for (const id of ['axelar', 'layerzero', 'wormhole', 'chainlink-ccip', 'cosmos-ibc', 'hyperlane']) {
    assert.ok(ids.includes(id), `missing ${id}`);
  }
  for (const b of BRIDGES) {
    assert.ok(['audited', 'battle-tested', 'unaudited'].includes(b.audit), `${b.id} audit tier`);
    assert.ok(Number.isFinite(b.risk));
    assert.ok(Array.isArray(b.chains) && b.chains.length);
  }
});

test('routeQuote ranks audited bridges lowest-risk first, never returns un-audited', () => {
  const ranked = routeQuote({ fromChain: 'MELEK', toChain: 'ethereum', asset: 'USDC', amount: 5000 });
  assert.ok(ranked.length >= 2, 'multiple viable routes');
  // every returned bridge is audited/battle-tested
  for (const r of ranked) assert.ok(['audited', 'battle-tested'].includes(r.audit));
  // sorted ascending by risk
  for (let i = 1; i < ranked.length; i++) assert.ok(ranked[i].risk >= ranked[i - 1].risk, 'risk ascending');
  // lowest-risk bridge wins the top slot (Chainlink CCIP, risk 1)
  assert.equal(ranked[0].id, 'chainlink-ccip');
  // both endpoints carried through
  assert.equal(ranked[0].fromChain, 'MELEK');
  assert.equal(ranked[0].toChain, 'ethereum');
});

test('routeQuote: no-route case returns [] (unreachable chain, same chain, missing input)', () => {
  assert.deepEqual(routeQuote({ fromChain: 'MELEK', toChain: 'dogecoin', amount: 100 }), []);
  assert.deepEqual(routeQuote({ fromChain: 'MELEK', toChain: 'MELEK', amount: 100 }), []);
  assert.deepEqual(routeQuote({ fromChain: 'MELEK' }), []);
  assert.deepEqual(routeQuote(), []);
});

test('bridgePolicy allows an audited bridge within cap', () => {
  const r = bridgePolicy({ amount: 5000, bridge: 'chainlink-ccip' });
  assert.equal(r.allowed, true, r.reason);
});

test('bridgePolicy rejects an un-audited bridge (audited-only rule)', () => {
  const fake = { id: 'sketchy', name: 'SketchyBridge', audit: 'unaudited' };
  const r = bridgePolicy({ amount: 100, bridge: fake });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /un-audited/i);
});

test('bridgePolicy rejects an unknown bridge not in the registry', () => {
  const r = bridgePolicy({ amount: 100, bridge: 'does-not-exist' });
  assert.equal(r.allowed, false);
  assert.match(r.reason, /unknown bridge/i);
});

test('bridgePolicy rejects amount over the cap (minimize value at risk)', () => {
  const over = bridgePolicy({ amount: DEFAULT_MAX_BRIDGED_VALUE + 1, bridge: 'chainlink-ccip' });
  assert.equal(over.allowed, false);
  assert.match(over.reason, /exceeds cap/i);

  const custom = bridgePolicy({ amount: 2000, bridge: 'chainlink-ccip', maxBridgedValue: 1000 });
  assert.equal(custom.allowed, false, 'custom cap honored');
});

test('bridgePolicy rejects invalid / non-positive amounts', () => {
  assert.equal(bridgePolicy({ amount: 0, bridge: 'axelar' }).allowed, false);
  assert.equal(bridgePolicy({ amount: -5, bridge: 'axelar' }).allowed, false);
  assert.equal(bridgePolicy({ amount: 'NaN', bridge: 'axelar' }).allowed, false);
});
