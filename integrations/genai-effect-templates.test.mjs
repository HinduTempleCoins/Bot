import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EFFECT_TEMPLATES, EFFECT_CATEGORIES, SUBJECT_KINDS, CHARACTERS,
  listEffects, getEffect, getCharacter, needsConsent, subjectFromInput,
  buildEffectJob, validateEffects,
} from './genai-effect-templates.mjs';

test('registry is valid and wide', () => {
  const v = validateEffects();
  assert.ok(v.ok, 'validateEffects: ' + v.errors.join('; '));
  assert.ok(EFFECT_TEMPLATES.length >= 20, `expected a wide selection, got ${EFFECT_TEMPLATES.length}`);
});

test('every effect: unique id, valid category, {{subject}} placeholder', () => {
  const seen = new Set();
  for (const e of EFFECT_TEMPLATES) {
    assert.ok(!seen.has(e.id), `dup ${e.id}`); seen.add(e.id);
    assert.ok(EFFECT_CATEGORIES.includes(e.category), `${e.id} bad category`);
    assert.match(e.prompt, /\{\{\s*subject\s*\}\}/, `${e.id} missing {{subject}}`);
  }
});

test('no protected trademarks leak into titles/prompts', () => {
  // person-likeness is handled by consent; branded CHARACTERS are copyright/trademark — keep generic
  const banned = /\b(star\s?wars|jedi|sith\b|lightsaber|grinch|pixar|disney|marvel|mickey|pokemon|barbie|simpsons)\b/i;
  for (const e of EFFECT_TEMPLATES) {
    assert.ok(!banned.test(e.title), `${e.id}: trademark in title "${e.title}"`);
    assert.ok(!banned.test(e.prompt), `${e.id}: trademark in prompt`);
  }
});

test('getEffect / listEffects', () => {
  assert.equal(getEffect('gorilla').title, 'Giant Gorilla');
  assert.equal(getEffect('nope'), null);
  assert.ok(listEffects('creature').every((e) => e.category === 'creature'));
  assert.equal(listEffects().length, EFFECT_TEMPLATES.length);
});

test('consent gate: only real people need consent', () => {
  assert.equal(needsConsent('real-person'), true);
  assert.equal(needsConsent('fictional'), false);
  assert.equal(needsConsent('platform'), false);
  assert.equal(needsConsent('builtin'), false);
});

test('buildEffectJob: fictional subject is open and renders the prompt', () => {
  const r = buildEffectJob('superhero', { kind: 'fictional', name: 'Captain Example' });
  assert.ok(r.ok);
  assert.match(r.job.prompt, /Captain Example/);
  assert.doesNotMatch(r.job.prompt, /\{\{/, 'placeholder fully replaced');
  assert.equal(r.job.consent.required, false);
});

test('buildEffectJob: real person WITHOUT consent is blocked', () => {
  const r = buildEffectJob('gorilla', { kind: 'real-person', name: 'Ryan' });
  assert.equal(r.ok, false);
  assert.equal(r.needsConsent, true);
});

test('buildEffectJob: real person WITH a consent record is allowed', () => {
  const r = buildEffectJob('gorilla', { kind: 'real-person', name: 'Ryan', ref: 'upload:abc', consent: 'consent-123' });
  assert.ok(r.ok, r.error);
  assert.equal(r.job.consent.record, 'consent-123');
  assert.equal(r.job.technique, 'character-ref');
});

test('built-in Hathor is pre-cleared and character-referenced', () => {
  assert.ok(getCharacter('hathor'));
  const r = buildEffectJob('space-saga-jedi', { kind: 'builtin', name: 'hathor' });
  assert.ok(r.ok, r.error);
  assert.equal(r.job.consent.cleared, true);
  assert.ok(['character-ref', 'lora'].includes(r.job.technique));
});

test('subjectFromInput rejects unknown kinds and unknown builtins', () => {
  assert.ok(subjectFromInput({ kind: 'bogus' }).error);
  assert.ok(subjectFromInput({ kind: 'builtin', name: 'nobody' }).error);
  assert.ok(subjectFromInput({ kind: 'fictional', name: 'X' }).subject);
});

test('SUBJECT_KINDS and CHARACTERS exported and sane', () => {
  assert.deepEqual(SUBJECT_KINDS, ['builtin', 'platform', 'fictional', 'real-person']);
  assert.ok(CHARACTERS.length >= 1);
});
