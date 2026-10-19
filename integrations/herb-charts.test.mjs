import { test } from 'node:test';
import assert from 'node:assert/strict';
import { midPct, wrap, familyOf, constituentsOf, plantPin, enzymeMatrixSvg, dyeChartSvg, allPlantsSvg, CHARTS, CLASS_COLOUR, plants } from './herb-charts.mjs';
import { buildPins, pinworthy } from '../knowledge/herb-atlas/build-pins.mjs';

test('midPct reads the published range forms', () => {
  assert.equal(midPct('20-40'), 30);
  assert.equal(midPct('15'), 15);
  assert.equal(midPct('2-7 (variable)'), 4.5);
  assert.equal(midPct('trace-1'), 0.55);
  assert.equal(midPct('variable, often major'), null);
  assert.equal(midPct(null), null);
  assert.equal(midPct(''), null);
});

test('wrap never drops or splits a word', () => {
  const s = 'the quick brown fox jumps over the lazy dog';
  const lines = wrap(s, 12);
  assert.equal(lines.join(' '), s);
  for (const l of lines) assert.ok(l.length <= 12 || !l.includes(' '), l);
});

test('constituents are classed into the families the charts colour by', () => {
  assert.equal(familyOf('myristicin'), 'phenylpropanoid');
  assert.equal(familyOf('cinnamaldehyde'), 'aldehyde');
  assert.equal(familyOf('thymol'), 'phenol');
  assert.equal(familyOf('piperine'), 'alkaloid');
  assert.equal(familyOf('alpha-pinene'), 'terpene');
  assert.equal(familyOf('something unheard of'), 'other');
  for (const fam of new Set(Object.values({ a: 'phenylpropanoid', b: 'aldehyde', c: 'phenol', d: 'alkaloid', e: 'terpene', f: 'other' }))) {
    assert.ok(CLASS_COLOUR[fam], `no colour for ${fam}`);
  }
});

test('constituentsOf flattens chemotypes, de-dupes and sorts biggest first', () => {
  const p = { constituents: { essential_oil: { chemotypes: [
    { components: [{ compound: 'a', pct: '5-10' }, { compound: 'b', pct: '40-60' }] },
    { components: [{ compound: 'a', pct: '30-40' }] },
  ] } } };
  const cs = constituentsOf(p);
  assert.deepEqual(cs.map((c) => c.name), ['b', 'a']);
  assert.equal(cs.find((c) => c.name === 'a').mid, 35, 'the larger chemotype figure wins');
});

const isSvg = (s) => /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/.test(s) && s.trim().endsWith('</svg>');

test('every registered chart renders valid standalone SVG', () => {
  for (const [name, fn] of Object.entries(CHARTS)) {
    const s = fn();
    assert.ok(isSvg(s), `${name} is not valid standalone SVG`);
    assert.ok(s.length > 2000, `${name} looks empty`);
  }
});

test('the enzyme matrix marks inhibition and induction differently and explains both', () => {
  const s = enzymeMatrixSvg(plants());
  assert.ok(isSvg(s));
  assert.match(s, /inhibits/);
  assert.match(s, /induces/);
  assert.match(s, /raises the level/);
});

test('a plant pin is the Pinterest canvas and carries its caution', () => {
  const nutmeg = plants().find((p) => p.id === 'nutmeg');
  assert.ok(nutmeg, 'nutmeg missing from the dataset');
  const s = plantPin(nutmeg);
  assert.match(s, /viewBox="0 0 1000 1500"/);
  assert.match(s, /CAUTION/);
  assert.match(s, /Nutmeg/);
});

test('pins escape the text they are given', () => {
  const s = plantPin({ id: 'x', common: '<script>bad</script>', latin: 'A & B', categories: ['herb'],
    constituents: { essential_oil: { components: [{ compound: 'a', pct: '1-2' }, { compound: 'b', pct: '3-4' }] } },
    cautions: { toxicity: 'care & attention' } });
  assert.ok(!s.includes('<script>'));
  assert.match(s, /&amp;/);
});

test('a pin is only built for a plant with enough to say', () => {
  assert.equal(pinworthy({ constituents: {}, cautions: {} }), false);
  const all = plants();
  const picked = all.filter(pinworthy);
  assert.ok(picked.length > 40, `only ${picked.length} pinworthy plants`);
  for (const p of picked) {
    assert.ok(constituentsOf(p, 6).filter((c) => c.mid != null).length >= 2, `${p.id} has too few measured constituents`);
  }
});

test('buildPins produces a diagram per worthy plant plus the standing charts', () => {
  const out = buildPins();
  const names = Object.keys(out);
  for (const c of Object.keys(CHARTS)) assert.ok(names.includes(`chart-${c}`), `missing chart-${c}`);
  assert.ok(names.filter((n) => n.startsWith('plant-')).length > 40);
  for (const [n, svg] of Object.entries(out)) assert.ok(isSvg(svg), `${n} invalid`);
});

test('the dye chart only lists plants that actually dye', () => {
  const s = dyeChartSvg(plants());
  assert.ok(isSvg(s));
  assert.match(s, /mordant/);
});

test('the all-plants chart says the percentages are of the oil, not the plant', () => {
  const s = allPlantsSvg(plants());
  assert.match(s, /ESSENTIAL OIL, not of the plant/);
});
