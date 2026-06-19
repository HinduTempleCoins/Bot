// hathor-video.test.mjs — the AI video director. Pure/deterministic offline; LLM injected for clever mode.
import { test } from 'node:test';
import assert from 'node:assert';
import { composeVideoPlan, composeVideoPlanLLM, FORMATS, KINDS, __setComplete } from './hathor-video.mjs';

test('a brief becomes a complete, renderable plan', () => {
  const p = composeVideoPlan({ brief: 'an ad for MELEK Move, the step-counter geo-miner', kind: 'ad', format: 'short' });
  assert.equal(p.ok, true);
  assert.equal(p.kind, 'ad');
  assert.equal(p.aspect, '9:16');
  assert.ok(p.scenes.length >= 3 && p.scenes.length <= 8);
  assert.ok(p.hook && p.cta && p.title);
  // the brief's subject carries through (framing words stripped)
  assert.match(p.subject, /MELEK Move/i);
  assert.ok(!/^an ad for/i.test(p.subject));
});

test('every scene has the four render inputs (visual, caption, voiceover, duration)', () => {
  const p = composeVideoPlan({ brief: 'KULA staking', format: 'explainer' });
  for (const s of p.scenes) {
    assert.ok(s.visual && s.visual.length > 5, 'visual prompt');
    assert.ok(typeof s.onScreenText === 'string', 'caption');
    assert.ok(s.voiceover && s.voiceover.length > 3, 'voiceover');
    assert.ok(s.durationSec > 0, 'duration');
  }
  // scene durations sum to ~ the total
  const sum = p.scenes.reduce((a, s) => a + s.durationSec, 0);
  assert.ok(Math.abs(sum - p.durationSec) <= p.scenes.length, 'durations cover the runtime');
});

test('captions track is contiguous and covers the runtime', () => {
  const p = composeVideoPlan({ brief: 'a trailer for Hathor.Live', format: 'trailer' });
  assert.equal(p.captions.length, p.scenes.length);
  assert.equal(p.captions[0].start, 0);
  for (let i = 1; i < p.captions.length; i++) {
    assert.equal(p.captions[i].start, p.captions[i - 1].end, 'no gaps between captions');
  }
});

test('render manifest maps each scene to txt2img + svd img2video, plus ffmpeg assembly', () => {
  const p = composeVideoPlan({ brief: 'MELEK', format: 'square' });
  const m = p.renderManifest;
  assert.equal(m.videoModel, 'svd-img2video');     // the existing genai-comfyui template
  assert.equal(m.steps.length, p.scenes.length);
  assert.equal(m.aspect, '1:1');
  for (const st of m.steps) {
    assert.ok(st.txt2img && st.txt2img.prompt, 'per-scene image prompt');
    assert.equal(st.img2video.template, 'svd-img2video');
  }
  assert.equal(m.assemble.tool, 'ffmpeg');
});

test('formats set aspect + length; unknown format falls back to short', () => {
  assert.equal(composeVideoPlan({ brief: 'x', format: 'explainer' }).aspect, '16:9');
  assert.equal(composeVideoPlan({ brief: 'x', format: 'nope' }).aspect, FORMATS.short.aspect);
  assert.equal(composeVideoPlan({ brief: 'x', format: 'short', durationSec: 9999 }).durationSec, 180); // clamped
});

test('different briefs produce different plans (not a fixed template)', () => {
  const a = composeVideoPlan({ brief: 'an ad for hemp seeds' });
  const b = composeVideoPlan({ brief: 'an ad for a credentialing portal' });
  assert.notEqual(a.title, b.title);
  assert.notEqual(a.scenes[0].visual, b.scenes[0].visual);
});

test('empty brief is safe (defaults to MELEK), never throws', () => {
  const p = composeVideoPlan({});
  assert.equal(p.ok, true);
  assert.ok(p.scenes.length >= 3);
});

test('KINDS/FORMATS are well-formed', () => {
  assert.ok(KINDS.includes('ad'));
  for (const k of Object.keys(FORMATS)) {
    assert.ok(/^\d+:\d+$/.test(FORMATS[k].aspect));
    assert.ok(FORMATS[k].durationSec > 0);
  }
});

test('clever mode: an injected LLM rewrites the copy; bad JSON falls back to the deterministic plan', async () => {
  __setComplete(async () => JSON.stringify({
    title: 'Move. Mine. MELEK.', hook: 'Your steps are a goldmine.', cta: 'Walk in →',
    scenes: [{ n: 1, onScreenText: 'Move', voiceover: 'Every step you take mines MELEK.' }],
  }));
  const p = await composeVideoPlanLLM({ brief: 'MELEK Move', kind: 'ad', format: 'ad', durationSec: 6 });
  assert.equal(p.usedLLM, true);
  assert.equal(p.title, 'Move. Mine. MELEK.');
  assert.match(p.scenes[0].voiceover, /mines MELEK/);

  __setComplete(async () => 'not json at all');
  const fb = await composeVideoPlanLLM({ brief: 'MELEK Move', format: 'ad' });
  assert.equal(fb.usedLLM, false);   // graceful fallback
  assert.equal(fb.ok, true);
  __setComplete(null);
});
