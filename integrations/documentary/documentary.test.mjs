import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScript, score, chapterPrompt, fleschReadingEase } from './script.mjs';
import { keywords, matchImage, planShots, sourcesOf, youtubeMeta, ALPHA_LINE } from './shots.mjs';
import { TOPICS, factsFor } from './topics.mjs';

test('parseScript: several sentences and tags per line — each tag belongs to the sentence before it', () => {
  const l = parseScript('Herodotus called Egypt the gift of the river «R: Herodotus, Histories 2.5». It flooded every year. Hapi was its god «R: Egyptian religious texts»\n- I will show you more.');
  assert.deepEqual(l.map((x) => [x.text, x.tag]), [
    ['Herodotus called Egypt the gift of the river.', 'record'].map((v, i) => (i === 0 ? 'Herodotus called Egypt the gift of the river' : v)),
    ['It flooded every year.', null],
    ['Hapi was its god', 'record'],
    ['I will show you more.', null],
  ]);
  assert.equal(l[0].source, 'Herodotus, Histories 2.5');
});

test('score rewards tagged claims with real sources and penalises invented ones', () => {
  const good = parseScript('Genesis says the Gihon encompasses the land of Kush «T: Genesis 2:13»\nPiye conquered Egypt around 727 BCE «R: Victory Stela of Piye (Cairo JE 48862)»');
  const bad = parseScript('Piye conquered Egypt around 727 BCE «R: My Blog»\nKush was in Sudan.');
  const allowed = ['Genesis 2:13', 'Victory Stela of Piye (Cairo JE 48862)'];
  const g = score(good, { targetWords: 20, allowedSources: allowed });
  const b = score(bad, { targetWords: 20, allowedSources: allowed });
  assert.equal(g.tagCoverage, 1); assert.equal(g.citationValidity, 1);
  assert.equal(b.citationValidity, 0); assert.ok(b.tagCoverage < 1);
  assert.ok(g.total > b.total);
  assert.ok(fleschReadingEase(good) < 120);
});

test('chapterPrompt carries only the chapter facts, their tags, the alpha note and the word target', () => {
  const t = TOPICS['havilah-kush']; const ch = t.outline[0];
  const { system, prompt } = chapterPrompt({ topic: t, chapter: ch, facts: factsFor(t, ch.facts), words: 280, variant: 'hathor', chapterIndex: 0, chapterCount: 5 });
  assert.match(system, /alpha/i);
  assert.match(prompt, /\[T: Genesis 2:13\]/);
  assert.match(prompt, /about 280 words/);
  assert.doesNotMatch(prompt, /Piye/); // chapter 4's fact is not offered in chapter 1
});

test('planShots: reuse by keyword with people preference, renders within budget, alpha cards, sources + YouTube metadata', () => {
  const index = [
    { path: 'a/nubian_archers.png', text: 'Nubian archers military army', people: '' },
    { path: 'b/1_real_nubian.png', text: 'The Nubian bathhouse Nubia river', people: 'nubian' },
    { path: 'b/1_real_pale.png', text: 'The Nubian bathhouse Nubia river', people: 'pale' },
    { path: 'c/meroe.png', text: 'Meroe pyramids tomb', people: '' },
  ];
  assert.ok(keywords('the land of Kush').includes('nubia'));
  assert.equal(matchImage('Kush on the Nile', index, { people: 'nubian' }).path, 'b/1_real_nubian.png');
  const chapters = [{ title: 'Kush on the Nile', lines: parseScript('Kush lay on the Nile «R: Geography of the Nile»\nIts archers were famous «R: Egyptian texts»\nA dragon flew over the moon.\nAnother dragon.') }];
  const { shots, renders } = planShots({ topic: TOPICS['havilah-kush'], chapters, index, people: 'nubian', renderBudget: 1 });
  assert.equal(shots[0].card, 'title'); assert.equal(shots[0].alpha, ALPHA_LINE);
  assert.equal(shots.at(-1).card, 'end');
  assert.equal(renders.length, 1);
  assert.ok(shots.some((s) => s.image === 'a/nubian_archers.png'));
  const src = sourcesOf(chapters);
  assert.deepEqual(src.record.sort(), ['Egyptian texts', 'Geography of the Nile']);
  const yt = youtubeMeta({ topic: TOPICS['havilah-kush'], chapters, chapterStarts: [12.4], sources: src, url: 'https://x' });
  assert.match(yt.description, /ALPHA/); assert.match(yt.description, /0:12 Kush on the Nile/); assert.match(yt.title, /Alpha/);
});
