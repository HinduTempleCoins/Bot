import { test } from 'node:test';
import assert from 'node:assert/strict';
import { see, watch, describePercept } from './visual-cortex.mjs';

test('see uses detectImage (rich) when available', async () => {
  const detectImage = async () => ({ description: 'a city skyline', extractedText: 'WELCOME', match: true, source: 'chain:@x/post', confidence: 0.8 });
  const p = await see('img://1', { detectImage });
  assert.equal(p.blind, false);
  assert.match(p.description, /skyline/);
  assert.equal(p.text, 'WELCOME');
  assert.equal(p.known, true);
  assert.equal(p.source, 'chain:@x/post');
});

test('see falls back to describeImage', async () => {
  const describeImage = async () => ({ description: 'a dog', extractedText: '' });
  const p = await see('img://2', { describeImage });
  assert.match(p.description, /dog/);
  assert.equal(p.known, false);
});

test('threatening scene gets a threat tag from the amygdala', async () => {
  const describeImage = async () => ({ description: 'a phishing scam login page asking for your seed phrase', extractedText: '' });
  const p = await see('img://3', { describeImage });
  assert.ok(p.tags.includes('threat'));
  assert.ok(p.salience > 0);
});

test('see soft-fails to a blind percept (no organ / error / no image)', async () => {
  assert.equal((await see('img://x', {})).blind, true);
  assert.equal((await see('', { describeImage: async () => ({}) })).blind, true);
  const p = await see('img://x', { describeImage: async () => { throw new Error('vision down'); } });
  assert.equal(p.blind, true);
  assert.equal(p.why, 'organ-error');
});

test('watch shares a novelty set across frames', async () => {
  const describeImage = async () => ({ description: 'same repeated frame of a wall', extractedText: '' });
  const seen = new Set();
  const out = await watch(['f://1', 'f://2'], { describeImage, seen });
  assert.equal(out.length, 2);
});

test('describePercept speaks a clean line', async () => {
  const p = await see('img://4', { describeImage: async () => ({ description: 'a sunset', extractedText: 'THE END' }) });
  const line = describePercept(p);
  assert.match(line, /sunset/);
  assert.match(line, /THE END/);
  assert.equal(describePercept({ blind: true }), 'I cannot make out the image right now.');
});
