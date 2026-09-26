/**
 * tutorial/lang.mjs — language detection + intent classification for comments on Hathor's lessons.
 *
 * Readers do not all write English, do not use the exact call phrase, and make typos. So nothing here
 * matches an exact phrase. Two layers:
 *
 *   1. detectLanguage(text) — offline, dependency-free: Unicode SCRIPT first (Bengali, Devanagari,
 *      Arabic, Cyrillic, Han, Kana, Hangul, Thai, ...), then a stop-word vote among the Latin-script
 *      languages (en, es, pt, fr, de, it, id, tr, tl). Returns { lang, confidence, script }.
 *      `und` when it cannot tell — the caller may then ask the brain.
 *   2. classifyIntentFallback(text) — the cheap deterministic intent read used when the local LLM is
 *      unavailable: multilingual "done / finished / check me" keywords → `claim`; a question mark (any
 *      script: ? ؟ ？ ;) or question words → `question`; else `other`. The brain's classification is
 *      preferred when it answers (tutorial/lesson-brain.mjs); this is the floor.
 *
 * Pure, offline, never throws.
 */

// ---- scripts --------------------------------------------------------------------------------------

const SCRIPTS = [
  ['bn', 'Bengali', /[ঀ-৿]/g],
  ['hi', 'Devanagari', /[ऀ-ॿ]/g],
  ['ar', 'Arabic', /[؀-ۿݐ-ݿ]/g],
  ['ru', 'Cyrillic', /[Ѐ-ӿ]/g],
  ['ko', 'Hangul', /[가-힯ᄀ-ᇿ㄰-㆏]/g],
  ['ja', 'Kana', /[぀-ヿ]/g],
  ['zh', 'Han', /[一-鿿㐀-䶿]/g],
  ['th', 'Thai', /[฀-๿]/g],
  ['el', 'Greek', /[Ͱ-Ͽ]/g],
  ['he', 'Hebrew', /[֐-׿]/g],
  ['ta', 'Tamil', /[஀-௿]/g],
  ['ur', 'Arabic', /[پچژگںھہے]/g], // Urdu-specific letters
];

// Latin-script stop words (short, very frequent, reasonably distinctive).
const STOP = {
  en: 'the and is are you i my to of it this that what how do does did have has with for on in not can please',
  es: 'el la los las de que y es en un una por para con mi no como qué cómo ya terminé hecho está son lo se',
  pt: 'o a os as de que e é em um uma por para com meu minha não como já terminei feito está você isso',
  fr: 'le la les de des que et est en un une pour avec mon ma ne pas comment je j\'ai fini c\'est vous il',
  de: 'der die das und ist ich nicht ein eine mit für mein meine wie was habe fertig bin es zu auf',
  it: 'il lo la gli le di che e è un una per con mio mia non come ho finito fatto sono questo',
  id: 'saya yang dan di ini itu tidak dengan untuk ke sudah apa bagaimana selesai ada kamu aku bisa',
  tr: 've bir bu da de ne nasıl ben benim için değil mi mı bitti tamam yaptım var çok ile',
  tl: 'ang ng sa na ako ko mga ito paano ano tapos na po hindi ba siya ka mo',
};
const STOP_SETS = Object.fromEntries(Object.entries(STOP).map(([k, v]) => [k, new Set(v.split(/\s+/))]));

const strip = (text) => String(text ?? '')
  .replace(/https?:\/\/\S+/g, ' ')        // URLs are not language
  .replace(/@[a-z0-9.-]+/gi, ' ')          // @usernames either
  .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ');

/**
 * Detect the language of a comment. Offline and dependency-free.
 * @returns {{ lang: string, confidence: number, script: string }}
 */
