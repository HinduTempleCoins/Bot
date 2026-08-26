// map.test.mjs — offline tests for the HUD Game map layer. node --test, no network, deterministic.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AFFINITIES, NODE_KINDS, MAX_ACCRUAL_INTERVALS,
  hexKey, parseHexKey, neighbors, hexDistance, hexRange, inBounds, affinityAt,
  axialToPixel, hexCorners,
  generateBoard, createPlayer, boardFor,
  reveal, claimCost, claim, deedDescriptor, placeNode, unitMultiplier, staffNode,
  accrue, collect, resolveExpedition, mapView,
} from './map.mjs';
import { createCreature } from './creatures.mjs';

const HOUR = 3600_000;

// ── axial helpers ─────────────────────────────────────────────────────────────
test('hexKey / parseHexKey round-trip and reject junk', () => {
  assert.equal(hexKey({ q: 1, r: -2 }), '1,-2');
  assert.deepEqual(parseHexKey('1,-2'), { q: 1, r: -2 });
  assert.equal(hexKey({ q: 1.5, r: 0 }), null);
  assert.equal(hexKey(null), null);
  assert.equal(parseHexKey('junk'), null);
  assert.equal(parseHexKey(42), null);
});

test('neighbors returns 6 uniform hexes; distance is axial', () => {
  const ns = neighbors({ q: 0, r: 0 });
  assert.equal(ns.length, 6);
  // every neighbor is distance 1 from origin
  for (const n of ns) assert.equal(hexDistance({ q: 0, r: 0 }, n), 1);
  assert.equal(hexDistance({ q: 0, r: 0 }, { q: 3, r: 0 }), 3);
  assert.equal(hexDistance(null, { q: 1, r: 1 }), Infinity);
  assert.deepEqual(neighbors('junk'), []);
});

test('hexRange is a bounded hexagon: radius 2 → 19 tiles', () => {
  assert.equal(hexRange(2).length, 19);
  assert.equal(hexRange(1).length, 7);
  assert.equal(hexRange(0).length, 1);
  // clamps junk
  assert.equal(hexRange(-5).length, 1);
});

// ── board generation ──────────────────────────────────────────────────────────
test('generateBoard is deterministic and hex/axial with home at origin', () => {
  const a = generateBoard({ seed: 7, radius: 2 });
  const b = generateBoard({ seed: 7, radius: 2 });
  assert.deepEqual(a.hexes, b.hexes, 'same seed → identical layout');
  assert.equal(Object.keys(a.hexes).length, 19);
  assert.equal(a.hexes['0,0'].affinity, 'home', 'origin is always Home');
  // every non-home tile has a known affinity from the table
  for (const h of Object.values(a.hexes)) {
    assert.ok(AFFINITIES[h.affinity], `affinity ${h.affinity} is known`);
    assert.ok(Number.isInteger(h.q) && Number.isInteger(h.r), 'axial integer coords');
  }
  const c = generateBoard({ seed: 999, radius: 2 });
  assert.notDeepEqual(a.hexes, c.hexes, 'different seed → different layout');
});

test('generateBoard tolerates junk seed/radius (never throws)', () => {
  const g = generateBoard({ seed: 'oops', radius: 99 });
  assert.ok(g.radius >= 1 && g.radius <= 6);
  assert.ok(Object.keys(g.hexes).length > 0);
  assert.doesNotThrow(() => generateBoard(null));
  assert.doesNotThrow(() => generateBoard(undefined));
});

test('inBounds / affinityAt', () => {
  const board = generateBoard({ seed: 7, radius: 2 });
  assert.equal(inBounds(board, { q: 0, r: 0 }), true);
  assert.equal(inBounds(board, { q: 9, r: 9 }), false);
  assert.equal(affinityAt(board, { q: 0, r: 0 }), 'home');
  assert.equal(affinityAt(board, { q: 9, r: 9 }), null);
});

