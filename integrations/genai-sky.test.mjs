import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CLOUDS, skyCue, defaultSkyFor, cloudTypes } from './genai-sky.mjs';
test('knows pyrocumulus and a broad taxonomy', () => {
  assert.match(CLOUDS.pyrocumulus, /fire/i);
  assert.ok(cloudTypes().length >= 18);
  assert.match(skyCue('cumulonimbus'), /anvil/i);
  assert.equal(skyCue('nope'), null);
});
test('default sky is the North Texas prairie sky; places override', () => {
  assert.match(defaultSkyFor(''), /North Texas|cumulus/i);
  assert.match(defaultSkyFor('North Texas'), /North Texas/i);
  assert.match(defaultSkyFor('Arizona desert'), /cirrus|clear/i);
});
