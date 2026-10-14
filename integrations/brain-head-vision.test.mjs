import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from './brain-head-vision.mjs';

// a fake pipeline router: returns a canned result shaped per pipeline-task
function fakeFactory() {
  return async (task) => async (input, arg2) => {
    // zero-shot tasks receive candidate_labels as a positional array (arg2)
    if (task === 'zero-shot-image-classification') return (arg2 || []).map((l, i) => ({ label: l, score: i === 0 ? 0.92 : 0.02 }));
    if (task === 'zero-shot-object-detection') return (arg2 || []).map((l) => ({ label: l, score: 0.5, box: {} }));
    if (task === 'image-classification') return [{ label: 'golden retriever', score: 0.8 }];
    if (task === 'image-to-text') return [{ generated_text: input.includes('receipt') ? 'TOTAL $12.00' : 'a dog sitting on grass' }];
    if (task === 'object-detection') return [{ label: 'dog', score: 0.95, box: {} }];
    if (task === 'depth-estimation') return { depth: 'tensor' };
    if (task === 'image-segmentation') return [{ label: 'sky', score: 0.9 }];
    return null;
  };
}

test('vision: zero-shot classify with candidate labels ranks them', async () => {
  V.__setPipelineFactory(fakeFactory());
  const v = V.createVisionHead();
  const out = await v.classify('photo.jpg', ['a bird', 'a flower', 'a mushroom', 'a dog']);
  assert.equal(out[0].label, 'a bird'); assert.ok(out[0].score > 0.9);
  V.__setPipelineFactory(null);
});

test('vision: caption / ocr / detect / imagenet classify', async () => {
  V.__setPipelineFactory(fakeFactory());
  const v = V.createVisionHead();
  assert.match(await v.caption('photo.jpg'), /dog sitting/);
  assert.match(await v.readText('receipt.png'), /TOTAL/);
  assert.equal((await v.detect('photo.jpg'))[0].label, 'dog');
  assert.equal((await v.detect('photo.jpg', ['cat', 'dog'])).length, 2); // zero-shot path
  assert.equal((await v.classify('photo.jpg'))[0].label, 'golden retriever'); // imagenet path (no labels)
  V.__setPipelineFactory(null);
});

test('vision: every method soft-returns (null/[]) when a model cannot load', async () => {
  V.__setPipelineFactory(async () => null);
  const v = V.createVisionHead();
  assert.equal(await v.classify('x', ['a']), null);
  assert.equal(await v.caption('x'), null);
  assert.equal(await v.readText('x'), null);
  assert.deepEqual(await v.detect('x'), []);
  V.__setPipelineFactory(null);
});

test('vision: capabilities list + task registry is overridable', () => {
  const v = V.createVisionHead({ ocr: { task: 'image-to-text', model: 'Xenova/trocr-base-handwritten' } });
  assert.ok(v.capabilities().includes('caption'));
  assert.equal(v.models.ocr.model, 'Xenova/trocr-base-handwritten');
  assert.ok(V.VISION_MODELS.zeroShotClassify.model.includes('clip'));
});