// ── SVG pixel math ──────────────────────────────────────────────────────────
test('axialToPixel + hexCorners produce finite polygon points', () => {
  const p = axialToPixel({ q: 0, r: 0 }, 32);
  assert.deepEqual(p, { x: 0, y: 0 });
  const pts = hexCorners(0, 0, 32).split(' ');
  assert.equal(pts.length, 6);
  for (const pt of pts) {
    const [x, y] = pt.split(',').map(Number);
    assert.ok(Number.isFinite(x) && Number.isFinite(y));
  }
  // junk coord doesn't throw
  assert.doesNotThrow(() => axialToPixel(null));
});

// ── player + fog ────────────────────────────────────────────────────────────
test('createPlayer owns Home and reveals its ring', () => {
  const p = createPlayer({ owner: 'alice', seed: 7, radius: 2 });
  assert.equal(p.owned['0,0'], true);
  assert.equal(p.revealed['0,0'], true);
  // all 6 home neighbors revealed (all in-bounds at radius 2)
  const board = boardFor(p);
  for (const n of neighbors(board.home)) {
    if (inBounds(board, n)) assert.equal(p.revealed[hexKey(n)], true);
  }
  // but a distant ring-2 tile is still fogged
  assert.notEqual(p.revealed['2,0'], true);
});

test('reveal lifts fog outward; off-board soft-fails', () => {
  const p = createPlayer({ seed: 7, radius: 2 });
  const board = boardFor(p);
  const r = reveal(p, { q: 2, r: 0 }, board);
  assert.equal(r.ok, true);
  assert.equal(p.revealed['2,0'], true);
  assert.equal(reveal(p, { q: 9, r: 9 }, board).ok, false);
  assert.equal(reveal(null).ok, false);
});

// ── claim ───────────────────────────────────────────────────────────────────
test('claimCost scales with owned count and distance', () => {
  const p = createPlayer({ seed: 7, radius: 2 });
  const board = boardFor(p);
  const near = neighbors(board.home)[0];
  const cost = claimCost(p, near, board);
  assert.ok(cost.stone > 0 && cost.wood > 0);
  assert.equal(cost.wood, 2); // dist 1 → 1 + 1
});

test('claim: adjacency + ownership + affordability enforced, returns non-broadcasting deed', () => {
  const p = createPlayer({ seed: 7, radius: 2 });
  const board = boardFor(p);
  const target = neighbors(board.home)[0]; // adjacent to Home
  // too poor → soft-fail
  const poor = claim(p, target, board, { materials: { stone: 0, wood: 0 } });
  assert.equal(poor.ok, false);
  assert.equal(poor.reason, 'insufficient materials');
  assert.equal(p.owned[hexKey(target)], undefined, 'not claimed when it fails');

  // afford it → claimed, materials spent, deed is a descriptor (NOT broadcast)
  const mats = { stone: 50, wood: 50 };
  const ok = claim(p, target, board, { materials: mats });
  assert.equal(ok.ok, true);
  assert.equal(p.owned[hexKey(target)], true);
  assert.ok(mats.stone < 50 && mats.wood < 50, 'materials deducted');
  assert.equal(ok.deed.broadcast, false, 'deed mint is stubbed, never broadcast');
  assert.equal(ok.deed.fn, 'mintDeed');
  assert.match(ok.deed.note, /settle on-chain/);

  // re-claim same tile → already owned
  assert.equal(claim(p, target, board, { materials: { stone: 50, wood: 50 } }).reason, 'already owned');

  // a non-adjacent, unowned far tile → rejected (not touching Home or the claimed {1,0})
  const far = { q: -2, r: 2 };
  const farRes = claim(p, far, board, { materials: { stone: 999, wood: 999 } });
  assert.equal(farRes.ok, false);
  assert.match(farRes.reason, /adjacent/);
});

test('deedDescriptor encodes canonical coord (one hex = one deed)', () => {
  const d = deedDescriptor('alice', { q: 1, r: -1 }, 'ore');
  assert.deepEqual(d.args, ['alice', '1,-1', 'ore']);
  assert.equal(d.broadcast, false);
});

