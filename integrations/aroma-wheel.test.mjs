import { test } from 'node:test';
import assert from 'node:assert';
import { wheelSvg, WHEELS, wheel, wheelNames } from './aroma-wheel.mjs';

test('every wheel has families, colours and terms', () => {
  assert.ok(wheelNames().length >= 7);
  for (const [name, w] of Object.entries(WHEELS)) {
    assert.ok(w.title && w.note, name);
    assert.ok(w.families.length >= 4, name);
    for (const fam of w.families) {
      assert.match(fam.colour, /^#[0-9a-f]{6}$/i, `${name}/${fam.name}`);
      assert.ok(fam.terms.length >= 3, `${name}/${fam.name}`);
      for (const t of fam.terms) assert.ok(t.length <= 18, `${name}: "${t}" too long for the ring`);
    }
  }
});

test('a wheel draws as an SVG with every family and term present', () => {
  const svg = wheelSvg('wine');
  assert.match(svg, /^<svg /);
  assert.match(svg, /role="img"/);
  assert.match(svg, /aria-label="Wine aroma wheel"/);
  for (const fam of WHEELS.wine.families) {
    assert.ok(svg.includes(fam.name), fam.name);
    for (const t of fam.terms) assert.ok(svg.includes(t), t);
  }
  assert.match(svg, /Ann C\. Noble/);
});

test('wheels are deterministic and unknown names draw nothing', () => {
  assert.equal(wheelSvg('coffee'), wheelSvg('coffee'));
  assert.equal(wheelSvg('nope'), '');
  assert.equal(wheelSvg(), '');
  assert.equal(wheel('nope'), null);
});

test('element ids are unique within a wheel so arcs never collide', () => {
  const svg = wheelSvg('cannabis');
  const ids = [...svg.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('labels are escaped and the geometry stays inside the canvas', () => {
  const svg = wheelSvg('outdoor', { size: 600 });
  assert.equal(svg.includes('<script'), false);
  const m = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
  const [w, h] = [+m[1], +m[2]];
  for (const n of [...svg.matchAll(/<text x="([-\d.]+)" y="([-\d.]+)"/g)]) {
    assert.ok(+n[1] >= -40 && +n[1] <= w + 40, `x ${n[1]} outside canvas`);
    assert.ok(+n[2] >= -40 && +n[2] <= h + 40, `y ${n[2]} outside canvas`);
  }
});
