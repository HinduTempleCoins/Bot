import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEAKERS, FARM_WALKTHROUGH, walkthroughById, startWalkthrough, currentStep, chapterOf,
  isChapterOpening, observe, skip, resume, progress, isComplete, matches,
} from './tutorial-walkthrough.mjs';

const START = () => startWalkthrough('botanica_farm');

// Drive the whole walkthrough with the events the Botanica server actually emits.
const PLAY = [
  { action: 'plant', plant: 'wheat', plot: 0 },
  { action: 'ready', plot: 0 },
  { action: 'harvest', plot: 0 },
  { action: 'sell' },
  { action: 'plant', plant: 'mint', plot: 1 },
  { action: 'plant', plant: 'mint', plot: 2 },
  { action: 'craft', item: 'salve' },
];

test('the farm walkthrough is well formed', () => {
  const chapterIds = new Set(FARM_WALKTHROUGH.chapters.map((c) => c.id));
  assert.ok(FARM_WALKTHROUGH.steps.length > 0);
  for (const s of FARM_WALKTHROUGH.steps) {
    assert.ok(chapterIds.has(s.chapter), `${s.id} names unknown chapter ${s.chapter}`);
    assert.ok(SPEAKERS[s.speaker], `${s.id} has unknown speaker ${s.speaker}`);
    assert.ok(s.action, `${s.id} has no action to satisfy it`);
    assert.ok(s.say && s.say.length > 0);
  }
  assert.equal(new Set(FARM_WALKTHROUGH.steps.map((s) => s.id)).size, FARM_WALKTHROUGH.steps.length);
});

test('every step is completed by doing something, never by a Next button', () => {
  // The whole point of the engine: no step can be satisfied by an event the game does not emit.
  const emitted = new Set(['plant', 'ready', 'harvest', 'sell', 'craft']);
  for (const s of FARM_WALKTHROUGH.steps) assert.ok(emitted.has(s.action), `${s.id}: ${s.action}`);
});

test('the cat instructs and Phoebe never gives a click instruction', () => {
  for (const s of FARM_WALKTHROUGH.steps) {
    assert.equal(s.speaker, 'cat', 'step-level lines belong to the onboarding buddy');
  }
  for (const c of FARM_WALKTHROUGH.chapters) {
    assert.ok(c.beat && c.beat.length > 0, `${c.id} has no Phoebe beat`);
    assert.ok(!/\btap\b|\bclick\b|\bpress\b/i.test(c.beat), `${c.id} beat gives an instruction`);
  }
});

test('the first chapter ends in a real success, not in setup', () => {
  const first = FARM_WALKTHROUGH.chapters[0].id;
  const inFirst = FARM_WALKTHROUGH.steps.filter((s) => s.chapter === first);
  assert.equal(inFirst[inFirst.length - 1].reward, 'first_harvest');
});

test('starting yields step one with its speaker and chapter', () => {
  const s = START();
  assert.equal(s.index, 0);
  assert.equal(isComplete(s), false);
  const step = currentStep(s);
  assert.equal(step.id, 'pick_seed');
  assert.equal(step.speakerName, 'the winged cat');
  assert.equal(chapterOf(s).id, 'ground');
  assert.equal(isChapterOpening(s), true);
  assert.equal(startWalkthrough('nope'), null);
});

test('a matching action advances exactly one step', () => {
  const s = observe(START(), { action: 'plant', plant: 'wheat' });
  assert.equal(currentStep(s).id, 'wait_grow');
  assert.equal(isChapterOpening(s), false, 'still inside the opening chapter');
});

test('an unrelated event leaves the step waiting rather than failing', () => {
  const s0 = START();
  for (const noise of [{ action: 'harvest' }, { action: 'sell' }, { action: 'wander' }, {}]) {
    assert.deepEqual(observe(s0, noise), s0, `${JSON.stringify(noise)} should be inert`);
  }
  assert.equal(currentStep(observe(s0, { action: 'harvest' })).id, 'pick_seed');
});