// ── node placement + staffing multiplier ─────────────────────────────────────
// Find a board seed exposing a fertile tile adjacent to Home, so we can farm it.
function playerWithFertileNeighbor() {
  for (let seed = 1; seed < 200; seed++) {
    const board = generateBoard({ seed, radius: 2 });
    const fert = neighbors(board.home).find((n) => affinityAt(board, n) === 'fertile');
    if (fert) {
      const p = createPlayer({ seed, radius: 2 });
      claim(p, fert, board, { materials: { stone: 999, wood: 999 } });
      return { p, board, fert };
    }
  }
  throw new Error('no fertile neighbor found in 200 seeds (unexpected)');
}

test('placeNode requires ownership + matching affinity + empty tile', () => {
  const { p, board, fert } = playerWithFertileNeighbor();
  const ok = placeNode(p, fert, 'farm', board);
  assert.equal(ok.ok, true);
  assert.equal(p.nodes[hexKey(fert)].kind, 'farm');
  // second node on same tile rejected
  assert.equal(placeNode(p, fert, 'farm', board).reason, 'a node already stands here');
  // wrong affinity: a mine on a fertile tile
  const p2 = createPlayer({ seed: p.seed, radius: 2 });
  claim(p2, fert, board, { materials: { stone: 999, wood: 999 } });
  assert.match(placeNode(p2, fert, 'mine', board).reason, /needs a ore tile/);
  // unowned tile rejected
  const un = createPlayer({ seed: p.seed, radius: 2 });
  assert.match(placeNode(un, fert, 'farm', board).reason, /do not own/);
  // unknown kind
  assert.match(placeNode(p, fert, 'bogus', board).reason, /unknown node kind/);
});

test('unitMultiplier: bigger/rarer worker → higher multiplier; junk → 1', () => {
  assert.equal(unitMultiplier(null), 1);
  assert.equal(unitMultiplier('junk'), 1);
  assert.equal(unitMultiplier({}), 1);
  const small = createCreature({ species: 'mossquill' }); // small/common-ish
  const big = createCreature({ species: 'cinderox', genes: { size: ['colossal', 'colossal'] } });
  const ms = unitMultiplier(small);
  const mb = unitMultiplier(big);
  assert.ok(ms >= 1 && mb >= 1);
  assert.ok(mb > ms, 'colossal worker beats small worker');
});

test('staffNode applies a multiplier to a node; no node → soft-fail', () => {
  const { p, board, fert } = playerWithFertileNeighbor();
  placeNode(p, fert, 'farm', board);
  const big = createCreature({ species: 'cinderox', genes: { size: ['colossal', 'colossal'] } });
  const s = staffNode(p, fert, big, board);
  assert.equal(s.ok, true);
  assert.ok(s.multiplier > 1);
  assert.equal(p.staff[hexKey(fert)].multiplier, s.multiplier);
  // staffing a tile with no node
  const empty = neighbors(board.home).find((n) => hexKey(n) !== hexKey(fert));
  assert.equal(staffNode(p, empty, big, board).ok, false);
});

// ── offline accrual (injected clock) ─────────────────────────────────────────
test('accrue/collect produce yield over elapsed intervals, capped, with injected clock', () => {
  const { p, board, fert } = playerWithFertileNeighbor();
  const placed = placeNode(p, fert, 'farm', board);
  const t0 = placed.node.placedAt;
  // immediately: nothing
  assert.equal(accrue(p, fert, { now: t0 }).amount, 0);
  // after 5 hours: 5 intervals * baseYield(5) * 1x = 25
  const a5 = accrue(p, fert, { now: t0 + 5 * HOUR });
  assert.equal(a5.amount, 5 * NODE_KINDS.farm.baseYield);
  assert.equal(a5.resource, 'crop');
  // collect banks it and advances the clock
  const c = collect(p, fert, { now: t0 + 5 * HOUR });
  assert.equal(c.gained, 25);
  assert.equal(p.resources.crop, 25);
  // collecting again immediately yields nothing (clock advanced)
  assert.equal(collect(p, fert, { now: t0 + 5 * HOUR }).gained, 0);
  // accrual is capped: 1000 hours away → at most MAX_ACCRUAL_INTERVALS
  const capped = accrue(p, fert, { now: t0 + 1000 * HOUR });
  assert.ok(capped.intervals <= MAX_ACCRUAL_INTERVALS);
  assert.equal(capped.amount, MAX_ACCRUAL_INTERVALS * NODE_KINDS.farm.baseYield);
});