export function detectLanguage(text) {
  const s = strip(text);
  const letters = (s.match(/\p{L}/gu) || []).length;
  if (!letters) return { lang: 'und', confidence: 0, script: 'none' };

  // Script vote. Japanese text mixes Han + Kana; any Kana means Japanese.
  let best = null;
  for (const [lang, script, re] of SCRIPTS) {
    const n = (s.match(re) || []).length;
    if (!n) continue;
    if (!best || n > best.n) best = { lang, script, n };
  }
  if (best && (s.match(/[぀-ヿ]/g) || []).length) best = { lang: 'ja', script: 'Kana', n: best.n };
  if (best && best.n / letters >= 0.3) {
    // Urdu vs Arabic: Urdu-specific letters present → ur.
    if (best.script === 'Arabic' && (s.match(/[پچژگںھہے]/g) || []).length >= 2) {
      return { lang: 'ur', confidence: Math.min(1, best.n / letters), script: 'Arabic' };
    }
    return { lang: best.lang, confidence: Math.min(1, best.n / letters), script: best.script };
  }

  // Latin script: stop-word vote + a few diacritic hints.
  const words = s.toLowerCase().match(/[\p{L}']+/gu) || [];
  const score = Object.fromEntries(Object.keys(STOP_SETS).map((k) => [k, 0]));
  for (const w of words) for (const [k, set] of Object.entries(STOP_SETS)) if (set.has(w)) score[k] += 1;
  if (/[ñ¿¡]/i.test(s)) score.es += 2;
  if (/[ãõ]|ção|ções/i.test(s)) score.pt += 2;
  if (/[ßäöü]/i.test(s)) score.de += 2;
  if (/[ğış]/i.test(s)) score.tr += 2;
  if (/[èàùç]|œ|ê/i.test(s)) score.fr += 1;
  const ranked = Object.entries(score).sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top || top[1] === 0) return { lang: 'und', confidence: 0, script: 'Latin' };
  const conf = top[1] / Math.max(1, top[1] + (second ? second[1] : 0));
  if (top[1] === (second ? second[1] : -1)) return { lang: 'und', confidence: 0.3, script: 'Latin' };
  return { lang: top[0], confidence: Math.min(1, conf), script: 'Latin' };
}

/** Language name for prompts ("Reply in Bengali"). */
export const LANGUAGE_NAMES = Object.freeze({
  en: 'English', es: 'Spanish', pt: 'Portuguese', fr: 'French', de: 'German', it: 'Italian',
  id: 'Indonesian', tr: 'Turkish', tl: 'Tagalog', bn: 'Bengali', hi: 'Hindi', ar: 'Arabic', ur: 'Urdu',
  ru: 'Russian', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', th: 'Thai', el: 'Greek', he: 'Hebrew', ta: 'Tamil',
});
export const languageName = (code) => LANGUAGE_NAMES[code] || null;

// ---- intent -----------------------------------------------------------------------------------------

// "I'm done / finished / check me / completed" in many languages. Lowercased; substring match for
// non-Latin scripts (no word boundaries there), word-ish match for Latin ones.
export const CLAIM_KEYWORDS = Object.freeze({
  en: ['done', 'finished', 'finish', 'completed', 'complete', 'check me', 'check my', 'check it', 'did it', 'i did', 'made it', 'posted it', 'i posted', 'come check', 'come see', 'look at my', 'verify', 'submitted', 'finshed', 'finised', 'compleet', 'chek'],
  es: ['listo', 'lista', 'terminé', 'termine', 'terminado', 'hecho', 'ya lo hice', 'lo hice', 'completé', 'complete', 'revisa', 'revisar', 'verifica', 'comprueba'],
  pt: ['pronto', 'terminei', 'feito', 'concluí', 'conclui', 'completei', 'já fiz', 'ja fiz', 'fiz', 'verifica', 'confere', 'confira'],
  fr: ['fini', 'terminé', 'termine', "j'ai fini", 'fait', "c'est fait", 'complété', 'vérifie', 'vérifier', 'regarde'],
  de: ['fertig', 'erledigt', 'geschafft', 'abgeschlossen', 'gemacht', 'prüf', 'überprüf', 'schau mal'],
  it: ['finito', 'fatto', 'completato', 'terminato', 'ho finito', 'controlla', 'verifica'],
  id: ['selesai', 'sudah', 'sdh', 'beres', 'rampung', 'cek', 'periksa', 'tolong cek'],
  tr: ['bitti', 'bitirdim', 'tamam', 'tamamladım', 'yaptım', 'kontrol et', 'bak'],
  tl: ['tapos na', 'tapos ko na', 'natapos', 'nagawa ko', 'pakicheck', 'paki-check', 'tingnan'],
  bn: ['শেষ', 'সম্পন্ন', 'করেছি', 'করলাম', 'হয়ে গেছে', 'হয়েছে', 'চেক করুন', 'চেক', 'দেখুন', 'পোস্ট করেছি', 'দিয়েছি'],
  hi: ['हो गया', 'पूरा', 'कर दिया', 'कर लिया', 'समाप्त', 'खत्म', 'जांच', 'चेक', 'देखो', 'देखिए'],
  ar: ['انتهيت', 'خلصت', 'تم', 'أنجزت', 'اكتمل', 'تحقق', 'افحص', 'راجع'],
  ur: ['ہو گیا', 'مکمل', 'کر دیا', 'چیک'],
  ru: ['готово', 'сделал', 'сделала', 'закончил', 'закончила', 'выполнил', 'проверь', 'проверьте'],
  zh: ['完成', '做完', '好了', '已完成', '检查', '檢查', '看看'],
  ja: ['終わり', '終わった', '完了', 'できた', 'できました', '確認', 'チェック'],
  ko: ['완료', '끝났', '다 했', '했어요', '했습니다', '확인', '체크'],
});

// Question words beyond the question mark (people drop the "?").
export const QUESTION_KEYWORDS = Object.freeze({
  en: ['how', 'what', 'why', 'where', 'when', 'which', 'can i', 'can you', 'is it', 'does', 'do i', 'help'],
  es: ['cómo', 'como puedo', 'qué', 'por qué', 'dónde', 'cuándo', 'puedo', 'ayuda'],
  pt: ['como', 'o que', 'por que', 'porque', 'onde', 'quando', 'posso', 'ajuda'],
  fr: ['comment', 'quoi', 'pourquoi', 'où', 'quand', 'est-ce', 'puis-je', 'aide'],
  de: ['wie', 'was', 'warum', 'wo', 'wann', 'kann ich', 'hilfe'],
  it: ['come', 'cosa', 'perché', 'dove', 'quando', 'posso', 'aiuto'],
  id: ['bagaimana', 'gimana', 'apa', 'kenapa', 'mengapa', 'di mana', 'dimana', 'kapan', 'bisakah', 'bantu'],
  tr: ['nasıl', 'ne', 'neden', 'nerede', 'ne zaman', 'yardım'],
  tl: ['paano', 'ano', 'bakit', 'saan', 'kailan', 'pwede ba', 'tulong'],
  bn: ['কিভাবে', 'কীভাবে', 'কি', 'কী', 'কেন', 'কোথায়', 'কখন', 'সাহায্য', 'পারি'],
  hi: ['कैसे', 'क्या', 'क्यों', 'कहाँ', 'कब', 'मदद'],
  ar: ['كيف', 'ماذا', 'لماذا', 'أين', 'متى', 'هل', 'ساعد'],
  ur: ['کیسے', 'کیا', 'کیوں', 'کہاں', 'کب'],
  ru: ['как', 'что', 'почему', 'где', 'когда', 'можно', 'помоги'],
  zh: ['怎么', '怎樣', '什么', '什麼', '为什么', '為什麼', '哪里', '哪裡', '吗', '嗎', '如何'],
  ja: ['どうやって', 'どう', '何', 'なぜ', 'どこ', 'いつ', 'ですか', 'ますか'],
  ko: ['어떻게', '무엇', '뭐', '왜', '어디', '언제', '까요', '나요'],
});

const QUESTION_MARKS = /[?？؟¿;]\s*$|[?？؟¿]/; // Greek ';' only at the end

const isLatinWord = (k) => /^[a-zÀ-ɏ' -]+$/i.test(k);
function containsKeyword(text, kw) {
  if (isLatinWord(kw)) {
    const re = new RegExp(`(^|[^\\p{L}])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}])`, 'iu');
    return re.test(text);
  }
  return text.includes(kw);
}

function anyKeyword(text, table, langs) {
  for (const lang of langs) for (const kw of table[lang] || []) if (containsKeyword(text, kw)) return { lang, kw };
  return null;
}

/**
 * Deterministic intent fallback. `callPhrase` is a HINT: if the comment contains it (loosely), that
 * strengthens `claim`, but a comment never needs it.
 * @returns {{ intent: 'claim'|'question'|'other', lang: string, confidence: number, via: string, matched?: string }}
 */
export function classifyIntentFallback(text, { callPhrase = '' } = {}) {
  const raw = strip(text).trim();
  const lower = raw.toLowerCase();
  const det = detectLanguage(raw);
  if (!lower) return { intent: 'other', lang: det.lang, confidence: 0.2, via: 'empty' };
  // Search the detected language first, then every table (mixed-language comments are common).
  const order = [det.lang, 'en', ...Object.keys(CLAIM_KEYWORDS)].filter((v, i, a) => v && a.indexOf(v) === i);
  const hint = String(callPhrase || '').toLowerCase().replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ').trim();
  const loose = lower.replace(/[^\p{L}\p{N} ]/gu, ' ').replace(/\s+/g, ' ');
  const claim = anyKeyword(lower, CLAIM_KEYWORDS, order);
  // A short Latin comment the stop-word vote could not place takes the language of the keyword it hit.
  if (det.lang === 'und' && claim) det.lang = claim.lang;
  const asked = QUESTION_MARKS.test(raw) || Boolean(anyKeyword(lower, QUESTION_KEYWORDS, order));
  if (hint && loose.includes(hint)) return { intent: 'claim', lang: det.lang, confidence: 0.9, via: 'call-phrase-hint' };
  // "Did I finish?" / "¿Ya terminé?" is a claim phrased as a question: a claim keyword wins over "?"
  // unless the question words dominate ("how do I finish" is a question).
  if (claim) {
    const howTo = anyKeyword(lower, { x: [...(QUESTION_KEYWORDS[det.lang] || []), ...QUESTION_KEYWORDS.en].filter((k) => !['is it', 'does', 'help', 'can you'].includes(k)) }, ['x']);
    if (howTo && asked && !/^(check|verify|revisa|verifica|cek|চেক|проверь)/i.test(lower) && /how|cómo|como|comment|wie|come|bagaimana|gimana|nasıl|paano|কিভাবে|কীভাবে|कैसे|كيف|как|怎么|如何|どうやって|어떻게/i.test(lower)) {
      return { intent: 'question', lang: det.lang, confidence: 0.6, via: 'keywords', matched: howTo.kw };
    }
    return { intent: 'claim', lang: det.lang, confidence: 0.7, via: 'keywords', matched: claim.kw };
  }
  if (asked) return { intent: 'question', lang: det.lang, confidence: 0.6, via: 'keywords' };
  return { intent: 'other', lang: det.lang, confidence: 0.4, via: 'keywords' };
}
