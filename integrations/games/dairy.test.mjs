// dairy.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DAIRY_ANIMALS, MATERIALS, milkAnimal, separate, churn, clarify, fermentMilk,
  makeCheese, versatilityOf, dairyWeb,
} from './dairy.mjs';

test('materials carry domains → versatility (ghee/whey earn their keep)', () => {
  assert.ok(versatilityOf('ghee') >= 3);      // food+medicine+alchemy+trade
  assert.ok(versatilityOf('whey') >= 3);      // feed+substrate+food
  for (const m of Object.values(MATERIALS)) assert.ok(m.domains.length >= 1);
});

test('milking is deterministic; richer animals give more/fattier milk', () => {
  const a = milkAnimal('buffalo', { ctx: { blockId: '0x1', txId: '0x1' }, cycles: 2 });
  const b = milkAnimal('buffalo', { ctx: { blockId: '0x1', txId: '0x1' }, cycles: 2 });
  assert.deepEqual(a, b);
  assert.ok(a.milk > 0 && a.fat === DAIRY_ANIMALS.buffalo.fat);
  assert.equal(milkAnimal('cat').reason, 'not-a-dairy-animal');
});

test('separate → churn → clarify chain conserves sensibly', () => {
  const { cream, skim } = separate(10, { fat: 0.04 });
  assert.ok(cream > 0 && skim > 0 && cream < skim);
  const { butter, buttermilk } = churn(cream, { ctx: { blockId: '0x1', txId: '0x2' } });
  assert.ok(butter > 0 && buttermilk >= 0);
  const { ghee, milk_solids } = clarify(butter);
  assert.ok(ghee > 0 && milk_solids > 0 && ghee > milk_solids);
});

test('yogurt/kefir REQUIRE a probiotic starter from the microbe lab', () => {
  const y = fermentMilk(10, { kind: 'yogurt', ctx: { blockId: '0x1', txId: '0x3' } });
  assert.ok(y.ok && y.product === 'yogurt' && y.amount > 0);
  assert.ok(fermentMilk(10, { kind: 'kefir' }).ok);
  assert.equal(fermentMilk(10, { starter: 'water' }).reason, 'need-a-probiotic-starter');
  assert.equal(fermentMilk(10, { kind: 'butter' }).reason, 'unknown-ferment');
});

test('cheese REQUIRES rennet (an enzyme culture) and drains WHEY for re-use', () => {
  const c = makeCheese(10, { ctx: { blockId: '0x1', txId: '0x4' } });
  assert.ok(c.ok && c.cheese > 0 && c.whey > 0);
  assert.ok(c.cheese < c.whey);                         // most of the milk leaves as whey
  assert.equal(makeCheese(10, { rennet: 'none' }).reason, 'need-rennet-enzyme');
});

test('dairyWeb documents the branching chains (whey loops back to the microbe lab + feed)', () => {
  const web = dairyWeb();
  assert.ok(web.animals.includes('cow') && web.animals.includes('buffalo'));
  const wheyReuse = web.chains.find((c) => c.from === 'whey');
  assert.ok(wheyReuse.to.includes('microbe-substrate') && wheyReuse.to.includes('livestock-feed'));
});
