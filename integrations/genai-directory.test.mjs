// Tests for the generative-AI competitor directory (genai-directory.mjs).
// Run: node --test integrations/genai-directory.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GENERATORS, byKind, getGenerator, noSignupOptions } from './genai-directory.mjs';

test('directory integrity — every entry complete, https, unique ids', () => {
  const ids = new Set();
  for (const g of GENERATORS) {
    for (const field of ['id', 'name', 'kind', 'url', 'maker', 'free', 'signup', 'strengths']) {
      assert.ok(g[field], `${g.id || g.name}: missing ${field}`);
    }
    assert.match(g.url, /^https:\/\//, `${g.id}: url must be https`);
    assert.ok(['image', 'video'].includes(g.kind), `${g.id}: bad kind`);
    assert.ok(!ids.has(g.id), `duplicate id ${g.id}`);
    ids.add(g.id);
  }
});

test('the operator-named essentials are present', () => {
  assert.ok(getGenerator('bing-image-creator'), 'Bing is the one the operator named');
  assert.ok(getGenerator('capcut'), 'CapCut is the template-maker model');
  assert.ok(getGenerator('gemini'));
  assert.ok(getGenerator('pollinations'));
});

test('byKind splits image vs video, both non-empty', () => {
  const img = byKind('image'), vid = byKind('video');
  assert.ok(img.length >= 10, 'a real image directory');
  assert.ok(vid.length >= 4, 'a real video lane');
  assert.equal(img.length + vid.length, GENERATORS.length);
});

test('zero-signup options exist (the no-friction path)', () => {
  const open = noSignupOptions();
  assert.ok(open.length >= 2);
  assert.ok(open.every((g) => g.signup === 'none'));
});
