// voice-tier.mjs — Hathor voice I/O adapter (queue #98). A thin, soft-failing layer over
// self-hostable open engines so the Witness can listen and speak without any cloud/keys:
//   - Whisper (ASR / speech-to-text)  — https://github.com/openai/whisper / faster-whisper servers
//   - Piper   (TTS / text-to-speech)  — https://github.com/rhasspy/piper
//   - OVOS    (OpenVoiceOS assistant) — https://www.openvoiceos.org/
// Everything is reached through CONFIGURABLE endpoints (env vars). If an endpoint is unset, the
// relevant call SOFT-FAILS (returns a null-ish result with a reason) and NEVER throws — voice is an
// optional capability layered on top of a text-first bot. No keys live here; these are self-hosted
// services on the operator's own infra, addressed by URL only.
//
// Pattern mirrors integrations/soapbox/macro.mjs: ESM, injectable fetch via __setFetch, CLI guarded
// by process.argv[1].endsWith('voice-tier.mjs'). transcribe/speak also accept an injected client so
// the engine round-trip can be unit-tested offline.

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Endpoints come from the environment; absent → that engine is "not configured" and soft-fails.
export const ENGINES = {
  whisper: () => process.env.HATHOR_WHISPER_URL || '',   // ASR endpoint, e.g. http://127.0.0.1:9000/asr
  piper:   () => process.env.HATHOR_PIPER_URL   || '',   // TTS endpoint, e.g. http://127.0.0.1:5000/api/tts
  ovos:    () => process.env.HATHOR_OVOS_URL    || '',   // OVOS assistant bus/HTTP bridge
};

// Available Piper-style voices Hathor can speak in. en_GB-jenny is the warm default; the others let
// pickVoice resolve preferences (language, gender, named voice) deterministically and offline.
export const VOICES = [
  { id: 'en_GB-jenny',    lang: 'en', locale: 'en-GB', gender: 'f', name: 'jenny',    default: true },
  { id: 'en_US-amy',      lang: 'en', locale: 'en-US', gender: 'f', name: 'amy' },
  { id: 'en_US-ryan',     lang: 'en', locale: 'en-US', gender: 'm', name: 'ryan' },
  { id: 'en_GB-alan',     lang: 'en', locale: 'en-GB', gender: 'm', name: 'alan' },
  { id: 'es_ES-davefx',   lang: 'es', locale: 'es-ES', gender: 'm', name: 'davefx' },
  { id: 'fr_FR-siwis',    lang: 'fr', locale: 'fr-FR', gender: 'f', name: 'siwis' },
];

export const DEFAULT_VOICE = VOICES.find((v) => v.default) || VOICES[0];

/**
 * PURE. Resolve a Piper voice id from caller preferences. Never throws; always returns a voice id.
 * prefs: { voice?, name?, lang?, locale?, gender? }
 *   - voice / name: exact voice id or short name match wins first
 *   - locale: exact locale match (en-US)
 *   - lang + gender: best fit within a language
 *   - lang alone: first voice in that language
 * Falls back to DEFAULT_VOICE when nothing matches.
 */
export function pickVoice(prefs = {}) {
  const p = prefs || {};
  const want = (s) => String(s || '').trim().toLowerCase();

  // 1. exact voice id or short name.
  const named = want(p.voice || p.name);
  if (named) {
    const hit = VOICES.find((v) => v.id.toLowerCase() === named || v.name.toLowerCase() === named);
    if (hit) return hit.id;
  }

  // 2. exact locale.
  const locale = want(p.locale);
  if (locale) {
    const hit = VOICES.find((v) => v.locale.toLowerCase() === locale);
    if (hit) return hit.id;
  }

  // 3. language (+ optional gender).
  const lang = want(p.lang) || (locale ? locale.split('-')[0] : '');
  const gender = want(p.gender);
  if (lang) {
    const inLang = VOICES.filter((v) => v.lang === lang);
    if (inLang.length) {
      if (gender) {
        const g = gender.startsWith('m') ? 'm' : gender.startsWith('f') ? 'f' : '';
        const gHit = inLang.find((v) => v.gender === g);
        if (gHit) return gHit.id;
      }
      return inLang[0].id;
    }
  }

  return DEFAULT_VOICE.id;
}

