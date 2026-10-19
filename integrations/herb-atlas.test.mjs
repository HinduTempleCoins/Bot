import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { ALLYLBENZENES, POSITION_KEY, PLANTS, CONSTITUENT_CLASS, allylbenzeneMapSvg, plantConstituentsSvg, ringSvg } from './herb-atlas.mjs';

test('the position key is the operator colour key, 1..6', () => {
  assert.deepEqual(POSITION_KEY.map((k) => k.pos), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(POSITION_KEY.map((k) => k.name), ['black', 'brown', 'red', 'green', 'blue', 'purple']);
  for (const k of POSITION_KEY) assert.match(k.colour, /^#[0-9a-f]{6}$/i);
});

test('every molecule has five declared ring positions and a known chain type', () => {
  for (const m of ALLYLBENZENES) {
    assert.equal(m.pos.length, 5, `${m.name} must declare positions 2..6`);
    assert.ok(['allyl', 'propenyl'].includes(m.chain), `${m.name} chain`);
    for (const s of m.pos) assert.ok(s === null || ['OMe', 'OH', 'MDO', 'MDO2'].includes(s), `${m.name}: ${s}`);
  }
});

test('a methylenedioxy bridge always has its second half on the next position', () => {
  for (const m of ALLYLBENZENES) {
    m.pos.forEach((s, i) => {
      if (s === 'MDO') assert.equal(m.pos[i + 1], 'MDO2', `${m.name}: MDO at ${i + 2} needs MDO2 at ${i + 3}`);
      if (s === 'MDO2') assert.equal(m.pos[i - 1], 'MDO', `${m.name}: stray MDO2`);
    });
  }
});

test('propenylbenzenes are never given an amphetamine pair', () => {
  // Peele & Oswald: propenylbenzenes form no alkaloid metabolites at all, so no pair can be claimed.
  for (const m of ALLYLBENZENES.filter((x) => x.chain === 'propenyl')) {
    assert.equal(m.shulgin, null, `${m.name} is propenyl and must not carry a Shulgin pair`);
  }
});

test('the structure chart renders valid standalone SVG with every molecule on it', () => {
  const s = allylbenzeneMapSvg();
  assert.match(s, /^<svg [^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.ok(s.trim().endsWith('</svg>'));
  for (const m of ALLYLBENZENES) assert.ok(s.includes(m.name.replace(/&/g, '&amp;')), `${m.name} missing from chart`);
  assert.match(s, /community claim/i, 'the chart must say the position claims are a community model');
});

test('every amphetamine pair on the chart is labelled hypothetical', () => {
  const s = allylbenzeneMapSvg();
  for (const m of ALLYLBENZENES.filter((x) => x.shulgin)) {
    assert.ok(s.includes(`→ ${m.shulgin} (hypothetical)`), `${m.name} pair must be marked hypothetical`);
  }
});

test('plant constituent ranges are ordered and within 0-100', () => {
  for (const p of PLANTS) {
    assert.ok(p.c.length, `${p.name} has no constituents`);
    for (const [name, cls, lo, hi] of p.c) {
      assert.ok(CONSTITUENT_CLASS[cls], `${p.name}/${name}: unknown class ${cls}`);
      assert.ok(lo >= 0 && hi <= 100 && lo <= hi, `${p.name}/${name}: bad range ${lo}-${hi}`);
    }
  }
});

test('the plant chart renders and names every plant', () => {
  const s = plantConstituentsSvg();
  assert.match(s, /^<svg /);
  assert.ok(s.trim().endsWith('</svg>'));
  for (const p of PLANTS) assert.ok(s.includes(p.name), `${p.name} missing`);
  assert.match(s, /NOT volatile/, 'the chart must warn that some listed constituents are not in the oil');
});

test('ringSvg escapes nothing unescaped into the output', () => {
  const s = ringSvg({ chain: 'allyl', pos: [null, null, 'OMe', null, null] }, 50, 50);
  assert.ok(!s.includes('<script'));
  assert.match(s, /<polygon/);
});

test('the generated atlas page is present, linked and honest', () => {
  const page = 'site/wiki/articles/Herb_and_Chemical_Atlas.wiki';
  if (!existsSync(page)) return; // generated page not built in this checkout
  const t = readFileSync(page, 'utf8');
  assert.match(t, /\[\[Figure:allylbenzene-map\|/);
  assert.match(t, /\[\[Figure:plant-constituents\|/);
  assert.match(t, /hypothetical/i);
  assert.match(t, /== Sources ==/);
  assert.match(t, /== Coverage ==/);
  assert.ok(!/\|\|/.test(t) && !/^\{\|/m.test(t), 'the wiki renderer has no tables; none may appear');
  // every [[link]] must resolve to a real article file
  const have = new Set();
  for (const d of ['site/wiki/articles', 'site/wiki/seed-articles']) {
    for (const f of readdirSync(d)) have.add(f.replace(/\.wiki$/, ''));
  }
  const links = [...t.matchAll(/\[\[([^\]|:]+)(\|[^\]]*)?\]\]/g)].map((m) => m[1].trim());
  for (const l of links) assert.ok(have.has(l.replace(/ /g, '_')), `broken wiki link: ${l}`);
});
