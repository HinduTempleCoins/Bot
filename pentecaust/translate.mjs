// pentecaust/translate.mjs — Pentecaust's translation layer (the "descent of tongues").
//
// The name is load-bearing: Pentecost = the descent of tongues, where every nation hears in its OWN
// language. So Pentecaust messages cross language barriers automatically — each reader sees a message in
// THEIR preferred language, with the original always preserved. This is one of the two headline features
// (the other is the platform-agnostic connector layer); both sit on the identity base in auth.mjs.
//
// WHAT THIS IS
//   - A per-account language preference (account -> lang code), file-backed + injectable fs.
//   - `translate({text, to, from})` → { text (original), tr (translated|null), to, from } — soft-fails to
//     the original on any error (never throws, never blocks a message).
//   - `translateMessages(messages, to)` → the same array with `text_tr` + `tr_to` added where a translation
//     differs from the original; the original `text` is untouched so the UI can show "original".
//   - Provider is pluggable + KEYLESS by default (MyMemory) so it works live with no setup; override with a
//     LibreTranslate-style endpoint via env (TRANSLATE_URL [+ TRANSLATE_API_KEY]).
//   - Injectable fetch (`__setFetch`) + an in-memory LRU-ish cache so the offline suite never hits network.
//
//   import { translate, translateMessages, setLang, getLang, __setFetch } from './translate.mjs'

import { fileURLToPath } from 'node:url';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

// ── per-account language preference store (account -> lang) ──────────────────────────────────────────
const DATA_FILE = () => env('TRANSLATE_DATA', join(process.cwd(), 'data', 'pentecaust-translate.json'));
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} try { writeFileSync(p, s); } catch {} },
};
const ctx = (opts = {}) => ({ fs: opts.fs || realFs, file: opts.file || DATA_FILE() });
function loadPrefs(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { lang: {} };
  try { const o = JSON.parse(raw); return o && o.lang ? o : { lang: {} }; } catch { return { lang: {} }; }
}
const _acct = (s) => String(s || '').trim().toLowerCase();

// A permissive ISO-639-ish guard: 2–5 letters, optional region (e.g. en, es, pt-br, zh-CN). Lowercased.
const LANG_RE = /^[a-z]{2,3}(-[a-z]{2,4})?$/;
export function normLang(l) {
  const s = String(l || '').trim().toLowerCase();
  return LANG_RE.test(s) ? s : '';
}

/** Set an account's preferred language (e.g. 'es', 'pt-br'). Empty/invalid clears it. */
export function setLang(account, lang, opts = {}) {
  const acct = _acct(account);
  if (!acct) return { ok: false, reason: 'account required' };
  const { fs, file } = ctx(opts);
  const prefs = loadPrefs(fs, file);
  const l = normLang(lang);
  if (l) prefs.lang[acct] = l; else delete prefs.lang[acct];
  (fs.write || realFs.write)(file, JSON.stringify(prefs));
  return { ok: true, account: acct, lang: l || null };
}

/** Read an account's preferred language, or '' if none/unset. */
export function getLang(account, opts = {}) {
  const acct = _acct(account);
  if (!acct) return '';
  const { fs, file } = ctx(opts);
  return loadPrefs(fs, file).lang[acct] || '';
}

// ── translation provider (keyless MyMemory by default; LibreTranslate-style via env) ────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

// Only the base language (before any region) is sent to the provider — providers key on 'en'/'es'/'zh'.
const baseLang = (l) => normLang(l).split('-')[0];

// in-memory cache: key `${from}|${to}|${text}` → translated string. Capped so it can't grow unbounded.
const _cache = new Map();
const CACHE_MAX = 2000;
function cacheGet(k) { return _cache.has(k) ? _cache.get(k) : undefined; }
function cacheSet(k, v) { if (_cache.size >= CACHE_MAX) { const first = _cache.keys().next().value; _cache.delete(first); } _cache.set(k, v); }

