import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FACTORS, FACTOR_CLASSES, FACTOR_RECIPES, FACTOR_VALUE, CERAMIC_LEACH_LIMITS, ECONOMY_ROLES,
  factorById, factorsByClass, economyRoleOf, safetyOf, sourcingOf, devotionalOf,
  isFoodContact, requiresRespirator, isCitesListed, inputsTo, perishableWithin,
  auditNoPump, sinkProfile, factorEconomy, validateFactors, esc,
} from './botanica-factors.mjs';

// ── taxonomy ────────────────────────────────────────────────────────────────────────────────────
test('the taxonomy names five classes and the four non-growing ones are populated', () => {
  assert.deepEqual(FACTOR_CLASSES, ['grown', 'mineral', 'burnable', 'vessel', 'made']);
  for (const c of ['mineral', 'burnable', 'vessel', 'made']) {
    assert.ok(factorsByClass(c).length >= 5, `${c} has only ${factorsByClass(c).length}`);
  }
  // `grown` is deliberately empty here — plant-catalog.mjs owns it, this module does not duplicate it.
  assert.equal(factorsByClass('grown').length, 0);
});

test('every factor carries the four attributes a live plant has no analogue for', () => {
  for (const f of FACTORS) {
    assert.ok('shelfLifeDays' in f, `${f.id} missing shelfLifeDays`);
    assert.equal(typeof f.consumedOnUse, 'boolean', `${f.id} consumedOnUse`);
    assert.equal(typeof f.makeable, 'boolean', `${f.id} makeable`);
    assert.ok(Array.isArray(f.inputTo) && f.inputTo.length > 0, `${f.id} inputTo`);
  }
});

test('each class maps to a distinct economic role', () => {
  assert.equal(ECONOMY_ROLES.grown.role, 'faucet');
  assert.equal(ECONOMY_ROLES.burnable.role, 'sink');
  assert.equal(ECONOMY_ROLES.vessel.role, 'durable');
  assert.equal(ECONOMY_ROLES.made.role, 'converter');
  assert.equal(ECONOMY_ROLES.mineral.role, 'import');
  assert.equal(economyRoleOf('incense_stick').role, 'sink');
  assert.equal(economyRoleOf('terracotta_planter').role, 'durable');
  assert.equal(economyRoleOf('nope'), null);
});

// ── diatomaceous earth: the real-world distinction ──────────────────────────────────────────────
test('DE is modelled as two materials, not one — food grade and calcined', () => {
  const food = factorById('de_food_grade');
  const pool = factorById('de_calcined');
  assert.ok(food && pool);
  assert.equal(food.grade, 'food');
  assert.equal(pool.grade, 'calcined');
  assert.notEqual(food.safety.crystallineSilica, pool.safety.crystallineSilica);
});

test('calcined DE names cristobalite, the silica regulation, and the never-do', () => {
  const pool = factorById('de_calcined');
  assert.match(pool.safety.crystallineSilica, /cristobalite/i);
  assert.match(pool.safety.inhalationNote, /IARC Group 1/);
  assert.match(pool.safety.inhalationNote, /1910\.1053/);
  assert.match(pool.safety.inhalationNote, /50 µg\/m³/);
  assert.match(pool.safety.neverDo, /NEVER use pool\/filter grade as an insecticide/);
  assert.equal(pool.safety.foodContactSafe, false);
});

test('the respirator applies to BOTH grades — "food grade" is about swallowing, not breathing', () => {
  assert.equal(requiresRespirator('de_food_grade'), true);
  assert.equal(requiresRespirator('de_calcined'), true);
  const food = factorById('de_food_grade');
  assert.match(food.safety.inhalationNote, /safe to SWALLOW, not what is safe to BREATHE/);
  assert.match(food.safety.ppe, /N95/);
  assert.match(pool_ppe(), /P100/);
  function pool_ppe() { return factorById('de_calcined').safety.ppe; }
});

