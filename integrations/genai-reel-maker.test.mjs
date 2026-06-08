// genai-reel-maker.test.mjs — offline tests for the CapCut-style reel template maker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REEL_TEMPLATES, REEL_ASPECTS, listReelTemplates, getReelTemplate,
  buildReelSpec, shotlist, validateReelTemplates,
} from './genai-reel-maker.mjs';

test('library has several templates and is valid', () => {
  assert.ok(REEL_TEMPLATES.length >= 4, `expected >=4, got ${REEL_TEMPLATES.length}`);
  const v = validateReelTemplates();
  assert.equal(v.ok, true, 'integrity errors: ' + v.errors.join('; '));
});

test('buildReelSpec produces a correct spec from inputs', () => {
  const { ok, spec } = buildReelSpec('hook-explainer', {
    topic: 'how voting works', hook: 'STOP scrolling', point1: 'A', point2: 'B', cta: 'Follow me',
  });
  assert.equal(ok, true);
  assert.equal(spec.template, 'hook-explainer');
  assert.equal(spec.kind, 'reel-storyboard');
  assert.equal(spec.sceneCount, spec.scenes.length);
  assert.ok(spec.scenes[0].caption.includes('STOP scrolling'));
  assert.ok(spec.scenes.some((s) => s.caption.includes('Follow me')));
  // timeline is contiguous and totals up
  let t = 0;
  for (const s of spec.scenes) { assert.equal(s.start, t); t += s.seconds; }
  assert.equal(spec.totalSeconds, t);
  // no leftover placeholders
  for (const s of spec.scenes) assert.ok(!s.caption.includes('{{'), 'placeholder leaked');
});

test('missing fields fall back to their example', () => {
  const { spec } = buildReelSpec('hook-explainer', { hook: 'My hook' });
  const t = getReelTemplate('hook-explainer');
  const topicEx = t.fields.find((f) => f.key === 'topic').example;
  assert.ok(spec.scenes.some((s) => s.caption.includes(topicEx)), 'missing field uses example');
  assert.ok(spec.scenes.some((s) => s.caption.includes('My hook')));
});

test('opts.aspect overrides when valid, ignored when not', () => {
  assert.equal(buildReelSpec('hook-explainer', {}, { aspect: '1:1' }).spec.aspect, '1:1');
  const dflt = getReelTemplate('hook-explainer').aspect;
  assert.equal(buildReelSpec('hook-explainer', {}, { aspect: 'bogus' }).spec.aspect, dflt);
});

test('unknown template id soft-fails (no throw)', () => {
  const r = buildReelSpec('does-not-exist', {});
  assert.equal(r.ok, false);
  assert.ok(r.error.includes('does-not-exist'));
});

test('bad / non-string field values are coerced, never throw', () => {
  const r = buildReelSpec('hook-explainer', { hook: 12345, topic: null, point1: { x: 1 } });
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r.spec).includes('{{'));
});

test('shotlist renders a human-readable plan from a spec', () => {
  const { spec } = buildReelSpec('listicle-5', { subject: 'tea' });
  const txt = shotlist(spec);
  assert.ok(txt.includes('5 Quick Tips'));
  assert.ok(/\d+s–\d+s/.test(txt), 'timecodes present');
  assert.ok(txt.includes('tea'));
});

test('shotlist soft-fails on a bad spec', () => {
  assert.equal(shotlist(null), '');
  assert.equal(shotlist({}), '');
});

test('every template default aspect is a known aspect', () => {
  for (const t of REEL_TEMPLATES) assert.ok(REEL_ASPECTS.includes(t.aspect), `${t.id}: bad aspect`);
});

test('the spec is JSON-serializable (downloadable)', () => {
  const { spec } = buildReelSpec('quote-card', { quote: 'Be still' });
  const json = JSON.stringify(spec, null, 2);
  assert.deepEqual(JSON.parse(json).template, 'quote-card');
});

test('listReelTemplates + unique ids', () => {
  assert.equal(listReelTemplates().length, REEL_TEMPLATES.length);
  const ids = REEL_TEMPLATES.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
});