// COMMON, world-lingua-franca languages the cheap MT engines cover well. Anything NOT here is treated as
// potentially one of Hathor's specialized tongues and is offered to her Language Center first.
const COMMON = new Set(['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'ru', 'uk', 'pl', 'zh', 'ja', 'ko', 'ar', 'hi', 'tr', 'vi', 'id', 'sw', 'fa', 'he', 'el', 'sv', 'no', 'da', 'fi', 'cs', 'ro', 'hu', 'th', 'bn', 'ur', 'ta', 'ms', 'tl']);

// Specialized router → Hathor's Language Center for the FEW uncommon tongues (Kurdish dialects, scripture +
// ancient languages, …). Injectable for tests; the default lazy-imports the Language Center (soft — if it's
// unavailable, e.g. Pentecaust running standalone, we simply fall through to the common MT best-effort).
let _special = null;
export function __setSpecializedRouter(fn) { _special = typeof fn === 'function' ? fn : null; }
async function defaultSpecialized(text, from, to) {
  try {
    const lc = await import('../integrations/language-center.mjs');
    if (lc.isSpecializedLang && lc.isSpecializedLang(to)) {
      const r = await lc.translateSpecialized({ text, to, from });
      return typeof r === 'string' ? r : null;
    }
  } catch {}
  return null;
}
async function routeSpecialized(text, from, to) {
  try { return await (_special || defaultSpecialized)(text, from, to); } catch { return null; }
}

// Call the configured provider. Returns the translated string, or null on any failure (caller soft-fails).
async function callProvider(text, from, to) {
  // Hathor's specialty first: uncommon target languages route into her Language Center; common ones skip it.
  if (!COMMON.has(to)) { const s = await routeSpecialized(text, from, to); if (typeof s === 'string' && s.trim()) return s; }
  const url = env('TRANSLATE_URL', '');
  try {
    if (url) {
      // LibreTranslate-compatible: POST { q, source, target, format } → { translatedText }
      const body = { q: text, source: from || 'auto', target: to, format: 'text' };
      const key = env('TRANSLATE_API_KEY', '');
      if (key) body.api_key = key;
      const r = await _fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      return (j && typeof j.translatedText === 'string') ? j.translatedText : null;
    }
    // Default: MyMemory — keyless, GET, langpair=from|to. Free + works live with zero setup.
    const langpair = `${from || 'en'}|${to}`;
    const u = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langpair)}`;
    const r = await _fetch(u);
    const j = await r.json();
    const t = j && j.responseData && j.responseData.translatedText;
    return (typeof t === 'string' && t) ? t : null;
  } catch { return null; }
}

/**
 * Translate `text` into `to` (from `from`, default 'en'). Soft-fails to the original.
 * @returns {{ text:string, tr:(string|null), to:string, from:string }}
 *          `tr` is null when there's nothing to do (no text / no target / same language / provider failure /
 *          the provider echoed the input). The original `text` is always returned untouched.
 */
export async function translate({ text, to, from } = {}) {
  const original = String(text == null ? '' : text);
  const target = baseLang(to);
  const source = baseLang(from) || 'en';
  if (!original.trim() || !target || target === source) return { text: original, tr: null, to: target, from: source };
  const key = `${source}|${target}|${original}`;
  const hit = cacheGet(key);
  if (hit !== undefined) return { text: original, tr: hit, to: target, from: source };
  const out = await callProvider(original, source, target);
  // Treat an identical echo as "no translation" so the UI doesn't show a redundant duplicate line.
  const tr = (out && out.trim() && out.trim() !== original.trim()) ? out : null;
  cacheSet(key, tr);
  return { text: original, tr, to: target, from: source };
}

/**
 * Translate a batch of strings into `to` — for the on-demand "Translate this page?" widget, which collects
 * a page's visible text nodes and translates them in one round-trip. Returns an array aligned to the input:
 * each entry is the translation, or null where there's nothing to do / it failed (caller keeps the original).
 * Bounded by `max`; translations run concurrently and share the cache.
 */
export async function translateBatch(texts, to, opts = {}) {
  const list = Array.isArray(texts) ? texts : [];
  const target = baseLang(to);
  const from = opts.from;
  const cap = Math.min(list.length, opts.max || 200);
  const out = new Array(list.length).fill(null);
  await Promise.all(list.slice(0, cap).map(async (t, i) => {
    try { const r = await translate({ text: t, to: target, from }); out[i] = r.tr; } catch { out[i] = null; }
  }));
  return out;
}

// ── localized affordance labels — the "Translate?" prompt is shown in the READER's OWN language ─────────
// (Optional translation: nothing is translated until the reader clicks. The ask itself must be legible to
// them, so we localize the word.) Unknown languages fall back to English. Kurdish (ku) included per the
// operator's audience. Extend freely.
const ASK = {
  en: 'Translate?', es: '¿Traducir?', fr: 'Traduire ?', de: 'Übersetzen?', pt: 'Traduzir?', it: 'Tradurre?',
  nl: 'Vertalen?', ru: 'Перевести?', zh: '翻译？', ja: '翻訳しますか？', ko: '번역하시겠어요?', ar: 'ترجمة؟',
  hi: 'अनुवाद करें?', tr: 'Çevir?', ku: 'Wergerîne?', fa: 'ترجمه؟', he: 'לתרגם?', pl: 'Przetłumaczyć?',
  uk: 'Перекласти?', vi: 'Dịch?', id: 'Terjemahkan?', sw: 'Tafsiri?',
};
const ORIG = {
  en: 'Show original', es: 'Ver original', fr: "Voir l'original", de: 'Original anzeigen', pt: 'Ver original',
  ru: 'Показать оригинал', zh: '显示原文', ja: '原文を表示', ar: 'النص الأصلي', ku: 'Nivîsa resen', tr: 'Orijinali göster',
};
/** The localized "Translate?" prompt for a reader's language (English fallback). */
export const translateLabel = (lang) => ASK[baseLang(lang)] || ASK.en;
/** The localized "Show original" label for a reader's language (English fallback). */
export const originalLabel = (lang) => ORIG[baseLang(lang)] || ORIG.en;

// ── CLI (guarded) — quick live check: `node pentecaust/translate.mjs "Hello world" es` ─────────────────
if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  const text = process.argv[2] || 'Welcome to Pentecaust — every nation hears in its own language.';
  const to = process.argv[3] || 'es';
  const r = await translate({ text, to });
  console.log(JSON.stringify({ from: r.from, to: r.to, original: r.text, translated: r.tr }, null, 2));
}
