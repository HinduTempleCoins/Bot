// brain-head-translate.mjs — Hathor's MULTILINGUAL head (the Babel seat). A native-CPU neural translation
// model on the same transformers.js lane as MiniLM, so she can READ a message in another language and
// ANSWER in it. General capability any world-facing brain needs. ZERO external API — open weights pulled
// + cached on the box (verified: the opus-mt / NLLB / multilingual-MiniLM lane loads CPU-native).
//
// Injectable + soft-fail: tests inject a fake pipe (ZERO network); if the net can't load, translate()
// soft-returns the input unchanged with backend:'passthrough' so nothing hard-fails. Importing does NO work.
//
//   import { createTranslateHead } from './brain-head-translate.mjs';
//   const tr = createTranslateHead();                 // many-language net on the box
//   await tr.translate('Peace be with you', { from: 'eng_Latn', to: 'fra_Latn' });
//
// Model is env-overridable. Default = NLLB-200 (200 languages, needs src/tgt lang codes). For a lighter
// per-pair option pin an opus-mt model (e.g. Xenova/opus-mt-en-fr), which ignores the lang codes.
//   MELEK_TRANSLATE_MODEL=Xenova/nllb-200-distilled-600M   (or Xenova/m2m100_418M, Xenova/opus-mt-xx-yy)

const DEFAULT_MODEL = process.env.MELEK_TRANSLATE_MODEL || 'Xenova/nllb-200-distilled-600M';

let _factory = null;
export function __setPipelineFactory(fn) { _factory = typeof fn === 'function' ? fn : null; _pipe = null; }

let _pipe = null, _loading = null, _model = null;
async function loadPipe(model) {
  if (_pipe && _model === model) return _pipe;
  if (_factory) { _pipe = await _factory(model); _model = model; return _pipe; }
  if (_loading && _model === model) return _loading;
  _model = model;
  _loading = (async () => {
    try {
      const { pipeline, env } = await import('@huggingface/transformers');
      try { env.allowRemoteModels = true; } catch { /* older builds */ }
      _pipe = await pipeline('translation', model);
      return _pipe;
    } catch { _pipe = null; return null; }
  })();
  return _loading;
}

function normalize(out) {
  const r = Array.isArray(out) ? out[0] : out;
  const text = r && (r.translation_text ?? r.generated_text ?? r.text);
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

// Common language name -> NLLB FLORES code (so callers can say "french"/"fr" not "fra_Latn").
const NLLB = {
  english: 'eng_Latn', en: 'eng_Latn', french: 'fra_Latn', fr: 'fra_Latn', spanish: 'spa_Latn', es: 'spa_Latn',
  arabic: 'arb_Arab', ar: 'arb_Arab', kurdish: 'kmr_Latn', kurmanji: 'kmr_Latn', sorani: 'ckb_Arab',
  mandarin: 'zho_Hans', chinese: 'zho_Hans', zh: 'zho_Hans', russian: 'rus_Cyrl', ru: 'rus_Cyrl',
  korean: 'kor_Hang', ko: 'kor_Hang', hindi: 'hin_Deva', hi: 'hin_Deva', hebrew: 'heb_Hebr', he: 'heb_Hebr',
  greek: 'ell_Grek', el: 'ell_Grek', portuguese: 'por_Latn', pt: 'por_Latn', german: 'deu_Latn', de: 'deu_Latn',
  turkish: 'tur_Latn', tr: 'tur_Latn', farsi: 'pes_Arab', persian: 'pes_Arab', fa: 'pes_Arab', somali: 'som_Latn',
};
export const toNllb = (lang) => NLLB[String(lang || '').toLowerCase().trim()] || lang;

export function createTranslateHead({ model = DEFAULT_MODEL } = {}) {
  return {
    model,
    /** Translate text. {from,to} accept names ("french"), ISO ("fr") or FLORES ("fra_Latn"). */
    async translate(text, { from = 'eng_Latn', to = 'fra_Latn' } = {}) {
      const t = String(text || '');
      if (!t.trim()) return { text: '', backend: 'passthrough', to };
      const src = toNllb(from), tgt = toNllb(to);
      try {
        const pipe = await loadPipe(model);
        if (pipe) {
          const out = await pipe(t, { src_lang: src, tgt_lang: tgt }); // opus-mt ignores these harmlessly
          const n = normalize(out);
          if (n) return { text: n, backend: 'net', from: src, to: tgt };
        }
      } catch { /* fall through */ }
      return { text: t, backend: 'passthrough', from: src, to: tgt }; // never hard-fail
    },
  };
}
