import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { promptsFor, graphicPrompts, animationPrompts, figureCandidates, sections } from './wiki-visual-prompts.mjs';

const ART = readFileSync('site/wiki/seed-articles/Beneficial_Insects_and_Biological_Pest_Control.wiki', 'utf8');

test('an article is split into its own sections', () => {
  const s = sections(ART);
  assert.ok(s.length > 5);
  assert.ok(s.some((x) => /Who eats what/.test(x.heading)));
});

test('⭐ every prompt carries the sentence it came from, so a wrong picture is traceable', () => {
  const { graphics, animations } = promptsFor(ART, 'Beneficial Insects');
  assert.ok(graphics.length > 0);
  for (const g of graphics) {
    assert.ok(g.source && g.source.length > 20, 'a graphic must cite its source sentence');
    assert.ok(g.prompt.includes(g.source), 'the prompt must contain what the article said');
    assert.equal(g.article, 'Beneficial Insects');
  }
  for (const a of animations) {
    for (const shot of a.shots) assert.ok(shot.source && shot.prompt.includes(shot.source));
  }
});

test('wiki markup never leaks into a prompt', () => {
  const { graphics } = promptsFor("== H ==\nThe '''ladybird''' larva eats [[Aphids|aphids]] on a leaf in the garden all day long.\n", 'T');
  assert.ok(graphics.length >= 1);
  const p = graphics[0].prompt;
  for (const junk of ["'''", '[[', ']]', '<ref>', '&nbsp;']) assert.equal(p.includes(junk), false, junk);
  assert.match(p, /ladybird larva eats aphids/);
});

test('every graphic forbids text in the image', () => {
  for (const g of graphicPrompts(ART, 'x')) {
    assert.match(g.prompt, /no text/);
    assert.match(g.negative, /text, watermark/);
  }
});

test('animations are wordless, short, and carry no character by default', () => {
  const anims = animationPrompts(ART, 'x');
  for (const a of anims) {
    assert.equal(a.wordless, true);
    assert.ok(a.seconds > 0 && a.seconds <= 12);
    assert.ok(a.shots.length >= 2);
    assert.match(a.note, /no character unless/i);
    for (const s of a.shots) assert.match(s.prompt, /no text on screen/);
  }
});

test('sections that describe a process or comparison are sent to be DRAWN, not generated', () => {
  const figs = figureCandidates(ART, 'Beneficial Insects');
  assert.ok(figs.length > 0);
  for (const f of figs) {
    assert.equal(f.kind, 'figure');
    assert.match(f.why, /accurate/);
    assert.match(f.suggest, /figures\.mjs/);
  }
  // a chart-shaped section must never become an image prompt instead
  const chartish = figureCandidates("== Odour thresholds compared ==\nLimonene versus linalool, orders of magnitude apart on a scale.\n", 't');
  assert.equal(chartish.length, 1);
});

test('non-visual text yields nothing rather than junk', () => {
  const { graphics, animations } = promptsFor('== Sources ==\nSee Smith et al., Journal of Things, 2020.\n', 't');
  assert.equal(graphics.length, 0);
  assert.equal(animations.length, 0);
});

test('a sentence about the article itself is not turned into a picture', () => {
  const lead = "== Lead ==\nThis page covers the plant-derived pesticides and what each one does to a leaf in the garden.\n";
  assert.equal(graphicPrompts(lead, 'Neem and Botanical Pesticides').length, 0);
  // but a real claim from the same article still produces one
  const real = "== Body ==\nAzadirachtin lives in the seed kernel of the neem tree and is destroyed by heat and by UV light.\n";
  assert.equal(graphicPrompts(real, 'Neem and Botanical Pesticides').length, 1);
});

test('a one-letter title does not filter out every sentence', () => {
  const text = "== H ==\nThe ladybird larva eats aphids on a leaf in the garden through the afternoon.\n";
  assert.equal(graphicPrompts(text, 'T').length, 1);
});