test('a repeating step needs the stated number of real actions', () => {
  let s = START();
  for (const e of PLAY.slice(0, 4)) s = observe(s, e);
  assert.equal(currentStep(s).id, 'plant_again');
  assert.equal(currentStep(s).needed, 2);

  s = observe(s, { action: 'plant', plant: 'mint' });
  assert.equal(currentStep(s).id, 'plant_again', 'one plant is not enough');
  assert.equal(currentStep(s).hits, 1);

  s = observe(s, { action: 'plant', plant: 'mint' });
  assert.equal(currentStep(s).id, 'craft_item');
  assert.equal(currentStep(s).hits, 0, 'hit counter resets for the next step');
});

test('playing it through completes it and banks the rewards in order', () => {
  let s = START();
  for (const e of PLAY) s = observe(s, e);
  assert.equal(isComplete(s), true);
  assert.equal(currentStep(s), null);
  assert.deepEqual(s.rewards, ['first_harvest', 'first_coin', 'first_craft']);
  const p = progress(s);
  assert.equal(p.done, true);
  assert.equal(p.pct, 100);
  assert.equal(p.stepNumber, p.total);
});

test('events after completion are inert', () => {
  let s = START();
  for (const e of PLAY) s = observe(s, e);
  assert.deepEqual(observe(s, { action: 'plant' }), s);
});

test('a where clause restricts which payloads satisfy a step', () => {
  const anyPlant = { action: 'plant', where: {} };
  const wheatOnly = { action: 'plant', where: { plant: 'wheat' } };

  assert.equal(matches(anyPlant, { action: 'plant', plant: 'mint' }), true);
  assert.equal(matches(wheatOnly, { action: 'plant', plant: 'wheat' }), true);
  assert.equal(matches(wheatOnly, { action: 'plant', plant: 'mint' }), false);
  assert.equal(matches(wheatOnly, { action: 'plant' }), false, 'a missing field cannot match');
  assert.equal(matches(wheatOnly, { action: 'harvest', plant: 'wheat' }), false);

  // Multi-field clauses require every field.
  const exact = { action: 'plant', where: { plant: 'wheat', plot: 0 } };
  assert.equal(matches(exact, { action: 'plant', plant: 'wheat', plot: 0 }), true);
  assert.equal(matches(exact, { action: 'plant', plant: 'wheat', plot: 1 }), false);

  // The action name is matched case-insensitively, since surfaces differ on casing.
  assert.equal(matches(anyPlant, { action: 'PLANT' }), true);
  assert.equal(matches(anyPlant, null), false);
  assert.equal(matches(null, { action: 'plant' }), false);
});

test('skip exits at any point and stays exited', () => {
  const s = skip(observe(START(), { action: 'plant' }));
  assert.equal(s.skipped, true);
  assert.equal(currentStep(s), null);
  assert.equal(isComplete(s), false);
  assert.deepEqual(observe(s, { action: 'ready' }), s);
  assert.equal(progress(s).skipped, true);
});

test('resume restores a saved state and clamps a corrupt one', () => {
  let s = START();
  s = observe(s, PLAY[0]);
  const restored = resume(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(restored, s);

  assert.equal(resume({ walkthroughId: 'botanica_farm', index: 999 }).done, true);
  assert.equal(resume({ walkthroughId: 'botanica_farm', index: -4 }).index, 0);
  assert.equal(resume({ walkthroughId: 'botanica_farm', hits: 'x' }).hits, 0);
  assert.equal(resume({ walkthroughId: 'nope' }), null);
  assert.equal(resume(null), null);
});

test('progress reports position, chapter and percentage', () => {
  const p0 = progress(START());
  assert.equal(p0.stepNumber, 1);
  assert.equal(p0.pct, 0);
  assert.equal(p0.chapter.title, 'The Ground');

  let s = START();
  for (const e of PLAY.slice(0, 4)) s = observe(s, e);
  const p = progress(s);
  assert.equal(p.index, 4);
  assert.ok(p.pct > 0 && p.pct < 100);
  assert.equal(p.chapter.id, 'bench');
});

test('never throws on garbage input', () => {
  assert.doesNotThrow(() => observe(null, null));
  assert.doesNotThrow(() => observe(START(), null));
  assert.doesNotThrow(() => currentStep({}));
  assert.doesNotThrow(() => progress(undefined));
  assert.doesNotThrow(() => chapterOf(null));
  assert.doesNotThrow(() => skip(null));
  assert.equal(currentStep(null), null);
  assert.equal(progress(null), null);
  assert.equal(walkthroughById(null), null);
});
