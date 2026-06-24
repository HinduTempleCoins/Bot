// hathor-tutor.test.mjs — OFFLINE. Hathor IS the tutor: she teaches the staged arc in her voice, credits the
// Mentor/Sphinx/Tutu/CryptoKannon lineage, never impersonates the human.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stages, stageById, nextStage, teach, welcome, nextUnfinished, teachLLM, LINEAGE, MENTOR_LINEAGE, THRESHOLD_RIDDLES, TEACHING_SOURCES, lineage } from './hathor-tutor.mjs';

test('the staged arc loads (the 19-stage onboarding)', () => {
  const s = stages();
  assert.ok(s.length >= 6, 'has the onboarding stages');
  assert.equal(stageById(1).key, 'intro_post');
  assert.equal(nextStage(1).id, 2);
});

test('teach: Hathor voices ONE stage — the step, what they earn, that it opens the next', () => {
  const t = teach(1, { name: '@Newcomer' });
  assert.equal(t.ok, true);
  assert.equal(t.stageId, 1);
  assert.match(t.message, /stage 1 of \d+/);
  assert.match(t.message, /Post an introduction/);
  assert.match(t.message, /I will/);              // she (the witness) responds
  assert.match(t.message, /opens the next/);
  assert.equal(t.next, 2);
});

test('welcome: warm + light + the first step — she does NOT recite the lineage every time', () => {
  const w = welcome({ name: 'Ada' });
  assert.match(w, /Ada/);
  assert.match(w, /threshold/);                     // a touch of the gate imagery is fine
  assert.match(w, /stage 1 of \d+/);                // it gets them moving
  assert.doesNotMatch(w, /CryptoKannon|Athena|Sphinx/);   // the deep lineage is carried, not recited
});

test('the lineage is CARRIED (available when it fits), naming Mentor/Sphinx/Tutu/CryptoKannon from Athenaism', () => {
  assert.equal(lineage(), LINEAGE);
  assert.match(LINEAGE, /Mentor/);
  assert.match(LINEAGE, /Athena/);
  assert.match(LINEAGE, /Sphinx|Tutu/);
  const names = MENTOR_LINEAGE.map((m) => m.name);
  assert.deepEqual(names, ['Mentor', 'The Sphinx', 'Tutu', 'CryptoKannon']);
  assert.match(MENTOR_LINEAGE[0].from, /Athenaism/);
  assert.match(MENTOR_LINEAGE.find((m) => m.name === 'CryptoKannon').is, /never wears her name/);
});

test('the threshold riddles are lore she may pose — the Sphinx + its matching Indian (Yaksha Prashna)', () => {
  assert.match(THRESHOLD_RIDDLES.sphinx.riddle, /four legs in the morning/);
  assert.match(THRESHOLD_RIDDLES.sphinx.answer, /Man/);
  assert.match(THRESHOLD_RIDDLES.indian.of, /Yaksha Prashna/);
  assert.match(THRESHOLD_RIDDLES.indian.from, /Mahabharata/);
});

test('her teaching sources are carried — Ptahhotep’s Sebayt, the Emerald Tablet, Bailey’s Hercules', () => {
  const names = TEACHING_SOURCES.map((s) => s.name);
  assert.ok(names.some((n) => /Ptahhotep/.test(n)));
  assert.ok(names.some((n) => /Emerald Tablet/.test(n)));
  assert.ok(names.some((n) => /Hercules/.test(n)));
  assert.match(TEACHING_SOURCES.find((s) => /Hercules/.test(s.name)).what, /one trial at a time|initiation/);
});

test('nextUnfinished picks up where the newcomer left off', () => {
  assert.equal(nextUnfinished([]), stages()[0].id);
  assert.equal(nextUnfinished([1, 2]), 3);
});

test('teachLLM re-voices via an injected model; falls back to teach() with none', async () => {
  const polished = await teachLLM(1, { name: 'Ada', complete: async () => 'Ada, take your first step: tell us who you are.' });
  assert.match(polished.message, /first step/);
  assert.equal(polished.stageId, 1);
  const plain = await teachLLM(1, { name: 'Ada' });        // no complete
  assert.match(plain.message, /stage 1/);
  assert.equal((await teachLLM(999, {})).ok, false);        // unknown stage
});
