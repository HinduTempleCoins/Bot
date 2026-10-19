// build-pins.mjs — render the share-shaped "informed diagrams" to files.
//
// Operator, 2026-10-19: "the Witches of Instragram Pinterest Type stuff we were doing, not Cards like
// You Had Started, Informed Diagrams, You can make more Using these Charts we have." So these are not
// decorated captions over generated art. Each one is a real diagram drawn from the atlas datasets, on
// the Pinterest 1000x1500 canvas from knowledge/herbal-cards/FORMAT_RESEARCH.md.
//
// SVG out, because it stays sharp at any size and can be rasterised wherever it is needed. Nothing is
// fetched and nothing is posted — this writes files and stops.
//
//   node knowledge/herb-atlas/build-pins.mjs [outDir]      (default: site/wiki/files/pins)

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { plants, plantPin, constituentsOf, CHARTS } from '../../integrations/herb-charts.mjs';

/** A plant is worth a pin when it has measured constituents AND something to say beyond them. */
export function pinworthy(p) {
  const cs = constituentsOf(p, 6).filter((c) => c.mid != null);
  const hasEnz = (p.enzymatic?.whole_plant || []).some((e) => e.target && e.effect);
  const hasWhy = Boolean(p.culinary?.why);
  const hasCaution = Boolean(p.cautions?.toxicity);
  return cs.length >= 2 && (hasEnz || hasWhy) && hasCaution;
}

export function buildPins(all = plants()) {
  const out = {};
  for (const p of all.filter(pinworthy)) out[`plant-${p.id}`] = plantPin(p);
  for (const [name, fn] of Object.entries(CHARTS)) out[`chart-${name}`] = fn();
  return out;
}

if (process.argv[1] && process.argv[1].endsWith('build-pins.mjs')) {
  const dir = process.argv[2] || 'site/wiki/files/pins';
  mkdirSync(dir, { recursive: true });
  const pins = buildPins();
  for (const [name, svg] of Object.entries(pins)) writeFileSync(join(dir, `${name}.svg`), svg);
  console.log(`[pins] ${Object.keys(pins).length} diagrams -> ${dir}`);
}
