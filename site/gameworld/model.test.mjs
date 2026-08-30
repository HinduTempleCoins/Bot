// model.test.mjs — OFFLINE. Pure reducer over the Fort/Game-World state model. Deterministic, no network.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  createWorld, reduce, apply, score, embedManifest, themeVars, esc,
  EVENTS, PLOTS, BUILDINGS, SYSTEMS, RESOURCES, ECONOMY_TOKENS, DEFAULT_THEME, SCHEMA_VERSION,
} from './model.mjs';

test('createWorld: keep unlocked, nothing built, resources zeroed', () => {
  const w = createWorld('Hathor');
  assert.equal(w.owner, 'hathor');
  assert.equal(w.plots.keep.unlocked, true);
  assert.deepEqual(w.buildings, {});
  assert.equal(w.schema, SCHEMA_VERSION);
  for (const r of RESOURCES) assert.equal(w.resources[r], 0);
});

test('createWorld throws without owner', () => {
  assert.throws(() => createWorld(''));
});

test('reduce never throws and is pure (does not mutate input)', () => {
  const w = createWorld('a', { seedResources: { timber: 10 } });
  const before = JSON.stringify(w);
  const r = reduce(w, { type: EVENTS.PLOT_UNLOCK, plot: 'garden' });
  assert.equal(JSON.stringify(w), before, 'input world unchanged');
  assert.equal(r.ok, true);
  assert.equal(r.world.plots.garden.unlocked, true);
  assert.equal(r.world.rev, 1);
});