test('accrue with a staffed node scales by the multiplier', () => {
  const { p, board, fert } = playerWithFertileNeighbor();
  const placed = placeNode(p, fert, 'farm', board);
  const t0 = placed.node.placedAt;
  const big = createCreature({ species: 'cinderox', genes: { size: ['colossal', 'colossal'] } });
  const s = staffNode(p, fert, big, board);
  const a = accrue(p, fert, { now: t0 + 4 * HOUR });
  assert.equal(a.amount, Math.floor(4 * NODE_KINDS.farm.baseYield * s.multiplier));
  assert.ok(a.amount > 4 * NODE_KINDS.farm.baseYield, 'staffed beats unstaffed');
});

test('accrue soft-fails on non-accruing / missing nodes', () => {
  const p = createPlayer({ seed: 7, radius: 2 });
  assert.equal(accrue(p, { q: 0, r: 0 }, { now: 0 }).ok, false); // no node at home
  assert.equal(accrue(null, { q: 0, r: 0 }).ok, false);
});

// ── expedition ────────────────────────────────────────────────────────────────
test('resolveExpedition is deterministic per seed and reveals the tile', () => {
  const p1 = createPlayer({ seed: 7, radius: 2 });
  const p2 = createPlayer({ seed: 7, radius: 2 });
  const board = boardFor(p1);
  const wild = { q: 0, r: 0 };
  const a = resolveExpedition(p1, wild, { seed: 123 });
  const b = resolveExpedition(p2, wild, { seed: 123 });
  assert.equal(a.ok, true);
  assert.deepEqual(a.reward, b.reward, 'same seed → same outcome');
  assert.ok(['materials', 'seed', 'creature', 'nothing'].includes(a.reward.kind));
  // off-board soft-fails
  assert.equal(resolveExpedition(p1, { q: 9, r: 9 }, { seed: 1 }).ok, false);
});

test('resolveExpedition materials land in resources; log grows', () => {
  // find a seed that yields a materials outcome
  let found = null;
  for (let s = 1; s < 100 && !found; s++) {
    const p = createPlayer({ seed: 7, radius: 2 });
    const r = resolveExpedition(p, { q: 0, r: 0 }, { seed: s });
    if (r.reward.kind === 'materials') found = { p, r };
  }
  assert.ok(found, 'some seed yields materials');
  assert.ok(found.p.resources.wood > 0);
  assert.ok(found.p.log.length >= 1);
});

// ── mapView ────────────────────────────────────────────────────────────────
test('mapView hides fogged affinities and marks owned/nodes', () => {
  const { p, board, fert } = playerWithFertileNeighbor();
  placeNode(p, fert, 'farm', board);
  const v = mapView(p, board);
  assert.equal(v.tiles.length, 19);
  const home = v.tiles.find((t) => t.key === '0,0');
  assert.equal(home.owned, true);
  assert.equal(home.affinity, 'home');
  const ftile = v.tiles.find((t) => t.key === hexKey(fert));
  assert.equal(ftile.node, 'farm');
  // an unrevealed ring-2 tile shows as fog, not its true affinity
  const fogged = v.tiles.find((t) => !p.revealed[t.key]);
  if (fogged) assert.equal(fogged.affinity, 'fog');
  // pixel coords are finite numbers
  for (const t of v.tiles) assert.ok(Number.isFinite(t.x) && Number.isFinite(t.y));
});

// ── robustness: nothing throws on junk ────────────────────────────────────────
test('every entry point soft-fails on garbage (never throws)', () => {
  const junk = [null, undefined, 42, 'x', {}, [], { q: 'a', r: 'b' }];
  assert.doesNotThrow(() => {
    for (const j of junk) {
      claim(j, j, undefined, { materials: j });
      placeNode(j, j, j);
      staffNode(j, j, j);
      accrue(j, j, { now: j });
      collect(j, j, { now: j });
      resolveExpedition(j, j, { seed: j });
      reveal(j, j);
      claimCost(j, j);
      mapView(j);
      unitMultiplier(j);
      deedDescriptor(j, j, j);
    }
  });
});
