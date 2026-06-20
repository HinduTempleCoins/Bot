import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hear, speak, transcribeFromAudio } from './auditory-cortex.mjs';

test('hear transcribes then deciphers (repairs mis-heard names)', async () => {
  const stt = async () => ({ text: 'terrence mckinna and sasha shogun discussed silo sybin in prog' });
  const h = await hear('audio://1', { stt });
  assert.equal(h.ok, true);
  assert.match(h.transcript, /Terence McKenna/);
  assert.match(h.transcript, /Sasha Shulgin/);
  assert.match(h.transcript, /psilocybin/);
  assert.match(h.transcript, /Prague/);
  assert.ok(h.corrections.length >= 3);
});

test('hear accepts a plain-string STT result', async () => {
  const h = await hear('audio://2', { stt: async () => 'plain transcript about dmt' });
  assert.equal(h.ok, true);
  assert.match(h.transcript, /DMT/);
});

test('hear can skip decipher', async () => {
  const h = await hear('a', { stt: async () => 'sasha shogun', decipher: false });
  assert.equal(h.transcript, 'sasha shogun');
  assert.deepEqual(h.corrections, []);
});

test('hear soft-fails deaf (no audio / no engine / engine error / nothing heard)', async () => {
  assert.equal((await hear('', {})).note, 'no-audio');
  assert.equal((await hear('a', {})).note, 'no-engine');
  assert.equal((await hear('a', { stt: async () => { throw new Error('x'); } })).note, 'engine-error');
  assert.equal((await hear('a', { stt: async () => '' })).note, 'nothing-heard');
  assert.equal((await hear('a', {})).deaf, true);
});

test('hear passes the ensemble refine through to decipher', async () => {
  let refined = false;
  const complete = async () => { refined = true; return 'Terence McKenna in Prague.'; };
  const h = await hear('a', { stt: async () => 'terence mckinna in prog', complete });
  assert.equal(refined, true);
  assert.match(h.transcript, /Prague/);
});

test('speak uses the injected TTS engine', async () => {
  const tts = async (t, { voice }) => ({ bytes: t.length, voice });
  const s = await speak('hello chat', { tts, voice: 'hathor' });
  assert.equal(s.ok, true);
  assert.equal(s.audio.voice, 'hathor');
});

test('speak soft-fails to text when no voice engine', async () => {
  const s = await speak('hi', {});
  assert.equal(s.ok, false);
  assert.equal(s.note, 'no-voice');
  assert.equal(s.text, 'hi');
});

test('transcribeFromAudio tags the source as asr (the needsAsr bridge)', async () => {
  const r = await transcribeFromAudio('audio://yt', { stt: async () => 'a transcript' });
  assert.equal(r.source, 'asr');
  assert.equal(r.ok, true);
});