test('unknown event is a soft no-op', () => {
  const w = createWorld('a');
  const r = reduce(w, { type: 'bogus/event' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unknown event/);
  assert.equal(r.world, w);
});

test('plot unlock enforces prerequisite and cost', () => {
  const w = createWorld('a', { seedResources: { stone: 100 } });
  // market-row needs workshop-yard first
  let r = reduce(w, { type: EVENTS.PLOT_UNLOCK, plot: 'market-row' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /workshop-yard/);
  // cannot afford garden with no timber
  const poor = createWorld('a');
  r = reduce(poor, { type: EVENTS.PLOT_UNLOCK, plot: 'garden' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /need .*timber/);
});

test('build → upgrade → attach chain works and spends resources', () => {
  let w = createWorld('a', { seedResources: { timber: 20, fiber: 20, essence: 10 } });
  const res = apply(w, [
    { type: EVENTS.PLOT_UNLOCK, plot: 'garden' },
    { type: EVENTS.BUILDING_PLACE, building: 'seed-plot' },
    { type: EVENTS.BUILDING_UPGRADE, building: 'seed-plot' },
    { type: EVENTS.SYSTEM_ATTACH, system: 'seed-farm' },
  ]);
  assert.equal(res.applied, 4);
  assert.equal(res.rejected.length, 0);
  assert.equal(res.world.buildings['seed-plot'].level, 2);
  assert.equal(res.world.systems['seed-farm'].attached, true);
  // resources were consumed
  assert.ok(res.world.resources.timber < 20);
});

test('cannot place a building before its plot is unlocked', () => {
  const w = createWorld('a', { seedResources: { timber: 50, fiber: 50 } });
  const r = reduce(w, { type: EVENTS.BUILDING_PLACE, building: 'seed-plot' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /unlock plot "garden"/);
});

test('cannot attach a system before its anchor building exists', () => {
  const w = createWorld('a');
  const r = reduce(w, { type: EVENTS.SYSTEM_ATTACH, system: 'hud' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /command-centre/);
});

test('resource/grant only accepts real resources and positive qty', () => {
  const w = createWorld('a');
  assert.equal(reduce(w, { type: EVENTS.RESOURCE_GRANT, resource: 'gold', qty: 5 }).ok, false);
  assert.equal(reduce(w, { type: EVENTS.RESOURCE_GRANT, resource: 'timber', qty: 0 }).ok, false);
  const r = reduce(w, { type: EVENTS.RESOURCE_GRANT, resource: 'timber', qty: 7 });
  assert.equal(r.ok, true);
  assert.equal(r.world.resources.timber, 7);
});

test('upgrade respects maxLevel', () => {
  let w = createWorld('a', { seedResources: { spark: 200, essence: 200, stone: 200, timber: 200, fiber: 200 } });
  w = apply(w, [{ type: EVENTS.PLOT_UNLOCK, plot: 'gate' }, { type: EVENTS.BUILDING_PLACE, building: 'wayfarers-gate' }]).world;
  const max = BUILDINGS['wayfarers-gate'].maxLevel;
  const ups = Array.from({ length: max + 3 }, () => ({ type: EVENTS.BUILDING_UPGRADE, building: 'wayfarers-gate' }));
  w = apply(w, ups).world;
  assert.equal(w.buildings['wayfarers-gate'].level, max);
});

test('tick advances passive resource nodes for placed buildings', () => {
  let w = createWorld('a', { seedResources: { timber: 20, fiber: 20 } });
  w = apply(w, [
    { type: EVENTS.PLOT_UNLOCK, plot: 'gate' },
    { type: EVENTS.BUILDING_PLACE, building: 'wayfarers-gate' }, // produces(1) = { timber: 1 }
  ]).world;
  const before = w.resources.timber;
  w = reduce(w, { type: EVENTS.TICK }).world;
  assert.equal(w.resources.timber, before + 1);
});

test('score rewards plots, levels and systems', () => {
  const empty = createWorld('a');
  const s0 = score(empty);
  assert.equal(s0.plots, 1); // keep
  let w = createWorld('a', { seedResources: { timber: 20, stone: 20, essence: 10 } });
  w = apply(w, [
    { type: EVENTS.BUILDING_PLACE, building: 'command-centre' },
    { type: EVENTS.SYSTEM_ATTACH, system: 'hud' },
  ]).world;
  const s1 = score(w);
  assert.ok(s1.total > s0.total);
  assert.equal(s1.systems, 1);
});

test('embedManifest exposes safe state and no internal journal', () => {
  let w = createWorld('a', { seedResources: { timber: 20 } });
  w = apply(w, [{ type: EVENTS.PLOT_UNLOCK, plot: 'garden' }]).world;
  const m = embedManifest(w);
  assert.equal(m.owner, 'a');
  assert.ok(Array.isArray(m.plots) && m.plots.includes('garden'));
  assert.ok(Array.isArray(m.events) && m.events.includes('resource/grant'));
  assert.equal(m.journal, undefined, 'manifest must not leak internal journal');
  assert.equal(typeof m.score, 'number');
});

test('themeVars produces CSS vars and merges overrides', () => {
  const v = themeVars({ acc: '#fff' });
  assert.match(v, /--acc:#fff/);
  assert.match(v, /--bg:/);
});

test('themeVars blocks CSS injection + unknown keys (security)', () => {
  const v = themeVars({ bg: 'red;} body{display:none}', acc: '</style><script>alert(1)</script>', evil: 'url(http://x)' });
  assert.doesNotMatch(v, /[<>{}]/, 'no selectors/breakout chars');
  assert.doesNotMatch(v, /url\(|@import|<\/style/i, 'no url()/import/style-breakout');
  assert.doesNotMatch(v, /--evil/, 'unknown keys dropped');
  assert.match(v, /--bg:#0b0b0f/, 'malicious bg falls back to default');
  assert.match(v, /--acc:#8b7cff/, 'malicious acc falls back to default');
});

test('esc escapes html', () => {
  assert.equal(esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
});

test('economy tokens name PRANA/KULA/MWALI with PRANA chainId 712217, no minting in model', () => {
  assert.equal(ECONOMY_TOKENS.PRANA.chainId, 712217);
  assert.ok(ECONOMY_TOKENS.KULA && ECONOMY_TOKENS.MWALI);
  // Seed Farm + HUD are declared systems attaching at their buildings
  assert.equal(SYSTEMS['seed-farm'].attachBuilding, 'seed-plot');
  assert.equal(SYSTEMS.hud.attachBuilding, 'command-centre');
  // every building's plot exists in PLOTS
  for (const b of Object.values(BUILDINGS)) assert.ok(PLOTS[b.plot], `plot ${b.plot} exists`);
  assert.ok(DEFAULT_THEME.bg);
});

test('play-only systems are flagged (compliance line)', () => {
  assert.equal(SYSTEMS.arcade.playOnly, true);
  assert.equal(SYSTEMS['lantern-hall'].playOnly, true);
  assert.equal(SYSTEMS['seed-farm'].playOnly, false);
});