/**
 * PURE. Split long text into TTS-sized chunks on sentence boundaries. Engines (Piper) choke / clip on
 * very long inputs, so we break after sentence-ending punctuation and pack sentences up to maxLen.
 * A single sentence longer than maxLen is hard-split on whitespace as a last resort. Never throws;
 * returns [] for empty input.
 */
export function chunkForTts(text, maxLen = 280) {
  const src = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!src) return [];
  const limit = Number.isFinite(maxLen) && maxLen > 0 ? Math.floor(maxLen) : 280;

  // Sentence pieces: keep the terminating punctuation with the sentence.
  const sentences = src.match(/[^.!?…]+[.!?…]+(?:["')\]]+)?|\S[^.!?…]*$/g) || [src];

  const out = [];
  let buf = '';
  const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };

  for (let s of sentences) {
    s = s.trim();
    if (!s) continue;

    // A lone sentence too big for one chunk → hard-split on whitespace.
    if (s.length > limit) {
      flush();
      const words = s.split(' ');
      let w = '';
      for (const word of words) {
        if (w && (w.length + 1 + word.length) > limit) { out.push(w); w = ''; }
        // a single word longer than the limit gets sliced.
        if (word.length > limit) {
          if (w) { out.push(w); w = ''; }
          for (let i = 0; i < word.length; i += limit) out.push(word.slice(i, i + limit));
        } else {
          w = w ? `${w} ${word}` : word;
        }
      }
      if (w) out.push(w);
      continue;
    }

    if (buf && (buf.length + 1 + s.length) > limit) flush();
    buf = buf ? `${buf} ${s}` : s;
  }
  flush();
  return out;
}

// Normalize whatever a Whisper-style ASR server / injected client returns into a stable shape.
function normalizeTranscript(raw) {
  if (raw == null) return { ok: false, text: '', reason: 'empty-response' };
  if (typeof raw === 'string') return { ok: true, text: raw.trim(), language: null, segments: [] };
  const text = String(raw.text ?? raw.transcript ?? raw.result ?? '').trim();
  return {
    ok: text.length > 0,
    text,
    language: raw.language ?? raw.lang ?? null,
    segments: Array.isArray(raw.segments) ? raw.segments : [],
    ...(text.length ? {} : { reason: 'no-text' }),
  };
}

// Normalize a Piper-style TTS server / injected client response into an audio reference.
function normalizeAudio(raw, voice) {
  if (raw == null) return { ok: false, audioRef: null, reason: 'empty-response' };
  if (typeof raw === 'string') return { ok: true, audioRef: raw, kind: 'url', voice };
  const audioRef = raw.audioRef ?? raw.url ?? raw.path ?? raw.file ?? raw.audio ?? null;
  return audioRef
    ? { ok: true, audioRef, kind: raw.kind ?? (typeof audioRef === 'string' && /^https?:|^\// .test(audioRef) ? (audioRef.startsWith('http') ? 'url' : 'path') : 'data'), voice: raw.voice ?? voice, mime: raw.mime ?? raw.contentType ?? null }
    : { ok: false, audioRef: null, reason: 'no-audio', voice };
}

/**
 * ASR — transcribe audio to text via a Whisper endpoint. SOFT-FAIL: returns { ok:false, reason } when
 * no endpoint is configured or the call fails; never throws.
 * opts:
 *   - audioRef: url/path/identifier of the audio to transcribe (required)
 *   - language: optional hint passed to the engine
 *   - client: optional injected async fn(audioRef, opts) → response (bypasses HTTP, for tests/embedding)
 */
export async function transcribe({ audioRef, language, client } = {}) {
  if (!audioRef) return { ok: false, text: '', reason: 'no-audio-ref' };

  if (typeof client === 'function') {
    try { return normalizeTranscript(await client(audioRef, { language })); }
    catch (e) { return { ok: false, text: '', reason: `client-error: ${e?.message || e}` }; }
  }

  const url = ENGINES.whisper();
  if (!url) return { ok: false, text: '', reason: 'whisper-not-configured' };

  try {
    const r = await _fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ audio: audioRef, ...(language ? { language } : {}) }),
    });
    if (!r || !r.ok) return { ok: false, text: '', reason: `whisper-http-${r ? r.status : 'no-response'}` };
    const ct = (r.headers?.get?.('content-type') || '').toLowerCase();
    const body = ct.includes('json') ? await r.json() : await r.text();
    return normalizeTranscript(body);
  } catch (e) {
    return { ok: false, text: '', reason: `whisper-error: ${e?.message || e}` };
  }
}

