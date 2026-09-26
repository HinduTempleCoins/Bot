// lang.test.mjs — OFFLINE. Language detection + multilingual intent (claim / question / other) with no
// exact phrase required. Bengali is tested specifically: many current MELEK users write in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectLanguage, classifyIntentFallback, CLAIM_KEYWORDS, languageName } from './lang.mjs';

const CLAIMS = [
  ['en', 'I finished the lesson, check me'],
  ['en', 'finshed it lol'],                      // typo
  ['es', 'Ya terminé la lección, revisa por favor'],
  ['pt', 'Já fiz o post, confere'],
  ['fr', "J'ai fini la leçon"],
  ['de', 'Ich bin fertig mit der Lektion'],
  ['it', 'Ho finito la lezione'],
  ['id', 'Saya sudah selesai, tolong cek'],
  ['bn', 'আমি পাঠটি শেষ করেছি'],
  ['bn', 'আমি পোস্ট করেছি, চেক করুন'],
  ['hi', 'मैंने पाठ पूरा कर दिया'],
  ['ar', 'انتهيت من الدرس'],
  ['ru', 'Я закончил урок, проверь'],
  ['tr', 'Dersi bitirdim'],
  ['zh', '我完成了'],
  ['ja', '終わりました、確認してください'],
  ['ko', '레슨 완료했습니다'],
  ['tl', 'Tapos na po ako'],
];

const QUESTIONS = [
  ['en', 'how do I upload a photo?'],
  ['en', 'where is the editor'],                 // no question mark
  ['es', '¿Cómo subo una imagen?'],
  ['pt', 'Como eu coloco a foto'],
  ['bn', 'ছবি কিভাবে আপলোড করব?'],
  ['bn', 'আমি কিভাবে পোস্ট করব'],               // no question mark
  ['hi', 'फोटो कैसे डालें?'],
  ['ar', 'كيف أضيف صورة؟'],
  ['ru', 'Как добавить фото?'],
  ['zh', '怎么上传图片？'],
  ['ja', '写真はどうやって追加しますか'],
  ['ko', '사진은 어떻게 올리나요?'],
];

test('every claim, in 17 languages and with typos, reads as a claim — no exact phrase needed', () => {
  for (const [lang, text] of CLAIMS) {
    const r = classifyIntentFallback(text);
    assert.equal(r.intent, 'claim', `${lang}: ${text}`);
  }
});

test('questions read as questions, with or without a question mark, in any script', () => {
  for (const [lang, text] of QUESTIONS) {
    assert.equal(classifyIntentFallback(text).intent, 'question', `${lang}: ${text}`);
  }
});

test('"how do I finish" is a question even though it contains a claim word', () => {
  assert.equal(classifyIntentFallback('how do I finish this lesson?').intent, 'question');
  assert.equal(classifyIntentFallback('¿Cómo termino la lección?').intent, 'question');
});

test('chat is other', () => {
  for (const t of ['nice pic lol', 'thanks Hathor!', 'ধন্যবাদ', '']) assert.equal(classifyIntentFallback(t).intent, 'other', t);
});

test('the call phrase is only a hint: it strengthens a claim but is never required', () => {
  const r = classifyIntentFallback('Hathor, check my lesson 03', { callPhrase: 'Hathor, check my lesson 03' });
  assert.equal(r.intent, 'claim');
  assert.equal(r.via, 'call-phrase-hint');
  assert.equal(classifyIntentFallback('ok all done here').intent, 'claim');
});

test('detectLanguage: scripts first (Bengali, Hindi, Arabic, Russian, CJK), then Latin stop words', () => {
  const cases = [
    ['bn', 'আমি পাঠটি শেষ করেছি, দয়া করে দেখুন'],
    ['hi', 'मैंने पाठ पूरा कर दिया है'],
    ['ar', 'انتهيت من الدرس اليوم'],
    ['ru', 'Я закончил урок сегодня'],
    ['zh', '我今天完成了课程'],
    ['ja', '今日レッスンを終わりました'],
    ['ko', '오늘 레슨을 완료했습니다'],
    ['es', 'Ya terminé la lección de hoy y está muy bien'],
    ['pt', 'Eu já fiz o post e não sei como ver'],
    ['fr', "J'ai fini la leçon et c'est très bien"],
    ['de', 'Ich habe die Lektion gemacht und bin fertig'],
    ['it', 'Ho finito la lezione e sono contento'],
    ['id', 'Saya sudah selesai dengan pelajaran ini'],
    ['tr', 'Ben bu dersi bitirdim ve çok güzel'],
    ['tl', 'Tapos na po ako sa aralin na ito'],
    ['en', 'I have finished the lesson and it is good'],
  ];
  for (const [lang, text] of cases) assert.equal(detectLanguage(text).lang, lang, text);
});

test('URLs and @names are not language; empty text is und', () => {
  assert.equal(detectLanguage('@hathor https://melek.salon/@hathor/x').lang, 'und');
  assert.equal(detectLanguage('').lang, 'und');
  assert.equal(detectLanguage('@hathor আমি শেষ করেছি https://x.y/z').lang, 'bn');
});

test('keyword tables cover the operator-listed languages', () => {
  for (const l of ['es', 'pt', 'fr', 'de', 'it', 'id', 'bn', 'hi', 'ar', 'ru', 'tr', 'zh', 'ja', 'ko', 'tl']) {
    assert.ok(CLAIM_KEYWORDS[l]?.length, l);
    assert.ok(languageName(l), l);
  }
});
