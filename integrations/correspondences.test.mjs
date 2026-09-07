import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TABLES, CHALDEAN, ERAS, getTable, datedTo, provenance,
  SURVIVALS, survivedIntoScience, tracers, TO_SCIENCE, THESIS,
  checkChaldean, AS_ABOVE_TABLE,
} from './correspondences.mjs';

test('every table declares a year, an era and a citable source', () => {
  for (const t of TABLES) {
    assert.ok(t.id && t.label, 'malformed table');
    assert.ok(Number.isInteger(t.firstAttested), `${t.id} has no year`);
    assert.ok(ERAS.includes(t.era), `${t.id} has bad era ${t.era}`);
    assert.ok(t.source && t.source.length > 20, `${t.id} needs a real source`);
    assert.ok(t.verdict, `${t.id} needs a verdict`);
  }
});

test('the dating sort IS the argument — ancient and modern separate cleanly', () => {
  const d = datedTo();
  assert.equal(d[0].id, 'breastplate-zodiac');
  assert.equal(d[0].year, 90);
  assert.equal(d[d.length - 1].id, 'chakra-rainbow');
  assert.equal(d[d.length - 1].year, 1927);
  for (let i = 1; i < d.length; i += 1) assert.ok(d[i].year >= d[i - 1].year, 'not sorted');

  const ancient = d.filter((t) => t.year <= 600).map((t) => t.id);
  const modern = d.filter((t) => t.year >= 1900).map((t) => t.id);
  assert.deepEqual(ancient.sort(), ['breastplate-zodiac', 'hermetic-ascent', 'planet-metal']);
  assert.deepEqual(modern.sort(), ['birthstones', 'chakra-rainbow', 'golden-dawn-777']);
});

test('provenance() states what each date licenses you to claim', () => {
  assert.match(provenance('hermetic-ascent').licence, /Ancient/);
  assert.match(provenance('agrippa-scales').licence, /never as ancient doctrine/);
  assert.match(provenance('birthstones').licence, /not evidence about antiquity/);
  assert.equal(provenance('no-such-table'), null);
});

test('only the unmotivated planet-metal pairs count as tracers', () => {
  const t = tracers().map((e) => `${e.planet}=${e.metal}`);
  assert.deepEqual(t.sort(), ['Jupiter=tin', 'Saturn=lead']);
  // gold=Sun and silver=Moon must NOT be tracers — anyone could reinvent them
  const gold = getTable('planet-metal').entries.find((e) => e.metal === 'gold');
  assert.equal(gold.motivated, true);
  const silver = getTable('planet-metal').entries.find((e) => e.metal === 'silver');
  assert.equal(silver.motivated, true);
});

test('the planet-metal table has all seven planets, each with one metal', () => {
  const e = getTable('planet-metal').entries;
  assert.equal(e.length, 7);
  assert.deepEqual(e.map((x) => x.planet).sort(), [...CHALDEAN].sort());
  assert.equal(new Set(e.map((x) => x.metal)).size, 7);
  for (const row of e) assert.ok(row.why, `${row.metal} needs a why`);
});

test('the metal correspondence is the one that reached chemistry, and the terms are named', () => {
  const terms = survivedIntoScience();
  assert.ok(terms.includes('saturnism'), 'lead poisoning still carries Saturn');
  assert.ok(terms.includes('lunar caustic'), 'silver nitrate still carries the Moon');
  assert.ok(terms.includes('mercury'));
  assert.equal(SURVIVALS.length, terms.length);
  for (const s of SURVIVALS) assert.ok(s.survives.length > 20, `${s.term} needs an explanation`);
});

test('the breastplate-zodiac equation is ancient BUT the stones are flagged unresolved', () => {
  const b = getTable('breastplate-zodiac');
  assert.equal(b.firstAttested, 90);
  assert.match(b.source, /Josephus/);
  assert.match(b.source, /Philo/);
  assert.equal(b.entries.length, 12, 'twelve stones');
  assert.deepEqual([...new Set(b.entries.map((e) => e.row))], [1, 2, 3, 4], 'four rows of three');
  for (const r of [1, 2, 3, 4]) assert.equal(b.entries.filter((e) => e.row === r).length, 3);
  assert.match(b.caveat, /unresolved|disagree/i, 'the stone identities must be flagged');
  assert.match(b.caveat, /sappir|lapis/i);
});

test('birthstones are dated to the trade, with the later additions as the tell', () => {
  const b = provenance('birthstones');
  assert.equal(b.year, 1912);
  assert.match(b.source, /Jewelers/);
  assert.match(b.caveat, /2002|tanzanite/i);
});

