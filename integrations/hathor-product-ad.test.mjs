// hathor-product-ad.test.mjs — the product-ad reel/script generator. Fully offline (fake generator).
import { test } from 'node:test';
import assert from 'node:assert';
import {
  composeProductAd, renderSlideshowStills, adScript,
  listProducts, getProduct, PRODUCTS,
} from './hathor-product-ad.mjs';
import { HATHOR_SIGNATURE } from '../witness/hathor-post-image.mjs';

test('catalog lookups', () => {
  assert.ok(listProducts().length >= 5);
  assert.equal(getProduct('KulaSwap').id, 'kulaswap'); // case-insensitive
  assert.equal(getProduct('nope'), null);
  for (const p of PRODUCTS) { assert.ok(p.name && p.tagline && p.benefits.length >= 2 && p.url && p.call && p.look); }
});

test('composeProductAd builds a full renderable ad plan', () => {
  const ad = composeProductAd('kulaswap', { format: 'ad' });
  assert.equal(ad.ok, true);
  assert.equal(ad.product, 'kulaswap');
  assert.equal(ad.name, 'KulaSwap');
  assert.equal(ad.aspect, '9:16');
  assert.ok(ad.scenes.length >= 3);
  assert.equal(ad.cta, 'Swap now');
  assert.match(ad.ctaUrl, /kulaswap/);
  // hook voiceover carries the tagline
  assert.match(ad.hook, /swap the ecosystem tokens/i);
});

test('unknown product soft-fails with the list', () => {
  const ad = composeProductAd('dogecoin');
  assert.equal(ad.ok, false);
  assert.match(ad.error, /unknown product/);
  assert.ok(ad.products.includes('melek'));
});

test('presenter beats put Hathor on-screen with her canonical signature', () => {
  const ad = composeProductAd('melek');
  const presenter = ad.scenes.filter((s) => s.presenter);
  assert.ok(presenter.length >= 2, 'hook/reveal/call are presenter beats');
  for (const s of presenter) {
    assert.ok(s.visual.startsWith(HATHOR_SIGNATURE.split(':')[0]), 'signature leads presenter visuals');
    assert.match(s.visual, /VR\/oculus headset/);
  }
  // non-presenter beats show the product, not the figure
  const broll = ad.scenes.filter((s) => !s.presenter);
  for (const s of broll) assert.ok(!s.visual.includes('VR/oculus headset'));
});

test('benefits are injected into the body scenes', () => {
  const ad = composeProductAd('tools');
  const texts = ad.scenes.map((s) => s.onScreenText).join(' | ');
  assert.match(texts, /Paste it into any forum/);
});

test('captions are contiguous and cover the runtime', () => {
  const ad = composeProductAd('prana');
  assert.equal(ad.captions.length, ad.scenes.length);
  assert.equal(ad.captions[0].start, 0);
  for (let i = 1; i < ad.captions.length; i++) assert.equal(ad.captions[i].start, ad.captions[i - 1].end);
});

test('two render paths — slideshow buildable-now, svd needs GPU', () => {
  const ad = composeProductAd('hathor-live-40hz');
  const rp = ad.renderPaths;
  assert.equal(rp.slideshow.buildableNow, true);
  assert.equal(rp.slideshow.needsGpu, false);
  assert.equal(rp.slideshow.steps.length, ad.scenes.length);
  assert.ok(rp.slideshow.steps[0].still.prompt);
  assert.equal(rp.svd.buildableNow, false);
  assert.equal(rp.svd.needsGpu, true);
  assert.equal(rp.svd.manifest.videoModel, 'svd-img2video'); // reuses composeVideoPlan manifest
  assert.ok(rp.svd.hostedAlternatives.includes('runway'));
});

test('renderSlideshowStills renders one still per scene through an injected generator', async () => {
  const calls = [];
  const gen = async ({ prompt, size }) => { calls.push({ prompt, size }); return { ok: true, base64: 'ZZ', mime: 'image/png', provider: 'pollinations' }; };
  const res = await renderSlideshowStills('melek', { format: 'short' }, { generate: gen });
  assert.equal(res.ok, true);
  assert.equal(res.stills.length, res.ad.scenes.length);
  assert.ok(res.stills.every((s) => s.ok && s.base64 === 'ZZ'));
  // 9:16 short → portrait still size
  assert.equal(calls[0].size, '576x1024');
});

test('renderSlideshowStills soft-fails per scene without throwing', async () => {
  const gen = async () => { throw new Error('provider down'); };
  const res = await renderSlideshowStills('kulaswap', {}, { generate: gen });
  assert.equal(res.ok, true);
  assert.ok(res.stills.every((s) => s.ok === false && /provider down/.test(s.error)));
});

test('renderSlideshowStills reports unknown product', async () => {
  const res = await renderSlideshowStills('nope', {}, { generate: async () => ({ ok: true, base64: 'x' }) });
  assert.equal(res.ok, false);
});

test('adScript renders a human shotlist', () => {
  const s = adScript(composeProductAd('kulaswap'));
  assert.match(s, /KulaSwap/);
  assert.match(s, /HOOK:/);
  assert.match(s, /CTA:.*kulaswap/);
  assert.match(s, /Hathor on-screen/);
  assert.equal(adScript({ ok: false }), '');
});