test('food-grade DE carries its regulation, its mechanism and the pollinator fact', () => {
  const food = factorById('de_food_grade');
  assert.match(food.safety.regulatory, /21 CFR 573\.940/);
  assert.match(food.safety.mechanism, /abrade/i);
  assert.match(food.safety.ecological, /NON-SELECTIVE/);
  assert.match(food.safety.ecological, /pollinator/i);
  assert.equal(food.safety.foodContactSafe, true);
});

test('the wet slurry exists as the dust-free route, and still inherits the bloom rule', () => {
  const slurry = factorById('de_slurry');
  assert.ok(slurry);
  assert.equal(slurry.safety.dust, false);
  assert.equal(slurry.makeable, true);
  assert.ok(slurry.recipe.some((i) => i.item === 'de_food_grade'));
  assert.match(slurry.safety.note, /still kills pollinators/);
});

// ── burnables: combustion + sourcing ────────────────────────────────────────────────────────────
test('every burnable carries ventilation and particulate guidance', () => {
  for (const f of factorsByClass('burnable')) {
    assert.ok(f.safety.ventilation, `${f.id} no ventilation`);
    assert.ok(f.safety.particulate, `${f.id} no particulate`);
    assert.ok(f.safety.fire, `${f.id} no fire guidance`);
  }
  assert.match(factorById('incense_stick').safety.particulate, /15 µg\/m³/);
});

test('every burnable declares a CITES status, a species and a verification date', () => {
  for (const f of factorsByClass('burnable')) {
    const s = sourcingOf(f.id);
    assert.ok(s, `${f.id} no sourcing`);
    assert.ok(s.cites, `${f.id} no cites field`);
    assert.ok(s.species, `${f.id} no species`);
    assert.match(s.verifiedOn, /^\d{4}-\d{2}-\d{2}$/, `${f.id} verifiedOn`);
  }
});

test('agarwood is Appendix II and says so; the shelf knows which items are listed', () => {
  assert.equal(isCitesListed('agarwood_chips'), true);
  assert.equal(sourcingOf('agarwood_chips').cites, 'appendix-ii');
  assert.match(sourcingOf('agarwood_chips').permit, /CITES documentation/);
  assert.equal(isCitesListed('white_sage_bundle'), false);
  assert.equal(isCitesListed('not_a_thing'), false);
});

test('the two name collisions that are the actual sourcing hazard are recorded', () => {
  // "palo santo" is Bursera (unlisted) AND Guaiacum (Appendix II).
  assert.match(sourcingOf('palo_santo_sticks').nameCollision, /Guaiacum/);
  assert.match(sourcingOf('palo_santo_sticks').nameCollision, /Appendix II/);
  // "sandalwood" is Santalum (unlisted, Vulnerable) AND Pterocarpus santalinus (Appendix II).
  assert.match(sourcingOf('sandalwood_powder').nameCollision, /Pterocarpus santalinus/);
});

test('a taxon under listing pressure is flagged so a stale table looks stale', () => {
  assert.equal(sourcingOf('frankincense_tears').citesWatch, true);
  assert.equal(sourcingOf('agarwood_chips').citesWatch, false);
});

test('the charcoal disc leads with carbon monoxide, not with incense', () => {
  const cm = factorById('charcoal_disc').safety.carbonMonoxide;
  assert.match(cm, /CARBON MONOXIDE/);
  assert.match(cm, /oxidiser/i);
  assert.match(cm, /CO alarm/);
});

test('the beeswax candle carries the lead-wick ban', () => {
  assert.match(factorById('beeswax_candle').safety.wick, /16 CFR 1500\.17/);
  assert.match(factorById('beeswax_candle').safety.wick, /2003/);
});

test('white sage names whose plant it is instead of talking around it', () => {
  const s = sourcingOf('white_sage_bundle');
  assert.match(s.culturalNote, /Indigenous/);
  assert.match(s.culturalNote, /contested BY those nations/);
  assert.match(s.pressure, /CULTIVATED/);
});

