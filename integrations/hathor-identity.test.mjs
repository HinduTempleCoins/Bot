// hathor-identity.test.mjs — Hathor recognizes herself across languages. Pure, offline.
import { test } from 'node:test';
import assert from 'node:assert';
import { NAMES, DIVINE_KIN, selfName, recognizes, selfRecognitionLine } from './hathor-identity.mjs';

test('her name is held in every Language Center script', () => {
  const langs = new Set(NAMES.map((n) => n.lang));
  for (const l of ['egyptian', 'koine-greek', 'phoenician-punic', 'latin', 'russian', 'mandarin', 'korean', 'sanskrit']) {
    assert.ok(langs.has(l), `missing her name in ${l}`);
  }
  // the true name is the Egyptian one
  assert.ok(NAMES.some((n) => n.lang === 'egyptian' && /ḥwt-ḥr|hwt-hr/i.test(n.name + n.roman)));
});

test('attested vs transliteration is marked honestly', () => {
  const greek = NAMES.find((n) => n.script === 'greek');
  assert.equal(greek.attested, true);                 // Greek really rendered Ἁθώρ
  const hangul = NAMES.find((n) => n.lang === 'korean');
  assert.equal(hangul.attested, false);               // modern phonetic transcription
});

test('recognizes() affirms her by any of her names/scripts', () => {
  assert.equal(recognizes('are you Hathor?').isHer, true);
  assert.equal(recognizes('Ἁθώρ, speak to me').isHer, true);
  assert.equal(recognizes('Хатхор').isHer, true);
  assert.equal(recognizes('哈索尔').isHer, true);
  assert.equal(recognizes('ḥwt-ḥr').isHer, true);
  // not her name → not a self-match
  assert.equal(recognizes('what is the price of bitcoin').isHer, false);
  assert.equal(recognizes('').isHer, false);
});

test('divine kin cross-link to the Hierophant (language and the gods)', () => {
  const names = DIVINE_KIN.map((k) => k.deity);
  assert.ok(names.some((d) => /Aphrodite/.test(d)));
  assert.ok(names.some((d) => /Ishtar|Inanna/.test(d)));
  // each carries a hierophant entity id to link
  for (const k of DIVINE_KIN) assert.ok(k.hierophant && k.basis);
});

test('selfName returns her rendering in a given language', () => {
  assert.match(selfName('russian').name, /Хатхор/);
  assert.match(selfName('koine-greek').name, /Ἁθώρ/);
  // unknown language falls back to the Greek attested form
  assert.ok(selfName('klingon'));
});

test('selfRecognitionLine names her across tongues + her kin, in-voice', () => {
  const line = selfRecognitionLine();
  assert.match(line, /House of Horus/);
  assert.match(line, /Ἁθώρ/);
  assert.match(line, /Byblos/);
  assert.match(line, /it is you they call/);
});
