// insect-ecosystem.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INSECTS, LIVESTOCK, PROBLEMS, MATERIALS, farmColony, bioconvert, pollinate,
  solutionsFor, deployControl, feed, versatilityOf, problemSolutionWeb,
  EDIBLE, ANIMALS, feedTo, predatorsOf, nutritionOf, foodWeb,
  BIOPROCESS, bioprocess,
  WILD, forage, capture, establishColony, canFarm,
  collectDung, compost, fertilizerGrade, INSECTS as INS,
} from './insect-ecosystem.mjs';

test('materials carry domains → versatility (frass/silk/wax beat single-use)', () => {
  assert.ok(versatilityOf('frass') >= 3);
  assert.ok(versatilityOf('silk') >= 3);
  assert.ok(versatilityOf('propolis') >= 1);
  for (const m of Object.values(MATERIALS)) assert.ok(m.domains.length >= 1);
});

test('bee colony produces hive materials, deterministically', () => {
  const a = farmColony('honeybee', { ctx: { blockId: '0xbee', txId: '0x1' }, cycles: 3, strength: 0.8 });
  const b = farmColony('honeybee', { ctx: { blockId: '0xbee', txId: '0x1' }, cycles: 3, strength: 0.8 });
  assert.deepEqual(a.products, b.products);
  assert.ok(a.products.honey >= 1 && a.products.beeswax >= 1);
});