test('the rainbow chakras are dated to Leadbeater, and the instability is recorded', () => {
  const c = provenance('chakra-rainbow');
  assert.equal(c.year, 1927);
  assert.match(c.source, /Leadbeater/);
  assert.match(c.source, /Avalon|Woodroffe/);
  assert.match(c.caveat, /Quaoar/, 'a 2002 discovery in a supposedly ancient chart is the decisive fact');
  assert.match(c.caveat, /disagree/i);
});

test('the Golden Dawn attributions are flagged as one tradition counted twice', () => {
  const g = getTable('golden-dawn-777');
  assert.equal(g.firstAttested, 1909);
  assert.match(g.caveat, /counting one tradition twice/i);
});

test('Agrippa is identified as the FORMAT origin, not the content origin', () => {
  const a = getTable('agrippa-scales');
  assert.equal(a.firstAttested, 1533);
  assert.match(a.verdict, /FORMAT ORIGIN/);
  assert.match(a.verdict, /did not invent the individual correspondences/);
  // and 777 is its descendant
  assert.match(getTable('golden-dawn-777').verdict, /descendant of Agrippa/i);
});

test('the Agrippa-to-Mendeleev chain is dated, ordered, and lands on a measured variable', () => {
  assert.ok(TO_SCIENCE.length >= 8);
  for (let i = 1; i < TO_SCIENCE.length; i += 1) {
    // Paracelsus predates the Agrippa printing; otherwise the chain runs forward.
    if (i > 1) assert.ok(TO_SCIENCE[i].year >= TO_SCIENCE[i - 1].year, `out of order at ${TO_SCIENCE[i].who}`);
  }
  const who = TO_SCIENCE.map((s) => s.who);
  for (const name of ['Agrippa', 'Robert Boyle', 'Antoine Lavoisier', 'John Newlands', 'Dmitri Mendeleev', 'Henry Moseley']) {
    assert.ok(who.includes(name), `missing ${name}`);
  }
  const newlands = TO_SCIENCE.find((s) => s.who === 'John Newlands');
  assert.equal(newlands.year, 1865);
  assert.match(newlands.kept, /HINGE/);
  assert.match(newlands.kept, /alphabetically/, 'the mockery is the point');
  const moseley = TO_SCIENCE[TO_SCIENCE.length - 1];
  assert.equal(moseley.who, 'Henry Moseley');
  assert.match(moseley.what, /atomic NUMBER/);
});

test('the thesis is that the impulse was right and every specific was wrong', () => {
  assert.match(THESIS.claim, /right about the world and wrong about every detail/);
  assert.match(THESIS.argument, /CHOSEN/);
  assert.match(THESIS.argument, /MEASURED/);
  assert.match(THESIS.soWhat, /measurable/);
});

test('checkChaldean() recognises the true order and the Hermetic ascent that uses it', () => {
  const exact = checkChaldean(CHALDEAN);
  assert.equal(exact.isChaldean, true);
  assert.equal(exact.matches, 7);
  assert.equal(exact.distance, 0);
  assert.deepEqual(exact.displaced, []);

  const ascent = getTable('hermetic-ascent').entries.map((e) => e.planet);
  assert.equal(checkChaldean(ascent).isChaldean, true, 'the ascent IS Chaldean order');
});

test('checkChaldean() measures the corpus chakra table: four in place, three rotated', () => {
  const r = checkChaldean(AS_ABOVE_TABLE);
  assert.equal(r.valid, true);
  assert.equal(r.isChaldean, false);
  assert.equal(r.matches, 4, 'Saturn, Jupiter, Sun and Moon already sit correctly');
  assert.equal(r.distance, 3);
  assert.deepEqual(r.displaced.map((d) => d.planet).sort(), ['Mars', 'Mercury', 'Venus']);
  assert.equal(r.swapOnly, false, 'it is a three-cycle, not a transposition');
});

test('checkChaldean() rejects malformed input rather than scoring it', () => {
  assert.equal(checkChaldean([]).valid, false);
  assert.equal(checkChaldean(['Sun', 'Moon']).valid, false);
  assert.equal(checkChaldean([...CHALDEAN, 'Pluto']).valid, false);
  assert.equal(checkChaldean(['Sun', 'Sun', 'Sun', 'Sun', 'Sun', 'Sun', 'Sun']).valid, false);
  assert.equal(checkChaldean(['Quaoar', ...CHALDEAN.slice(1)]).valid, false);
});

test('the doctrine of signatures is kept as the method losing under test', () => {
  const d = getTable('doctrine-of-signatures');
  assert.match(d.verdict, /failed/i);
  assert.match(d.caveat, /ETHNOBOTANY/);
  assert.match(d.caveat, /willow/i);
});