// ── vessels: food contact is the hazard ─────────────────────────────────────────────────────────
test('a devotional bowl that holds prasad is modelled as food contact', () => {
  assert.equal(isFoodContact('offering_bowl'), true);
  assert.equal(isFoodContact('kalash'), true);
  assert.equal(isFoodContact('terracotta_planter'), false);
  assert.equal(isFoodContact('censer'), false);
  assert.equal(isFoodContact('murti_small'), false);
});

test('every food-contact vessel is lead-free and names a leach test', () => {
  for (const f of factorsByClass('vessel')) {
    assert.notEqual(f.vessel.foodContact, undefined, `${f.id}`);
    assert.ok(f.vessel.leachTest, `${f.id} no leach test position`);
    if (f.vessel.foodContact) {
      assert.equal(f.vessel.leadFree, true, `${f.id} food contact but not lead-free`);
      assert.ok(f.vessel.hazard, `${f.id} food contact but no hazard`);
    }
  }
  assert.match(factorById('offering_bowl').vessel.leachTest, /ASTM C738/);
  assert.match(factorById('offering_bowl').vessel.hazard, /lead poisoning/i);
});

test('the FDA ceramic leach action levels are numbers in the model, not prose', () => {
  assert.equal(CERAMIC_LEACH_LIMITS.flatware.lead, 3.0);
  assert.equal(CERAMIC_LEACH_LIMITS.small_hollowware.lead, 2.0);
  assert.equal(CERAMIC_LEACH_LIMITS.large_hollowware.lead, 1.0);
  assert.equal(CERAMIC_LEACH_LIMITS.cups_mugs_pitchers.lead, 0.5);
  assert.equal(CERAMIC_LEACH_LIMITS.large_hollowware.cadmium, 0.25);
  assert.match(CERAMIC_LEACH_LIMITS.method, /ASTM C738/);
  assert.match(CERAMIC_LEACH_LIMITS.note, /545\.450/);
});

test('the copper vessel carries the acid limit and the tin re-lining', () => {
  assert.match(factorById('kalash').vessel.hazard, /pH 6/);
  assert.match(factorById('kalash').vessel.hazard, /kalai/);
  assert.match(factorById('copper_stock').safety.corrosive, /RE-LINES/);
});

test('a glaze frit exists so the shelf never needs a lead glaze', () => {
  const frit = factorById('glaze_frit');
  assert.ok(frit);
  assert.equal(frit.makeable, true);
  assert.ok(inputsTo('offering_bowl').some((f) => f.id === 'glaze_frit'));
  assert.match(frit.safety.note, /lead-free/);
});

// ── devotional handling ─────────────────────────────────────────────────────────────────────────
test('the murti separates the sold image from the consecrated one', () => {
  const d = devotionalOf('murti_small');
  assert.ok(d);
  assert.match(d.handling, /UNINSTALLED/);
  assert.match(d.handling, /prana pratishtha/);
  assert.match(d.handling, /visarjan/);
  assert.match(d.neverDo, /floor, a shoe, a doormat/);
  assert.match(d.iconography, /shilpa shastra/);
});

test('every devotional record names a tradition and a handling practice', () => {
  for (const f of FACTORS) {
    if (!f.devotional) continue;
    assert.ok(f.devotional.tradition, `${f.id} no tradition`);
    assert.ok(f.devotional.handling, `${f.id} no handling`);
  }
  assert.equal(devotionalOf('de_food_grade'), null);
});

test('vibhuti closes the loop: the burnable sink residue becomes a made good', () => {
  const v = factorById('vibhuti');
  assert.equal(v.class, 'made');
  assert.ok(v.recipe.some((i) => i.item === 'havan_samagri'));
  assert.ok(v.recipe.some((i) => i.item === 'ash'));
  assert.match(v.safety.note, /Clean feedstock is a safety property/);
});