test('a pure beneficial (mason bee / ladybug) yields no harvest — value is the service', () => {
  const r = farmColony('mason_bee', { ctx: { blockId: '0x1', txId: '0x1' } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.products, {});
  assert.match(r.note, /pollination/);
});

test('SOLDIER FLIES eat manure → frass + larvae (bioconversion); worms → castings', () => {
  const bsf = bioconvert('manure', { amount: 20, ctx: { blockId: '0x1', txId: '0x2' } });
  assert.equal(bsf.ok, true);
  assert.ok(bsf.products.frass > 0 && bsf.products.bsf_larvae > 0);
  assert.equal(bsf.solves, 'manure_buildup');
  const worm = bioconvert('food-waste', { agent: 'earthworm', amount: 10, ctx: { blockId: '0x1', txId: '0x3' } });
  assert.ok(worm.products.castings > 0);
  // wrong feedstock / wrong agent are refused
  assert.equal(bioconvert('metal', { amount: 5 }).reason, 'wont-eat-that');
  assert.equal(bioconvert('manure', { agent: 'ladybug' }).reason, 'not-a-decomposer');
});

test('bees are a cross-crop YIELD BOOST (pollination = their real versatility)', () => {
  const p = pollinate(100, { strength: 0.9 });
  assert.ok(p.multiplier > 1 && p.yield > 100);
  assert.equal(pollinate(100, { colony: 'ladybug' }).ok, false); // not a pollinator
});

test('problems map to farmable solutions (IPM web)', () => {
  const sols = solutionsFor('aphids').map((s) => s.agent);
  assert.ok(sols.includes('ladybug') && sols.includes('chicken'));
  assert.equal(solutionsFor('nope').length, 0);
  const web = problemSolutionWeb();
  assert.equal(web.length, Object.keys(PROBLEMS).length);
});

test('deployControl only accepts a valid control; fowl also give byproducts', () => {
  assert.equal(deployControl('aphids', 'duck').reason, 'not-a-control-for-this-problem');
  const lady = deployControl('aphids', 'ladybug', { ctx: { blockId: '0x1', txId: '0x4' }, count: 2 });
  assert.ok(lady.ok && lady.reduction > 0 && lady.reduction <= 1);
  const hen = deployControl('aphids', 'chicken', { ctx: { blockId: '0x1', txId: '0x5' } });
  assert.ok(hen.byproduct.includes('eggs')); // chickens patrol AND lay
});

test('the bugs are FOOD for many other animals — the food web spans classes', () => {
  // same BSF larvae feed fowl, fish, reptiles, amphibians, songbirds
  assert.deepEqual(predatorsOf('bsf_larvae').sort(), ['amphibian', 'fish', 'fowl', 'reptile', 'songbird']);
  assert.ok(nutritionOf('bsf_larvae') > nutritionOf('bait_worm'));
  assert.equal(foodWeb().length, Object.keys(EDIBLE).length);
});

test('feedTo generalizes across the web — larvae→koi, mealworm→gecko, worm→catfish', () => {
  const koi = feedTo('koi', 'bsf_larvae', { ctx: { blockId: '0x1', txId: '0x6' } });
  assert.ok(koi.ok && koi.class === 'fish' && koi.growth > 0);
  const koi2 = feedTo('koi', 'bsf_larvae', { ctx: { blockId: '0x1', txId: '0x6' } });
  assert.equal(koi.growth, koi2.growth); // deterministic
  assert.ok(feedTo('gecko', 'mealworm').ok);
  assert.ok(feedTo('catfish', 'bait_worm').ok);
  // a class that doesn't eat it is refused; an ad-hoc animal descriptor works too
  assert.equal(feedTo('koi', 'mealworm').reason, 'class-wont-eat-that'); // mealworm not fed to fish here
  assert.ok(feedTo({ class: 'reptile' }, 'live_cricket').ok);
  assert.equal(feedTo('koi', 'silk').reason, 'not-a-feed-item');
});

test('animal PARTS are food for carnivores/scavengers (keys match spirits-and-parts)', () => {
  assert.ok(predatorsOf('bone').includes('carnivore'));
  assert.ok(feedTo('dog', 'marrow').ok);            // marrow → carnivore
  assert.ok(feedTo('crab', 'fish_scraps').ok);      // scraps → scavenger (crab → aquatic-farm)
  assert.ok(feedTo('vulture', 'carrion').ok);       // carrion → scavenger
  assert.equal(feedTo('songbird', 'bone').reason, 'class-wont-eat-that'); // a songbird won't
});

test('bioprocess: animal-mediated refinement (civet coffee) — collected, non-lethal, value uplift', () => {
  const c = bioprocess('civet_coffee', { amount: 10, ctx: { blockId: '0x1', txId: '0x7' } });
  assert.ok(c.ok && c.output === 'civet_coffee' && c.amount > 0);
  assert.equal(c.collected, true);       // collected from natural droppings, never force-fed
  assert.ok(c.uplift > 1 && c.domains.includes('luxury'));
  const c2 = bioprocess('civet_coffee', { amount: 10, ctx: { blockId: '0x1', txId: '0x7' } });
  assert.equal(c.amount, c2.amount);     // deterministic
  assert.equal(bioprocess('nope').reason, 'unknown-bioprocess');
});

test('ACQUISITION is capture-and-breed only: forage the world → what you find is KNOWN on sight', () => {
  const ctx = { blockId: '0xf0', txId: '0x1' };
  const f = forage({ ctx, biome: 'compost', season: 'summer' });
  assert.ok(f.ok);
  // a real wild entry (with a known species, no mystery) or an honest miss
  assert.ok(f.found === null || (WILD[f.found.id] && f.found.species === WILD[f.found.id].species));
  const f2 = forage({ ctx, biome: 'compost', season: 'summer' });
  assert.deepEqual(f, f2); // deterministic
});

test('breeding gate: a colony needs a same-species, opposite-sex PAIR (no store-bought stock)', () => {
  const bsfF = { id: 'soil_grub', species: 'black_soldier_fly', sex: 'f' };
  const bsfM = { id: 'soil_grub', species: 'black_soldier_fly', sex: 'm' };
  assert.ok(establishColony(bsfF, bsfM).ok);
  assert.equal(establishColony({ sex: 'f' }, { sex: 'm' }).reason, 'need-two-captures');
  assert.equal(establishColony(bsfF, { species: 'cricket', sex: 'm' }).reason, 'species-mismatch');
  assert.equal(establishColony(bsfF, { species: 'black_soldier_fly', sex: 'f' }).reason, 'need-a-breeding-pair');
  // production is gated on having that established colony
  const colonies = [establishColony(bsfF, bsfM).colony];
  assert.ok(canFarm('black_soldier_fly', colonies));
  assert.equal(canFarm('honeybee', colonies), false);
});

test('capture can fail (it got away) and succeed by gear; success yields stock', () => {
  const find = { id: 'royal_swarm', identifiedAs: null, grub: false, rare: true };
  // rare + bare hands over many contexts should sometimes fail and sometimes succeed
  let ok = 0, miss = 0;
  for (let i = 0; i < 20; i++) {
    const r = capture(find, { ctx: { blockId: '0x1', txId: `0x${i}` }, gear: 'hands' });
    r.ok ? ok++ : miss++;
    if (r.ok) assert.ok(r.stock.id === 'royal_swarm');
  }
  assert.ok(ok > 0 && miss > 0, `expected mixed outcomes, got ok=${ok} miss=${miss}`);
  assert.equal(capture(null).reason, 'nothing-to-capture');
});

test('dung beetles COLLECT dung into piles + bury some (in-place fertility); deterministic', () => {
  assert.equal(INS.dung_beetle.role, 'collector');
  const a = collectDung({ scattered: 20, beetles: 3, ctx: { blockId: '0x1', txId: '0xa' } });
  const b = collectDung({ scattered: 20, beetles: 3, ctx: { blockId: '0x1', txId: '0xa' } });
  assert.deepEqual(a, b);
  assert.ok(a.piles > 0 && a.buried > 0);
  assert.ok(a.gathered <= 20 && Math.abs(a.piles + a.buried - a.gathered) < 1e-9);
  assert.ok(solutionsFor('manure_buildup').map((s) => s.agent).includes('dung_beetle'));
});

test('raw manure fertilizes with NO composting; composting is an OPTIONAL upgrade to grade 2', () => {
  assert.equal(fertilizerGrade('manure'), 1);          // works raw — no composting even
  assert.ok(MATERIALS.manure.domains.includes('fertilizer'));
  const c = compost(20, { method: 'hot', ctx: { blockId: '0x1', txId: '0xb' } });
  assert.ok(c.ok && c.output === 'compost' && c.amount > 0 && c.grade === 2);
  assert.ok(fertilizerGrade('compost') > fertilizerGrade('manure')); // richer, but never required
});

test('the loop closes: farmed feed → fowl/reptiles → manure → decomposers', () => {
  assert.ok(feed('chicken', 'bsf_larvae').ok);        // BSF larvae feed the fowl
  assert.ok(feed('reptile', 'cricket_flour').ok);     // crickets feed the reptiles (from the post)
  assert.equal(feed('chicken', 'silk').reason, 'wont-eat-that');
  assert.ok(LIVESTOCK.chicken.products.includes('manure')); // whose manure the soldier flies then eat
  assert.ok(INSECTS.black_soldier_fly.eats.includes('manure'));
});
