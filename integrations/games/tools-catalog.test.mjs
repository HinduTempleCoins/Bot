import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SKILLS, TIERS, TOOLS, tierById, toolById, toolsForSkill, toolsForAction, tiersForTool,
  variant, variantId, variantById, allVariants, speedMultiplier, yieldBonus,
  canUse, bestUsable, manufactureRecipe,
} from './tools-catalog.mjs';

test('every tool names a real skill and at least one action', () => {
  const skillIds = new Set(SKILLS.map((s) => s.id));
  for (const t of TOOLS) {
    assert.ok(skillIds.has(t.skill), `${t.id} has unknown skill ${t.skill}`);
    assert.ok(Array.isArray(t.actions) && t.actions.length > 0, `${t.id} has no actions`);
  }
});

test('tool ids and tier ids are unique', () => {
  assert.equal(new Set(TOOLS.map((t) => t.id)).size, TOOLS.length);
  assert.equal(new Set(TIERS.map((t) => t.id)).size, TIERS.length);
});

test('the tier ladder rises monotonically in rank, level, speed and value', () => {
  for (let i = 1; i < TIERS.length; i++) {
    const prev = TIERS[i - 1], cur = TIERS[i];
    assert.equal(cur.rank, prev.rank + 1);
    assert.ok(cur.level > prev.level, `${cur.id} level not above ${prev.id}`);
    assert.ok(cur.speed > prev.speed, `${cur.id} speed not above ${prev.id}`);
    assert.ok(cur.scrapValue > prev.scrapValue, `${cur.id} value not above ${prev.id}`);
    assert.ok(cur.yieldBonus >= prev.yieldBonus);
  }
});

test('a restricted tool only exists in its allowed tiers', () => {
  const can = tiersForTool('watering_can').map((t) => t.id);
  assert.deepEqual(can, ['clay', 'copper', 'bronze', 'iron']);
  assert.equal(variant('watering_can', 'star_iron'), null, 'star-iron watering can must not exist');
  assert.ok(variant('watering_can', 'iron'));
  // An unrestricted tool gets the whole ladder.
  assert.equal(tiersForTool('pickaxe').length, TIERS.length);
});

test('variant builds a concrete ownable item with the tier gate and scaled durability', () => {
  const v = variant('pickaxe', 'iron');
  assert.equal(v.id, 'iron_pickaxe');
  assert.equal(v.name, 'Iron Pickaxe');
  assert.equal(v.skill, 'mining');
  assert.equal(v.level, tierById('iron').level);
  assert.equal(v.speed, tierById('iron').speed);
  assert.ok(v.actions.includes('mine_ore'));
  // durability = base x (1 + rank x 0.25); iron is rank 3 → 125 x 1.75
  assert.equal(v.durability, Math.round(125 * 1.75));
  assert.ok(variant('pickaxe', 'star_iron').durability > v.durability);
});

test('mutating a returned variant cannot corrupt the catalog', () => {
  const v = variant('pickaxe', 'iron');
  v.actions.push('teleport');
  assert.equal(variant('pickaxe', 'iron').actions.includes('teleport'), false);
});

test('allVariants covers every legal tool x tier pair with unique ids', () => {
  const all = allVariants();
  const expected = TOOLS.reduce((n, t) => n + tiersForTool(t.id).length, 0);
  assert.equal(all.length, expected);
  assert.equal(new Set(all.map((v) => v.id)).size, all.length);
  assert.ok(all.every((v) => variantById(v.id)));
});

test('lookups are forgiving about case and spacing but reject nonsense', () => {
  assert.equal(toolById(' PickAxe ').id, 'pickaxe');
  assert.equal(tierById('STAR_IRON').id, 'star_iron');
  assert.equal(variantId('pickaxe', 'iron'), 'iron_pickaxe');
  assert.equal(toolById('sword'), null);
  assert.equal(tierById('unobtainium'), null);
  assert.equal(variantId('sword', 'iron'), '');
});

