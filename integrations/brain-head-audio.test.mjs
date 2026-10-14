import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as A from './brain-head-audio.mjs';

function fakeFactory() {
  return async (task) => async (input, opts) => {
    if (task === 'automatic-speech-recognition') return { text: 'peace be with you' };
    if (task === 'audio-classification') return [{ label: 'Speech', score: 0.9 }, { label: 'Music', score: 0.05 }];
    if (task === 'text-to-speech') return { audio: new Float32Array([0, 0.1, 0]), sampling_rate: 16000 };
    return null;
  };
}

test('audio: listen transcribes speech (Whisper path)', async () => {
  A.__setPipelineFactory(fakeFactory());
  const a = A.createAudioHead();
  assert.equal(await a.listen('clip.wav'), 'peace be with you');
  A.__setPipelineFactory(null);
});

test('audio: hearSound names sounds; speak returns a waveform', async () => {
  A.__setPipelineFactory(fakeFactory());
  const a = A.createAudioHead();
  const sounds = await a.hearSound('street.wav');
  assert.equal(sounds[0].label, 'Speech');
  const spoken = await a.speak('hello');
  assert.equal(spoken.sampling_rate, 16000);
  assert.ok(spoken.audio.length > 0);
  A.__setPipelineFactory(null);
});

test('audio: every method soft-returns when a model cannot load', async () => {
  A.__setPipelineFactory(async () => null);
  const a = A.createAudioHead();
  assert.equal(await a.listen('x'), null);
  assert.deepEqual(await a.hearSound('x'), []);
  assert.equal(await a.speak('x'), null);
  A.__setPipelineFactory(null);
});

test('audio: registry is overridable + capabilities list', () => {
  const a = A.createAudioHead({ listen: { task: 'automatic-speech-recognition', model: 'Xenova/whisper-tiny.en' } });
  assert.equal(a.models.listen.model, 'Xenova/whisper-tiny.en');
  assert.ok(a.capabilities().includes('hearSound'));
  assert.ok(A.AUDIO_MODELS.listen.model.includes('whisper'));
});
