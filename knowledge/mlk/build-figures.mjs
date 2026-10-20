// build-figures.mjs — write the three m-l-k figures into the wiki's served files directory.
//
// The wiki renders these inline through site/wiki/figures.mjs, so the files written here are NOT what
// the wiki pages use. They exist because an on-chain post cannot carry an inline SVG: a condenser
// renders a markdown image tag and nothing else, so @hathor's posts link to a hosted raster instead.
// That is why the PNGs are committed alongside the SVGs rather than generated at request time.
//
// /files/ serves flat names only (server.mjs rejects anything with a slash), hence the flat basenames.
//
//   node knowledge/mlk/build-figures.mjs [outDir]       (default: site/wiki/files)
//
// The PNGs beside them are rasterised with librsvg, which is not installed in the repo environment:
//
//   rsvg-convert -w 1560 site/wiki/files/mlk-greek.svg -o site/wiki/files/mlk-greek.png
//
// Keep the two in step — a changed module means re-running both halves, or the post and the wiki page
// drift apart and only the wiki is right.

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mlkWheelSvg } from '../../integrations/mlk-wheel.mjs';
import { septuagintChainSvg } from '../../integrations/septuagint-chain.mjs';
import { hebrewGreekAlphabetSvg } from '../../integrations/hebrew-greek-alphabet.mjs';

export const MLK_FIGURES = {
  'mlk-wheel': mlkWheelSvg,
  'mlk-greek': septuagintChainSvg,
  'hebrew-greek-alphabet': hebrewGreekAlphabetSvg,
};

export function buildFigures() {
  return Object.fromEntries(Object.entries(MLK_FIGURES).map(([n, fn]) => [n, fn()]));
}

if (process.argv[1] && process.argv[1].endsWith('build-figures.mjs')) {
  const dir = process.argv[2] || 'site/wiki/files';
  mkdirSync(dir, { recursive: true });
  const figs = buildFigures();
  for (const [name, svg] of Object.entries(figs)) writeFileSync(join(dir, `${name}.svg`), svg);
  console.log(`[mlk] ${Object.keys(figs).length} figures -> ${dir}`);
}