test('toolsForSkill and toolsForAction find the right implements', () => {
  assert.ok(toolsForSkill('mining').some((t) => t.id === 'pickaxe'));
  assert.equal(toolsForSkill('nonsense').length, 0);
  assert.ok(toolsForAction('distil').some((t) => t.id === 'alembic'));
  assert.equal(toolsForAction('').length, 0);
});

test('multipliers fall back safely for an unknown tier', () => {
  assert.equal(speedMultiplier('iron'), 1.6);
  assert.equal(speedMultiplier('unobtainium'), 1);
  assert.equal(yieldBonus('star_iron'), 0.3);
  assert.equal(yieldBonus(null), 0);
});

test('canUse enforces the tier level gate against the tool s own skill', () => {
  const v = variant('pickaxe', 'steel');           // needs mining 45
  assert.equal(canUse(v, { mining: 45 }), true);
  assert.equal(canUse(v, { mining: 44 }), false);
  assert.equal(canUse('steel_pickaxe', { mining: 99 }), true);
  assert.equal(canUse(v, { smithing: 99 }), false, 'the wrong skill must not unlock it');
  assert.equal(canUse(v, {}), false);
  assert.equal(canUse(variant('pickaxe', 'clay'), {}), true, 'the entry tier is usable from level 1');
});

test('bestUsable picks the highest rank the holder may actually use', () => {
  const owned = ['clay_pickaxe', 'steel_pickaxe', 'star_iron_pickaxe', 'iron_hatchet'];
  assert.equal(bestUsable('mine_ore', owned, { mining: 99 }).id, 'star_iron_pickaxe');
  assert.equal(bestUsable('mine_ore', owned, { mining: 45 }).id, 'steel_pickaxe');
  assert.equal(bestUsable('mine_ore', owned, { mining: 1 }).id, 'clay_pickaxe');
  assert.equal(bestUsable('fell', owned, { woodcutting: 99 }).id, 'iron_hatchet');
  assert.equal(bestUsable('mine_ore', ['iron_hatchet'], { mining: 99 }), null);
  assert.equal(bestUsable('mine_ore', [], { mining: 99 }), null);
});

test('manufactureRecipe states materials, station, gate and a scrap floor', () => {
  const r = manufactureRecipe('pickaxe', 'iron');
  assert.equal(r.variantId, 'iron_pickaxe');
  assert.equal(r.station, 'forge');
  assert.equal(r.skill, 'smithing');
  assert.equal(r.level, tierById('iron').level);
  assert.equal(r.materials.iron_bar, 3);
  assert.equal(r.materials.timber, 1);
  assert.equal(r.scrapValue, tierById('iron').scrapValue * 3);

  // Fired clay is shaped in a kiln, not forged.
  assert.equal(manufactureRecipe('quern', 'clay').station, 'kiln');
  assert.equal(manufactureRecipe('quern', 'clay').materials.clay_block, 4);
  // An illegal pairing has no recipe at all.
  assert.equal(manufactureRecipe('watering_can', 'star_iron'), null);
});

test('scrap value rises with tier, so a better tool is never cheaper to make', () => {
  let prev = 0;
  for (const t of TIERS) {
    const r = manufactureRecipe('pickaxe', t.id);
    assert.ok(r.scrapValue > prev, `${t.id} not dearer than the tier below`);
    prev = r.scrapValue;
  }
});

test('never throws on garbage input', () => {
  assert.doesNotThrow(() => variant(null, undefined));
  assert.doesNotThrow(() => canUse({}, null));
  assert.doesNotThrow(() => bestUsable(null, null, null));
  assert.doesNotThrow(() => manufactureRecipe({}, []));
  assert.equal(variant('', ''), null);
  assert.equal(canUse(null, {}), false);
  assert.equal(bestUsable('mine_ore', 'not-an-array', {}), null);
  assert.equal(manufactureRecipe('nope', 'nope'), null);
});