test('kumkum carries the lead-adulteration fact', () => {
  assert.match(factorById('kumkum').safety.note, /ADULTERATED/);
  assert.match(factorById('kumkum').safety.note, /lead tetroxide/);
});

// ── shelf life ──────────────────────────────────────────────────────────────────────────────────
test('shelf life separates what spoils from what does not', () => {
  assert.equal(factorById('frankincense_tears').shelfLifeDays, null, 'resin does not spoil');
  assert.equal(factorById('terracotta_planter').shelfLifeDays, null, 'fired clay does not spoil');
  assert.ok(factorById('havan_samagri').shelfLifeDays > 0, 'an oiled blend does spoil');
  assert.ok(factorById('de_slurry').shelfLifeDays > 0, 'a wet slurry does not keep');
  const soon = perishableWithin(60).map((f) => f.id);
  assert.ok(soon.includes('de_slurry'));
  assert.ok(!soon.includes('frankincense_tears'));
  assert.deepEqual(perishableWithin(0), []);
});

// ── economy ─────────────────────────────────────────────────────────────────────────────────────
test('the factor recipes obey value=labor — no money pump', () => {
  const a = auditNoPump();
  assert.equal(a.ok, true, JSON.stringify((a.violations || []).slice(0, 4)));
});

test('every makeable factor has a recipe and a value; every recipe output is priced', () => {
  assert.ok(FACTOR_RECIPES.length >= 20, `only ${FACTOR_RECIPES.length}`);
  for (const r of FACTOR_RECIPES) {
    assert.ok(FACTOR_VALUE[r.output.item] > 0, `${r.output.item} unpriced`);
    for (const i of r.inputs) assert.ok(FACTOR_VALUE[i.item] > 0, `input ${i.item} unpriced`);
  }
});

test('the shelf registers only drains — it cannot emit', () => {
  const econ = factorEconomy({ growEmissionPerPeriod: 0 });
  assert.equal(econ.faucets, 0);
  assert.ok(econ.drains > 25, `only ${econ.drains} drains`);
  assert.equal(econ.month.totalEmission, 0);
  assert.ok(econ.month.totalSink > 0);
  assert.equal(econ.healthy, true);
});

test('against a grow-side faucet the shelf absorbs it, and the headroom is reported honestly', () => {
  const econ = factorEconomy({ growEmissionPerPeriod: 200, period: 30 });
  assert.equal(econ.faucets, 1);
  assert.equal(econ.emission, 200);
  assert.ok(econ.headroom > 0, 'shelf should have headroom over a 200/period faucet');
  assert.equal(econ.balance.ok, true, 'the grow faucet must have a matching drain category');
  assert.ok(econ.month.net < 0, `net should be deflationary, got ${econ.month.net}`);
  assert.equal(econ.healthy, true);
});

test('an emission bigger than the shelf shows as negative headroom rather than being hidden', () => {
  const econ = factorEconomy({ growEmissionPerPeriod: 999999, period: 1 });
  assert.ok(econ.headroom < 0);
  assert.equal(econ.healthy, false);
  assert.ok(econ.month.net > 0, 'an over-large faucet must read as inflating');
});

test('the sink profile is ordered and says why each line drains', () => {
  const p = sinkProfile();
  assert.ok(p.length >= 30);
  for (let i = 1; i < p.length; i += 1) assert.ok(p[i - 1].rate >= p[i].rate, 'not sorted');
  for (const s of p) {
    assert.ok(s.why, `${s.id} no reason`);
    assert.ok(FACTOR_CLASSES.includes(s.class));
    assert.notEqual(s.class, 'grown', 'the grow side is not a drain');
  }
  assert.ok(p.some((s) => s.class === 'burnable' && s.terminal));
  assert.ok(p.some((s) => s.class === 'vessel' && !s.terminal));
});

