import { test } from 'node:test';
import assert from 'node:assert';
import { leafSvg, chartSvg, leafletPath, fan, DEFICIENCIES, deficiency } from './plant-deficiency-chart.mjs';

test('every deficiency states where it shows and whether the nutrient moves', () => {
  for (const d of DEFICIENCIES) {
    assert.ok(['mobile', 'immobile'].includes(d.mobility), d.id);
    assert.ok(d.where && d.note && d.fix, d.id);
    assert.match(d.blade, /^#[0-9a-f]{6}$/i, d.id);
  }
  assert.equal(deficiency('iron').mobility, 'immobile');
  assert.equal(deficiency('nitrogen').mobility, 'mobile');
  assert.equal(deficiency('nope'), null);
});

test('⭐ the diagnostic rule holds: mobile = old leaves, immobile = new growth', () => {
  for (const d of DEFICIENCIES) {
    if (d.mobility === 'mobile') assert.match(d.where, /old|lowest|older/i, `${d.id} is mobile so it must show on old growth`);
    else assert.match(d.where, /new|newest|tip/i, `${d.id} is immobile so it must show on new growth`);
  }
});

test('the two pairs that are confused with each other are each told apart', () => {
  // magnesium vs iron: same interveinal pattern, opposite ends of the plant
  const mg = deficiency('magnesium'); const fe = deficiency('iron');
  assert.equal(mg.pattern, 'interveinal');
  assert.equal(fe.pattern, 'interveinal');
  assert.notEqual(mg.mobility, fe.mobility);
  assert.match(mg.confusable, /Iron/);
  assert.match(fe.confusable, /Magnesium/);
  // nitrogen vs sulfur: same yellow, opposite ends
  assert.notEqual(deficiency('nitrogen').mobility, deficiency('sulfur').mobility);
  assert.match(deficiency('sulfur').confusable, /Nitrogen/);
});

test('a leaf is drawn as a palmate leaf, not a blob', () => {
  const svg = leafSvg(deficiency('magnesium'), { size: 180 });
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 180 180"/);
  assert.equal((svg.match(/<path d="M /g) || []).length >= 7, true, 'seven leaflets');
  assert.match(svg, /linearGradient/);              // interveinal needs the green-vein gradient
  assert.match(svg, /aria-label="Magnesium deficiency"/);
  assert.equal(fan(7).length, 7);
  assert.match(leafletPath(100, 20, 9), /^M .* Z$/);
});

test('a healthy leaf is green and has no gradient or spots', () => {
  const svg = leafSvg(null);
  assert.match(svg, /#3f8046/);
  assert.equal(svg.includes('linearGradient'), false);
  assert.match(svg, /aria-label="healthy leaf"/);
});

test('the chart teaches the rule in the chart itself, and is deterministic', () => {
  const a = chartSvg(); const b = chartSvg();
  assert.equal(a, b, 'the same chart must draw the same every time');
  assert.match(a, /Mobile<\/tspan>/);
  assert.match(a, /Immobile<\/tspan>/);
  assert.match(a, /BOTTOM fades first/);
  assert.match(a, /TOP goes first/);
  assert.match(a, /most &quot;deficiencies&quot; are lockouts|most "deficiencies" are lockouts/);
  for (const d of DEFICIENCIES) assert.ok(a.includes(d.name), `${d.name} must appear on the chart`);
  assert.ok(a.includes('Healthy'));
});

test('ids used in gradients are unique per leaf so two leaves never collide', () => {
  const chart = chartSvg();
  const ids = [...chart.matchAll(/id="(l[a-z0-9]+(?:iv|eb|un))"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length, 'every gradient id must be unique');
});
