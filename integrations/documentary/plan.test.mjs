import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePlan, scorePlan, factPlan, planPrompt } from './plan.mjs';
import { buildBoard } from './run.mjs';
import { chooseStyle } from './batch.mjs';
import { TOPICS } from './topics.mjs';

const sheet = TOPICS['kush-nile'];
const allowed = sheet.facts.map((f) => f.source);

test('parsePlan is tolerant; scorePlan rewards sourced cards, hedged myth, sparse text and variety', () => {
  const raw = 'Here you go:\n```json\n{"scenes":[{"sequence":1,"visual":"the Nile at dawn","camera":"push_in","seconds":8,"card":"","kind":"none"},{"sequence":1,"visual":"archers train by the river","camera":"pan_left","seconds":9,"card":"Ta-Seti — the Land of the Bow","kind":"record","source":"Egyptian texts (Middle and New Kingdom)"},{"sequence":2,"visual":"the god Amun inside the mountain","camera":"weird","seconds":30,"card":"Amun lived in the mountain","kind":"record","source":"Made Up"}]}\n```';
  const sc = parsePlan(raw);
  assert.equal(sc.length, 3); assert.equal(sc[2].camera, 'push_in'); assert.equal(sc[2].seconds, 14);
  const m = scorePlan(sc, { minutes: 0.5, allowedSources: allowed });
  assert.equal(m.cardSourcing, 0.5); assert.equal(m.mythHedged, 0); // "Amun lived…" states myth as fact
  assert.equal(parsePlan('no json here').length, 0);
});

test('prompt carries the facts, the alpha rule and the no-narration rule; fallback plan uses fact cards', () => {
  const { system, prompt } = planPrompt({ topic: sheet, facts: sheet.facts, minutes: 10, style: 'mythic' });
  assert.match(system, /ALPHA/); assert.match(system, /No narration/);
  assert.match(prompt, /\[record: Lion Temple at Naqa\]/);
  const fp = factPlan(sheet, new Map(sheet.facts.map((f) => [f.id, f])));
  assert.ok(fp.some((s) => s.card === 'How were these raised?'));
});

test('board: corrects a mislabelled card from the fact sheet, reuses parts with variety, logs missing scenes', () => {
  const index = [
    { id: 'remake:nile_a:1_real:nubian', path: 'a.png', text: 'Nile river boat Nubia', people: 'nubian', type: 'remake' },
    { id: 'remake:nile_b:1_real:nubian', path: 'b.png', text: 'Nile river fishing Nubia', people: 'nubian', type: 'remake' },
    { id: 'remake:archers:1_real:nubian', path: 'c.png', text: 'Nubian archers bow military', people: 'nubian', type: 'remake' },
  ];
  const plan = { topic: 'kush-nile', title: sheet.title, sequences: ['The River'], scenes: [
    { sequence: 1, visual: 'the Nile at dawn with boats', camera: 'push_in', seconds: 8, card: 'The Institute reads the flood as Hapi', kind: 'interpretation', source: 'Egyptian religious texts' },
    { sequence: 1, visual: 'archers with bows', camera: 'still', seconds: 8, card: '', kind: 'none', source: '' },
    { sequence: 1, visual: 'a dragon over glaciers', camera: 'still', seconds: 8, card: '', kind: 'none', source: '' },
  ] };
  const b = buildBoard(plan, index);
  assert.equal(b.shots[0].kind, 'record'); assert.equal(b.shots[0].card, 'Egyptians and Kushites saw the yearly flood as the god Hapi'); assert.ok(b.shots[0].corrected);
  assert.equal(b.shots[1].asset, 'remake:archers:1_real:nubian');
  assert.equal(b.missing.length, 1); assert.match(b.missing[0].visual, /dragon/);
  assert.deepEqual(b.sources.record, ['Egyptian religious texts']);
});

test('chooseStyle: Thompson sampling favours the style people liked', () => {
  const fb = { films: { a: { style: 'mythic', up: 40, down: 0 }, b: { style: 'wonder', up: 0, down: 40 } } };
  let mythic = 0; for (let i = 0; i < 200; i++) if (chooseStyle(fb) === 'mythic') mythic += 1;
  assert.ok(mythic > 150, `mythic chosen ${mythic}/200`);
});