/**
 * TTS — synthesize speech from text via a Piper endpoint. Returns an audio reference (url/path/data).
 * SOFT-FAIL: returns { ok:false, reason } when no endpoint is configured or the call fails; never throws.
 * opts:
 *   - text: text to speak (required)
 *   - voice: voice preference (string id, short name, or prefs object → resolved by pickVoice)
 *   - client: optional injected async fn(text, { voice }) → response (bypasses HTTP, for tests/embedding)
 */
export async function speak({ text, voice, client } = {}) {
  const t = String(text == null ? '' : text).trim();
  if (!t) return { ok: false, audioRef: null, reason: 'no-text' };

  const voiceId = pickVoice(typeof voice === 'string' ? { voice } : (voice || {}));

  if (typeof client === 'function') {
    try { return normalizeAudio(await client(t, { voice: voiceId }), voiceId); }
    catch (e) { return { ok: false, audioRef: null, reason: `client-error: ${e?.message || e}`, voice: voiceId }; }
  }

  const url = ENGINES.piper();
  if (!url) return { ok: false, audioRef: null, reason: 'piper-not-configured', voice: voiceId };

  try {
    const r = await _fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ text: t, voice: voiceId }),
    });
    if (!r || !r.ok) return { ok: false, audioRef: null, reason: `piper-http-${r ? r.status : 'no-response'}`, voice: voiceId };
    const ct = (r.headers?.get?.('content-type') || '').toLowerCase();
    const body = ct.includes('json') ? await r.json() : await r.text();
    return normalizeAudio(body, voiceId);
  } catch (e) {
    return { ok: false, audioRef: null, reason: `piper-error: ${e?.message || e}`, voice: voiceId };
  }
}

if (process.argv[1] && process.argv[1].endsWith('voice-tier.mjs')) {
  const sample = process.argv.slice(2).join(' ') ||
    'Peace be upon you. This is the Witness speaking. The chunker splits long passages on sentence boundaries; each piece is then handed to Piper for synthesis.';
  console.log('engines configured:',
    'whisper=' + (ENGINES.whisper() ? 'yes' : 'no'),
    'piper=' + (ENGINES.piper() ? 'yes' : 'no'),
    'ovos=' + (ENGINES.ovos() ? 'yes' : 'no'));
  console.log('default voice:', DEFAULT_VOICE.id);
  console.log('pickVoice({lang:"es"}):', pickVoice({ lang: 'es' }));
  const chunks = chunkForTts(sample, 80);
  console.log(`\nchunkForTts → ${chunks.length} chunk(s):`);
  chunks.forEach((c, i) => console.log(`  [${i}] (${c.length}) ${c}`));
  console.log('\nspeak (no endpoint, soft-fail):', await speak({ text: sample }));
  console.log('transcribe (no endpoint, soft-fail):', await transcribe({ audioRef: 'sample.wav' }));
}
