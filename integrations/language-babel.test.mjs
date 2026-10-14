import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as T from './brain-head-translate.mjs';
import { createLanguageTeacher, matchLanguage } from './brain-head-language-teacher.mjs';

test('translate head: injected net translates; maps friendly lang names to FLORES', async () => {
  let seenOpts = null;
  T.__setPipelineFactory(async () => async (txt, opts) => { seenOpts = opts; return [{ translation_text: 'Que la paix soit avec toi' }]; });
  const tr = T.createTranslateHead();
  const r = await tr.translate('Peace be with you', { from: 'english', to: 'french' });
  assert.equal(r.backend, 'net');
  assert.equal(r.text, 'Que la paix soit avec toi');
  assert.equal(seenOpts.src_lang, 'eng_Latn');   // name -> FLORES
  assert.equal(seenOpts.tgt_lang, 'fra_Latn');
  T.__setPipelineFactory(null);
});

test('translate head: soft-returns input (passthrough) when the net cannot load', async () => {
  T.__setPipelineFactory(async () => null);
  const tr = T.createTranslateHead();
  const r = await tr.translate('hello', { to: 'spanish' });
  assert.equal(r.backend, 'passthrough');
  assert.equal(r.text, 'hello');     // never hard-fails
  assert.equal(r.to, 'spa_Latn');
  T.__setPipelineFactory(null);
});

test('toNllb maps names/iso and passes FLORES through', () => {
  assert.equal(T.toNllb('kurdish'), 'kmr_Latn');
  assert.equal(T.toNllb('zh'), 'zho_Hans');
  assert.equal(T.toNllb('fra_Latn'), 'fra_Latn');
});

test('language teacher: matches a requested language from free text', () => {
  assert.ok(matchLanguage('I want to learn kurdish'));
  assert.ok(matchLanguage('teach me biblical hebrew') || matchLanguage('hebrew'));
});

test('language teacher: builds a Jesuit-method plan with real catalog resources', () => {
  const teach = createLanguageTeacher();
  assert.ok(teach.offerings().resourceCount > 0);
  const out = teach.teach('I want to learn Kurmanji Kurdish');
  assert.equal(out.ok, true);
  assert.ok(out.plan.length >= 1, 'has staged plan');
  assert.ok(out.resources.length >= 1, 'has resources');
  assert.match(out.reply, /teach you/i);
  assert.match(out.guardrail, /Jesuit|primary|verified/i);
});

test('language teacher: unknown request returns the offerings, not a crash', () => {
  const teach = createLanguageTeacher();
  const out = teach.teach('teach me klingon');
  assert.equal(out.ok, false);
  assert.ok(out.offerings.families.length >= 1);
});