test('era filter: an ancient film never uses a modern-scene asset; the anachronism check flags one if it slips in', async () => {
  const { anachronismCheck } = await import('./shots.mjs');
  const index = [
    { id: 'remake:nile_view_in_cairo:1_real:nubian', path: 'cairo.png', text: 'A View in Cairo Ports, the Nile & the coast David Roberts nile city river', people: 'nubian', type: 'remake', depicts: 'modern', region: '' },
    { id: 'remake:mosque_nile:1_real:nubian', path: 'm.png', text: 'Nile river boats by a mosque', people: 'nubian', type: 'remake', depicts: 'ancient', region: 'nile' },
    { id: 'remake:huy_boat:1_real:nubian', path: 'huy.png', text: 'Boat from Nubia Nile river', people: 'nubian', type: 'remake', depicts: 'ancient', region: 'nile' },
    { id: 'remake:tassili:1_real:depicted', path: 't.png', text: 'Nile river archers Tassili', people: '', type: 'remake', depicts: 'ancient', region: 'maghreb-sahara' },
  ];
  for (let i = 0; i < 20; i++) index.push({ id: `remake:filler${i}:1_real:x`, path: `f${i}.png`, text: 'tomb painting', type: 'remake', depicts: 'ancient', region: 'nile' });
  const plan = { topic: 'kush-nile', title: 'Kush and the Nile', sequences: ['The River'], scenes: [
    { sequence: 1, visual: 'a Nile river city with boats', camera: 'still', seconds: 8, card: '', kind: 'none', source: '' },
    { sequence: 1, visual: 'a Nile river city with boats again', camera: 'still', seconds: 8, card: '', kind: 'none', source: '' },
  ] };
  const b = buildBoard(plan, index);
  const used = b.shots.map((s) => s.asset);
  assert.ok(!used.includes('remake:nile_view_in_cairo:1_real:nubian'), 'modern scene excluded');
  assert.ok(!used.includes('remake:mosque_nile:1_real:nubian'), 'anachronism word excluded');
  assert.ok(!used.includes('remake:tassili:1_real:depicted'), 'other region excluded');
  assert.equal(b.anachronisms.length, 0);
  assert.equal(anachronismCheck({ shots: [{ image: 'cairo.png' }, { image: 'huy.png' }] }, index).length, 1);
});

test('board: real maps — region pick + Cush/Kush synonyms open the film, and a "Map" chapter gets its own map', async () => {
  const { pickMaps } = await import('./run.mjs');
  const maps = [
    { id: 'map:kush-nubia', type: 'map', path: 'kush.mp4', seconds: 20, text: 'map Kush and Nubia nile', credit: 'Cliopatria (CC BY 4.0)' },
    { id: 'map:egypt', type: 'map', path: 'egypt.mp4', seconds: 20, text: 'map Egypt nile', credit: 'Cliopatria (CC BY 4.0)' },
    { id: 'map:china', type: 'map', path: 'china.mp4', seconds: 20, text: 'map China', credit: 'Cliopatria (CC BY 4.0)' },
  ];
  const topicDef = { region: 'nile', peoples: 'nubian', name: 'Havilah and Cush Before and After Noah' };
  const plan = { topic: 'havilah-cush', topicDef, minutes: 10, title: 'Havilah and Cush Before and After Noah',
    sequences: ['Genesis and the Biblical Map', 'Kush: Nubian Kingdom and Its Gold', 'Arabian Gold and the Havilah Region'],
    scenes: [1, 2, 3].map((q) => ({ sequence: q, visual: 'gold ingots', camera: 'still', seconds: 8, card: '', kind: 'none', source: '' })) };
  const picked = pickMaps(plan, maps, topicDef).map((m) => m.id);
  assert.deepEqual(picked.slice(0, 2).sort(), ['map:egypt', 'map:kush-nubia']); assert.equal(picked[0], 'map:kush-nubia'); assert.ok(!picked.includes('map:china'));
  const b = buildBoard(plan, [...maps, { id: 'remake:gold', type: 'remake', path: 'g.png', text: 'gold ingots', people: '' }]);
  const mapShots = b.shots.filter((s) => s.assetType === 'map');
  assert.ok(mapShots.length >= 2, `expected an opener + a chapter map, got ${mapShots.length}`);
  assert.equal(b.shots[0].assetType, 'map');
  assert.ok(b.credits.some((c) => /Cliopatria/.test(c)));
  // a topic with no matching map gets none (no fake map)
  const none = pickMaps({ title: 'Beekeeping', sequences: [] }, maps, { region: 'nowhere' });
  assert.equal(none.length, 0);
});