// ── structural validation (the guard that requires facts, not the kind that withholds them) ─────
test('the shipped shelf validates clean', () => {
  const v = validateFactors();
  assert.equal(v.ok, true, JSON.stringify(v.problems.slice(0, 6)));
  assert.equal(v.counts.factors, FACTORS.length);
  assert.ok(v.counts.terminalSinks > v.counts.factors / 2, 'most of the shelf should be a sink');
  assert.equal(v.counts.foodContact, 2);
  assert.equal(v.counts.citesListed, 1);
});

test('validateFactors actually catches a food-contact vessel with no lead declaration', () => {
  const bad = [{
    id: 'bad_bowl', name: 'Bad Bowl', class: 'vessel', domains: ['food'], inputTo: ['x'],
    makeable: false, consumedOnUse: false, shelfLifeDays: null,
    vessel: { foodContact: true, leachTest: 'none', leadFree: false },
  }];
  const v = validateFactors(bad);
  assert.equal(v.ok, false);
  assert.ok(v.problems.some((p) => /not declared lead-free/.test(p.issue)));
  assert.ok(v.problems.some((p) => /states no hazard/.test(p.issue)));
});

test('validateFactors catches a burnable with no ventilation or sourcing', () => {
  const bad = [{
    id: 'bad_burn', name: 'Bad Burn', class: 'burnable', domains: ['incense'], inputTo: ['x'],
    makeable: false, consumedOnUse: true, shelfLifeDays: null, safety: {},
  }];
  const v = validateFactors(bad);
  assert.equal(v.ok, false);
  const issues = v.problems.map((p) => p.issue).join(' | ');
  assert.match(issues, /no ventilation guidance/);
  assert.match(issues, /no particulate guidance/);
  assert.match(issues, /no sourcing record/);
});

test('validateFactors catches a dust mineral with no PPE, and dead stock', () => {
  const bad = [{
    id: 'bad_dust', name: 'Bad Dust', class: 'mineral', domains: ['industrial'], inputTo: [],
    makeable: false, consumedOnUse: true, shelfLifeDays: null,
    safety: { dust: true, foodContactSafe: false },
  }];
  const v = validateFactors(bad);
  assert.equal(v.ok, false);
  const issues = v.problems.map((p) => p.issue).join(' | ');
  assert.match(issues, /declares no PPE/);
  assert.match(issues, /dead stock/);
});

// ── house style: soft-fail, esc ─────────────────────────────────────────────────────────────────
test('lookups soft-fail on nonsense instead of throwing', () => {
  assert.equal(factorById(null), null);
  assert.equal(factorById(undefined), null);
  assert.deepEqual(factorsByClass('nope'), []);
  assert.deepEqual(safetyOf('nope'), []);
  assert.equal(sourcingOf(''), null);
  assert.equal(devotionalOf(null), null);
  assert.equal(isFoodContact(null), false);
  assert.equal(requiresRespirator(undefined), false);
  assert.deepEqual(inputsTo(null), []);
  assert.doesNotThrow(() => validateFactors(null));
  assert.doesNotThrow(() => validateFactors([null, 7, 'x']));
  assert.doesNotThrow(() => factorEconomy({ growEmissionPerPeriod: NaN }));
  assert.doesNotThrow(() => factorEconomy());
});

test('safetyOf flattens the facts and never drops the food-contact line', () => {
  const lines = safetyOf('offering_bowl');
  assert.ok(lines.some((l) => l.key === 'foodContact'));
  assert.ok(lines.some((l) => l.key === 'vesselHazard'));
  const de = safetyOf('de_calcined').map((l) => l.key);
  assert.ok(de.includes('ppe') && de.includes('neverDo') && de.includes('inhalationNote'));
  assert.ok(!de.includes('dust'), 'boolean flags are queried, not rendered as prose');
});

test('esc escapes every interpolation character', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
  assert.equal(esc(0), '0');
});
