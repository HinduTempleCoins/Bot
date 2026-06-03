// translate.mjs — SoapBox translation layer (queue #109). Lets the aggregator render headlines /
// chyron / summaries in a reader's language. Primary backend: LibreTranslate — open-source,
// self-hostable, free, no per-call key required for a public/self-hosted instance.
//
//   LIBRETRANSLATE_URL  base URL of the instance (default https://libretranslate.com)
//   LIBRETRANSLATE_KEY  optional api_key for instances that gate usage (soft-fail if absent)
//
// Soft-fail philosophy (matches macro.mjs / news.mjs): a translation backend going down must
// NEVER break the page. Every public function returns the ORIGINAL text (or a safe fallback)
// on any error — we never throw out of here.
//
// Fallback chain: if LibreTranslate fails we leave a HOOK for an LLM-backed provider
// (Gemini / Cloudflare Workers-AI), reusing creds the operator already holds elsewhere. The
// hook is intentionally a stub — provider key wiring is deferred, not implemented here.
//
// NOTE: a Tor exit/relay or general web-proxy that would "translate by fetching the page
// for the user" is a legal/abuse LIABILITY and is deliberately NOT included here. This module
// only sends short strings to a translation API; it never proxies arbitrary URLs.

const BASE = () => (process.env.LIBRETRANSLATE_URL || 'https://libretranslate.com').replace(/\/+$/, '');
const KEY = () => process.env.LIBRETRANSLATE_KEY || '';

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// LibreTranslate refuses very long bodies; keep each request comfortably small.
const MAX_CHARS = 4500;

/**
 * PURE: split `text` into chunks no longer than `max` chars, breaking on sentence
 * boundaries where possible. Falls back to whitespace, then to a hard cut, so a single
 * unbreakable run still gets chunked. Empty/blank input → []. No I/O, deterministic.
 */
export function chunkText(text, max = MAX_CHARS) {
  const s = typeof text === 'string' ? text : '';
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : MAX_CHARS;
  if (!s.trim()) return [];
  if (s.length <= limit) return [s];

  // Split into sentence-ish pieces, keeping their trailing punctuation/whitespace.
  const pieces = s.match(/[^.!?\n]*[.!?\n]+\s*|[^.!?\n]+$/g) || [s];
  const chunks = [];
  let buf = '';
  const flush = () => { if (buf) { chunks.push(buf); buf = ''; } };

  for (let piece of pieces) {
    // A single sentence longer than the limit: break it on whitespace, then hard-cut.
    while (piece.length > limit) {
      const slice = piece.slice(0, limit);
      const sp = slice.lastIndexOf(' ');
      const cut = sp > limit * 0.5 ? sp + 1 : limit; // prefer a word boundary past halfway
      flush();
      chunks.push(piece.slice(0, cut));
      piece = piece.slice(cut);
    }
    if (!piece) continue;
    if ((buf + piece).length > limit) flush();
    buf += piece;
  }
  flush();
  return chunks;
}

// Normalize one LibreTranslate /translate response body into a plain string, or null on shape error.
function normTranslate(body) {
  if (body == null) return null;
  if (typeof body === 'string') return body; // some proxies return the bare string
  const t = body.translatedText;
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) return t.join('');
  return null;
}

// Normalize one LibreTranslate /detect response into { language, confidence } or null.
function normDetect(body) {
  const arr = Array.isArray(body) ? body : (body && Array.isArray(body.detections) ? body.detections : null);
  if (!arr || !arr.length) return null;
  const top = arr[0];
  if (!top || typeof top.language !== 'string') return null;
  return { language: top.language, confidence: typeof top.confidence === 'number' ? top.confidence : null };
}

// Normalize /languages into [{ code, name }]. Best-effort; bad rows dropped.
function normLanguages(body) {
  if (!Array.isArray(body)) return null;
  const out = body
    .filter((l) => l && typeof l.code === 'string')
    .map((l) => ({ code: l.code, name: typeof l.name === 'string' ? l.name : l.code }));
  return out.length ? out : null;
}

async function post(path, payload) {
  const r = await _fetch(`${BASE()}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(KEY() ? { ...payload, api_key: KEY() } : payload),
  });
  if (!r || !r.ok) return null;
  return r.json();
}

/**
 * Fallback hook: LLM-backed translation via creds the operator already holds (Gemini /
 * Cloudflare Workers-AI). Intentionally a STUB — provider key wiring is deferred. Returns
 * null so the caller falls back to the original text. Wire a real provider here later.
 */
async function llmFallback(/* { text, source, target } */) {
  return null;
}

/**
 * Translate `text` into `target` language (ISO code). `source` defaults to 'auto'.
 * Long text is chunked and reassembled. Soft-fail: returns the ORIGINAL text on any failure.
 */
export async function translate({ text, source = 'auto', target } = {}) {
  const original = typeof text === 'string' ? text : '';
  if (!original.trim() || !target || source === target) return original;
  try {
    const parts = chunkText(original);
    const translated = [];
    for (const part of parts) {
      const body = await post('/translate', { q: part, source, target, format: 'text' });
      const out = normTranslate(body);
      if (out == null) {
        const alt = await llmFallback({ text: part, source, target });
        if (alt == null) return original; // give up cleanly, keep the original whole
        translated.push(alt);
      } else {
        translated.push(out);
      }
    }
    const joined = translated.join('');
    return joined.trim() ? joined : original;
  } catch {
    return original;
  }
}

/**
 * Detect the language of `text`. Returns { language, confidence } or null on failure
 * (soft-fail: callers treat null as "unknown", they don't crash).
 */
export async function detect(text) {
  const s = typeof text === 'string' ? text : '';
  if (!s.trim()) return null;
  try {
    return normDetect(await post('/detect', { q: s }));
  } catch {
    return null;
  }
}

/**
 * List supported languages as [{ code, name }]. Returns [] on failure (soft-fail).
 */
export async function languages() {
  try {
    const r = await _fetch(`${BASE()}/languages`, { headers: { accept: 'application/json' } });
    if (!r || !r.ok) return [];
    return normLanguages(await r.json()) || [];
  } catch {
    return [];
  }
}

if (process.argv[1] && process.argv[1].endsWith('translate.mjs')) {
  const [, , target = 'es', ...rest] = process.argv;
  const text = rest.join(' ') || 'Bitcoin reaches a new all-time high as markets rally.';
  console.log('source :', text);
  console.log('detect :', JSON.stringify(await detect(text)));
  console.log(`-> ${target}:`, await translate({ text, target }));
}
