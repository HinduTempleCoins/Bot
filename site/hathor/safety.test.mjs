import { test } from 'node:test';
import assert from 'node:assert/strict';
import { screenPrompt } from './safety.mjs';

test('clean prompts pass and are not adult', () => {
  const r = screenPrompt('an Egyptian temple at golden hour, cinematic');
  assert.equal(r.ok, true);
  assert.equal(r.adult, false);
});

test('artistic nudity is ALLOWED (nudity is art), flagged adult', () => {
  const r = screenPrompt('a nude goddess, classical life drawing, tasteful');
  assert.equal(r.ok, true);
  assert.equal(r.adult, true);
});

test('sexy / lingerie is allowed but adult-flagged', () => {
  const r = screenPrompt('a sensual woman in lingerie, boudoir, attractive');
  assert.equal(r.ok, true);
  assert.equal(r.adult, true);
});

test('hardcore pornography is always refused', () => {
  for (const p of ['a girl with cum on her and a dick in her ass', 'explicit blowjob', 'hardcore penetration porn']) {
    const r = screenPrompt(p);
    assert.equal(r.ok, false, p);
    assert.equal(r.reason, 'pornographic', p);
  }
});

test('nudity from an uploaded real photo is refused (no deepfakes)', () => {
  const r = screenPrompt('make her nude', { hasReferenceImage: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'real-person');
});

test('the same nude prompt WITHOUT a reference is allowed-but-adult', () => {
  const r = screenPrompt('a nude figure study');
  assert.equal(r.ok, true);
  assert.equal(r.adult, true);
});

test('anything sexual/nude + minor is refused', () => {
  const r = screenPrompt('a nude teen');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'minor');
});

test('minor + uploaded photo is refused even if not overtly sexual', () => {
  const r = screenPrompt('a schoolgirl', { hasReferenceImage: true });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'minor');
});

test('non-sexual mention of a child is not blocked', () => {
  const r = screenPrompt('a child playing in a sunlit garden, wholesome');
  assert.equal(r.ok, true);
  assert.equal(r.adult, false);
});
