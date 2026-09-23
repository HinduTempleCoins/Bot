// hathor-decades-voice.test.mjs — the Decades Brain speaks (no LLM/GPU) for the intents it should,
// and stays silent (returns '') on open knowledge questions so corpus reflection handles those.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decadesVoice, buildHathorBrain } from './hathor-decades-voice.mjs';

test('buildHathorBrain climbs the decades and answers a greeting from a classical layer', async () => {
  const brain = buildHathorBrain();
  const r = await brain.think('hello there');
  assert.ok(r.answer && /Hathor/i.test(r.answer));
  assert.ok(['1960s', '1990s', '2000s'].includes(r.era)); // never needed an LLM
});

test('voice() answers signup/help/"are you an AI" on the user question', async () => {
  const voice = decadesVoice();
  assert.match(await voice('x', { question: 'how do I sign up?' }), /!signup/i);
  assert.match(await voice('x', { question: 'are you an AI?' }), /GPU|classical|PRANA/i);
  assert.match(await voice('x', { question: 'hi hathor' }), /Hathor|Peace/i);
});

test('voice() returns "" for open knowledge questions (deliberation reflection handles those)', async () => {
  const voice = decadesVoice();
  const out = await voice('x', { question: 'what is the pharmacology of harmaline reuptake in the raphe' });
  assert.equal(out, '');
});

test('voice() returns "" on empty input', async () => {
  assert.equal(await decadesVoice()('', {}), '');
});
